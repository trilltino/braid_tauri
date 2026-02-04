pub mod ai;
pub mod auth;
pub mod braid_mail;
pub mod chat;
pub mod local_sync;

pub mod backend;
pub mod commands;
pub mod models;
pub mod realtime;

// Re-export commonly used types
pub use chat::{BlobRef, ChatManager, ChatSnapshot, ChatSyncStatus, Message, MessageType};

// Export braid types for pure Braid protocol
pub use chat::braid_client::{
    BraidClient, BraidRequest, BraidResponse, BraidSubscription, BraidUpdate,
};

pub use models::{BraidMessage, EventType, RealtimeEvent};
