/**
 * Offline Queue for Local-First Chat
 * 
 * Persists pending messages to disk for true offline support.
 * Uses Tauri's FS API when available, falls back to localStorage.
 */

const QUEUE_KEY = 'chat_offline_queue';
const STATE_KEY = 'chat_crdt_state';

/**
 * Pending operation in the queue
 */
export class PendingOperation {
  constructor(type, data, timestamp = Date.now()) {
    this.id = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    this.type = type; // 'send', 'edit', 'delete', 'reaction'
    this.data = data;
    this.timestamp = timestamp;
    this.retries = 0;
    this.maxRetries = 5;
    this.status = 'pending'; // 'pending', 'syncing', 'failed', 'acked'
    this.error = null;
  }
}

/**
 * OfflineQueue manages local persistence and sync
 */
export class OfflineQueue {
  constructor(roomId, options = {}) {
    this.roomId = roomId;
    this.storageDir = options.storageDir || `chat_${roomId}`;
    this.useTauri = options.useTauri !== false && typeof window !== 'undefined' && window.__TAURI__;
    this.maxQueueSize = options.maxQueueSize || 1000;
    this.onStateChange = options.onStateChange || (() => {});
    
    this.queue = [];
    this.crdtState = null;
    this.syncStatus = 'disconnected'; // 'connected', 'syncing', 'disconnected', 'error'
    this.lastSyncTime = null;
    
    // Message deduplication cache
    this.sentMessages = new Set();
  }

  /**
   * Initialize - load from disk
   */
  async init() {
    await this.loadQueue();
    await this.loadCrdtState();
    console.log(`[OfflineQueue ${this.roomId}] Initialized with ${this.queue.length} pending ops`);
    return this;
  }

  /**
   * Get storage path for Tauri
   */
  _getQueuePath() {
    return `${this.storageDir}/queue.json`;
  }

  _getStatePath() {
    return `${this.storageDir}/crdt_state.json`;
  }

  /**
   * Load queue from storage
   */
  async loadQueue() {
    try {
      if (this.useTauri) {
        // Use Tauri FS API
        const { readTextFile, BaseDirectory } = window.__TAURI__.fs;
        const data = await readTextFile(this._getQueuePath(), { 
          dir: BaseDirectory.AppData 
        });
        this.queue = JSON.parse(data);
      } else {
        // Fallback to localStorage
        const data = localStorage.getItem(`${QUEUE_KEY}_${this.roomId}`);
        if (data) {
          this.queue = JSON.parse(data);
        }
      }
    } catch (err) {
      console.warn(`[OfflineQueue ${this.roomId}] Failed to load queue:`, err);
      this.queue = [];
    }
  }

  /**
   * Save queue to storage
   */
  async saveQueue() {
    try {
      // Clean up old completed operations
      this.queue = this.queue.filter(op => 
        op.status !== 'acked' || 
        Date.now() - op.timestamp < 24 * 60 * 60 * 1000 // Keep acked for 24h
      );

      if (this.useTauri) {
        const { writeTextFile, BaseDirectory, mkdir } = window.__TAURI__.fs;
        // Ensure directory exists
        try {
          await mkdir(this.storageDir, { dir: BaseDirectory.AppData, recursive: true });
        } catch (e) {
          // Directory may already exist
        }
        
        await writeTextFile(
          this._getQueuePath(),
          JSON.stringify(this.queue, null, 2),
          { dir: BaseDirectory.AppData }
        );
      } else {
        localStorage.setItem(`${QUEUE_KEY}_${this.roomId}`, JSON.stringify(this.queue));
      }
    } catch (err) {
      console.error(`[OfflineQueue ${this.roomId}] Failed to save queue:`, err);
    }
  }

