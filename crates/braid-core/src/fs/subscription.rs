use super::PEER_ID;
use crate::core::BraidRequest;
use crate::core::Result;
use crate::fs::mapping;
use crate::fs::state::DaemonState;
use std::collections::HashMap;

pub async fn spawn_subscription(
    url: String,
    subscriptions: &mut HashMap<String, tokio::task::JoinHandle<()>>,
    state: DaemonState,
) {
    if subscriptions.contains_key(&url) {
        return;
    }

    if !state
        .config
        .read()
        .await
        .sync
        .get(&url)
        .cloned()
        .unwrap_or(false)
    {
        return;
    }

    let url_capture = url.clone();
    let state_capture = state.clone();
    let handle = tokio::spawn(async move {
        loop {
            match subscribe_loop(url_capture.clone(), state_capture.clone()).await {
                Ok(_) => {
                    tracing::info!(
                        "Subscription for {} ended normally (disconnect). Retrying in 5s...",
                        url_capture
                    );
                }
                Err(e) => {
                    tracing::error!(
                        "Subscription error for {}: {}. Retrying in 5s...",
                        url_capture,
                        e
                    );
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });

    subscriptions.insert(url, handle);
}

pub async fn subscribe_loop(url: String, state: DaemonState) -> Result<()> {
    tracing::info!("Subscribing to {}", url);

    let mut req = BraidRequest::new()
        .subscribe()
        .with_header("Accept", "text/plain")
        .with_header("Heartbeats", "30s");

    // For braid.org wiki pages, request the simpleton merge type
    // This matches the behavior of braid-text sites
    if url.contains("braid.org") {
        req = req.with_merge_type("simpleton");
    }

    // Add Authentication Headers
    if let Ok(u) = url::Url::parse(&url) {
        if let Some(domain) = u.domain() {
            let cfg = state.config.read().await;
            if let Some(token) = cfg.cookies.get(domain) {
                req = req.with_header("Authorization", format!("Bearer {}", token));
                let cookie_str = if token.contains('=') {
                    token.clone()
                } else {
                    format!("token={}", token)
                };
                req = req.with_header("Cookie", cookie_str);
            }
        }
    }

    let mut sub = state.client.subscribe(&url, req).await?;
    let mut is_first = true;

    while let Some(update) = sub.next().await {
        let update = update?;

        // Handle 309 Reborn during subscription
        if update.status == 309 {
            tracing::warn!(
                "[BraidFS] Reborn (309) detected during subscription for {}. History reset.",
                url
            );
            is_first = true;
        }

        // Filter echoes (ignore updates from ourselves)
        if let Some(v) = update.primary_version() {
            let v_str = v.to_string();
            let my_id = PEER_ID.read().await;
            if !is_first && v_str.contains(&*my_id) {
                tracing::debug!(
                    "[BraidFS] Ignoring echo from {} (version matches our PEER_ID {})",
                    url,
                    *my_id
                );
                continue;
            }
        }
        is_first = false;

        tracing::debug!("Received update from {}: {:?}", url, update.version);

        // Update version store
        {
            state.tracker.mark(&url);
            let mut store = state.version_store.write().await;
            store.update(&url, update.version.clone(), update.parents.clone());
            let _ = store.save().await;
        }

        let patches = match update.patches.as_ref() {
            Some(p) if !p.is_empty() => p,
            _ => {
                // Check if it is a snapshot
                if let Some(body) = update.body_str() {
                    tracing::info!(
                        "[BraidFS-Sub] Snapshot for {}, writing {} bytes",
                        url,
                        body.len()
                    );

                    // Get/Create Merge State (extracting valid content version)
                    let raw_content = {
                        let mut merges = state.active_merges.write().await;
                        let peer_id = PEER_ID.read().await.clone();
                        let requested_merge_type =
                            update.merge_type.as_deref().unwrap_or("diamond");
                        let merge = merges.entry(url.clone()).or_insert_with(|| {
                            tracing::info!(
                                "[BraidFS] Creating merge state for {} with type: {}",
                                url,
                                requested_merge_type
                            );
                            let mut m = state
                                .merge_registry
                                .create(requested_merge_type, &peer_id)
                                .or_else(|| state.merge_registry.create("diamond", &peer_id))
                                .expect("Failed to create merge type");
                            m.initialize(body);
                            m
                        });

                        let patch = crate::core::merge::MergePatch {
                            range: "".to_string(),
                            content: serde_json::Value::String(body.to_string()),
                            version: update.primary_version().map(|v| v.to_string()),
                            parents: update.parents.iter().map(|p| p.to_string()).collect(),
                        };
                        merge.apply_patch(patch);
                        merge.get_content()
                    };

                    // Filter: Auto-Extract Markdown if HTML shell
                    let final_content = if raw_content.trim().starts_with("<!DOCTYPE")
                        || raw_content.trim().starts_with("<html")
                    {
                        mapping::extract_markdown(&raw_content)
                    } else {
                        raw_content
                    };

                    // Update Content Cache
                    {
                        let mut cache = state.content_cache.write().await;
                        cache.insert(url.clone(), final_content.clone());
                    }

                    if let Ok(path) = mapping::url_to_path(&url) {
                        // Add to pending BEFORE writing to avoid echo loop
                        state.pending.add(path.clone());

                        if let Some(parent) = path.parent() {
                            ensure_dir_path(parent).await;
                        }

                        // Atomic Write: Write to .tmp file then rename (Snapshot)
                        let tmp_path = path.with_extension("tmp");
                        if let Err(e) = tokio::fs::write(&tmp_path, final_content.clone()).await {
                            tracing::error!("Failed to write tmp file for snapshot {}: {}", url, e);
                        } else {
                            match tokio::fs::rename(&tmp_path, &path).await {
                                Ok(_) => {
                                    // Update Content Cache only on success
                                    let mut cache = state.content_cache.write().await;
                                    cache.insert(url.clone(), final_content.clone());
                                }
                                Err(e) => {
                                    tracing::error!("Failed to rename tmp file for snapshot {}: {} (fallback direct)", url, e);
                                    if let Err(e2) = tokio::fs::write(&path, final_content).await {
                                        tracing::error!(
                                            "Direct snapshot write failed for {}: {}",
                                            url,
                                            e2
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                continue;
            }
        };

        let path = mapping::url_to_path(&url)?;

        let content = if path.exists() {
            tokio::fs::read_to_string(&path).await.unwrap_or_default()
        } else {
            String::new()
        };

        // Apply Patches via Merge State
        let final_content = {
            let mut merges = state.active_merges.write().await;
            let peer_id = PEER_ID.read().await.clone();
            let requested_merge_type = update.merge_type.as_deref().unwrap_or("diamond");
            let merge = merges.entry(url.clone()).or_insert_with(|| {
                tracing::info!(
                    "[BraidFS] Creating merge state for {} with type: {}",
                    url,
                    requested_merge_type
                );
                let mut m = state
                    .merge_registry
                    .create(requested_merge_type, &peer_id)
                    .or_else(|| state.merge_registry.create("diamond", &peer_id))
                    .expect("Failed to create merge type");
                m.initialize(&content);
                m
            });

            for patch in patches {
                let patch_content = std::str::from_utf8(&patch.content).unwrap_or("");

                let merge_patch = crate::core::merge::MergePatch {
                    range: patch.range.clone(),
                    content: serde_json::Value::String(patch_content.to_string()),
                    version: update.primary_version().map(|v| v.to_string()),
                    parents: update.parents.iter().map(|p| p.to_string()).collect(),
                };
                merge.apply_patch(merge_patch);
            }
            merge.get_content()
        };

        if let Ok(path) = mapping::url_to_path(&url) {
            // Add to pending BEFORE writing to avoid echo loop
            state.pending.add(path.clone());

            if let Some(parent) = path.parent() {
                ensure_dir_path(parent).await;
            }

            // Atomic Write: Write to .tmp file then rename
            // This prevents "Access Denied" if the file is open in an editor/viewer
            let tmp_path = path.with_extension("tmp");
            if let Err(e) = tokio::fs::write(&tmp_path, final_content.clone()).await {
                tracing::error!("Failed to write tmp file for {}: {}", url, e);
            } else {
                match tokio::fs::rename(&tmp_path, &path).await {
                    Ok(_) => {
                        // Update Content Cache only on success
                        let mut cache = state.content_cache.write().await;
                        cache.insert(url.clone(), final_content);
                    }
                    Err(e) => {
                        tracing::error!("Failed to rename tmp file for {}: {} (attempting direct write fallback)", url, e);
                        // Fallback: Try direct write if rename fails (e.g. cross-device, though unlikely in simple sync)
                        if let Err(e2) = tokio::fs::write(&path, final_content.clone()).await {
                            tracing::error!("Direct write fallback failed for {}: {}", url, e2);
                        }
                    }
                }
            }
        }

        tracing::debug!("Updated local file {}", url);
    }

    Ok(())
}

async fn ensure_dir_path(path: &std::path::Path) {
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component);
        if current.exists() {
            if current.is_file() {
                let mut new_name = current.clone();
                new_name.set_extension("txt");
                tracing::warn!(
                    "[BraidFS] Path conflict: {:?} is a file but needs to be a directory. Renaming to {:?}",
                    current,
                    new_name
                );
                if let Err(e) = tokio::fs::rename(&current, &new_name).await {
                    tracing::error!("[BraidFS] Failed to resolve path conflict: {}", e);
                    continue;
                }
                // Now create the directory
                if let Err(e) = tokio::fs::create_dir(&current).await {
                    tracing::error!("[BraidFS] Failed to create directory after rename: {}", e);
                }
            }
        } else {
            if let Err(e) = tokio::fs::create_dir(&current).await {
                // It might have been created by another task in the meantime
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    tracing::error!("[BraidFS] Failed to create directory {:?}: {}", current, e);
                }
            }
        }
    }
}
