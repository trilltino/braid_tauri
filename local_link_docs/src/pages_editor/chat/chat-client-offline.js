/**
 * Offline-First Chat Client
 * 
 * Wraps the base chat client with offline queue support.
 * All operations are persisted locally and synced when online.
 */

import { createChatClient } from './chat-client.js';
import { OfflineQueue, SyncManager } from './offline-queue.js';

/**
 * Create an offline-first chat client
 * 
 * @param {string} roomId - The chat room ID
 * @param {Object} options - Configuration options
 * @returns {Object} Enhanced chat client with offline support
 */
export function createOfflineChatClient(roomId, options = {}) {
  const {
    onMessages,
    onMessageUpdate,
    onSyncStatusChange,
    onError,
    daemonPort = 45678,
    enableOffline = true
  } = options;

  // Base client for online operations
  const baseClient = createChatClient(roomId, {
    onMessages: (msgs) => {
      // Merge with pending local operations
      const merged = mergeWithPending(msgs);
      onMessages?.(merged);
    },
    onMessageUpdate: (msg) => {
      onMessageUpdate?.(msg);
    },
    onError: (err) => {
      onError?.(err);
    },
    daemonPort
  });

  // Offline queue
  let queue = null;
  let syncManager = null;
  let pendingMessages = new Map(); // Local optimistic updates

  /**
   * Merge server messages with pending local operations
   */
  function mergeWithPending(serverMessages) {
    const merged = [...serverMessages];
    
    // Add pending messages that aren't in server state yet
    for (const [id, msg] of pendingMessages) {
      const exists = merged.find(m => m.id === id);
      if (!exists) {
        merged.push({ ...msg, _pending: true });
      }
    }
    
    // Sort by timestamp
    merged.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    return merged;
  }

  /**
   * Initialize offline storage
   */
  async function init() {
    if (!enableOffline) return;
    
    queue = new OfflineQueue(roomId, {
      useTauri: true,
      onStateChange: (state) => {
        console.log(`[Chat ${roomId}] Loaded CRDT state from disk`);
      }
    });
    
    await queue.init();
    
    // Start sync manager
    syncManager = new SyncManager(queue, baseClient, {
      interval: 3000,
      onProgress: (progress) => {
        onSyncStatusChange?.({
          status: 'syncing',
          pending: queue.getPending().length,
          progress
        });
      },
      onComplete: (result) => {
        onSyncStatusChange?.({
          status: 'synced',
          pending: queue.getPending().length,
          processed: result.processed
        });
        
        // Clear processed pending messages
        for (const id of pendingMessages.keys()) {
          if (queue.isDuplicate(id)) {
            pendingMessages.delete(id);
          }
        }
      },
      onError: (err) => {
        onSyncStatusChange?.({
          status: 'error',
          error: err.message,
          pending: queue.getPending().length
        });
      }
    });
    
    syncManager.start();
    
    // Connect base client
    await baseClient.connect();
    
    console.log(`[Chat ${roomId}] Offline-first client initialized`);
  }

  /**
   * Send message (offline-aware)
   */
  async function sendMessage(content, opts = {}) {
    const tempId = generateTempId();
    
    // Create optimistic message
    const optimisticMsg = {
      id: tempId,
      sender: baseClient.peer,
      content,
      type: opts.attachments?.length > 0 ? 'file' : 'text',
      created_at: new Date().toISOString(),
      version: 'local',
      parents: [],
      reply_to: opts.replyTo || null,
      blob_refs: opts.attachments || [],
      reactions: [],
      edited_at: null,
      edit_history: [],
      deleted: false,
      _pending: true,
      _optimistic: true
    };
    
    // Add to pending
    pendingMessages.set(tempId, optimisticMsg);
    onMessages?.(mergeWithPending([])); // Trigger UI update
    
    // Queue for sync
    if (enableOffline && queue) {
      await queue.enqueue('send', {
        id: tempId,
        content,
        replyTo: opts.replyTo,
        attachments: opts.attachments
      });
      
      // Try immediate sync if connected
      if (baseClient.isConnected) {
        syncManager?.syncNow().catch(() => {});
      }
    } else {
      // Online-only mode
      try {
        const msg = await baseClient.sendMessage(content, opts);
        pendingMessages.delete(tempId);
        return msg;
      } catch (err) {
        pendingMessages.delete(tempId);
        throw err;
      }
    }
    
    return optimisticMsg;
  }

  /**
   * Edit message (offline-aware)
   */
  async function editMessage(msgId, newContent) {
    // Optimistic update
    const existing = pendingMessages.get(msgId);
    if (existing) {
      existing.content = newContent;
      existing.edited_at = new Date().toISOString();
      onMessages?.(mergeWithPending([]));
    }
    
    if (enableOffline && queue) {
      await queue.enqueue('edit', { msgId, newContent });
      
      if (baseClient.isConnected) {
        syncManager?.syncNow().catch(() => {});
      }
    } else {
      return baseClient.editMessage(msgId, newContent);
    }
  }

  /**
   * Delete message (offline-aware)
   */
  async function deleteMessage(msgId) {
    // Optimistic update
    const existing = pendingMessages.get(msgId);
    if (existing) {
      existing.deleted = true;
      onMessages?.(mergeWithPending([]));
    }
    
    if (enableOffline && queue) {
      await queue.enqueue('delete', { msgId });
      
      if (baseClient.isConnected) {
        syncManager?.syncNow().catch(() => {});
      }
    } else {
      return baseClient.deleteMessage(msgId);
    }
  }

  /**
   * Add reaction (offline-aware)
   */
  async function addReaction(msgId, emoji) {
    if (enableOffline && queue) {
      await queue.enqueue('reaction', { msgId, emoji });
      
      if (baseClient.isConnected) {
        syncManager?.syncNow().catch(() => {});
      }
    } else {
      return baseClient.addReaction(msgId, emoji);
    }
  }

  /**
   * Get sync status
   */
  function getSyncStatus() {
    if (!queue) return { status: 'unknown' };
    return queue.getStats();
  }

  /**
   * Force sync now
   */
  async function syncNow() {
    if (syncManager) {
      return syncManager.syncNow();
    }
  }

  /**
   * Export debug info
   */
  function exportDebugInfo() {
    return {
      roomId,
      queue: queue?.export(),
      pendingMessages: Array.from(pendingMessages.entries()),
      isConnected: baseClient.isConnected
    };
  }

  /**
   * Disconnect and cleanup
   */
  function disconnect() {
    syncManager?.stop();
    baseClient.disconnect();
  }

  /**
   * Generate temporary ID
   */
  function generateTempId() {
    return `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  return {
    init,
    connect: init, // Alias
    disconnect,
    sendMessage,
    editMessage,
    deleteMessage,
    addReaction,
    syncNow,
    getSyncStatus,
    exportDebugInfo,
    get peer() { return baseClient.peer; },
    get isConnected() { return baseClient.isConnected; }
  };
}
