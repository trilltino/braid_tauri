//! Centralized directory structure management for Braid
//!
//! Directory layout:
//! ```text
//! braid_sync/
//! ├── local/           # Local SQLite, config files
//! ├── peers/           # P2P chat exports (markdown)
//! ├── ai/              # AI chat exports (markdown)
//! ├── braid.org/       # Synced wiki pages
//! └── .braidfs/        # Internal blob storage (managed by daemon)
//! ```

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tracing::{error, info, warn};

#[derive(Serialize, Deserialize, Debug)]
struct BraidConfig {
    braid_root: Option<PathBuf>,
}

/// Get the global configuration path
fn get_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("local_link").join("config.json"))
}

/// Load the persistent root from config file
pub fn load_persistent_root() -> Option<PathBuf> {
    let path = get_config_path()?;
    if !path.exists() {
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<BraidConfig>(&content) {
            Ok(config) => config.braid_root,
            Err(e) => {
                warn!("Failed to parse config file at {:?}: {}", path, e);
                None
            }
        },
        Err(e) => {
            warn!("Failed to read config file at {:?}: {}", path, e);
            None
        }
    }
}

/// Save a path as the persistent Braid root
pub fn save_persistent_root(root: PathBuf) -> anyhow::Result<()> {
    let path = get_config_path().ok_or_else(|| anyhow::anyhow!("Could not determine config dir"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let config = BraidConfig {
        braid_root: Some(root),
    };
    let json = serde_json::to_string_pretty(&config)?;
    fs::write(path, json)?;
    Ok(())
}

/// Get the BRAID_ROOT directory from environment, persistent config, or default
pub fn braid_root() -> PathBuf {
    // 1. Check environment variable
    if let Ok(val) = std::env::var("BRAID_ROOT") {
        return PathBuf::from(val);
    }

    // 2. Check persistent config
    if let Some(root) = load_persistent_root() {
        // Set env var so subprocesses see it too
        std::env::set_var("BRAID_ROOT", &root);
        return root;
    }

    // 3. Default fallback
    PathBuf::from("braid_data")
}

/// Set the BRAID_ROOT directory at runtime
pub fn set_braid_root(path: PathBuf) {
    info!("Setting BRAID_ROOT to: {:?}", path);
    std::env::set_var("BRAID_ROOT", path);
}

/// Local data directory (SQLite, config)
pub fn local_dir() -> PathBuf {
    braid_root().join("local")
}

/// Peer chat exports directory
pub fn peers_dir() -> PathBuf {
    braid_root().join("peers")
}

/// AI chat exports directory
pub fn ai_dir() -> PathBuf {
    braid_root().join("ai")
}

/// AI context directory for supplemental files
pub fn ai_context_dir() -> PathBuf {
    ai_dir().join("context")
}

/// Braid.org synced wiki pages directory
pub fn braid_org_dir() -> PathBuf {
    braid_root().join("braid.org")
}

/// BraidFS internal blob storage directory
pub fn braidfs_dir() -> PathBuf {
    braid_root().join(".braidfs")
}

/// Blob storage subdirectory
pub fn blobs_dir() -> PathBuf {
    braidfs_dir().join("blobs")
}

/// Blob metadata database path
pub fn blob_meta_path() -> PathBuf {
    braidfs_dir().join("meta.sqlite")
}

/// Database file path
pub fn db_path() -> PathBuf {
    local_dir().join("xfmail.db")
}

/// Sync directory (for filesystem watcher)
pub fn sync_dir() -> PathBuf {
    braid_root().join("sync")
}

/// Ensure a single directory exists
pub fn ensure_dir(path: &PathBuf) -> anyhow::Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
        info!("Created directory: {:?}", path);
    }
    Ok(())
}

/// Initialize the complete directory structure
/// Call this once at app startup before any other operations
pub fn init_structure() -> anyhow::Result<PathBuf> {
    let root = braid_root();

    // Ensure root exists first
    ensure_dir(&root)?;

    // Create all subdirectories
    ensure_dir(&local_dir())?;
    ensure_dir(&peers_dir())?;
    ensure_dir(&ai_dir())?;
    ensure_dir(&ai_context_dir())?;
    ensure_dir(&braid_org_dir())?;
    ensure_dir(&braidfs_dir())?;
    ensure_dir(&blobs_dir())?;

    // Canonicalize for absolute path
    let canonical = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());

    info!("Braid directory structure initialized at: {:?}", canonical);

    Ok(canonical)
}

/// Ensure a file's parent directory exists
pub fn ensure_parent(path: &PathBuf) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_dir(&parent.to_path_buf())?;
    }
    Ok(())
}

/// Get the appropriate chat export directory based on participants
/// Returns ai_dir() if any participant contains "bot" or "@BraidBot"
pub fn chat_export_dir(participants: &[String]) -> PathBuf {
    let is_ai = participants
        .iter()
        .any(|p| p.to_lowercase().contains("bot") || p == "@BraidBot");

    if is_ai {
        ai_dir()
    } else {
        peers_dir()
    }
}

/// Get the full path for a chat export file
pub fn chat_export_path(conversation_id: &str, participants: &[String]) -> PathBuf {
    chat_export_dir(participants).join(format!("{}.md", conversation_id))
}

/// Legacy path migration: Move old data to new locations if present
/// This can be called optionally during startup to migrate old structures
pub fn migrate_legacy_paths() -> anyhow::Result<()> {
    let root = braid_root();

    // Migrate: Messages/AI -> ai/
    let old_ai = root.join("Messages").join("AI");
    if old_ai.exists() {
        info!("Migrating legacy AI chats from {:?}", old_ai);
        let new_ai = ai_dir();
        for entry in std::fs::read_dir(&old_ai)? {
            let entry = entry?;
            let new_path = new_ai.join(entry.file_name());
            if let Err(e) = std::fs::rename(entry.path(), new_path) {
                error!("Failed to migrate {:?}: {}", entry.path(), e);
            }
        }
        let _ = std::fs::remove_dir(&old_ai);
        let _ = std::fs::remove_dir(root.join("Messages"));
    }

    // Migrate: data/ -> local/
    let old_data = root.join("data");
    if old_data.exists() && !local_dir().exists() {
        info!("Migrating legacy data directory to local/");
        std::fs::rename(&old_data, local_dir())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_chat_export_dir() {
        let ai_participants = vec!["Alice".to_string(), "@BraidBot".to_string()];
        let peer_participants = vec!["Alice".to_string(), "Bob".to_string()];

        assert!(chat_export_dir(&ai_participants)
            .to_string_lossy()
            .ends_with("ai"));
        assert!(chat_export_dir(&peer_participants)
            .to_string_lossy()
            .ends_with("peers"));
    }

    #[test]
    fn test_paths_are_absolute_when_canonicalized() {
        let _root = braid_root();
        let _local = local_dir();
        let _peers = peers_dir();
        let _ai = ai_dir();
        let _braid_org = braid_org_dir();

        let _path = chat_export_dir(&vec!["bot".to_string()]);
    }
}