  /**
   * Load CRDT state from storage
   */
  async loadCrdtState() {
    try {
      if (this.useTauri) {
        const { readTextFile, BaseDirectory } = window.__TAURI__.fs;
        const data = await readTextFile(this._getStatePath(), { 
          dir: BaseDirectory.AppData 
        });
        this.crdtState = JSON.parse(data);
      } else {
        const data = localStorage.getItem(`${STATE_KEY}_${this.roomId}`);
        if (data) {
          this.crdtState = JSON.parse(data);
        }
      }
      
      if (this.crdtState) {
        this.onStateChange(this.crdtState);
      }
    } catch (err) {
      console.warn(`[OfflineQueue ${this.roomId}] Failed to load CRDT state:`, err);
      this.crdtState = null;
    }
  }

  /**
   * Save CRDT state to storage
   */
  async saveCrdtState(state) {
    this.crdtState = state;
    
    try {
      if (this.useTauri) {
        const { writeTextFile, BaseDirectory, mkdir } = window.__TAURI__.fs;
        try {
          await mkdir(this.storageDir, { dir: BaseDirectory.AppData, recursive: true });
        } catch (e) {}
        
        await writeTextFile(
          this._getStatePath(),
          JSON.stringify(state, null, 2),
          { dir: BaseDirectory.AppData }
        );
      } else {
        localStorage.setItem(`${STATE_KEY}_${this.roomId}`, JSON.stringify(state));
      }
    } catch (err) {
      console.error(`[OfflineQueue ${this.roomId}] Failed to save CRDT state:`, err);
    }
  }

  /**
   * Add operation to queue
   */
  async enqueue(type, data) {
    // Check for duplicates (same content within 5 seconds)
    const recentDuplicate = this.queue.find(op => 
      op.type === type && 
      op.status === 'pending' &&
      Date.now() - op.timestamp < 5000 &&
      JSON.stringify(op.data) === JSON.stringify(data)
    );
    
    if (recentDuplicate) {
      console.log(`[OfflineQueue ${this.roomId}] Duplicate operation ignored`);
      return recentDuplicate.id;
    }

    const op = new PendingOperation(type, data);
    this.queue.push(op);
    
    // Trim queue if too large (remove oldest acked/failed)
    if (this.queue.length > this.maxQueueSize) {
      const trimmable = this.queue.filter(op => 
        op.status === 'acked' || op.status === 'failed'
      );
      if (trimmable.length > 0) {
        trimmable.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = trimmable.slice(0, this.queue.length - this.maxQueueSize);
        this.queue = this.queue.filter(op => !toRemove.includes(op));
      }
    }
    
    await this.saveQueue();
    return op.id;
  }

  /**
   * Mark operation as acknowledged by server
   */
  async ack(operationId, serverVersion) {
    const op = this.queue.find(o => o.id === operationId);
    if (op) {
      op.status = 'acked';
      op.serverVersion = serverVersion;
      op.ackedAt = Date.now();
      await this.saveQueue();
      
      // Track for deduplication
      if (op.type === 'send' && op.data.id) {
        this.sentMessages.add(op.data.id);
      }
    }
  }

  /**
   * Mark operation as failed
   */
  async fail(operationId, error) {
    const op = this.queue.find(o => o.id === operationId);
    if (op) {
      op.status = 'failed';
      op.error = error;
      op.retries++;
      await this.saveQueue();
    }
  }

  /**
   * Mark operation as syncing
   */
  async markSyncing(operationId) {
    const op = this.queue.find(o => o.id === operationId);
    if (op) {
      op.status = 'syncing';
      await this.saveQueue();
    }
  }

  /**
   * Get pending operations (not acked)
   */
  getPending() {
    return this.queue.filter(op => op.status !== 'acked');
  }

  /**
   * Get operations ready to retry (failed but under maxRetries)
   */
  getRetryable() {
    return this.queue.filter(op => 
      op.status === 'failed' && 
      op.retries < op.maxRetries
    );
  }

