# Diamond Types CRDT Implementation Summary

## Overview

This implementation adds **Diamond Types (DT) CRDT** support for local-first chat with:
- Full version graph tracking (version → parents)
- Parent validation (409 Conflict for unknown parents)
- Message editing with full history
- File attachments via BraidBlob
- Right-click context menus for edit/delete

---

## Phase 0: Server Foundation ✅

### 0.1 DiamondMergeType Adapter
**File:** `crates/braid-core/src/core/merge/diamond.rs`

Already existed - provides `MergeType` trait implementation for Diamond Types CRDT.

### 0.2 Registered in MergeTypeRegistry
**File:** `crates/braid-core/src/core/merge/merge_type.rs`

```rust
registry.register("diamond", |peer_id| {
    Box::new(super::diamond::DiamondMergeType::new(peer_id))
});
```

### 0.3 Version Graph Storage
**File:** `crates/server/src/core/pages/versioned_storage.rs` (NEW)

JSON-based storage format:
```json
{
  "content": "hello world",
  "heads": ["alice-42"],
  "version_graph": {
    "alice-41": [],
    "alice-42": ["alice-41"],
    "bob-7": ["alice-41"],
    "alice-43": ["alice-42", "bob-7"]
  },
  "merge_type": "diamond",
  "created_at": 1234567890,
  "modified_at": 1234567999
}
```

### 0.4 Parent Validation
**File:** `crates/server/src/core/pages/handlers_v2.rs` (NEW)

```rust
// Returns 409 Conflict if parents unknown
if let Err(e) = VersionedStorage::validate_parents(&page, &parents) {
    return (StatusCode::CONFLICT, format!("409 Conflict: {}", e)).into_response();
}
```

**New API Endpoints:**
- `GET /v2/pages` - List all pages with metadata
- `GET /v2/pages/{path}` - Get page (with subscription support)
- `PUT /v2/pages/{path}` - Update page (with parent validation)
- `GET /v2/pages/{path}/versions` - Get version graph

---

## Phase 1: Chat with Message Editing ✅

### 1.1 Message Schema with Edit History
**File:** `crates/server/src/core/models/mod.rs`

```rust
pub struct EditRecord {
    pub version: String,
    pub timestamp: DateTime<Utc>,
    pub content: String,
    pub parents: Vec<Version>,
}

pub struct Message {
    pub id: String,
    pub sender: String,
    pub content: String,
    pub edit_history: Vec<EditRecord>,  // <-- NEW
    // ... other fields
}
```

### 1.2 Chat CRDT with Edit Support
**File:** `crates/server/src/chat/crdt.rs`

```rust
impl ChatCrdt {
    pub fn edit_message(&mut self, msg_id: &str, new_content: &str, editor: &str) 
        -> Result<(String, Message)> {
        // Validates: message exists, editor is sender, not deleted
        // Creates EditRecord, updates version graph
    }
    
    pub fn delete_message(&mut self, msg_id: &str, deleter: &str) 
        -> Result<(String, Message)> {
        // Soft delete with tombstone
    }
    
    pub fn add_reaction(&mut self, msg_id: &str, emoji: &str, user: &str) 
        -> Result<()>;
}
```

### 1.3 Chat Client (JavaScript)
**File:** `local_link_docs/src/pages_editor/chat/chat-client.js` (NEW)

```javascript
const client = createChatClient('general', {
  onMessages: (msgs) => setMessages(msgs),
  onError: (err) => console.error(err)
});

await client.sendMessage('Hello!', { replyTo: null });
await client.editMessage(msgId, 'Hello world!');
await client.deleteMessage(msgId);
await client.addReaction(msgId, '👍');
```

### 1.4 Chat UI with Context Menu
**Files:** 
- `local_link_docs/src/pages_editor/chat/ChatBubble.jsx` (NEW)
- `local_link_docs/src/pages_editor/chat/ChatBubble.css` (NEW)
- `local_link_docs/src/pages_editor/chat/Chat.jsx` (NEW)
- `local_link_docs/src/pages_editor/chat/Chat.css` (NEW)

**Features:**
- Right-click context menu on messages
  - "Edit Message" (own messages only)
  - "View Edit History"
  - "Reply"
  - "Delete Message" (own messages only)
- Edit history modal showing all versions
- Inline editing with textarea
- File attachment previews
- Reaction display

---

## Phase 2: File Attachments ✅

### 2.1 BraidBlob Integration
Already exists in `crates/braid-blob/src/store.rs`

