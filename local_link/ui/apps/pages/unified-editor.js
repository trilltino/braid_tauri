// Tauri UI integration for Unified Pages Editor
// Imports from local_link_docs pages_editor

import { initUnifiedEditor } from '../../../local_link_docs/src/pages_editor/tauri-bridge.js';

export function initPagesUnified() {
    console.log("[Unified Pages] Initializing...");
    
    const editor = initUnifiedEditor({
        editorContainer: '#pages-textarea',
        sidebarContainer: '#pages-sidebar', 
        toolbarContainer: '#pages-toolbar',
        apiBaseUrl: window.API_BASE_URL || 'http://localhost:3001'
    });
    
    // Store reference for global access
    window.unifiedEditor = editor;
    
    return editor;
}

// Re-export for other modules
export { simpleton_client } from '../../../local_link_docs/src/pages_editor/shared/simpleton-client.js';
