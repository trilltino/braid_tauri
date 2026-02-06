//! Braid Wiki Module - Server Side
//!
//! Handles discovery of wiki pages from central indexes
//! and manages synchronization triggers for the BraidFS daemon.

use anyhow::Result;
use braid_http::{BraidClient, BraidRequest};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Wiki page discovery and sync manager
pub struct WikiManager {
    /// Discovered wiki URLs
    discovered_urls: Arc<RwLock<HashSet<String>>>,
    /// Daemon API URL for sync triggers
    daemon_sync_url: String,
    /// Local directory to project wiki files into
    wiki_dir: PathBuf,
}

impl WikiManager {
    pub fn new(daemon_port: u16, wiki_dir: PathBuf) -> Self {
        Self {
            discovered_urls: Arc::new(RwLock::new(HashSet::new())),
            daemon_sync_url: format!("http://127.0.0.1:{}/api/sync", daemon_port),
            wiki_dir,
        }
    }

    /// Start the background discovery task
    pub async fn start_discovery(&self) -> Result<()> {
        info!("[WikiManager] Starting wiki discovery service");

        let discovered_urls = self.discovered_urls.clone();
        let daemon_sync_url = self.daemon_sync_url.clone();
        let wiki_dir = self.wiki_dir.clone();

        tokio::spawn(async move {
            if let Err(e) = Self::discovery_task(discovered_urls, daemon_sync_url, wiki_dir).await {
                error!("[WikiManager] Discovery task failed: {}", e);
            }
        });

        Ok(())
    }

    /// Background task for periodic discovery
    async fn discovery_task(
        discovered_urls: Arc<RwLock<HashSet<String>>>,
        daemon_sync_url: String,
        wiki_dir: PathBuf,
    ) -> Result<()> {
        let client = BraidClient::new()?;
        let wiki_index_url = "https://braid.org/pages";
        let ipc_client = reqwest::Client::new();

        loop {
            info!("[WikiManager] Polling wiki index: {}", wiki_index_url);

            match Self::fetch_index(&client, wiki_index_url).await {
                Ok(links) => {
                    let mut urls = discovered_urls.write().await;
                    let mut changed = false;

                    for link in links {
                        if !urls.contains(&link) {
                            info!("[WikiManager] New wiki found: {}", link);

                            // Trigger daemon sync
                            if let Err(e) = ipc_client
                                .put(&daemon_sync_url)
                                .json(&serde_json::json!({ "url": link }))
                                .send()
                                .await
                            {
                                warn!(
                                    "[WikiManager] Failed to trigger daemon sync for {}: {}",
                                    link, e
                                );
                            } else {
                                urls.insert(link);
                                changed = true;
                            }
                        }
                    }

                    if changed {
                        if let Err(e) = Self::sync_to_fs(&urls, &wiki_dir).await {
                            warn!("[WikiManager] Failed to sync wikis to FS: {}", e);
                        }
                    }
                }
                Err(e) => {
                    warn!("[WikiManager] Failed to fetch wiki index: {}", e);
                }
            }

            // Poll every 5 minutes
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        }
    }

    /// Sync discovered wikis to the filesystem
    async fn sync_to_fs(urls: &HashSet<String>, _wiki_dir: &Path) -> Result<()> {
        let client = BraidClient::new()?;

        for url in urls {
            // Use braid-core's official mapping to align with Daemon
            let file_path = match braid_core::fs::mapping::url_to_path(url) {
                Ok(p) => p,
                Err(_) => {
                    // Fallback to simple mapping if official one fails
                    let page_name = url
                        .trim_end_matches('/')
                        .split('/')
                        .last()
                        .unwrap_or("index");
                    braid_common::braid_org_dir().join(format!("{}.md", page_name))
                }
            };

            // Ensure parent exists
            if let Some(parent) = file_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }

            if !file_path.exists() {
                info!("[WikiManager] Fetching and projecting: {}", url);

                // Fetch with Simpleton support and Markdown extraction
                let req = BraidRequest::new().with_merge_type("simpleton");

                match client.fetch(url, req).await {
                    Ok(resp) => {
                        let raw_body = String::from_utf8_lossy(&resp.body);
                        let content = braid_core::fs::mapping::extract_markdown(&raw_body);

                        if let Err(e) = tokio::fs::write(&file_path, content.as_bytes()).await {
                            warn!(
                                "[WikiManager] Failed to write wiki file {:?}: {}",
                                file_path, e
                            );
                        }
                    }
                    Err(e) => {
                        warn!(
                            "[WikiManager] Failed to fetch wiki content for {}: {}",
                            url, e
                        );
                        // Still create an empty placeholder so it shows up in explorer
                        let _ = tokio::fs::write(&file_path, "").await;
                    }
                }
            }
        }

        Ok(())
    }

    /// Fetch wiki index and return list of URLs
    async fn fetch_index(client: &BraidClient, index_url: &str) -> Result<Vec<String>> {
        let req = BraidRequest::new();
        let resp = client.fetch(index_url, req).await?;
        let body_str = String::from_utf8_lossy(&resp.body);

        let mut links = Vec::new();

        if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&body_str) {
            for v in arr {
                if let Some(path) = v
                    .get("link")
                    .and_then(|v| v.as_str())
                    .or_else(|| v.as_str())
                {
                    links.push(Self::normalize_url(path));
                }
            }
        } else {
            // Fallback to line-by-line if not JSON array
            for line in body_str.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    links.push(Self::normalize_url(trimmed));
                }
            }
        }

        Ok(links)
    }

    fn normalize_url(path: &str) -> String {
        if path.starts_with("http") {
            path.to_string()
        } else {
            format!("https://braid.org{}", path)
        }
    }
}
