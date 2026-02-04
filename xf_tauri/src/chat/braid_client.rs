//! Pure Braid Protocol Client
//!
//! Thin wrapper around braid_http::BraidClient.
//! All protocol handling is done directly through braid-http types.

pub use braid_http::{
    BraidClient,
    BraidRequest,
    BraidResponse,
    client::Subscription as BraidSubscription,
    protocol::constants::headers,
    types::Version,
};

// Re-export types that the UI needs
pub use crate::chat::{
    Message, BlobRef, ChatSnapshot, ChatSyncStatus, MessageType,
};

/// Simple auth response type
#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
    pub username: String,
}

/// Braid update from subscription stream
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct BraidUpdate {
    pub version: String,
    pub data: serde_json::Value,
    #[serde(rename = "type")]
    pub update_type: String,
}

/// Helper trait for chat operations using pure Braid protocol
pub trait ChatBraidExt {
    /// Build request with auth token
    fn with_auth(&self, token: Option<&str>) -> BraidRequest;
}

impl ChatBraidExt for BraidClient {
    fn with_auth(&self, token: Option<&str>) -> BraidRequest {
        let mut req = BraidRequest::new();
        if let Some(t) = token {
            req = req.with_header("Authorization", &format!("Bearer {}", t));
        }
        req
    }
}

/// Parse Braid update from subscription body
pub fn parse_braid_update(body: &[u8]) -> Option<BraidUpdate> {
    let body_str = String::from_utf8_lossy(body);
    serde_json::from_str(&body_str).ok()
}

/// ChatManager for backward compatibility with existing code
pub struct ChatManager {
    client: BraidClient,
    pub base_url: String,
    auth_token: Option<String>,
}

impl ChatManager {
    pub fn new(base_url: String) -> anyhow::Result<Self> {
        let client = BraidClient::new()
            .map_err(|e| anyhow::anyhow!("Failed to create BraidClient: {}", e))?;
        
        Ok(Self {
            client,
            base_url,
            auth_token: None,
        })
    }
    
    pub fn set_auth_token(&mut self, token: String) {
        self.auth_token = Some(token);
    }
    
    pub fn client(&self) -> &BraidClient {
        &self.client
    }
    
    /// Build authenticated request
    fn req(&self) -> BraidRequest {
        self.client.with_auth(self.auth_token.as_deref())
    }
    
    /// Send message - pure Braid PUT
    pub async fn send_message(
        &self,
        conversation_id: String,
        content: String,
        sender: String,
    ) -> anyhow::Result<crate::models::BraidMessage> {
        let url = format!("{}/chat/{}", self.base_url, conversation_id);
        
        let body = serde_json::json!({
            "content": content,
            "message_type": { "type": "text" },
        });

        let req = self.req()
            .with_method("PUT")
            .with_content_type("application/json")
            .with_body(body.to_string());

        let resp = self.client.fetch(&url, req).await?;
        
        // Extract version from Braid response headers
        let version = resp.headers
            .get("version")
            .map(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(crate::models::BraidMessage {
            id: uuid::Uuid::new_v4(),
            conversation_id: uuid::Uuid::parse_str(&conversation_id)
                .unwrap_or_else(|_| uuid::Uuid::new_v4()),
            sender,
            content,
            timestamp: chrono::Utc::now(),
            version,
        })
    }
    
    /// Sync to file - no-op in pure Braid (sync happens automatically)
    pub async fn sync_to_file(&self, _conversation_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}
