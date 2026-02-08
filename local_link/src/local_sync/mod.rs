//! Local Sync Module
//!
//! Uses braid-http directly for Braid protocol operations.
//! Daemon control API uses reqwest (non-Braid REST API).

pub use braid_http::{BraidClient, BraidRequest};

use anyhow::Result;
use notify::{RecursiveMode, Watcher};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, RwLock};
use tracing::{error, info};

/// Daemon control URL (non-Braid REST API)
pub const DAEMON_URL: &str = "http://127.0.0.1:45678";

/// Local sync configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LocalSyncConfig {
    pub sync_dir: PathBuf,
    pub cookies: HashMap<String, String>,
    pub identities: HashMap<String, String>,
}

/// Global config state (used by helper functions)
static CONFIG: std::sync::OnceLock<Arc<RwLock<LocalSyncConfig>>> = std::sync::OnceLock::new();

fn get_config() -> &'static Arc<RwLock<LocalSyncConfig>> {
    CONFIG.get_or_init(|| {
        Arc::new(RwLock::new(LocalSyncConfig {
            sync_dir: braid_common::sync_dir(),
            cookies: HashMap::new(),
            identities: HashMap::new(),
        }))
    })
}

/// App handle channel for filesystem watcher
static APP_HANDLE_TX: std::sync::OnceLock<watch::Sender<Option<AppHandle>>> =
    std::sync::OnceLock::new();

fn get_app_handle_tx() -> watch::Sender<Option<AppHandle>> {
    APP_HANDLE_TX
        .get_or_init(|| {
            let (tx, rx) = watch::channel(None::<AppHandle>);
            // Spawn watcher on first use
            let watch_root = braid_common::sync_dir();
            tokio::spawn(async move {
                let _ = spawn_filesystem_watcher(rx, watch_root).await;
            });
            tx.clone()
        })
        .clone()
}

/// Initialize local sync (call once at startup or when root changes)
pub async fn init(storage_path: PathBuf) -> Result<()> {
    info!("Local sync (re)initializing at {:?}", storage_path);

    // Update config with storage path
    {
        let mut cfg = get_config().write().await;
        cfg.sync_dir = storage_path.clone();
    }

    // Refresh watcher if app handle is available
    if let Some(tx) = APP_HANDLE_TX.get() {
        let rx = tx.subscribe();
        tokio::spawn(async move {
            let _ = spawn_filesystem_watcher(rx, storage_path).await;
        });
    }

    // Check if we should skip starting the daemon
    if std::env::var("XF_SKIP_DAEMON").is_ok() {
        info!("Running in Client Mode. Daemon management is external.");
    }

    Ok(())
}

/// Set app handle for filesystem notifications
pub fn set_app_handle(handle: AppHandle) {
    let _ = get_app_handle_tx().send(Some(handle));
}

/// Spawn filesystem watcher
async fn spawn_filesystem_watcher(
    app_handle_rx: watch::Receiver<Option<AppHandle>>,
    watch_root: PathBuf,
) -> Result<()> {
    let (file_event_tx, file_event_rx) = std::sync::mpsc::channel();
    let mut watcher = notify::RecommendedWatcher::new(file_event_tx, notify::Config::default())?;
    watcher.watch(&watch_root, RecursiveMode::Recursive)?;

    tokio::spawn(async move {
        for file_event in file_event_rx {
            match file_event {
                Ok(event) => {
                    let is_interesting =
                        event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove();

                    if !is_interesting {
                        continue;
                    }

                    let maybe_handle = app_handle_rx.borrow().clone();
                    let Some(tauri_handle) = maybe_handle else {
                        continue;
                    };

                    for changed_path in event.paths {
                        let Ok(relative_path) = changed_path.strip_prefix(&watch_root) else {
                            continue;
                        };

                        let relative_path_str = relative_path.to_string_lossy().to_string();
                        info!(path = %relative_path_str, "Filesystem change detected");

                        let _ = tauri_handle.emit("fs-update", relative_path_str);
                    }
                }
                Err(watch_error) => {
                    error!(error = ?watch_error, "Filesystem watcher error");
                }
            }
        }
        drop(watcher);
    });

    Ok(())
}

