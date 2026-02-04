//! Antimatter CRDT Module for Chat
//!
//! This module provides a simple CRDT-based message storage
//! using the braid-core types.

use crate::models::{Message, ChatUpdate};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::debug;
use uuid::Uuid;

/// Chat-specific CRDT wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCrdt {
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

impl ChatCrdt {
    /// Create a new Chat CRDT for a room
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

    /// Add a message to the chat
    pub fn add_message(
        &mut self,
        sender: &str,
        content: &str,
        msg_type: crate::models::MessageType,
        reply_to: Option<&str>,
        blob_refs: Vec<crate::models::BlobRef>,
    ) -> (String, Message) {
        let version = self.generate_version();
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
        self.version_graph.insert(version.clone(), parents.clone());
        
        // Update frontier - remove parents, add new version
        for parent in parents.keys() {
            self.current_version.remove(parent);
        }
        self.current_version.insert(version.clone(), true);
        
        // Store message
        self.messages.insert(version.clone(), message.clone());

        debug!("Added message {} with version {}", message_id, version);
        (version, message)
    }

    /// Edit an existing message
    pub fn edit_message(&mut self, msg_id: &str, new_content: &str) -> anyhow::Result<(String, Message)> {
        // Find the message by ID
        let (version, mut message) = self.messages
            .iter()
            .find(|(_, m)| m.id == msg_id)
            .map(|(v, m)| (v.clone(), m.clone()))
            .ok_or_else(|| anyhow::anyhow!("Message not found: {}", msg_id))?;

        let new_version = self.generate_version();
        let parents: HashMap<String, bool> = self.get_frontier()
            .into_iter()
            .map(|v| (v, true))
            .collect();

        // Update message
        message.content = new_content.to_string();
        message.edited_at = Some(Utc::now());
        message.version = new_version.clone();
        message.parents = parents.clone();

        // Update version graph
        self.version_graph.insert(new_version.clone(), parents.clone());
        
        // Update frontier
        for parent in parents.keys() {
            self.current_version.remove(parent);
        }
        self.current_version.insert(new_version.clone(), true);
        
        // Store updated message
        self.messages.insert(new_version.clone(), message.clone());

        Ok((new_version, message))
    }

    /// Export the current CRDT state for persistence
    pub fn export_state(&self) -> ChatCrdtState {
        ChatCrdtState {
            room_id: self.room_id.clone(),
            node_id: self.node_id.clone(),
            next_seq: self.next_seq,
            current_version: self.current_version.clone(),
            version_graph: self.version_graph.clone(),
            messages: self.messages.clone(),
        }
    }

    /// Import state from a previous export
    pub fn import_state(state: ChatCrdtState) -> Self {
        Self {
            room_id: state.room_id,
            node_id: state.node_id,
            next_seq: state.next_seq,
            current_version: state.current_version,
            version_graph: state.version_graph,
            messages: state.messages,
        }
    }

    /// Merge updates from another CRDT or client
    pub fn merge_updates(&mut self, updates: Vec<ChatUpdate>) -> Vec<Message> {
        let mut new_messages = Vec::new();

        for update in updates {
            // Skip if we already have this version
            if self.messages.contains_key(&update.version) {
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
                self.version_graph.insert(update.version.clone(), update.parents.clone());
                
                // Update frontier
                for parent in update.parents.keys() {
                    self.current_version.remove(parent);
                }
                self.current_version.insert(update.version.clone(), true);
                
                // Store message
                self.messages.insert(update.version.clone(), message.clone());
                new_messages.push(message);
            }
        }

        new_messages
    }

    /// Generate a sync braid for a client based on known versions
    pub fn generate_sync_braid(&self, known_versions: &HashMap<String, bool>) -> Vec<ChatUpdate> {
        let mut updates = Vec::new();

        for (version, message) in &self.messages {
            // Skip if already known (or is an ancestor of known)
            if known_versions.contains_key(version) {
                continue;
            }

            // Check if any parent is known (for causal ordering)
            let has_known_parent = message.parents.keys().any(|p| known_versions.contains_key(p));

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