```rust
pub struct BlobMetadata {
    pub key: String,              // SHA256 hash
    pub content_type: Option<String>,
    pub content_hash: Option<String>,
    pub size: Option<u64>,
    pub version: Vec<Version>,
    pub parents: Vec<Version>,
}
```

### 2.2 File Upload in Chat
**File:** `local_link_docs/src/pages_editor/chat/Chat.jsx`

```javascript
const handleFileSelect = async (e) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`/blob/${file.name}`, {
    method: 'PUT',
    body: formData
  });
  
  const result = await response.json();
  // result.hash = SHA256 of content (content-addressed)
};
```

### 2.3 Attachment Types Supported
- **Images**: Preview thumbnail, click to expand
- **Videos**: Thumbnail with play button
- **Files**: Generic file card with icon, filename, size

---

## Architecture Deep Dive

### Version Graph

```
ROOT
  ├── alice-1: "Hello"
  │     └── alice-2: "Hello world" (edit)
  │           └── alice-3: "Hello world!" (edit)
  │
  └── bob-1: "Hi there"
        └── alice-4: "Hello world! / Hi there" (merge)
```

Each edit creates a new version with the old version as parent.

### Storage Layout

```
braid_data/
├── peers/
│   └── {peer_id}/
│       └── folders/           # BraidFS synced folders
├── chat/
│   └── {room_id}.json        # Chat CRDT state (NEW)
├── pages/
│   └── {path}.json           # Page version graphs (NEW)
└── blobs/
    └── {hash}                # Content-addressed files
```

### Braid Protocol Flow

1. **Client sends PUT**:
   ```
   PUT /chat/general
   Version: "alice-5"
   Parents: "alice-4"
   Content-Type: application/json
   
   {"action":"edit","message":{...}}
   ```

2. **Server validates parents**: Returns 409 if unknown

3. **Server applies to CRDT**: Merges into version graph

4. **Server broadcasts**: Via 209 Subscription to all clients

5. **Clients receive update**: Apply patch to local state

---

## Usage Example

### Start Chat (React)

```jsx
import { Chat } from './chat';

function App() {
  return <Chat roomId="general" daemonPort={45678} />;
}
```

### API Usage (curl)

```bash
# Get page with subscription
curl -N "http://localhost:45678/v2/pages/chat/general" \
  -H "Subscribe: true"

# Update page
curl -X PUT "http://localhost:45678/v2/pages/chat/general" \
  -H "Version: alice-5" \
  -H "Parents: alice-4" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello world"}'
```

---

## Files Created/Modified

### Rust (Server)
| File | Lines | Description |
|------|-------|-------------|
| `braid-core/src/core/merge/merge_type.rs` | +5 | Register diamond merge type |
| `server/src/core/pages/versioned_storage.rs` | +350 | Version graph storage |
| `server/src/core/pages/handlers_v2.rs` | +350 | V2 API with validation |
| `server/src/core/pages/mod.rs` | +4 | Add new modules |
| `server/src/core/models/mod.rs` | +25 | EditRecord, edit_history |
| `server/src/chat/crdt.rs` | +150 | Edit/delete/reactions |
| `server/src/core/store/json_store.rs` | +8 | Fix edit call |

### JavaScript (Client)
| File | Lines | Description |
|------|-------|-------------|
| `chat/chat-client.js` | +220 | Braid chat client |
| `chat/ChatBubble.jsx` | +280 | Message component |
| `chat/ChatBubble.css` | +350 | Message styles |
| `chat/Chat.jsx` | +180 | Main chat component |
| `chat/Chat.css` | +220 | Chat layout styles |
| `chat/index.js` | +6 | Module exports |

---

## Testing

```bash
# Build server
cd crates/server && cargo build

# Run tests
cargo test --package braid-core -- merge
cargo test --package local_link_server -- chat

# Manual test
curl http://localhost:45678/v2/pages
```

---

## Next Steps (Future)

1. **Offline Queue**: Persist pending messages to disk
2. **E2E Encryption**: Encrypt message content
3. **Reactions UI**: Click to add emoji reactions
4. **Typing Indicators**: Real-time "X is typing..."
5. **Threading**: Reply threads as nested conversations
6. **Search**: Full-text search across messages
7. **BraidFS Mount**: Auto-mount synced folders as network drive

---

## Key Design Decisions

1. **JSON over SQLite**: Human-readable, easier to debug
2. **Soft Deletes**: Messages marked deleted but kept in history
3. **Only Sender Edits**: Prevents unauthorized modifications
4. **Content-Addressed Blobs**: SHA256 = key, automatic deduplication
5. **409 for Unknown Parents**: Forces clients to sync before editing
6. **Optimistic UI**: Updates shown immediately, rolled back on error
