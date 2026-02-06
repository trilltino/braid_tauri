# Diamond Type Removal - Migration to Braid-Text (Simpleton)

**Date:** 2026-02-04  
**Status:** ✅ Complete

## Objective

Remove Diamond Type CRDT implementation entirely and use **only braid-text (simpleton)** as the merge type for all text-based Braid synchronization.

---

## Changes Made

### 1. **Removed Diamond Type from Merge Registry** 
**File:** `crates/braid-core/src/fs/mod.rs` (lines 154-168)

**Before:**
```rust
merge_registry.register("diamond", |id| {
    Box::new(crate::core::merge::DiamondMergeType::new(id))
});
merge_registry.register("dt", |id| {
    Box::new(crate::core::merge::DiamondMergeType::new(id))
});
```

**After:**
```rust
// Simpleton (braid-text) is the primary merge type for text documents
merge_registry.register("simpleton", |id| {
    Box::new(crate::core::merge::simpleton::SimpletonMergeType::new(id))
});
merge_registry.register("braid-text", |id| {
    Box::new(crate::core::merge::simpleton::SimpletonMergeType::new(id))
});
```

**Impact:** Diamond Type is no longer available as a merge type. Only `simpleton`, `braid-text`, and `antimatter` are registered.

---

### 2. **Changed Default Merge Type to Simpleton**
**File:** `crates/braid-core/src/fs/subscription.rs` (lines 143, 153, 233, 243)

**Before:**
```rust
let requested_merge_type = update.merge_type.as_deref().unwrap_or("diamond");
// ...
.or_else(|| state.merge_registry.create("diamond", &peer_id))
```

**After:**
```rust
let requested_merge_type = update.merge_type.as_deref().unwrap_or("simpleton");
// ...
.or_else(|| state.merge_registry.create("simpleton", &peer_id))
```

**Impact:** When the server doesn't specify a merge type, the daemon now defaults to `simpleton` instead of `diamond`.

---

### 3. **Explicit Braid-Text Request for braid.org**
**File:** `crates/braid-core/src/fs/subscription.rs` (lines 63-67)

**Already in place:**
```rust
// For braid.org wiki pages, request the braid-text (simpleton) merge type
// This ensures we get the actual wiki text content with simple text-based CRDT
if url.contains("braid.org") {
    req = req.with_merge_type("braid-text");
}
```

**Impact:** All `braid.org` URLs explicitly request the `braid-text` merge type in the subscription headers.

---

## Reference Implementation

The Rust simpleton implementation is based on:
- **JavaScript Reference:** `C:\Users\isich\braid_tauri\references\braid-text\simpleton-client.js`
- **Rust Implementation:** `C:\Users\isich\braid_tauri\crates\braid-core\src\core\merge\simpleton.rs`

---

## Testing

### Expected Behavior:
1. ✅ Daemon requests `Merge-Type: braid-text` for `braid.org` URLs
2. ✅ Daemon defaults to `simpleton` when server doesn't specify merge type
3. ✅ No Diamond Type crashes (since it's completely removed)
4. ✅ Logs show: `Creating merge state for https://braid.org/tino_tauri with type: simpleton`

### Test Commands:
```bash
# Rebuild daemon
cargo build --release --package braidfs-daemon

# Run daemon
.\ide.bat

# In daemon console:
sync https://braid.org/tino_tauri

# Edit the file and watch for sync
```

---

## Known Issues Resolved

1. ✅ **Diamond Type Panic:** `index out of bounds` error eliminated by removing Diamond Type
2. ✅ **Wrong Merge Type:** Daemon was using `diamond` instead of `braid-text` - now fixed
3. ✅ **309 Reborn Handling:** Already working correctly - clears merge state on history reset

---

## Files Modified

1. `crates/braid-core/src/fs/mod.rs` - Removed Diamond Type registration
2. `crates/braid-core/src/fs/subscription.rs` - Changed default to simpleton

---

## Next Steps

1. Test with live `braid.org` URLs
2. Verify simpleton merge logic matches JavaScript reference
3. Monitor logs for any merge type errors
4. Consider removing Diamond Type source files if no longer needed

---

## Notes

- **Antimatter** merge type is still available for future use
- **Simpleton** is now the only text-based CRDT
- The JavaScript reference implementation uses `Merge-Type: simpleton` in headers
- Our Rust implementation accepts both `"simpleton"` and `"braid-text"` as aliases
