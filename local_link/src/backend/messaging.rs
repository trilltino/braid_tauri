use super::SharedState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tracing::error;

const JWT_SECRET: &[u8] = b"your_ultra_secure_secret"; // In a real app, use environment variables

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub username: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub last_seen: Option<String>,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequest {
    pub id: String,
    pub from_username: String,
    pub from_email: String,
    pub to_email: String,
    pub message: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SendFriendRequest {
    pub to_email: String,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RespondFriendRequest {
    pub request_id: String,
    pub action: String, // "accept" or "reject"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub name: Option<String>,
    pub created_by: Option<String>,
    pub is_direct_message: bool,
    pub last_message: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender: String,
    pub content: String,
    pub created_at: String,
    pub is_read: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversation {
    pub name: Option<String>,
    pub participant_emails: Vec<String>,
    pub is_direct_message: bool,
    pub resource_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessage {
    pub conversation_id: String,
    pub content: String,
    pub sender: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomAdminClaims {
    pub sub: String,     // user_id
    pub room_id: String, // the conversation id
    pub exp: usize,
}

#[derive(Debug, Serialize)]
pub struct CreateAiChatResponse {
    pub conversation: Conversation,
    pub admin_token: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub conversation_id: String,
    pub admin_token: String,
}

#[derive(Debug, Serialize)]
pub struct InviteResponse {
    pub invite_token: String,
    pub room_url: String,
}

#[derive(Debug, Deserialize)]
pub struct JoinAiChatRequest {
    pub invite_token: String,
}

// --- Handlers ---

pub async fn list_contacts(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Contact>>, StatusCode> {
    let contacts =
        sqlx::query("SELECT id, username, email, avatar_url, last_seen, is_online FROM contacts")
            .map(|row: sqlx::sqlite::SqliteRow| Contact {
                id: row.get("id"),
                username: row.get("username"),
                email: row.get("email"),
                avatar_url: row.get("avatar_url"),
                last_seen: row.get("last_seen"),
                is_online: row.get("is_online"),
            })
            .fetch_all(&state.0.pool)
            .await
            .map_err(|e| {
                error!("Failed to fetch contacts: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    Ok(Json(contacts))
}

pub async fn send_friend_request(
    State(state): State<SharedState>,
    Json(payload): Json<SendFriendRequest>,
) -> Result<StatusCode, StatusCode> {
    let from_username = "current_user";
    let from_email = "user@example.com";

    match send_friend_request_db(
        &state.0.pool,
        payload.to_email.clone(),
        payload.message.clone(),
        from_email.to_string(),
        from_username.to_string(),
    )
    .await
    {
        Ok(_) => {
            // Guidance-based Structured Event
            use crate::models::{EventType, RealtimeEvent};
            use crate::realtime::broadcast_event;

            let event = RealtimeEvent::new(
                EventType::FriendRequested,
                serde_json::to_value(&payload).unwrap_or_default(),
            );
            let _ = broadcast_event(&state.0.broadcaster, event).await;

            Ok(StatusCode::CREATED)
        }
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn list_pending_requests(
    State(state): State<SharedState>,
) -> Result<Json<Vec<FriendRequest>>, StatusCode> {
    let requests = sqlx::query("SELECT id, from_username, from_email, to_email, message, status, created_at FROM friend_requests WHERE status = 'pending'")
        .map(|row: sqlx::sqlite::SqliteRow| FriendRequest {
            id: row.get("id"),
            from_username: row.get("from_username"),
            from_email: row.get("from_email"),
            to_email: row.get("to_email"),
            message: row.get("message"),
            status: row.get("status"),
            created_at: row.get("created_at"),
        })
        .fetch_all(&state.0.pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch pending requests: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(requests))
}

pub async fn respond_friend_request(
    State(state): State<SharedState>,
    Json(payload): Json<RespondFriendRequest>,
) -> Result<StatusCode, StatusCode> {
    let status = match payload.action.as_str() {
        "accept" => "accepted",
        "reject" => "rejected",
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let mut tx = state
        .0
        .pool
        .begin()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        "UPDATE friend_requests SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(status)
    .bind(&payload.request_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to update friend request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if status == "accepted" {
        let req = sqlx::query("SELECT from_username, from_email FROM friend_requests WHERE id = ?")
            .bind(&payload.request_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let from_username: String = req.get("from_username");
        let from_email: String = req.get("from_email");
        let contact_id = uuid::Uuid::new_v4().to_string();

        sqlx::query("INSERT OR IGNORE INTO contacts (id, username, email) VALUES (?, ?, ?)")
            .bind(contact_id)
            .bind(from_username)
            .bind(from_email)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                error!("Failed to add contact: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
    }

    tx.commit()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Guidance-based Structured Event
    use crate::models::{EventType, RealtimeEvent};
    use crate::realtime::broadcast_event;

    let event = RealtimeEvent::new(
        EventType::FriendAccepted,
        serde_json::to_value(&payload).unwrap_or_default(),
    );
    let _ = broadcast_event(&state.0.broadcaster, event).await;

    Ok(StatusCode::OK)
}

pub async fn list_conversations(
    State(state): State<SharedState>,
) -> Result<Json<Vec<Conversation>>, StatusCode> {
    let conversations = sqlx::query("SELECT id, name, created_by, is_direct_message, updated_at FROM conversations ORDER BY updated_at DESC")
        .map(|row: sqlx::sqlite::SqliteRow| Conversation {
            id: row.get("id"),
            name: row.get("name"),
            created_by: row.get("created_by"),
            is_direct_message: row.get("is_direct_message"),
            last_message: None,
            updated_at: row.get("updated_at"),
        })
        .fetch_all(&state.0.pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch conversations: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(conversations))
}

pub async fn create_conversation(
    State(state): State<SharedState>,
    Json(payload): Json<CreateConversation>,
) -> Result<Json<Conversation>, StatusCode> {
    match create_conversation_db(
        &state.0.pool,
        payload.name,
        "current_user".to_string(),
        payload.is_direct_message,
        payload.resource_url,
    )
    .await
    {
        Ok(conv) => Ok(Json(conv)),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

pub async fn list_messages(
    Path(conversation_id): Path<String>,
    State(state): State<SharedState>,
) -> Result<Json<Vec<Message>>, StatusCode> {
    let messages = sqlx::query("SELECT id, conversation_id, sender, content, created_at, is_read FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
        .bind(conversation_id)
        .map(|row: sqlx::sqlite::SqliteRow| Message {
            id: row.get("id"),
            conversation_id: row.get("conversation_id"),
            sender: row.get("sender"),
            content: row.get("content"),
            created_at: row.get("created_at"),
            is_read: row.get("is_read"),
        })
        .fetch_all(&state.0.pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch messages: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(messages))
}

pub async fn send_message_db(
    State(state): State<SharedState>,
    Json(payload): Json<SendMessage>,
) -> Result<Json<Message>, StatusCode> {
    let sender = payload
        .sender
        .clone()
        .unwrap_or_else(|| "current_user".to_string());
    let result = state
        .0
        .chat_manager
        .send_message(
            payload.conversation_id.clone(),
            payload.content.clone(),
            sender.clone(),
        )
        .await;

    match result {
        Ok(braid_msg) => Ok(Json(Message {
            id: braid_msg.id.to_string(),
            conversation_id: braid_msg.conversation_id.to_string(),
            sender: braid_msg.sender,
            content: braid_msg.content,
            created_at: braid_msg.timestamp.to_rfc3339(),
            is_read: false,
        })),
        Err(e) => {
            error!("Failed to send chat message: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_ai_chat(
    State(state): State<SharedState>,
    Json(payload): Json<CreateConversation>,
) -> Result<Json<CreateAiChatResponse>, StatusCode> {
    let admin_id = "current_user"; // In a real app, get from session
    let conversation = create_conversation_db(
        &state.0.pool,
        payload.name.clone(),
        admin_id.to_string(),
        false, // AI Group Chat is not a direct message
        payload.resource_url,
    )
    .await
    .map_err(|e| {
        error!("Failed to create AI chat in DB: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Phase 6 Enhancement: Create initial file in ai_chats
    if let Err(e) = state.0.chat_manager.sync_to_file(&conversation.id).await {
        error!("Failed to create initial AI chat file: {}", e);
    }

    // Create Admin JWT for this specific room
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(365)) // Long lived room token
        .expect("valid timestamp")
        .timestamp();

    let claims = RoomAdminClaims {
        sub: admin_id.to_owned(),
        room_id: conversation.id.clone(),
        exp: expiration as usize,
    };

    let admin_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
    .map_err(|e| {
        error!("Failed to generate admin token: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(CreateAiChatResponse {
        conversation,
        admin_token,
    }))
}

pub async fn generate_invite(
    State(_state): State<SharedState>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<Json<InviteResponse>, StatusCode> {
    // 1. Verify the Admin JWT
    let decoding_key = jsonwebtoken::DecodingKey::from_secret(JWT_SECRET);
    let validation = jsonwebtoken::Validation::default();

    let token_data =
        jsonwebtoken::decode::<RoomAdminClaims>(&payload.admin_token, &decoding_key, &validation)
            .map_err(|e| {
            error!("Invalid admin token: {}", e);
            StatusCode::UNAUTHORIZED
        })?;

    // 2. Ensure token matches the room
    if token_data.claims.room_id != payload.conversation_id {
        return Err(StatusCode::FORBIDDEN);
    }

    // 3. Create a specialized Invite Token (claims could include the specific guest ID later)
    // For now, we'll just create a signed token for that room ID.
    let invite_claims = RoomAdminClaims {
        sub: "guest".to_string(),
        room_id: payload.conversation_id.clone(),
        exp: (chrono::Utc::now() + chrono::Duration::days(7)).timestamp() as usize,
    };

    let invite_token = encode(
        &Header::default(),
        &invite_claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(InviteResponse {
        invite_token: invite_token.clone(),
        room_url: format!("xf://join?token={}", invite_token),
    }))
}

pub async fn join_ai_chat(
    State(state): State<SharedState>,
    Json(payload): Json<JoinAiChatRequest>,
) -> Result<Json<Conversation>, StatusCode> {
    // 1. Decode and verify the invite token
    let decoding_key = jsonwebtoken::DecodingKey::from_secret(JWT_SECRET);
    let validation = jsonwebtoken::Validation::default();

    let token_data =
        jsonwebtoken::decode::<RoomAdminClaims>(&payload.invite_token, &decoding_key, &validation)
            .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let room_id = token_data.claims.room_id;

    // 2. Fetch room details from DB
    let conversation = sqlx::query("SELECT id, name, created_by, is_direct_message, updated_at FROM conversations WHERE id = ?")
        .bind(&room_id)
        .map(|row: sqlx::sqlite::SqliteRow| Conversation {
            id: row.get("id"),
            name: row.get("name"),
            created_by: row.get("created_by"),
            is_direct_message: row.get("is_direct_message"),
            last_message: None,
            updated_at: row.get("updated_at"),
        })
        .fetch_optional(&state.0.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 3. Register user as a participant (TBD - we need a participants table)
    // For now, we'll just return the conversation.

    Ok(Json(conversation))
}

// --- Pure DB Logic ---

pub async fn send_friend_request_db(
    pool: &sqlx::SqlitePool,
    to_email: String,
    message: Option<String>,
    sender_email: String,
    sender_username: String,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO friend_requests (id, from_username, from_email, to_email, message, status) VALUES (?, ?, ?, ?, ?, 'pending')")
        .bind(id)
        .bind(sender_username)
        .bind(sender_email)
        .bind(to_email)
        .bind(message)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn create_conversation_db(
    pool: &sqlx::SqlitePool,
    name: Option<String>,
    sender_email: String,
    is_direct_message: bool,
    resource_url_opt: Option<String>,
) -> Result<Conversation, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let resource_url =
        resource_url_opt.unwrap_or_else(|| format!("https://mail.braid.org/chat/{}", id));

    sqlx::query("INSERT INTO conversations (id, name, created_by, is_direct_message, resource_url, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .bind(&id)
        .bind(&name)
        .bind(&sender_email)
        .bind(is_direct_message)
        .bind(&resource_url)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(Conversation {
        id,
        name,
        created_by: Some(sender_email),
        is_direct_message,
        last_message: None,
        updated_at: now,
    })
}
