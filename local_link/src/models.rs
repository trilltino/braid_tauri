use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub username: String,
    pub email: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: Uuid,
    pub name: String,
    pub last_message: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sender: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailPost {
    pub url: String,
    pub date: Option<u64>,
    pub from: Option<Vec<String>>,
    pub to: Option<Vec<String>>,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEditorPage {
    pub url: String,
    pub content: String,
    pub last_modified: Option<DateTime<Utc>>,
    pub version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub is_dir: bool,
    pub is_network: bool,
    pub relative_path: String,
    pub full_path: String,
    pub children: Vec<FileNode>,
}

/// Type of real-time event (following xfmail guidance)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// Chat message event
    Message,
    /// User notification event
    Notification,
    /// Status update event
    Status,
    /// Typing indicator event
    Typing,
    /// Friend request accepted event
    FriendAccepted,
    /// Friend request received event
    FriendRequested,
    /// Custom event type
    Custom(String),
}

/// Real-time event that can be broadcast (following xfmail guidance)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RealtimeEvent {
    /// Type of event
    pub event_type: EventType,
    /// Event payload (JSON-serializable data)
    pub payload: serde_json::Value,
    /// Timestamp when event occurred (RFC3339)
    pub timestamp: String,
    /// Optional version ID for Braid protocol
    pub version: Option<String>,
}

impl RealtimeEvent {
    pub fn new(event_type: EventType, payload: serde_json::Value) -> Self {
        Self {
            event_type,
            payload,
            timestamp: chrono::Utc::now().to_rfc3339(),
            version: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobResponse {
    pub base64: String,
    pub content_type: Option<String>,
}
