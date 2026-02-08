/**
 * Chat Client for Braid Protocol
 * 
 * Uses Braid-HTTP for real-time chat synchronization with
 * Diamond Types CRDT for conflict resolution.
 */

import { braid_fetch } from '../shared/braid-http-client.js';

/**
 * Create a chat client for a specific room
 * 
 * @param {string} roomId - The chat room ID
 * @param {Object} options - Configuration options
 * @returns {Object} Chat client API
 */
export function createChatClient(roomId, {
  onMessages,
  onMessageUpdate,
  onError,
  daemonPort = 45678
}) {
  const baseUrl = `http://localhost:${daemonPort}`;
  const peer = Math.random().toString(36).substr(2);
  
  let currentVersion = [];
  let messages = new Map(); // msgId -> message
  let ac = new AbortController();
  let isConnected = false;

  /**
   * Parse messages from CRDT content (JSON Lines format)
   */
  function parseMessages(content) {
    const msgs = [];
    for (const line of content.split('\n')) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          msgs.push(msg);
        } catch (e) {
          console.warn('Failed to parse message:', line);
        }
      }
    }
    return msgs;
  }

  /**
   * Serialize messages to CRDT content
   */
  function serializeMessages(msgs) {
    return msgs.map(m => JSON.stringify(m)).join('\n');
  }

  /**
   * Start the chat subscription
   */
  async function connect() {
    try {
      const res = await braid_fetch(`${baseUrl}/chat/${roomId}`, {
        headers: {
          'Merge-Type': 'diamond',
          'Content-Type': 'application/json'
        },
        subscribe: true,
        retry: (res) => res.status !== 404,
        parents: () => currentVersion.length ? currentVersion : null,
        peer,
        signal: ac.signal
      });

      isConnected = true;

      res.subscribe(update => {
        // Update version tracking
        update.parents.sort();
        if (currentVersion.length === update.parents.length &&
            currentVersion.every((v, i) => v === update.parents[i])) {
          currentVersion = update.version.sort();
        }

        // Handle incoming messages
        if (update.state !== undefined) {
          // Full state update
          const newMessages = parseMessages(update.state);
          messages = new Map(newMessages.map(m => [m.id, m]));
          onMessages?.(Array.from(messages.values()));
        }

        if (update.patches) {
          // Incremental patch update
          for (const patch of update.patches) {
            applyPatch(patch);
          }
          onMessages?.(Array.from(messages.values()));
        }
      });
    } catch (err) {
      onError?.(err);
      isConnected = false;
    }
  }

  /**
   * Apply a patch to the local message state
   */
  function applyPatch(patch) {
    try {
      const msg = JSON.parse(patch.content_text || patch.content);
      messages.set(msg.id, msg);
      onMessageUpdate?.(msg);
    } catch (e) {
      console.warn('Failed to apply patch:', patch, e);
    }
  }

  /**
   * Send a new message
   */
  async function sendMessage(content, options = {}) {
    const { replyTo, attachments = [] } = options;
    
    const msg = {
      id: generateId(),
      sender: peer,
      content,
      type: attachments.length > 0 ? 'file' : 'text',
      created_at: new Date().toISOString(),
      version: null,
      parents: [],
      reply_to: replyTo || null,
      blob_refs: attachments,
      reactions: [],
      edited_at: null,
      edit_history: [],
      deleted: false
    };

    messages.set(msg.id, msg);
    onMessages?.(Array.from(messages.values()));
    await sendUpdate(msg);
    return msg;
  }

  /**
   * Edit an existing message
   */
  async function editMessage(msgId, newContent) {
    const msg = messages.get(msgId);
    if (!msg) throw new Error('Message not found');
    if (msg.sender !== peer) throw new Error('Can only edit own messages');

    const editRecord = {
      version: msg.version,
      timestamp: new Date().toISOString(),
      content: msg.content,
      parents: msg.parents
    };

    if (!msg.edit_history) msg.edit_history = [];
    msg.edit_history.push(editRecord);
    msg.content = newContent;
    msg.edited_at = new Date().toISOString();

    messages.set(msgId, msg);
    onMessages?.(Array.from(messages.values()));
    await sendUpdate(msg, 'edit');
    return msg;
  }

  /**
   * Delete a message (soft delete)
   */
  async function deleteMessage(msgId) {
    const msg = messages.get(msgId);
    if (!msg) throw new Error('Message not found');
    if (msg.sender !== peer) throw new Error('Can only delete own messages');

    msg.deleted = true;
    msg.edited_at = new Date().toISOString();

    messages.set(msgId, msg);
    onMessages?.(Array.from(messages.values()));
    await sendUpdate(msg, 'delete');
  }

  /**
   * Add a reaction to a message
   */
  async function addReaction(msgId, emoji) {
    const msg = messages.get(msgId);
    if (!msg) throw new Error('Message not found');

    if (!msg.reactions) msg.reactions = [];
    
    const existing = msg.reactions.find(r => r.emoji === emoji && r.user === peer);
    if (existing) return;

    msg.reactions.push({
      emoji,
      user: peer,
      timestamp: new Date().toISOString()
    });

    messages.set(msgId, msg);
    onMessages?.(Array.from(messages.values()));
    await sendUpdate(msg, 'reaction');
  }

  /**
   * Send update to server
   */
  async function sendUpdate(msg, action = 'add') {
    const state = serializeMessages(Array.from(messages.values()));
    
    try {
      const response = await fetch(`${baseUrl}/chat/${roomId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Merge-Type': 'diamond',
          'Version': generateVersion(),
          'Parents': JSON.stringify(currentVersion)
        },
        body: JSON.stringify({ action, message: msg, state })
      });

      if (!response.ok) {
        if (response.status === 409) {
          console.warn('Conflict detected, syncing...');
          await sync();
        } else {
          throw new Error(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      onError?.(err);
      throw err;
    }
  }

  async function sync() {
    ac.abort();
    ac = new AbortController();
    await connect();
  }

  function disconnect() {
    ac.abort();
    isConnected = false;
  }

  function generateId() {
    return `${peer}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  function generateVersion() {
    return `${peer}-${Date.now()}`;
  }

  function getEditHistory(msgId) {
    const msg = messages.get(msgId);
    return msg?.edit_history || [];
  }

  return {
    connect,
    disconnect,
    sendMessage,
    editMessage,
    deleteMessage,
    addReaction,
    getEditHistory,
    sync,
    get isConnected() { return isConnected; },
    get peer() { return peer; }
  };
}
