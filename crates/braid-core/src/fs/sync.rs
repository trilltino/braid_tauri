use crate::core::{protocol_mod as protocol, BraidError, Result};
use crate::fs::state::DaemonState;
use braid_http::types::{BraidRequest, Version as BraidVersion};
use std::path::PathBuf;
use std::process::Command;
use tracing::{error, info};

/// Logic for syncing a local file to a remote Braid URL.
pub async fn sync_local_to_remote(
    _path: &PathBuf,
    url_in: &str,
    parents: &[String],
    _original_content: Option<String>,
    new_content: String,
    content_type: Option<String>,
    state: DaemonState,
) -> Result<()> {
    let url_str = url_in.trim_matches('"').trim().to_string();
    info!("[BraidFS] Syncing {} to remote...", url_str);

    // 1. Special case for braid.org using subprocess curl for max compatibility
    // This bypasses history-related 309 Conflicts for Braid Wiki resources.
    if url_str.contains("braid.org") {
        let mut cookie_str = String::new();
        let mut parents_header = String::new();

        if let Ok(u) = url::Url::parse(&url_str) {
            if let Some(domain) = u.domain() {
                // 1. Fetch Auth
                let cfg = state.config.read().await;
                if let Some(token) = cfg.cookies.get(domain) {
                    cookie_str = if token.contains('=') {
                        token.clone()
                    } else {
                        format!("client={}", token)
                    };
                }
            }
        }

        // 2. Proactively fetch latest version (Parents) to avoid 309 Conflict
        let mut head_req = BraidRequest::new().with_method("GET");
        if !cookie_str.is_empty() {
            head_req = head_req.with_header("Cookie", cookie_str.clone());
        }

        if let Ok(res) = state.client.fetch(&url_str, head_req).await {
            if let Some(v_header) = res.header("version").or(res.header("current-version")) {
                parents_header = v_header.to_string();
                info!("[BraidFS] Found parents for braid.org: {}", parents_header);
            }
        }

        let mut curl_cmd = Command::new("curl.exe");
        curl_cmd
            .arg("-i")
            .arg("-s")
            .arg("-X")
            .arg("PUT")
            .arg(&url_str);

        if !cookie_str.is_empty() {
            curl_cmd.arg("-H").arg(format!("Cookie: {}", cookie_str));
        }

        if !parents_header.is_empty() {
            curl_cmd
                .arg("-H")
                .arg(format!("Parents: {}", parents_header));
        }

        let output = curl_cmd
            .arg("-H")
            .arg("Accept: */*")
            .arg("-H")
            .arg("User-Agent: curl/8.0.1")
            .arg("-d")
            .arg(&new_content)
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);

                if stdout.contains("200 OK")
                    || stdout.contains("209 Subscription")
                    || stdout.contains("204 No Content")
                    || stdout.contains("201 Created")
                {
                    state.failed_syncs.write().await.remove(&url_str);
                    info!("[BraidFS] Sync success (curl) for {}", url_str);
                    state
                        .content_cache
                        .write()
                        .await
                        .insert(url_str.clone(), new_content.clone());
                    return Ok(());
                } else {
                    let status_line = stdout.lines().next().unwrap_or("Unknown").to_string();
                    let status_code = if status_line.contains("309") {
                        309
                    } else {
                        500
                    };
                    let err_msg = format!(
                        "Sync failed (curl). Status: {}. Stderr: {}",
                        status_line, stderr
                    );
                    error!("[BraidFS] {}", err_msg);
                    state
                        .failed_syncs
                        .write()
                        .await
                        .insert(url_str.clone(), (status_code, std::time::Instant::now()));
                    return Err(BraidError::Http(err_msg));
                }
            }
            Err(e) => {
                error!("[BraidFS] Failed to spawn curl: {}", e);
                return Err(BraidError::Io(e));
            }
        }
    }

    // 2. Standard Braid Protocol Path
    let mut request = BraidRequest::new().with_method("PUT");
    let mut effective_parents = parents.to_vec();

    if effective_parents.is_empty() {
        let mut head_req = BraidRequest::new()
            .with_method("GET")
            .with_header("Accept", "text/plain");

        if let Ok(u) = url::Url::parse(&url_str) {
            if let Some(domain) = u.domain() {
                let cfg = state.config.read().await;
                if let Some(token) = cfg.cookies.get(domain) {
                    let cookie_str = if token.contains('=') {
                        token.clone()
                    } else {
                        format!("token={}", token)
                    };
                    head_req = head_req.with_header("Cookie", cookie_str);
                }
            }
        }

        if let Ok(res) = state.client.fetch(&url_str, head_req).await {
            if let Some(v_header) = res
                .headers
                .get("version")
                .or(res.headers.get("current-version"))
            {
                if let Ok(versions) = protocol::parse_version_header(v_header) {
                    for v in versions {
                        let v_str = match v {
                            BraidVersion::String(s) => s,
                            BraidVersion::Integer(i) => i.to_string(),
                        };
                        let normalized = v_str.trim_matches('"').to_string();
                        if !normalized.is_empty() {
                            effective_parents.push(normalized);
                        }
                    }
                }
            }
        }
    }

    if !effective_parents.is_empty() {
        let filtered_parents: Vec<BraidVersion> = effective_parents
            .iter()
            .filter(|p| !p.starts_with("temp-") && !p.starts_with("missing-"))
            .map(|p| BraidVersion::new(p))
            .collect();

        if !filtered_parents.is_empty() {
            request = request.with_parents(filtered_parents);
        }
    }

    let ct = content_type.unwrap_or_else(|| "text/plain".to_string());
    request = request.with_content_type(ct);
    let mut final_request = request.with_body(new_content.clone());

    if let Ok(u) = url::Url::parse(&url_str) {
        if let Some(domain) = u.domain() {
            let cfg = state.config.read().await;
            if let Some(token) = cfg.cookies.get(domain) {
                let cookie_str = if token.contains('=') {
                    token.clone()
                } else {
                    format!("token={}", token)
                };
                final_request = final_request.with_header("Cookie", cookie_str);
            }
        }
    }

    let status = match state.client.fetch(&url_str, final_request).await {
        Ok(res) => {
            if (200..300).contains(&res.status) {
                state.failed_syncs.write().await.remove(&url_str);
                info!("[BraidFS] Sync success (braid) status: {}", res.status);
                state
                    .content_cache
                    .write()
                    .await
                    .insert(url_str.clone(), new_content);
                return Ok(());
            }
            res.status
        }
        Err(e) => {
            error!("[BraidFS] Sync error: {}", e);
            500
        }
    };

    let err_msg = format!("Sync failed: HTTP {}", status);
    state
        .failed_syncs
        .write()
        .await
        .insert(url_str, (status, std::time::Instant::now()));
    Err(BraidError::Http(err_msg))
}

