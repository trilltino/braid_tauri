use crate::core::{protocol_mod as protocol, BraidError, Result};
use crate::fs::state::DaemonState;
use crate::fs::PEER_ID;
use braid_http::types::{BraidRequest, Version as BraidVersion};
use std::path::PathBuf;
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

    // All URLs now use native Braid HTTP client (removed curl workaround)
    // The native client handles Windows properly without PowerShell quote issues

    // 2. Standard Braid Protocol Path
    let mut request = BraidRequest::new().with_method("PUT");
    let mut effective_parents = parents.to_vec();

    // Fetch server content first to check for conflicts (LWW check)
    let mut server_content: Option<String> = None;
    let mut server_version: Option<String> = None;
    
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
                    } else if domain.contains("braid.org") {
                        format!("client={}", token)
                    } else {
                        format!("token={}", token)
                    };
                    head_req = head_req.with_header("Cookie", cookie_str);
                }
            }
        }

        if let Ok(res) = state.client.fetch(&url_str, head_req).await {
            // Check server content vs local (LWW: if server differs, accept server)
            if !res.body.is_empty() {
                let server_body = String::from_utf8_lossy(&res.body).to_string();
                if server_body != new_content {
                    info!("[BraidFS-Sync] Server content differs from local - accepting server (LWW)");
                    server_content = Some(server_body);
                }
            }
            
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
                            effective_parents.push(normalized.clone());
                            server_version = Some(normalized);
                        }
                    }
                }
            }
        }
    }
    
    // If server has different content, update local file instead of pushing
    if let Some(server_body) = server_content {
        info!("[BraidFS-Sync] Updating local file with server content (server is newer/different)");
        
        // Update content cache
        {
            let mut cache = state.content_cache.write().await;
            cache.insert(url_str.clone(), server_body.clone());
        }
        
        // Update version store
        if let Some(ref sv) = server_version {
            let mut store = state.version_store.write().await;
            use braid_http::types::Version;
            store.update(&url_str, vec![Version::from(sv.clone())], vec![]);
            let _ = store.save().await;
        }
        
        // Write to file
        if let Ok(path) = crate::fs::mapping::url_to_path(&url_str) {
            state.pending.add(path.clone());
            let tmp_path = path.with_extension("tmp");
            if tokio::fs::write(&tmp_path, &server_body).await.is_ok() {
                let _ = tokio::fs::rename(&tmp_path, &path).await;
                info!("[BraidFS-Sync] Local file updated with server content");
            }
        }
        
        return Ok(()); // Don't push - we accepted server content
    }

    // Generate a new Version ID for this edit
    // For braid.org, always use timestamp-based version to avoid CRDT conflicts
    let new_version = if url_str.contains("braid.org") {
        let peer_id = PEER_ID.read().await.clone();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        format!("{}-{}", peer_id, ts)
    } else {
        let mut merges = state.active_merges.write().await;
        let peer_id = PEER_ID.read().await.clone();
        let merge = merges.entry(url_str.clone()).or_insert_with(|| {
            let mut m = state
                .merge_registry
                .create("simpleton", &peer_id)
                .expect("Failed to create simpleton merge type");
            m.initialize("");
            m
        });

        let patch = crate::core::merge::MergePatch::new("everything", serde_json::Value::String(new_content.clone()));
        let res = merge.local_edit(patch);
        res.version.unwrap_or_else(|| format!("{}-{}", peer_id, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()))
    };

    request = request.with_version(BraidVersion::new(&new_version));
    info!("[BraidFS-Sync] Using version: {}", new_version);

    // For braid.org, omit Parents header to avoid 309 conflicts
    if !url_str.contains("braid.org") && !effective_parents.is_empty() {
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
                } else if domain.contains("braid.org") {
                    format!("client={}", token)
                } else {
                    format!("token={}", token)
                };
                final_request = final_request.with_header("Cookie", cookie_str);
            }
        }
    }

    info!("[BraidFS-Sync] Sending PUT with {} bytes body", new_content.len());
    let status = match state.client.fetch(&url_str, final_request).await {
        Ok(res) => {
            info!("[BraidFS-Sync] PUT response status: {}", res.status);
            if (200..300).contains(&res.status) {
                state.failed_syncs.write().await.remove(&url_str);
                info!("[BraidFS] Sync success (braid) status: {}", res.status);
                state
                    .content_cache
                    .write()
                    .await
                    .insert(url_str.clone(), new_content.clone());
                
                // Update version store with the new version
                {
                    let mut store = state.version_store.write().await;
                    use braid_http::types::Version;
                    store.update(&url_str, vec![Version::from(new_version.clone())], effective_parents.iter().map(|v| Version::from(v.clone())).collect());
                    match store.save().await {
                        Ok(_) => info!("[BraidFS-Sync] Updated version store to: {}", new_version),
                        Err(e) => error!("[BraidFS-Sync] Failed to save version store: {}", e),
                    }
                }
                
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

    // Build native Braid PUT request
    let mut request = BraidRequest::new()
        .with_method("PUT")
        .with_body(data.to_vec());

    // Get parents if not provided
    let mut effective_parents = parents.to_vec();
    if effective_parents.is_empty() {
        let head_req = BraidRequest::new().with_method("GET");
        if let Ok(res) = state.client.fetch(&url_str, head_req).await {
            if let Some(v_header) = res.header("version").or(res.header("current-version")) {
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

    // Generate version
    let new_version = format!("{}-{}", 
        PEER_ID.read().await.clone(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
    );
    request = request.with_version(BraidVersion::new(&new_version));

    // Add parents
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

    // Content type
    let ct = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
    request = request.with_content_type(ct);

    // Auth
    let mut final_request = request;
    if let Ok(u) = url::Url::parse(&url_str) {
        if let Some(domain) = u.domain() {
            let cfg = state.config.read().await;
            if let Some(token) = cfg.cookies.get(domain) {
                let cookie_str = if token.contains('=') {
                    token.clone()
                } else if domain.contains("braid.org") {
                    format!("client={}", token)
                } else {
                    format!("token={}", token)
                };
                final_request = final_request.with_header("Cookie", cookie_str);
            }
        }
    }

    // Execute PUT
    match state.client.fetch(&url_str, final_request).await {
        Ok(res) => {
            if (200..300).contains(&res.status) {
                info!("[BraidFS] Binary sync success (braid) status: {}", res.status);
                Ok(())
            } else {
                let err_msg = format!("Binary sync failed: HTTP {}", res.status);
                error!("[BraidFS] {}", err_msg);
                Err(BraidError::Http(err_msg))
            }
        }
        Err(e) => {
            error!("[BraidFS] Binary sync error: {}", e);
            Err(BraidError::Http(format!("Binary sync error: {}", e)))
        }
    }
}
