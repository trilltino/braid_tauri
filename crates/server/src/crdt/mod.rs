//! Antimatter CRDT Module for Chat
//!
//! This module provides CRDT-based message storage using braid-core's
//! AntimatterCrdt for enhanced offline sync with pruning and fissures.

use crate::models::{BlobRef, ChatUpdate, Message, MessageType};
use braid_core::antimatter::{AntimatterCrdt, PrunableCrdt};
use braid_core::antimatter::messages::Patch;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};
use uuid::Uuid;

// ============================================================================
// ChatMessageCrdt - Underlying data store implementing PrunableCrdt trait
// ============================================================================

/// The underlying CRDT that stores chat messages.
/// This implements `PrunableCrdt` so it can be managed by `AntimatterCrdt`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMessageCrdt {
    /// Room/Chat ID
    pub room_id: String,
    /// Node ID for this peer
    pub node_id: String,
    /// Next sequence number for generating unique versions
    pub next_seq: u64,
    /// Current frontier versions (leaves of the DAG)
    pub current_version: HashMap<String, bool>,
    /// The version graph (DAG): version -> set of parent versions
    pub version_graph: HashMap<String, HashMap<String, bool>>,
    /// Messages in this room (version -> message)
    pub messages: HashMap<String, Message>,
}

impl ChatMessageCrdt {
    /// Create a new ChatMessageCrdt for a room
    pub fn new(room_id: &str, node_id: &str) -> Self {
        Self {
            room_id: room_id.to_string(),
            node_id: node_id.to_string(),
            next_seq: 0,
            current_version: HashMap::new(),
            version_graph: HashMap::new(),
            messages: HashMap::new(),
        }
    }

    /// Generate a new unique version ID
    fn generate_version(&mut self) -> String {
        let version = format!("{}@{}", self.next_seq, self.node_id);
        self.next_seq += 1;
        version
    }

    /// Get the current frontier (leaf versions)
    pub fn get_frontier(&self) -> Vec<String> {
        self.current_version.keys().cloned().collect()
    }
}

impl PrunableCrdt for ChatMessageCrdt {
    /// Apply a patch to the CRDT (add/edit/delete message)
    fn apply_patch(&mut self, patch: Patch) {
        // Parse the patch content to determine operation
        if let Some(obj) = patch.content.as_object() {
            let version = self.generate_version();
            let parents: HashMap<String, bool> = self.get_frontier()
                .into_iter()
                .map(|v| (v, true))
                .collect();

            // Check if this is an AddMessage patch
            if let (Some(id), Some(sender), Some(content)) = (
                obj.get("id").and_then(|v| v.as_str()),
                obj.get("sender").and_then(|v| v.as_str()),
                obj.get("content").and_then(|v| v.as_str()),
            ) {
                let msg_type = obj.get("message_type")
                    .and_then(|v| serde_json::from_value::<MessageType>(v.clone()).ok())
                    .unwrap_or(MessageType::Text);

                let message = Message {
                    id: id.to_string(),
                    sender: sender.to_string(),
                    content: content.to_string(),
                    message_type: msg_type,
                    version: version.clone(),
                    parents: parents.clone(),
                    created_at: Utc::now(),
                    edited_at: None,
                    reply_to: obj.get("reply_to").and_then(|v| v.as_str()).map(String::from),
                    reactions: Vec::new(),
                    blob_refs: Vec::new(),
                    deleted: false,
                };

                // Update version graph
                self.version_graph.insert(version.clone(), parents.clone());
                
                // Update frontier
                for parent in parents.keys() {
                    self.current_version.remove(parent);
                }
                self.current_version.insert(version.clone(), true);
                
                // Store message
                self.messages.insert(version, message);
            }
        }
    }

    /// Prune metadata associated with a version (antimatter's core operation)
    fn prune(&mut self, version: &str) {
        // Remove version from graph but keep message for history
        // This is the "collapsing" part of Collapsing Time Machines
        self.version_graph.remove(version);
        debug!("Pruned version {} from chat CRDT", version);
    }

    /// Get the current sequence number
    fn get_next_seq(&self) -> u64 {
        self.next_seq
    }