// --- Cookie & Identity Helpers ---

/// Get cookie header value for URL
pub async fn get_cookie_header(url: &str) -> Option<String> {
    let domain = match Url::parse(url) {
        Ok(u) => u.host_str()?.to_string(),
        Err(_) => return None,
    };

    let cfg = get_config().read().await;

    // Find best matching cookie (hierarchical)
    let mut current_domain = domain.clone();
    loop {
        if let Some(token) = cfg.cookies.get(&current_domain) {
            return Some(if !token.contains("=") {
                format!("token={}", token)
            } else {
                token.to_string()
            });
        }
        if let Some(pos) = current_domain.find('.') {
            current_domain = current_domain[pos + 1..].to_string();
            if current_domain.is_empty() {
                break;
            }
        } else {
            break;
        }
    }
    None
}

/// Set cookie for domain
pub async fn set_cookie(domain: &str, value: &str) -> Result<()> {
    info!("Setting cookie for domain: {}", domain);

    // Update in-memory config
    {
        let mut cfg = get_config().write().await;
        cfg.cookies.insert(domain.to_string(), value.to_string());
    }

    // Update Daemon
    let endpoint = format!("{}/api/cookie", DAEMON_URL);
    let client = reqwest::Client::new();
    let resp = client
        .put(&endpoint)
        .json(&serde_json::json!({ "domain": domain, "value": value }))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            info!("Daemon cookie updated for {}", domain);
        }
        Ok(r) => {
            error!("Daemon cookie update failed: Status {}", r.status());
        }
        Err(e) => {
            error!("Daemon unreachable: {}. Is BraidFS-Daemon running?", e);
        }
    }

    Ok(())
}

/// Set identity for domain
pub async fn set_identity(domain: &str, email: &str) -> Result<()> {
    info!("Setting identity for domain: {}", domain);
    {
        let mut cfg = get_config().write().await;
        cfg.identities.insert(domain.to_string(), email.to_string());
    }

    let endpoint = format!("{}/api/identity", DAEMON_URL);
    let client = reqwest::Client::new();
    let _ = client
        .put(&endpoint)
        .json(&serde_json::json!({ "domain": domain, "email": email }))
        .send()
        .await?;
    Ok(())
}

/// Get identity for domain
pub async fn get_identity(domain: &str) -> Option<String> {
    let cfg = get_config().read().await;
    cfg.identities.get(domain).cloned()
}

// --- Page Operations ---

/// Get storage path
pub async fn storage_path() -> PathBuf {
    let cfg = get_config().read().await;
    cfg.sync_dir.clone()
}

/// Get page path from URL
pub fn get_page_path(url: &str) -> Result<PathBuf> {
    let storage = braid_common::sync_dir();
    if url.starts_with("http") {
        Ok(storage
            .join("mapped_pages")
            .join(urlencoding::encode(url).to_string()))
    } else {
        Ok(storage.join(url))
    }
}

/// Load page (uses daemon API, not Braid protocol)
pub async fn load_page(url: &str) -> Result<crate::models::SyncEditorPage> {
    info!("Loading page: {}", url);

    let endpoint = format!("{}/api/get?url={}", DAEMON_URL, urlencoding::encode(url));
    let client = reqwest::Client::new();

    let mut req = client.get(&endpoint);
    if let Some(cookie) = get_cookie_header(url).await {
        req = req.header("Cookie", cookie);
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let version = resp
                .headers()
                .get("Version")
                .or_else(|| resp.headers().get("version"))
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim_matches('"').to_string());

            let content = resp.text().await?;

            Ok(crate::models::SyncEditorPage {
                url: url.to_string(),
                content,
                last_modified: None,
                version,
            })
        }
        _ => load_page_local(url).await,
    }
}

