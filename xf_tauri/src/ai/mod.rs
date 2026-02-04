//! AI Chat Types and Client
//!
//! AI processing is now handled entirely by the backend server.
//! This module provides types and client functions for AI chat.
//!
//! When a user sends a message containing "@BraidBot" or "@BraidBot!",
//! the server automatically processes it and generates a response.
//! The frontend treats AI chats just like regular chats.

use serde::{Deserialize, Serialize};

/// AI Chat configuration (set by server)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChatConfig {
    pub model: String,
    pub enable_context: bool,
}

impl Default for AiChatConfig {
    fn default() -> Self {
        Self {
            model: "ollama::qwen3:4b".to_string(),
            enable_context: true,
        }
    }
}

/// Request to create an AI chat room
#[derive(Debug, Serialize)]
pub struct CreateAiChatRequest {
    pub name: String,
    pub participant_emails: Vec<String>,
}

/// Response from creating AI chat
#[derive(Debug, Deserialize)]
pub struct CreateAiChatResponse {
    pub conversation_id: String,
    pub admin_token: String,
}

/// Check if a message triggers the AI
pub fn is_ai_trigger(content: &str) -> bool {
    content.contains("@BraidBot") || content.contains("@BraidBot!")
}

/// Format a message to trigger AI response
pub fn format_ai_prompt(content: &str) -> String {
    if !content.contains("@BraidBot") {
        format!("@BraidBot! {}", content)
    } else {
        content.to_string()
    }
}

/// AI Participant info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiParticipant {
    pub id: String,
    pub name: String,
    pub avatar: String,
}

impl AiParticipant {
    pub fn braid_bot() -> Self {
        Self {
            id: "@BraidBot".to_string(),
            name: "BraidBot".to_string(),
            avatar: "🤖".to_string(),
        }
    }
}

// No local AI processing - everything is done server-side
// The server watches for @BraidBot mentions and responds automatically