    /// Generate a braid (list of updates) for syncing
    fn generate_braid(
        &self,
        known_versions: &HashMap<String, bool>,
    ) -> Vec<(String, HashMap<String, bool>, Vec<Patch>)> {
        let mut updates = Vec::new();

        for (version, message) in &self.messages {
            // Skip if already known
            if known_versions.contains_key(version) {
                continue;
            }

            let patch = Patch {
                range: "messages".to_string(),
                content: serde_json::json!({
                    "id": message.id,
                    "sender": message.sender,
                    "content": message.content,
                    "message_type": message.message_type,
                    "reply_to": message.reply_to,
                }),
            };

            updates.push((version.clone(), message.parents.clone(), vec![patch]));
        }

        // Sort by timestamp for consistent ordering
        updates.sort_by(|a, b| {
            let msg_a = self.messages.get(&a.0);
            let msg_b = self.messages.get(&b.0);
            match (msg_a, msg_b) {
                (Some(a), Some(b)) => a.created_at.cmp(&b.created_at),
                _ => std::cmp::Ordering::Equal,
            }
        });

        updates
    }
}

// ============================================================================
// ChatCrdt - High-level wrapper for chat operations
// ============================================================================

/// Chat-specific CRDT wrapper using AntimatterCrdt for offline sync
#[derive(Clone, Serialize, Deserialize)]
pub struct ChatCrdt {
    /// The underlying message store
    pub inner: ChatMessageCrdt,
    // Note: AntimatterCrdt is not directly stored here because it requires
    // runtime callbacks. Instead, we use ChatMessageCrdt directly and
    // expose methods that mirror what AntimatterCrdt would provide.
}

impl ChatCrdt {
    /// Create a new Chat CRDT for a room
    pub fn new(room_id: &str, node_id: &str) -> Self {
        Self {
            inner: ChatMessageCrdt::new(room_id, node_id),
        }
    }

    /// Get the current frontier (leaf versions)
    pub fn get_frontier(&self) -> Vec<String> {
        self.inner.get_frontier()
    }

    /// Add a message to the chat
    pub fn add_message(
        &mut self,
        sender: &str,
        content: &str,
        msg_type: MessageType,
        reply_to: Option<&str>,
        blob_refs: Vec<BlobRef>,
    ) -> (String, Message) {
        let version = format!("{}@{}", self.inner.next_seq, self.inner.node_id);
        self.inner.next_seq += 1;
        let message_id = Uuid::new_v4().to_string();
        
        // Parents are the current frontier
        let parents: HashMap<String, bool> = self.get_frontier()
            .into_iter()
            .map(|v| (v, true))
            .collect();

        let message = Message {
            id: message_id.clone(),
            sender: sender.to_string(),
            content: content.to_string(),
            message_type: msg_type,
            version: version.clone(),
            parents: parents.clone(),
            created_at: Utc::now(),
            edited_at: None,
            reply_to: reply_to.map(|s| s.to_string()),
            reactions: Vec::new(),
            blob_refs,
            deleted: false,
        };

        // Update version graph
        self.inner.version_graph.insert(version.clone(), parents.clone());
        
        // Update frontier - remove parents, add new version
        for parent in parents.keys() {
            self.inner.current_version.remove(parent);
        }
        self.inner.current_version.insert(version.clone(), true);
        
        // Store message
        self.inner.messages.insert(version.clone(), message.clone());

        debug!("Added message {} with version {}", message_id, version);
        (version, message)
    }

    /// Edit an existing message
    pub fn edit_message(&mut self, msg_id: &str, new_content: &str) -> anyhow::Result<(String, Message)> {
        // Find the message by ID
        let (old_version, mut message) = self.inner.messages
            .iter()
            .find(|(_, m)| m.id == msg_id)
            .map(|(v, m)| (v.clone(), m.clone()))
            .ok_or_else(|| anyhow::anyhow!("Message not found: {}", msg_id))?;

        let version = format!("{}@{}", self.inner.next_seq, self.inner.node_id);
        self.inner.next_seq += 1;
        
        let parents: HashMap<String, bool> = self.get_frontier()
            .into_iter()
            .map(|v| (v, true))
            .collect();

        // Update message
        message.content = new_content.to_string();
        message.edited_at = Some(Utc::now());
        message.version = version.clone();
        message.parents = parents.clone();

        // Update version graph
        self.inner.version_graph.insert(version.clone(), parents.clone());
        
        // Update frontier
        for parent in parents.keys() {
            self.inner.current_version.remove(parent);
        }
        self.inner.current_version.insert(version.clone(), true);
        
        // Store updated message
        self.inner.messages.insert(version.clone(), message.clone());

        Ok((version, message))
    }

