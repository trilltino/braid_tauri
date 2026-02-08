# Unified Pages Editor Architecture

## Overview
A single editor codebase that works in both **Web** and **Tauri** environments.

## Directory Structure

```
pages_editor/
├── core/                       # Platform-agnostic core logic
│   ├── WikiEditor.jsx         # Main editor component (React)
│   ├── Explorer.jsx           # File explorer with search
│   ├── useBraidSync.js        # Braid sync hook
│   └── WikiEditor.css         # Editor styles
│
├── shared/                     # Shared utilities (vanilla JS compatible)
│   ├── QuillEditor.jsx        # Quill wrapper component
│   ├── simpleton-client.js    # Braid protocol client
│   ├── braid-http-client.js   # HTTP client
│   ├── markdown-utils.js      # MD <-> HTML conversion
│   └── index.js               # Shared exports
│
├── web/                        # Web-specific entry
│   └── index.jsx              # Web app entry point
│
├── tauri/                      # Tauri-specific bridge
│   └── bridge.js              # Vanilla JS bridge for Tauri
│
└── index.js                    # Main module exports
```

## Usage

### Web (local_link_docs)
```javascript
import { WikiEditor } from './pages_editor';

function App() {
  return <WikiEditor platform="web" />;
}
```

### Tauri (local_link)
```javascript
import { initUnifiedPages } from './apps/pages/unified-bridge.js';

// Initialize when pages view is shown
initUnifiedPages();
```

## Key Features

### 1. Platform Detection
```javascript
const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI__;
```

### 2. Platform-Aware API Calls
```javascript
if (platform === 'tauri' && window.__TAURI__) {
  // Use Tauri commands
  data = await window.__TAURI__.core.invoke('list_local_pages');
} else {
  // Use HTTP API
  data = await fetch(`${apiBaseUrl}/local.org/`).then(r => r.json());
}
```

### 3. Editor Abstraction
- **Web**: Full React component with Quill
- **Tauri**: Bridge that initializes Quill in vanilla JS environment

### 4. Explorer Features
- Search/filter pages
- Create new pages
- Delete pages
- Platform-aware data fetching

## Braid Integration

Both platforms use the same `simpleton-client.js` for:
- Real-time sync via HTTP 209 subscriptions
- Patches-based updates
- Version tracking

## Data Flow

```
User Edit → simpleton_client → PUT /local.org/page.md
                              ↓
Server Broadcast → HTTP 209 Stream
                              ↓
All Connected Clients Receive Patches
```
