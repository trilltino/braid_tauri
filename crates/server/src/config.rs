//! Chat server configuration

use std::path::PathBuf;
use std::sync::Arc;

use crate::ai::AiChatManager;
use crate::auth::AuthManager;
use crate::daemon::DaemonIntegration;
use crate::friends::FriendManager;
use crate::mail::MailManager;
use crate::store::JsonChatStore;
use crate::wiki::WikiManager;

/// Configuration for the Braid Chat Server
#[derive(Clone, Debug)]
pub struct ChatServerConfig {
    /// Storage directory for chat files
    pub storage_dir: PathBuf,
    /// Blob storage directory
    pub blob_dir: PathBuf,
    /// Local drafts directory
    pub drafts_dir: PathBuf,
    /// Enable daemon integration
    pub enable_daemon: bool,
    /// Daemon port to connect to
    pub daemon_port: u16,
    /// Enable offline drafts
    pub enable_offline: bool,
    /// Max blob size in MB
    pub max_blob_size: usize,
    /// Inline blob threshold in bytes
    pub inline_threshold: usize,
    /// Node ID for CRDT
    pub node_id: String,
}

impl Default for ChatServerConfig {
    fn default() -> Self {
        Self {
            storage_dir: braid_common::peers_dir(),
            blob_dir: braid_common::blobs_dir(),
            drafts_dir: braid_common::sync_dir().join("drafts"),
            enable_daemon: true,
            daemon_port: 45678,
            enable_offline: true,
            max_blob_size: 50,
            inline_threshold: 10240, // 10KB
            node_id: format!(
                "server-{}",
                uuid::Uuid::new_v4().to_string()[..8].to_string()
            ),
        }
    }
}

impl ChatServerConfig {
    /// Create config with custom base directory
    pub fn with_base_dir(_base_dir: impl Into<PathBuf>) -> Self {
        // braid_common uses BRAID_ROOT env var or "braid_sync" default.
        // We ignore explicit base_dir for now to maintain consistency with braid_common.
        Self::default()
    }

    /// Ensure all directories exist
    pub async fn ensure_dirs(&self) -> anyhow::Result<()> {
        tokio::fs::create_dir_all(&self.storage_dir).await?;
        tokio::fs::create_dir_all(&self.blob_dir).await?;
        tokio::fs::create_dir_all(&self.drafts_dir).await?;
        Ok(())
    }
}

/// App state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub store: Arc<JsonChatStore>,
    pub auth: Arc<AuthManager>,
    pub friends: Arc<FriendManager>,
    pub ai_manager: Option<Arc<AiChatManager>>,
    pub daemon: Option<Arc<DaemonIntegration>>,
    pub mail_manager: Arc<MailManager>,
    pub wiki_manager: Arc<WikiManager>,
}
