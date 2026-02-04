# Braid Tauri Chat Server v2.0

A refactored chat server using JSON file storage, Antimatter CRDT for conflict resolution, and integrated with BraidFS daemon and AI capabilities.

## Features

- ✅ **JSON File Storage** - No more SQLite, each room is a JSON file
- ✅ **Antimatter CRDT** - Conflict-free distributed synchronization
- ✅ **Blob Storage** - Image/file attachments with deduplication
- ✅ **Daemon Integration** - Automatic sync with braidfs-daemon
- ✅ **AI Chat Support** - Server-side @BraidBot processing
- ✅ **Offline Support** - Drafts and reconnection handling
- ✅ **NFS Mount Ready** - Export chats as filesystem

## Quick Start

```bash
# Run the server
cargo run -p server

# With custom storage directory
BRAID_ROOT=/path/to/sync cargo run -p server

# Disable AI
DISABLE_AI=1 cargo run -p server
```

## API Endpoints

### Core Chat
- `GET/PUT /chat/{room_id}` - Get/put messages (Braid protocol)
- `GET /chat/{room_id}/subscribe` - Braid protocol real-time subscriptions (NO SSE!)

### CRDT Sync (Offline Support)
- `GET /chat/{room_id}/sync` - Get updates since version
- `POST /chat/{room_id}/sync` - Submit local updates

### Blobs
- `POST /blobs` - Upload file/image
- `GET /blobs/{hash}` - Download blob

### Status & Drafts
- `GET /chat/{room_id}/status` - Sync status indicator
- `GET/POST/DELETE /chat/{room_id}/drafts` - Offline drafts

### Extras
- `GET/PUT /chat/{room_id}/presence` - Online status
- `GET/PUT /chat/{room_id}/typing` - Typing indicators

## Architecture

```
┌─────────────────────────────────────────┐
│  HTTP API (axum)                        │
│  - Braid protocol headers               │
│  - Braid protocol subscriptions         │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  Handlers                               │
│  - Chat CRDT operations                 │
│  - Blob upload/download                 │
│  - Sync reconciliation                  │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  JsonChatStore                          │
│  - JSON file persistence                │
│  - CRDT state management                │
│  - Atomic writes                        │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│  Integrations                           │
│  - DaemonIntegration (file sync)        │
│  - AiChatManager (@BraidBot)            │
│  - BlobStore (attachments)              │
└─────────────────────────────────────────┘
```

## File Structure

```
braid_sync/
├── chats/
│   ├── {room_id}.json          # Room with CRDT state
│   └── ...
├── blobs/
│   ├── {hash}.bin              # File attachments
│   └── meta.sqlite             # Blob metadata
├── ai/
│   ├── {room_id}.md            # AI chat history
│   └── ...
└── drafts/
    └── {room_id}.json          # Offline drafts
```

## Chat Room JSON Format

```json
{
  "id": "room-uuid",
  "name": "Room Name",
  "created_at": "2026-01-01T00:00:00Z",
  "created_by": "user@example.com",
  "participants": ["user1", "user2"],
  "crdt_state": {
    "node_id": "server-node-id",
    "next_seq": 42,
    "current_version": {"41@server": true},
    "version_graph": {
      "0@server": {},
      "1@server": {"0@server": true}
    },
    "messages": {
      "1@server": {
        "id": "msg-uuid",
        "sender": "user@example.com",
        "content": "Hello!",
        "version": "1@server",
        "parents": {"0@server": true}
      }
    }
  }
}
```

## Configuration

```rust
ChatServerConfig {
    storage_dir: "braid_sync/chats".into(),
    blob_dir: "braid_sync/blobs".into(),
    drafts_dir: "braid_sync/drafts".into(),
    enable_daemon: true,
    daemon_port: 45678,
    enable_offline: true,
    max_blob_size: 50,      // MB
    inline_threshold: 10240, // bytes
    node_id: "server-xxx".to_string(),
}
```

## Integration with xf_tauri

See [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) for detailed frontend integration instructions.

### Key Changes for Frontend

1. **Remove SQLite dependency** - All data is in JSON files
2. **Add sync status indicators** - Show connected/offline/syncing state
3. **Handle draft messages** - Save while offline, sync on reconnect
4. **Upload files via /blobs** - Then reference in messages

## Development

```bash
# Run tests
cargo test -p braid_tauri_chat_server

# Run with logging
RUST_LOG=debug cargo run -p server

# Build release
cargo build -p braid_tauri_chat_server --release
```

## License

MIT OR Apache-2.0