  /**
   * Get queue stats
   */
  getStats() {
    const pending = this.getPending();
    return {
      total: this.queue.length,
      pending: pending.length,
      syncing: this.queue.filter(o => o.status === 'syncing').length,
      failed: this.queue.filter(o => o.status === 'failed').length,
      acked: this.queue.filter(o => o.status === 'acked').length,
      syncStatus: this.syncStatus,
      lastSyncTime: this.lastSyncTime
    };
  }

  /**
   * Clear all operations (use with caution!)
   */
  async clear() {
    this.queue = [];
    await this.saveQueue();
  }

  /**
   * Clear only acked operations
   */
  async clearAcked() {
    this.queue = this.queue.filter(op => op.status !== 'acked');
    await this.saveQueue();
  }

  /**
   * Update sync status
   */
  setSyncStatus(status) {
    this.syncStatus = status;
    if (status === 'connected') {
      this.lastSyncTime = Date.now();
    }
  }

  /**
   * Check if message was already sent (deduplication)
   */
  isDuplicate(msgId) {
    return this.sentMessages.has(msgId);
  }

  /**
   * Export queue for debugging
   */
  export() {
    return {
      roomId: this.roomId,
      stats: this.getStats(),
      queue: this.queue,
      crdtState: this.crdtState
    };
  }
}

/**
 * SyncManager handles the sync loop
 */
export class SyncManager {
  constructor(queue, client, options = {}) {
    this.queue = queue;
    this.client = client;
    this.interval = options.interval || 5000; // 5 seconds
    this.retryDelay = options.retryDelay || 1000; // 1 second
    this.maxConcurrent = options.maxConcurrent || 3;
    
    this.isRunning = false;
    this.timer = null;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * Start sync loop
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[SyncManager] Started');
    this._syncLoop();
  }

  /**
   * Stop sync loop
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[SyncManager] Stopped');
  }

  /**
   * Force immediate sync
   */
  async syncNow() {
    return this._processQueue();
  }

  /**
   * Main sync loop
   */
  async _syncLoop() {
    while (this.isRunning) {
      try {
        await this._processQueue();
      } catch (err) {
        console.error('[SyncManager] Sync error:', err);
        this.onError(err);
      }
      
      // Wait before next sync
      await this._sleep(this.interval);
    }
  }

  /**
   * Process pending operations
   */
  async _processQueue() {
    const pending = this.queue.getPending()
      .filter(op => op.status !== 'syncing')
      .slice(0, this.maxConcurrent);

    if (pending.length === 0) {
      this.queue.setSyncStatus('connected');
      return;
    }

    this.queue.setSyncStatus('syncing');
    this.onProgress({ total: pending.length, processed: 0 });

    let processed = 0;
    
    for (const op of pending) {
      if (!this.isRunning) break;
      
      await this.queue.markSyncing(op.id);
      
      try {
        await this._executeOperation(op);
        processed++;
        this.onProgress({ total: pending.length, processed });
      } catch (err) {
        console.error(`[SyncManager] Operation ${op.id} failed:`, err);
        await this.queue.fail(op.id, err.message);
        
        // Wait before retrying
        await this._sleep(this.retryDelay * (op.retries + 1));
      }
    }

    if (processed === pending.length) {
      this.onComplete({ processed });
    }
  }

  /**
   * Execute a single operation
   */
  async _executeOperation(op) {
    switch (op.type) {
      case 'send':
        const msg = await this.client.sendMessage(op.data.content, {
          replyTo: op.data.replyTo,
          attachments: op.data.attachments
        });
        await this.queue.ack(op.id, msg.version);
        break;
        
      case 'edit':
        await this.client.editMessage(op.data.msgId, op.data.newContent);
        await this.queue.ack(op.id);
        break;
        
      case 'delete':
        await this.client.deleteMessage(op.data.msgId);
        await this.queue.ack(op.id);
        break;
        
      case 'reaction':
        await this.client.addReaction(op.data.msgId, op.data.emoji);
        await this.queue.ack(op.id);
        break;
        
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}

// Export factory function
export function createOfflineQueue(roomId, options) {
  return new OfflineQueue(roomId, options);
}