/// Logic for syncing a local binary file to a remote Braid URL.
pub async fn sync_binary_to_remote(
    _path: &std::path::Path,
    url_in: &str,
    parents: &[String],
    data: bytes::Bytes,
    content_type: Option<String>,
    state: DaemonState,
) -> Result<()> {
    let url_str = url_in.trim_matches('"').trim().to_string();
    info!("[BraidFS] Syncing binary {} to remote...", url_str);

    // 1. Proactively fetch latest version (Parents) to avoid 309 Conflict if not provided
    let mut parents_header = String::new();
    if parents.is_empty() {
        let head_req = BraidRequest::new().with_method("GET");
        if let Ok(res) = state.client.fetch(&url_str, head_req).await {
            if let Some(v_header) = res.header("version").or(res.header("current-version")) {
                parents_header = v_header.to_string();
            }
        }
    } else {
        // Simple join for now, protocol::format_version_header could be used but it's likely single parent usually
        parents_header = format!("\"{}\"", parents.join("\", \""));
    }

    // 2. Determine auth
    let mut cookie_str = String::new();
    if let Ok(u) = url::Url::parse(&url_str) {
        if let Some(domain) = u.domain() {
            let cfg = state.config.read().await;
            if let Some(token) = cfg.cookies.get(domain) {
                cookie_str = if token.contains('=') {
                    token.clone()
                } else {
                    format!("client={}", token)
                };
            }
        }
    }

    // 3. Perform PUT using curl for maximum compatibility with braid.org
    let mut curl_cmd = Command::new("curl.exe");
    curl_cmd
        .arg("-i")
        .arg("-s")
        .arg("-X")
        .arg("PUT")
        .arg(&url_str);

    if !cookie_str.is_empty() {
        curl_cmd.arg("-H").arg(format!("Cookie: {}", cookie_str));
    }

    if !parents_header.is_empty() {
        curl_cmd
            .arg("-H")
            .arg(format!("Parents: {}", parents_header));
    }

    let ct = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
    curl_cmd.arg("-H").arg(format!("Content-Type: {}", ct));

    // For binary, we'll pipe the data to curl
    use std::io::Write;
    let mut child = curl_cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| BraidError::Io(e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| BraidError::Fs("Failed to open stdin for curl".to_string()))?;
    stdin.write_all(&data).map_err(|e| BraidError::Io(e))?;
    drop(stdin);

    let out = child.wait_with_output().map_err(|e| BraidError::Io(e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    if stdout.contains("200 OK")
        || stdout.contains("209 Subscription")
        || stdout.contains("204 No Content")
        || stdout.contains("201 Created")
    {
        info!("[BraidFS] Binary sync success (curl) for {}", url_str);
        return Ok(());
    } else {
        let status_line = stdout.lines().next().unwrap_or("Unknown").to_string();
        let err_msg = format!(
            "Binary sync failed (curl). Status: {}. Stderr: {}",
            status_line, stderr
        );
        error!("[BraidFS] {}", err_msg);
        return Err(BraidError::Http(err_msg));
    }
}
