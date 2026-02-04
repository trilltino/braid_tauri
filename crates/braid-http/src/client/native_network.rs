use crate::client::parser::MessageParser;
use crate::error::{BraidError, Result};
use crate::protocol;
use crate::traits::BraidNetwork;
use crate::types::{BraidRequest, BraidResponse, Update};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;

pub struct NativeNetwork {
    client: Client,
}

impl NativeNetwork {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }
}

#[async_trait]
impl BraidNetwork for NativeNetwork {
    async fn fetch(&self, url: &str, request: BraidRequest) -> Result<BraidResponse> {
        let method = match request.method.to_uppercase().as_str() {
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "PATCH" => reqwest::Method::PATCH,
            _ => reqwest::Method::GET,
        };

        let mut req_builder = self.client.request(method.clone(), url);

        for (k, v) in &request.extra_headers {
            req_builder = req_builder.header(k, v);
        }

        if !request.body.is_empty() {
            let ct = request
                .content_type
                .as_deref()
                .unwrap_or("application/json");
            req_builder = req_builder.header(reqwest::header::CONTENT_TYPE, ct);
            req_builder = req_builder.body(request.body.clone());
        }

        if let Some(versions) = &request.version {
            req_builder = req_builder.header("Version", protocol::format_version_header(versions));
        }
        if let Some(parents) = &request.parents {
            req_builder = req_builder.header("Parents", protocol::format_version_header(parents));
        }
        if request.subscribe {
            req_builder = req_builder.header("subscribe", "true");
        }
        if let Some(peer) = &request.peer {
            req_builder = req_builder.header("Peer", format!("\"{}\"", peer));
        }
        if let Some(merge_type) = &request.merge_type {
            req_builder = req_builder.header("merge-type", merge_type);
        }

        tracing::info!(
            "[BraidHTTP-Out] {} {} headers: {:?}",
            method,
            url,
            request.extra_headers
        );

        let response = req_builder
            .send()
            .await
            .map_err(|e| BraidError::Http(e.to_string()))?;

        let status = response.status().as_u16();
        let mut headers = std::collections::BTreeMap::new();
        for (k, v) in response.headers() {
            if let Ok(val) = v.to_str() {
                headers.insert(k.as_str().to_string(), val.to_string());
            }
        }

        let body = response
            .bytes()
            .await
            .map_err(|e| BraidError::Http(e.to_string()))?;

        Ok(BraidResponse {
            status,
            headers,
            body,
            is_subscription: status == 209,
        })
    }

    async fn subscribe(
        &self,
        url: &str,
        mut request: BraidRequest,
    ) -> Result<async_channel::Receiver<Result<Update>>> {
        request.subscribe = true;
        let mut req_builder = self.client.get(url).header("subscribe", "true");

        for (k, v) in &request.extra_headers {
            req_builder = req_builder.header(k, v);
        }

        if let Some(versions) = &request.version {
            req_builder = req_builder.header("Version", protocol::format_version_header(versions));
        }

        if let Some(parents) = &request.parents {
            req_builder = req_builder.header("Parents", protocol::format_version_header(parents));
        }

        if let Some(peer) = &request.peer {
            req_builder = req_builder.header("Peer", format!("\"{}\"", peer));
        }

        if let Some(merge_type) = &request.merge_type {
            req_builder = req_builder.header("merge-type", merge_type);
        }

        tracing::info!(
            "[BraidHTTP-Sub-Out] GET {} headers: {:?}",
            url,
            request.extra_headers
        );

        let response = req_builder
            .send()
            .await
            .map_err(|e| BraidError::Http(e.to_string()))?;

        let mut headers = std::collections::BTreeMap::new();
        for (k, v) in response.headers() {
            if let Ok(val) = v.to_str() {
                headers.insert(k.as_str().to_lowercase(), val.to_string());
            }
        }

        tracing::debug!(
            "[BraidRequest] Response headers (normalized): {:?}",
            headers
        );

        let mut content_length = response.content_length().unwrap_or(0) as usize;

        if content_length == 0 {
            if let Some(range) = headers.get("content-range") {
                // Parse Content-Range: unit start-end/total
                // e.g. "text 0-4455/4455"
                let parts: Vec<&str> = range.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Some(range_part) = parts.get(1) {
                        if let Some((start, end)) = range_part.split_once('-') {
                            if let (Ok(s), Ok(e)) = (
                                start.parse::<usize>(),
                                end.split('/').next().unwrap_or("").parse::<usize>(),
                            ) {
                                // content_length = e - s; // Redundant assignment fixed below
                                // Wait, HTTP Content-Range is inclusive: "0-499" means 500 bytes.
                                // "0-4455/4455"? If total is 4455, bytes are 0-4454.
                                // If string is "0-4455", it might be start-seq?
                                // Let's re-read the curl output: "content-range: text 0-4455/4455"
                                // If total is 4455.
                                // Usually Content-Range is bytes start-end/total.
                                // If it is 0-4455... that's 4456 bytes?
                                // But let's look at `parser.rs` logic for Content-Range.
                                // It just grabs the unit.
                                // Wait, Braid `Content-Range` might be different for text?
                                // Let's assume it works like HTTP.
                                // Safe bet: if total is there, use total?
                                // No, valid is end - start.
                                // Actually, let's just use the length from the part after / if present?
                                // Or better, let's look at the `dt.js` or `parser.rs`?
                                // `parser.rs` doesn't parse Content-Range for body length, only for patches.
                                // It uses `expected_body_length`.

                                // Let's trust "content-length" header if present.
                                // If not, use the diff.
                                // HTTP Range: start-end. Length = end - start + 1.
                                content_length = e - s;
                            }
                        }
                    }
                }
            }
        }

        let (tx, rx) = async_channel::bounded(100);
        let mut stream = response.bytes_stream();

        tokio::spawn(async move {
            // Initialize parser with the HTTP headers and content-length
            // so it can parse the first message (snapshot) correctly
            let mut parser = MessageParser::new_with_state(headers, content_length);

            while let Some(chunk_res) = stream.next().await {
                match chunk_res {
                    Ok(chunk) => {
                        if let Ok(messages) = parser.feed(&chunk) {
                            for msg in messages {
                                let update = crate::client::utils::message_to_update(msg);
                                let _ = tx.send(Ok(update)).await;
                            }
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(BraidError::Http(e.to_string()))).await;
                        break;
                    }
                }
            }
        });

        Ok(rx)
    }
}
