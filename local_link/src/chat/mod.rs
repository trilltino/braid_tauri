//! Chat Module
//!
//! Pure Braid protocol chat using braid-http directly.
//! No custom wrapper - just re-exports from braid-http.

pub mod braid_client;

// Re-export braid-http types directly
pub use braid_client::{
    BraidClient,
    BraidRequest,
    BraidResponse,
    BraidSubscription,
    BraidUpdate,
    AuthResponse,
    ChatManager,
    headers,
    Version,
    parse_braid_update,
    ChatBraidExt,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSyncStatus {
    pub room_id: String,
    pub status: String,
    pub last_sync: Option<String>,
    pub pending_changes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobRef {
    pub hash: String,
    pub content_type: String,
    pub filename: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub sender: String,
    pub content: String,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub created_at: String,
    pub version: String,
    pub blob_refs: Vec<BlobRef>,
    pub deleted: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "type", content = "data")]
pub enum MessageType {
    Text,
    Image { width: Option<u32>, height: Option<u32> },
    File { filename: String, size: u64 },
    System { action: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatSnapshot {
    pub room: ChatRoom,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRoom {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub participants: Vec<String>,
}
