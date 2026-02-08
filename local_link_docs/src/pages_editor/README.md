# Unified Pages Editor

A modular Braid-synced wiki editor that works in both **Tauri** and **Web** environments.

## Usage

### Web (local_link_docs)
```javascript
import { WikiEditor } from './pages_editor';

function App() {
  return <WikiEditor />;
}
```

### Tauri (local_link)
```javascript
import { initUnifiedEditor } from './pages_editor/tauri-bridge';

initUnifiedEditor({
  container: '#editor-container',
  explorer: '#explorer-sidebar'
});
```

## Features

- **Quill-based rich text editing**
- **Braid protocol sync** (real-time collaborative)
- **Markdown preview**
- **Explorer sidebar** with search
- **Works in both Tauri and Web**

## Architecture

```
pages_editor/
├── core/                    # Platform-agnostic core
│   ├── Editor.jsx           # Main editor component
│   ├── Explorer.jsx         # File explorer
│   ├── useBraidSync.js      # Braid sync hook
│   └── simpleton-client.js  # Braid protocol
├── web/                     # Web-specific
│   └── index.jsx            # Web entry point
├── tauri/                   # Tauri-specific
│   └── bridge.js            # Tauri bridge
└── shared/                  # Shared components
    ├── QuillEditor.jsx
    └── markdown-utils.js
```
