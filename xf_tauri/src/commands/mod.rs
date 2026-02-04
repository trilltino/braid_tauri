//! Tauri Commands
//!
//! Includes both legacy HTTP commands and new pure Braid protocol commands.

// Braid protocol commands - defined directly in this module for Tauri macro compatibility
use crate::chat::{parse_braid_update, BraidRequest, ChatBraidExt, ChatManager};
use crate::local_sync;
use crate::models::FileNode;
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::Mutex;
use tracing::{error, info};

/// App state with Braid client
pub struct BraidAppState {
    pub client: Arc<Mutex<ChatManager>>,
}

// Helper to build authenticated request
fn auth_req(client: &ChatManager) -> BraidRequest {
    client.client().with_auth(None)
}

#[tauri::command]
pub async fn signup_braid(
    email: String,
    username: String,
    password: String,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/auth/signup", base_url);
    let body = serde_json::json!({
        "email": email,
        "username": username,
        "password": password,
    });

    let req = BraidRequest::new()
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let auth: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(auth)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn login_braid(
    email: String,
    password: String,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/auth/login", base_url);
    let body = serde_json::json!({
        "email": email,
        "password": password,
    });

    let req = BraidRequest::new()
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let auth: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(auth)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn send_message_braid(
    conversation_id: String,
    content: String,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/{}", base_url, conversation_id);
    let body = serde_json::json!({
        "content": content,
        "message_type": { "type": "text" },
    });

    let req = auth_req(&manager)
        .with_method("PUT")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let msg: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(msg)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_messages_braid(
    conversation_id: String,
    since_version: Option<String>,
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/{}", base_url, conversation_id);

    let mut req = auth_req(&manager);
    if let Some(ver) = since_version {
        req = req.with_version(braid_http::types::Version::from(ver));
    }

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let snapshot: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;

            let messages = snapshot
                .get("messages")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default();

            Ok(messages)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn start_braid_subscription(
    conversation_id: String,
    state: State<'_, BraidAppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    info!(
        "[BraidCommands] Starting Braid subscription for {}",
        conversation_id
    );

    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/{}/subscribe", base_url, conversation_id);

    let req = auth_req(&manager).subscribe().with_heartbeat(30);

    let mut subscription = client
        .subscribe(&url, req)
        .await
        .map_err(|e| format!("Subscribe failed: {}", e))?;

    drop(manager);

    tokio::spawn(async move {
        loop {
            match subscription.next().await {
                Some(Ok(update)) => {
                    if let Some(body) = &update.body {
                        if let Some(braid_update) = parse_braid_update(body) {
                            let _ = app_handle.emit("braid-update", braid_update);
                        }
                    }
                }
                Some(Err(e)) => {
                    error!("[BraidCommands] Subscription error: {}", e);
                    let _ = app_handle.emit("braid-error", e.to_string());
                }
                None => {
                    info!("[BraidCommands] Subscription ended");
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_braid_subscription(_state: State<'_, BraidAppState>) -> Result<(), String> {
    info!("[BraidCommands] Stopping Braid subscription");
    Ok(())
}

#[tauri::command]
pub async fn send_friend_request_braid(
    to_email: String,
    message: Option<String>,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends/requests", base_url);
    let body = serde_json::json!({
        "to_email": to_email,
        "message": message,
    });

    let req = auth_req(&manager)
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let req: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(req)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_pending_requests_braid(
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends/requests", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let requests: Vec<serde_json::Value> =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(requests)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn respond_to_request_braid(
    request_id: String,
    accept: bool,
    state: State<'_, BraidAppState>,
) -> Result<(), String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends/requests/{}", base_url, request_id);
    let body = serde_json::json!({
        "action": if accept { "accept" } else { "reject" },
    });

    let req = auth_req(&manager)
        .with_method("PUT")
        .with_content_type("application/json")
        .with_body(body.to_string());

    client.fetch(&url, req).await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_contacts_braid(
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let contacts: Vec<serde_json::Value> =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(contacts)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn sync_drafts_braid(
    conversation_id: String,
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/{}/drafts", base_url, conversation_id);

    let req = auth_req(&manager);
    let resp = client.fetch(&url, req).await.map_err(|e| e.to_string())?;

    let body_str = String::from_utf8_lossy(&resp.body);
    let drafts: Vec<serde_json::Value> =
        serde_json::from_str(&body_str).map_err(|e| e.to_string())?;

    let mut sent = Vec::new();
    for draft in &drafts {
        if let Some(content) = draft.get("content").and_then(|c| c.as_str()) {
            let msg_url = format!("{}/chat/{}", base_url, conversation_id);
            let body = serde_json::json!({
                "content": content,
                "message_type": { "type": "text" },
            });

            let req = auth_req(&manager)
                .with_method("PUT")
                .with_content_type("application/json")
                .with_body(body.to_string());

            if let Ok(msg_resp) = client.fetch(&msg_url, req).await {
                let msg_str = String::from_utf8_lossy(&msg_resp.body);
                if let Ok(msg) = serde_json::from_str(&msg_str) {
                    sent.push(msg);
                }
            }
        }
    }

    if sent.len() == drafts.len() {
        let del_req = auth_req(&manager).with_method("DELETE");
        let _ = client.fetch(&url, del_req).await;
    }

    Ok(sent)
}

#[tauri::command]
pub async fn upload_file_braid(
    file_path: String,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let base_url = &manager.base_url;

    let url = format!("{}/blobs", base_url);
    let path = std::path::PathBuf::from(file_path);

    let file_content = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed");

    let http_client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(file_content).file_name(file_name.to_string()),
    );

    let resp = http_client
        .post(&url)
        .header("Merge-Type", "antimatter")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Upload failed: {}", resp.status()));
    }

    let blob_ref: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    Ok(blob_ref)
}

// ========== MAIL/FEED COMMANDS ==========

#[tauri::command]
pub async fn subscribe_braid_mail(
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/subscribe", base_url);
    let req = BraidRequest::new().with_method("POST");

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let result: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(result)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn is_braid_mail_subscribed(state: State<'_, BraidAppState>) -> Result<bool, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/subscribed", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let result: bool = serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(result)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_mail_feed(
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/feed", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let items: Vec<serde_json::Value> =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(items)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_mail_feed_braid(
    state: State<'_, BraidAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    // Same as get_mail_feed - server handles the network fetching
    get_mail_feed(state).await
}

#[tauri::command]
pub async fn send_mail(
    subject: String,
    body: String,
    state: State<'_, BraidAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/send", base_url);
    let body_json = serde_json::json!({
        "subject": subject,
        "body": body,
        "from": "user@local",
        "to": ["braid@braid.org"],
    });

    let req = BraidRequest::new()
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(body_json.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let result: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(result)
        }
        Err(e) => Err(e.to_string()),
    }
}

// ========== EXPLORER / SYNC EDITOR COMMANDS ==========

#[tauri::command]
pub async fn get_braid_explorer_tree() -> Result<Vec<FileNode>, String> {
    let mut tree = Vec::new();

    // 1. Scan braid.org (Network/Wiki folder)
    let braid_org = braid_common::braid_org_dir();
    if braid_org.exists() {
        let mut org_node = FileNode {
            name: "braid.org".to_string(),
            is_dir: true,
            is_network: true,
            relative_path: "braid.org".to_string(),
            full_path: braid_org.to_string_lossy().to_string(),
            children: Vec::new(),
        };
        org_node.children = scan_dir_helper(&braid_org, &braid_org, true)?;
        tree.push(org_node);
    }

    // 2. Scan peers
    let peers = braid_common::peers_dir();
    if peers.exists() {
        let mut peers_node = FileNode {
            name: "peers".to_string(),
            is_dir: true,
            is_network: false,
            relative_path: "peers".to_string(),
            full_path: peers.to_string_lossy().to_string(),
            children: Vec::new(),
        };
        peers_node.children = scan_dir_helper(&peers, &peers, false)?;
        tree.push(peers_node);
    }

    // 3. Scan ai
    let ai = braid_common::ai_dir();
    if ai.exists() {
        let mut ai_node = FileNode {
            name: "ai".to_string(),
            is_dir: true,
            is_network: false,
            relative_path: "ai".to_string(),
            full_path: ai.to_string_lossy().to_string(),
            children: Vec::new(),
        };
        ai_node.children = scan_dir_helper(&ai, &ai, false)?;
        tree.push(ai_node);
    }

    Ok(tree)
}

fn scan_dir_helper(
    dir: &std::path::Path,
    folder_root: &std::path::Path,
    is_network: bool,
) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let is_dir = path.is_dir();

        // Root relative path (e.g. braid.org/Welcome.md)
        let root = folder_root.parent().unwrap_or(folder_root);
        let Ok(relative_path) = path.strip_prefix(root) else {
            continue;
        };
        let relative_path_str = relative_path.to_string_lossy().to_string();

        let mut node = FileNode {
            name,
            is_dir,
            is_network,
            relative_path: relative_path_str,
            full_path: path.to_string_lossy().to_string(),
            children: Vec::new(),
        };

        if is_dir {
            node.children = scan_dir_helper(&path, folder_root, is_network)?;
        }

        nodes.push(node);
    }

    // Sort directories first, then by name
    nodes.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(nodes)
}

#[tauri::command]
pub async fn read_explorer_file(relative_path: String) -> Result<String, String> {
    let root = braid_common::braid_root();
    let full_path = root.join(relative_path);
    std::fs::read_to_string(full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_explorer_file(relative_path: String, content: String) -> Result<(), String> {
    let root = braid_common::braid_root();
    let full_path = root.join(&relative_path);

    // Ensure parent dir exists
    if let Some(parent) = full_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    // If it's a network file (wiki), we should also push it via the daemon
    if relative_path.contains("braid.org") {
        let url = format!("https://{}", relative_path.replace("\\", "/"));
        let _ = local_sync::save_page(&url, &content)
            .await
            .map_err(|e| e.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn read_sync_editor_file(path: String) -> Result<String, String> {
    read_explorer_file(path).await
}

#[tauri::command]
pub async fn set_sync_editor_cookie(domain: String, value: String) -> Result<(), String> {
    local_sync::set_cookie(&domain, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_braid_sync_subscription(url: String) -> Result<(), String> {
    local_sync::sync_page(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_sync_editor_page(url: String) -> Result<crate::models::SyncEditorPage, String> {
    local_sync::load_page(&url).await.map_err(|e| e.to_string())
}

// Legacy commands (kept for compatibility)
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub async fn signup(email: String, _username: String, _password: String) -> Result<String, String> {
    Ok(format!("Signed up: {}", email))
}

#[tauri::command]
pub async fn login(email: String, _password: String) -> Result<String, String> {
    Ok(format!("Logged in: {}", email))
}