    /// Export the current CRDT state for persistence
    pub fn export_state(&self) -> ChatCrdtState {
        ChatCrdtState {
            room_id: self.inner.room_id.clone(),
            node_id: self.inner.node_id.clone(),
            next_seq: self.inner.next_seq,
            current_version: self.inner.current_version.clone(),
            version_graph: self.inner.version_graph.clone(),
            messages: self.inner.messages.clone(),
        }
    }

    /// Import state from a previous export
    pub fn import_state(state: ChatCrdtState) -> Self {
        Self {
            inner: ChatMessageCrdt {
                room_id: state.room_id,
                node_id: state.node_id,
                next_seq: state.next_seq,
                current_version: state.current_version,
                version_graph: state.version_graph,
                messages: state.messages,
            },
        }
    }

    /// Merge updates from another CRDT or client
    pub fn merge_updates(&mut self, updates: Vec<ChatUpdate>) -> Vec<Message> {
        let mut new_messages = Vec::new();

        for update in updates {
            // Skip if we already have this version
            if self.inner.messages.contains_key(&update.version) {
                continue;
            }

            // Create message from first patch (AddMessage)
            if let Some(crate::models::ChatPatch::AddMessage { id, content, sender, message_type }) = update.patches.first() {
                let message = Message {
                    id: id.clone(),
                    sender: sender.clone(),
                    content: content.clone(),
                    message_type: message_type.clone(),
                    version: update.version.clone(),
                    parents: update.parents.clone(),
                    created_at: update.timestamp,
                    edited_at: None,
                    reply_to: None,
                    reactions: Vec::new(),
                    blob_refs: Vec::new(),
                    deleted: false,
                };

                // Update version graph
                self.inner.version_graph.insert(update.version.clone(), update.parents.clone());
                
                // Update frontier
                for parent in update.parents.keys() {
                    self.inner.current_version.remove(parent);
                }
                self.inner.current_version.insert(update.version.clone(), true);
                
                // Store message
                self.inner.messages.insert(update.version.clone(), message.clone());
                new_messages.push(message);
            }
        }

        new_messages
    }

    /// Generate a sync braid for a client based on known versions
    pub fn generate_sync_braid(&self, known_versions: &HashMap<String, bool>) -> Vec<ChatUpdate> {
        let mut updates = Vec::new();

        for (version, message) in &self.inner.messages {
            // Skip if already known
            if known_versions.contains_key(version) {
                continue;
            }

            updates.push(ChatUpdate {
                version: version.clone(),
                parents: message.parents.clone(),
                patches: vec![crate::models::ChatPatch::AddMessage {
                    id: message.id.clone(),
                    content: message.content.clone(),
                    sender: message.sender.clone(),
                    message_type: message.message_type.clone(),
                }],
                timestamp: message.created_at,
                author: message.sender.clone(),
            });
        }

        // Sort by timestamp for consistent ordering
        updates.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        updates
    }

    /// Prune old acknowledged history to save memory (offline enhancement)
    pub fn prune_acknowledged(&mut self, acknowledged_versions: &[String]) {
        for version in acknowledged_versions {
            self.inner.prune(version);
        }
        info!("Pruned {} acknowledged versions", acknowledged_versions.len());
    }

    /// Access to messages for compatibility
    pub fn messages(&self) -> &HashMap<String, Message> {
        &self.inner.messages
    }

    /// Access to version graph for compatibility
    pub fn version_graph(&self) -> &HashMap<String, HashMap<String, bool>> {
        &self.inner.version_graph
    }
}

// Deref to inner messages for backward compatibility
impl std::ops::Deref for ChatCrdt {
    type Target = ChatMessageCrdt;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

/// Serializable state for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCrdtState {
    pub room_id: String,
    pub node_id: String,
    pub next_seq: u64,
    pub current_version: HashMap<String, bool>,
    pub version_graph: HashMap<String, HashMap<String, bool>>,
    pub messages: HashMap<String, Message>,
}
