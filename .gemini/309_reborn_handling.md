# 309 Reborn Error Handling Implementation

**Date:** 2026-02-04  
**Status:** ✅ Complete

## What is 309 Reborn?

The **309 Reborn** status code is a Braid protocol extension that indicates:
> "The server has reset its document history. Your parent version no longer exists in my timeline."

This happens when:
- Server restarts and loses history
- Server prunes old versions
- Server switches to a new timeline

---

## Implementation

### 1. **Subscription Handler** 
**File:** `crates/braid-core/src/fs/subscription.rs` (lines 91-100)

```rust
// Handle 309 Reborn during subscription
if update.status == 309 {
    tracing::warn!(
        "[BraidFS] Reborn (309) detected during subscription for {}. History reset.",
        url
    );
    // Clear the old merge state since the server's history was reset
    state.active_merges.write().await.remove(&url);
    is_first = true;
}
```

**What it does:**
1. Detects 309 status in subscription stream
2. Clears the CRDT merge state for that URL
3. Sets `is_first = true` to treat next update as a fresh snapshot
4. Logs a warning for debugging

---

### 2. **Sync Handler (PUT Requests)**
**File:** `crates/braid-core/src/fs/sync.rs` (lines 101-106)

```rust
let status_code = if status_line.contains("309") {
    // Clear merge state on 309 Reborn - the server's history was reset
    state.active_merges.write().await.remove(&url_str);
    info!("[BraidFS] Cleared merge state for {} due to 309 Reborn", url_str);
    309
} else {
    500
};
```

**What it does:**
1. Detects 309 in curl output during PUT/sync
2. Clears the merge state
3. Logs the action
4. Returns 309 error code (triggers retry with fresh state)

---

## How It Works Together

### Normal Flow:
```
1. Client has parent version: "abc-123"
2. Client makes edit → sends PUT with Parents: ["abc-123"]
3. Server accepts → returns 200 OK
4. Client continues with new version
```

### 309 Reborn Flow:
```
1. Client has parent version: "abc-123"
2. Server restarts/resets → history is now empty
3. Client sends PUT with Parents: ["abc-123"]
4. Server responds: 309 Reborn (parent doesn't exist)
5. Client clears merge state (forgets "abc-123")
6. Client re-subscribes → gets fresh snapshot
7. Client retries PUT with new parent
8. Server accepts → sync continues
```

---

## Key Insight

The **merge state** (`state.active_merges`) stores:
- Current version ID
- Parent version IDs
- CRDT internal state

When we get a 309, we **must clear this state** because:
- The parent versions are now invalid
- The CRDT state is based on a timeline that no longer exists
- We need to start fresh with the server's new timeline

---

## Testing

### Simulate 309 Error:
1. Start daemon and sync a file
2. Server admin resets the document
3. Edit the file locally
4. Watch logs for:
   ```
   [BraidFS] Cleared merge state for https://braid.org/tino_tauri due to 309 Reborn
   ```
5. Verify sync continues after clearing state

---

## Logs to Watch For

### ✅ Success:
```
2026-02-04T21:31:57.051676Z  INFO braid_core::fs::sync: 
  [BraidFS] Cleared merge state for https://braid.org/tino_tauri due to 309 Reborn
```

### ❌ Before Fix (Loop):
```
ERROR: Sync failed (curl). Status: HTTP/1.1 309 unknown
ERROR: Sync failed (curl). Status: HTTP/1.1 309 unknown
ERROR: Sync failed (curl). Status: HTTP/1.1 309 unknown
(infinite loop because state wasn't cleared)
```

---

## Related Code

### Merge State Structure:
```rust
// In state.rs
pub active_merges: Arc<RwLock<HashMap<String, Box<dyn MergeType>>>>,
```

### Clear Operation:
```rust
state.active_merges.write().await.remove(&url);
```

This removes the entire CRDT state for that URL, forcing a fresh initialization on the next update.

---

## Files Modified

1. `crates/braid-core/src/fs/subscription.rs` - Subscription 309 handling
2. `crates/braid-core/src/fs/sync.rs` - Sync PUT 309 handling

---

## References

- **Braid Protocol Spec:** https://braid.org/
- **309 Status Code:** Custom extension for history reset
- **Similar to HTTP 410 Gone:** But specifically for version history

---

## Future Improvements

1. **Exponential Backoff:** Add delay before retrying after 309
2. **User Notification:** Alert user when server history resets
3. **Conflict Resolution:** Offer to save local changes before clearing state
4. **Metrics:** Track 309 frequency to detect server instability
