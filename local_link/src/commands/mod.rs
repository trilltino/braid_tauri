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

/// App state with LocalLink client
pub struct LocalLinkAppState {
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
    avatar_blob_hash: Option<String>,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/auth/signup", base_url);
    let body = serde_json::json!({
        "email": email,
        "username": username,
        "password": password,
        "avatar_blob_hash": avatar_blob_hash,
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
    state: State<'_, LocalLinkAppState>,
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
    state: State<'_, LocalLinkAppState>,
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
    state: State<'_, LocalLinkAppState>,
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
    state: State<'_, LocalLinkAppState>,
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
pub async fn stop_braid_subscription(_state: State<'_, LocalLinkAppState>) -> Result<(), String> {
    info!("[BraidCommands] Stopping Braid subscription");
    Ok(())
}

#[tauri::command]
pub async fn get_sync_status_braid(
    conversation_id: String,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/{}/status", base_url, conversation_id);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let status: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(status)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn update_profile_braid(
    user_id: String,
    username: Option<String>,
    email: Option<String>,
    password: Option<String>,
    avatar_blob_hash: Option<String>,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/auth/profile/{}", base_url, user_id);
    let body = serde_json::json!({
        "username": username,
        "email": email,
        "password": password,
        "avatar_blob_hash": avatar_blob_hash,
    });

    let req = auth_req(&manager)
        .with_method("PUT")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let user: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(user)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn send_friend_request_braid(
    to_email: String,
    message: Option<String>,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    println!(
        "[Command] send_friend_request_braid called for: {}",
        to_email
    );
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends/requests", base_url);
    println!("[Command] Sending request to: {}", url);
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
    state: State<'_, LocalLinkAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends/requests", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            println!(
                "[Command] get_pending_requests_braid raw response: {}",
                body_str
            );
            let requests: Vec<serde_json::Value> = serde_json::from_str(&body_str)
                .map_err(|e| format!("Parse error: {}. Body: {}", e, body_str))?;
            Ok(requests)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn respond_to_request_braid(
    request_id: String,
    accept: bool,
    state: State<'_, LocalLinkAppState>,
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
    state: State<'_, LocalLinkAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/friends", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            println!("[Command] get_contacts_braid raw response: {}", body_str);
            let contacts: Vec<serde_json::Value> = serde_json::from_str(&body_str)
                .map_err(|e| format!("Parse error: {}. Body: {}", e, body_str))?;
            Ok(contacts)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_conversations_braid(
    state: State<'_, LocalLinkAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/chat/rooms", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let rooms: Vec<serde_json::Value> =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;

            // Map to frontend expected format
            let conversations = rooms
                .into_iter()
                .map(|mut r| {
                    if let Some(obj) = r.as_object_mut() {
                        let participants_len = obj
                            .get("participants")
                            .and_then(|p| p.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0);
                        // Infer DM status from participants count
                        obj.insert(
                            "is_direct_message".to_string(),
                            serde_json::Value::Bool(participants_len == 2),
                        );
                    }
                    r
                })
                .collect();

            Ok(conversations)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn create_conversation_braid(
    name: String,
    participant_emails: Vec<String>,
    is_direct_message: bool,
    sender: String,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    // Use UUID for new room ID
    let room_id = uuid::Uuid::new_v4().to_string();
    let url = format!("{}/chat/{}", base_url, room_id);

    // Call GET to create the room implicitly (backend creates if missing)
    match client.get(&url).await {
        Ok(_) => {
            // Return constructed room object for UI
            Ok(serde_json::json!({
                "id": room_id,
                "name": name,
                "is_direct_message": is_direct_message,
                "participants": participant_emails,
                "created_by": sender,
                "created_at": chrono::Utc::now().to_rfc3339()
            }))
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn create_ai_chat_braid(
    name: String,
    sender: String,
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let room_id = uuid::Uuid::new_v4().to_string();
    let url = format!("{}/chat/{}", base_url, room_id);

    match client.get(&url).await {
        Ok(_resp) => {
            // AI Chat doesn't need special handling on creation in pure Braid protocol
            // The act of talking to @BraidBot! happens in messages.
            // But we need to return the expected structure.
            // ai.js expects: conversation object or wrapper

            let conversation = serde_json::json!({
                "id": room_id,
                "name": name,
                "is_direct_message": false,
                "participants": [], // AI rooms have no human participants initially
                "created_by": sender,
            });

            Ok(serde_json::json!({
                "conversation": conversation,
                "admin_token": "dummy_token" // Backward compat for ai.js
            }))
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn sync_drafts_braid(
    conversation_id: String,
    state: State<'_, LocalLinkAppState>,
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
    state: State<'_, LocalLinkAppState>,
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
        .header("Merge-Type", "diamond")
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

#[tauri::command]
pub async fn send_message_with_file_braid(
    conversation_id: String,
    content: String,
    file_path: String,
    _sender: String, // Kept for frontend compat, unused in pure protocol (server infers from token)
    state: State<'_, LocalLinkAppState>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let base_url = &manager.base_url;

    // 1. Upload File
    let upload_url = format!("{}/blobs", base_url);
    let path = std::path::PathBuf::from(&file_path);

    let file_content = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string();
    let file_size = file_content.len() as u64;

    let http_client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(file_content).file_name(file_name.clone()),
    );

    let resp = http_client
        .post(&upload_url)
        .header("Merge-Type", "simpleton")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Upload failed: {}", resp.status()));
    }

    let blob_ref: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse blob ref: {}", e))?;

    // 2. Send Message with Link
    let chat_url = format!("{}/chat/{}", base_url, conversation_id);

    let body = serde_json::json!({
        "content": content,
        "message_type": {
            "type": "file",
            "data": {
                "filename": file_name,
                "size": file_size
            }
        },
        "blob_refs": [blob_ref]
    });

    let req = auth_req(&manager)
        .with_method("PUT")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match manager.client().fetch(&chat_url, req).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            let msg: serde_json::Value =
                serde_json::from_str(&body_str).map_err(|e| e.to_string())?;
            Ok(msg)
        }
        Err(e) => Err(e.to_string()),
    }
}

// ========== MAIL/FEED COMMANDS ==========

#[tauri::command]
pub async fn subscribe_braid_mail(
    state: State<'_, LocalLinkAppState>,
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client().clone();
    let base_url = manager.base_url.clone();
    drop(manager);

    // 1. Tell server to subscribe to external feed
    let sub_url = format!("{}/mail/subscribe", base_url);
    let sub_body = serde_json::json!({
        "feed_url": "https://mail.braid.org/feed"
    });

    let sub_req = BraidRequest::new()
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(sub_body.to_string());

    let _ = client
        .fetch(&sub_url, sub_req)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Start Braid subscription to server's mail feed
    let feed_url = format!("{}/mail/feed", base_url);
    let feed_req = BraidRequest::new().subscribe().with_heartbeat(30);

    let mut subscription = client
        .subscribe(&feed_url, feed_req)
        .await
        .map_err(|e| format!("Mail feed subscribe failed: {}", e))?;

    tokio::spawn(async move {
        info!("[BraidCommands] Starting Mail Feed subscription loop");
        loop {
            match subscription.next().await {
                Some(Ok(update)) => {
                    if let Some(body) = &update.body {
                        let body_str = String::from_utf8_lossy(body);
                        if let Ok(items) = serde_json::from_str::<serde_json::Value>(&body_str) {
                            info!(
                                "[BraidCommands] Emitting mail-update with {} items",
                                items.as_array().map(|a| a.len()).unwrap_or(0)
                            );
                            let _ = app_handle.emit("mail-update", items);
                        }
                    }
                }
                Some(Err(e)) => {
                    error!("[BraidCommands] Mail subscription error: {}", e);
                    break;
                }
                None => {
                    info!("[BraidCommands] Mail subscription ended");
                    break;
                }
            }
        }
    });

    Ok(serde_json::json!({"status": "subscribed", "message": "Mail subscription active"}))
}

#[tauri::command]
pub async fn is_braid_mail_subscribed(state: State<'_, LocalLinkAppState>) -> Result<bool, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/subscription", base_url);

    match client.get(&url).await {
        Ok(resp) => {
            let body_str = String::from_utf8_lossy(&resp.body);
            // API returns boolean true/false
            if let Ok(status) = serde_json::from_str::<bool>(&body_str) {
                Ok(status)
            } else {
                // Fallback parsing if wrapped
                Ok(false)
            }
        }
        Err(_) => Ok(false), // Assume false on error
    }
}

#[tauri::command]
pub async fn set_mail_auth(
    state: State<'_, LocalLinkAppState>,
    cookie: Option<String>,
    email: Option<String>,
) -> Result<serde_json::Value, String> {
    let manager = state.client.lock().await;
    let client = manager.client();
    let base_url = &manager.base_url;

    let url = format!("{}/mail/auth", base_url);
    let body = serde_json::json!({
        "cookie": cookie,
        "email": email
    });

    let req = BraidRequest::new()
        .with_method("POST")
        .with_content_type("application/json")
        .with_body(body.to_string());

    match client.fetch(&url, req).await {
        Ok(_) => Ok(serde_json::json!({"success": true})),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_mail_feed(
    state: State<'_, LocalLinkAppState>,
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

// Deprecated or Aliased: This used to bypass the server.
// Now we alias it to get_mail_feed so the UI gets consistent hydrated data.
#[tauri::command]
pub async fn get_mail_feed_braid(
    state: State<'_, LocalLinkAppState>,
) -> Result<Vec<serde_json::Value>, String> {
    // Reuse the main get_mail_feed logic to ensure hydration
    get_mail_feed(state).await
}

#[tauri::command]
pub async fn send_mail(
    subject: String,
    body: String,
    state: State<'_, LocalLinkAppState>,
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
pub async fn get_braid_explorer_tree(section: Option<String>) -> Result<Vec<FileNode>, String> {
    // Determine root based on section
    let (scan_root, folder_root) = match section.as_deref() {
        Some("braid.org") => (braid_common::braid_org_dir(), braid_common::braid_org_dir()),
        Some("local") => (braid_common::braid_root(), braid_common::braid_root()), // Scan root for LinkedLocal
        Some("ai") => (braid_common::ai_dir(), braid_common::ai_dir()),
        _ => (braid_common::braid_org_dir(), braid_common::braid_org_dir()),
    };

    tracing::info!(
        "[Explorer] Scanning tree at: {:?} (Section: {:?})",
        scan_root,
        section
    );

    if !scan_root.exists() {
        if section.is_none() {
            tracing::warn!(
                "[Explorer] braid_sync directory does not exist: {:?}",
                scan_root
            );
        }
        return Ok(vec![]);
    }

    // Helper to get raw tree
    let mut tree = scan_dir_helper(
        &scan_root,
        &folder_root,
        section.as_deref() == Some("braid.org"),
    )?;

    // Filter for "LinkedLocal" mode (section="local")
    if section.as_deref() == Some("local") {
        tree.retain(|node| node.name == "local.org" || node.name == "ai");
    }

    tracing::info!(
        "[Explorer] Found {} top-level items in {:?}",
        tree.len(),
        scan_root
    );

    Ok(tree)
}

#[tauri::command]
pub async fn download_default_wiki() -> Result<(), String> {
    println!("[Command] download_default_wiki called - CHECK YOUR TERMINAL!");
    let braid_org = braid_common::braid_org_dir();
    println!("[Command] Target dir: {:?}", braid_org);
    tracing::info!("[Command] Target dir: {:?}", braid_org);
    braid_common::ensure_dir(&braid_org).map_err(|e| e.to_string())?;

    // 1. Fetch index from braid.org
    // Try multiple potential index endpoints
    let index_urls = [
        "https://braid.org/pages.json",
        "https://braid.org/index.json",
    ];
    // No fallbacks per user request
    let mut pages_to_sync = Vec::new();

    let client = reqwest::Client::new();

    for index_url in index_urls {
        info!("[Wiki] Trying to fetch index from: {}", index_url);
        if let Ok(resp) = client.get(index_url).send().await {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(list) = json.as_array() {
                        info!(
                            "[Wiki] Found {} pages in index at {}",
                            list.len(),
                            index_url
                        );
                        for item in list {
                            let page_url = if let Some(s) = item.as_str() {
                                s.to_string()
                            } else if let Some(v) = item.as_object() {
                                v.get("url")
                                    .and_then(|u| u.as_str())
                                    .map(|s| s.to_string())
                                    .unwrap_or_default()
                            } else {
                                String::new()
                            };

                            if !page_url.is_empty() {
                                pages_to_sync.push(page_url);
                            }
                        }
                        break; // Stop after first successful index
                    }
                }
            }
        }
    }

    // Deduplicate
    pages_to_sync.sort();
    pages_to_sync.dedup();

    info!("[Wiki] Syncing {} pages...", pages_to_sync.len());
    for page_url in pages_to_sync {
        info!("[Wiki] Syncing page: {}", page_url);
        // Ensure we use the proper local_sync
        if let Err(e) = crate::local_sync::sync_page(&page_url).await {
            tracing::error!("[Wiki] Failed to sync {}: {}", page_url, e);
        }
    }

    Ok(())
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
    let full_path = root.join(&relative_path);
    tracing::info!(
        "[Explorer] Reading file: {:?} (Root: {:?})",
        full_path,
        root
    );
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
pub async fn create_local_page(name: String) -> Result<String, String> {
    let root = braid_common::braid_root().join("local.org");

    // Ensure .md extension
    let filename = if name.to_lowercase().endsWith(".md") {
        name
    } else {
        format!("{}.md", name)
    };

    let full_path = root.join(filename);

    // Ensure local dir exists
    if let Err(e) = std::fs::create_dir_all(&root) {
        return Err(format!("Failed to create local directory: {}", e));
    }

    // Check if exists
    if full_path.exists() {
        return Err("File already exists".to_string());
    }

    // Create empty file
    if let Err(e) = std::fs::write(&full_path, "") {
        return Err(format!("Failed to create file: {}", e));
    }

    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn is_storage_setup() -> bool {
    braid_common::load_persistent_root().is_some()
}

#[tauri::command]
pub async fn get_braid_root() -> String {
    braid_common::braid_root().to_string_lossy().to_string()
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

#[tauri::command]
pub async fn setup_user_storage(
    username: String,
    base_path: String,
    sync_with_braid: bool,
) -> Result<String, String> {
    info!(
        "[Storage] Setting up storage for user: {} at base: {}",
        username, base_path
    );
    let root = std::path::PathBuf::from(base_path).join(format!("{}_local_link", username));

    // 1. Create directory structure
    braid_common::set_braid_root(root.clone());
    braid_common::init_structure().map_err(|e| e.to_string())?;

    // 2. Re-initialize local sync (restarts watcher)
    crate::local_sync::init(root.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Persist choice so next restart uses it
    if let Err(e) = crate::config_store::save_root(root.clone()) {
        tracing::warn!("Failed to save persistent config: {}", e);
    }

    // 3. (Optional) Cleanup - We keep legacy braid_sync if it exists to support multi-user machines
    // 3. Cleanup - Remove legacy braid_sync if it's not the current root
    let legacy_root = std::path::PathBuf::from("braid_sync");
    let current_root_str = root.to_string_lossy().to_string();

    // Safety check: Don't delete if we somehow ARE the legacy root
    if legacy_root.exists() && !current_root_str.contains("braid_sync") {
        info!("[Storage] Removing legacy braid_sync folder");
        let _ = std::fs::remove_dir_all(&legacy_root);
    }

    // 4. Initial Sync with Braid Wiki if requested
    if sync_with_braid {
        info!("[Storage] Triggering initial Braid.org wiki sync");
        // This will fetch the index and download all pages
        let _ = download_default_wiki().await;
    }

    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_default_storage_base() -> Result<String, String> {
    // Default to user home directory if possible
    let home = dirs::home_dir()
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    Ok(home.to_string_lossy().to_string())
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

#[tauri::command]
pub async fn get_server_config() -> Result<serde_json::Value, String> {
    let url =
        std::env::var("CHAT_SERVER_URL").unwrap_or_else(|_| "http://localhost:3001".to_string());

    Ok(serde_json::json!({
        "chat_server_url": url
    }))
}
