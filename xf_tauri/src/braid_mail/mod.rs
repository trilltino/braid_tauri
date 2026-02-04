//! Braid Mail Module
//!
//! Uses braid-http directly without wrappers.
//! State management is external (commands hold their own state).

pub use braid_http::{BraidClient, BraidRequest, BraidResponse};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::{error, info, warn};

/// Mail feed item from subscription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidMailFeedItem {
    pub link: String,
}

/// Parse feed items from JSON body
pub fn parse_feed_items(body: &str) -> Vec<BraidMailFeedItem> {
    // Try multiple formats:
    // 1. [ {"link": "..."}, ... ]
    // 2. [ "/post/1", "/post/2" ] (Direct links)

    if let Ok(items_with_nulls) = serde_json::from_str::<Vec<Option<BraidMailFeedItem>>>(body) {
        return items_with_nulls.into_iter().flatten().collect();
    }

    if let Ok(links) = serde_json::from_str::<Vec<String>>(body) {
        return links.into_iter().map(|link| BraidMailFeedItem { link }).collect();
    }

    warn!(
        "Failed to parse feed body. Preview: {}",
        if body.len() > 200 { &body[..200] } else { body }
    );
    Vec::new()
}

/// Fetch mail post using BraidClient directly
pub async fn fetch_post(client: &BraidClient, base_url: &str, url: &str) -> Result<crate::models::MailPost> {
    let req = BraidRequest::new();

    // Ensure absolute URL
    let absolute_url = if !url.starts_with("http") {
        format!(
            "{}{}{}",
            base_url.trim_end_matches('/'),
            if url.starts_with('/') { "" } else { "/" },
            url
        )
    } else {
        url.to_string()
    };

    let resp = client.fetch(&absolute_url, req).await?;
    let body = String::from_utf8_lossy(&resp.body);

    let json: Value = serde_json::from_str(&body)?;

    Ok(crate::models::MailPost {
        url: url.to_string(),
        date: json.get("date").and_then(|v| v.as_u64()).map(|v| v * 1000),
        from: json.get("from").and_then(|v| serde_json::from_value(v.clone()).ok()),
        to: json.get("to").and_then(|v| serde_json::from_value(v.clone()).ok()),
        subject: json.get("subject").and_then(|v| v.as_str()).map(|s| s.to_string()),
        body: json.get("body").and_then(|v| v.as_str()).map(|s| s.to_string()),
        version: resp.headers.get("version").map(|s| s.to_string()),
    })
}

/// Put/save mail post using BraidClient directly
pub async fn put_post(
    client: &BraidClient,
    base_url: &str,
    mut post: crate::models::MailPost,
) -> Result<String> {
    if post.url.is_empty() {
        let id = uuid::Uuid::new_v4().to_string();
        post.url = format!("{}/post/{}", base_url, id);
    }

    let body_json = serde_json::json!({
        "subject": post.subject,
        "body": post.body,
        "from": post.from,
        "to": post.to,
        "date": post.date.map(|d| d / 1000),
    });

    info!("PUT Post to {}", post.url);
    let req = BraidRequest::new();

    client.put(&post.url, &body_json.to_string(), req).await?;

    Ok(post.url)
}

/// Start mail subscription - returns stream for caller to handle
pub async fn subscribe_mail_feed(
    client: &BraidClient,
    base_url: &str,
    last_version: Option<String>,
) -> Result<braid_http::client::Subscription> {
    let url = format!("{}/feed", base_url);
    let mut req = BraidRequest::new().subscribe();

    req.peer = Some(uuid::Uuid::new_v4().to_string());
    if let Some(p) = last_version {
        req.parents = Some(vec![braid_http::types::Version::new(&p)]);
    }

    info!("Starting Braidmail subscription to {}", url);
    client.subscribe(&url, req).await.map_err(|e| anyhow::anyhow!(e))
}

/// Send Braid mail message via PUT
pub async fn send_braid_mail(client: &BraidClient, url: &str, body: &str) -> Result<()> {
    info!("Sending Braid Mail: {}", url);
    let request = BraidRequest::new().with_header("Content-Type", "application/json");
    let resp = client.put(url, body, request).await?;

    if (200..300).contains(&resp.status) {
        Ok(())
    } else {
        anyhow::bail!("Braid Put failed with status: {}", resp.status)
    }
}

/// Fetch Braid mail feed
pub async fn get_braid_mail_feed(client: &BraidClient, url: &str) -> Result<String> {
    info!("Fetching Braid Mail Feed: {}", url);
    let request = BraidRequest::new();
    let resp = client.fetch(url, request).await?;

    if (200..300).contains(&resp.status) {
        Ok(String::from_utf8_lossy(&resp.body).to_string())
    } else {
        anyhow::bail!("Braid Fetch failed with status: {}", resp.status)
    }
}