async fn load_page_local(url: &str) -> Result<crate::models::SyncEditorPage> {
    let local_path = get_page_path(url)?;
    if local_path.exists() {
        let content = tokio::fs::read_to_string(&local_path).await?;
        Ok(crate::models::SyncEditorPage {
            url: url.to_string(),
            content,
            last_modified: None,
            version: Some("local".to_string()),
        })
    } else {
        anyhow::bail!("Page not found locally: {}", url)
    }
}

/// Save page (uses daemon API)
pub async fn save_page(url: &str, content: &str) -> Result<()> {
    let endpoint = format!("{}/api/push", DAEMON_URL);
    let client = reqwest::Client::new();

    let mut req = client.put(&endpoint).json(&serde_json::json!({
        "url": url,
        "content": content
    }));

    if let Some(cookie) = get_cookie_header(url).await {
        req = req.header("Cookie", cookie);
    }

    let resp = req.send().await?;
    let status_json: serde_json::Value = resp.json().await?;
    let status = status_json["status"].as_str().unwrap_or("error");

    if status == "ok" {
        Ok(())
    } else if status == "unauthorized" {
        anyhow::bail!("Unauthorized")
    } else {
        anyhow::bail!("Save failed: {}", status_json["message"])
    }
}

/// Sync page via daemon
pub async fn sync_page(url: &str) -> Result<()> {
    info!("Requesting BraidFS sync for: {}", url);
    let endpoint = format!("{}/api/sync", DAEMON_URL);
    let client = reqwest::Client::new();

    let mut req = client
        .put(&endpoint)
        .json(&serde_json::json!({ "url": url }));
    if let Some(cookie) = get_cookie_header(url).await {
        req = req.header("Cookie", cookie);
    }

    let _ = req.send().await?;
    Ok(())
}

/// Probe URL for auth
pub async fn probe_url(url: &str) -> Result<()> {
    let domain = Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_default();

    let cookie = {
        let cfg = get_config().read().await;
        cfg.cookies.get(&domain).cloned()
    };

    let client = reqwest::Client::new();
    let mut req = client.head(url);
    if let Some(c) = cookie {
        let cookie_val = if !c.contains("=") {
            format!("token={}", c)
        } else {
            c.to_string()
        };
        req = req.header("Cookie", cookie_val);
    }

    let resp = req.send().await?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        anyhow::bail!("Unauthorized");
    }

    Ok(())
}

// --- Blob Operations ---

/// Put blob
pub async fn put_blob(data: Vec<u8>, content_type: Option<String>) -> Result<String> {
    let endpoint = format!("{}/api/blob", DAEMON_URL);
    let client = reqwest::Client::new();

    let mut req = client.put(&endpoint).body(data);
    if let Some(ct) = content_type {
        req = req.header("Content-Type", ct);
    }

    let resp = req.send().await?;
    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await?;
        json["hash"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Invalid response"))
    } else {
        anyhow::bail!("Blob upload failed: {}", resp.status())
    }
}

/// Get blob
pub async fn get_blob(hash: &str) -> Result<Option<(Vec<u8>, Option<String>)>> {
    let endpoint = format!("{}/api/blob/{}", DAEMON_URL, hash);
    let client = reqwest::Client::new();
    let resp = client.get(&endpoint).send().await?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if resp.status().is_success() {
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string());
        let bytes = resp.bytes().await?.to_vec();
        Ok(Some((bytes, content_type)))
    } else {
        anyhow::bail!("Blob fetch failed: {}", resp.status())
    }
}

// --- Mount Operations ---

/// Mount BraidFS
pub async fn mount(port: u16, mount_point: &str) -> Result<()> {
    let endpoint = format!("{}/api/mount", DAEMON_URL);
    let client = reqwest::Client::new();
    let _ = client
        .put(&endpoint)
        .json(&serde_json::json!({ "port": port, "mount_point": mount_point }))
        .send()
        .await?;
    Ok(())
}

/// Unmount BraidFS
pub async fn unmount() -> Result<()> {
    let endpoint = format!("{}/api/mount", DAEMON_URL);
    let client = reqwest::Client::new();
    let _ = client.delete(&endpoint).send().await?;
    Ok(())
}
