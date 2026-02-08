// Unified Pages Editor Bridge for Tauri UI
// This bridges the React-based editor into the vanilla JS Tauri UI

// Import the simpleton client directly (works in vanilla JS)
import { simpleton_client } from '../../../local_link_docs/src/pages_editor/shared/simpleton-client.js';
import { mdToHtml } from '../../../local_link_docs/src/pages_editor/shared/markdown-utils.js';

let currentClient = null;
let currentEditor = null;

/**
 * Initialize the unified editor in Tauri's pages view
 */
export function initUnifiedPages() {
    console.log("[UnifiedPages] Initializing...");
    
    const container = document.getElementById('pages-view');
    if (!container) {
        console.error("[UnifiedPages] Pages view container not found");
        return;
    }
    
    // Check if already initialized
    if (container.dataset.initialized === 'true') {
        console.log("[UnifiedPages] Already initialized");
        return;
    }
    container.dataset.initialized = 'true';
    
    // Get UI elements
    const urlInput = document.getElementById('pages-url-input');
    const connectBtn = document.getElementById('pages-connect-btn');
    const textarea = document.getElementById('pages-textarea');
    const preview = document.getElementById('pages-preview');
    const status = document.getElementById('pages-status');
    
    if (!textarea) {
        console.error("[UnifiedPages] Textarea not found");
        return;
    }
    
    // State
    let currentUrl = '';
    let isConnected = false;
    
    // Try to initialize Quill if available
    function initEditor() {
        if (window.Quill) {
            // Wrap textarea in a div for Quill
            const wrapper = document.createElement('div');
            wrapper.id = 'unified-quill-container';
            wrapper.style.cssText = 'height: 100%;';
            
            const parent = textarea.parentNode;
            parent.insertBefore(wrapper, textarea);
            textarea.style.display = 'none';
            
            const quill = new window.Quill('#unified-quill-container', {
                theme: 'snow',
                placeholder: 'Connect to a Braid URL to start editing...',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                        ['link', 'image', 'code-block'],
                        ['clean']
                    ]
                }
            });
            
            quill.enable(false);
            
            return {
                type: 'quill',
                instance: quill,
                setContent: (text) => {
                    const html = mdToHtml(text, currentUrl);
                    quill.root.innerHTML = html;
                },
                getContent: () => {
                    // Convert HTML back to markdown (simplified)
                    return quill.getText();
                },
                enable: (enabled) => quill.enable(enabled)
            };
        }
        
        // Fallback to textarea
        return {
            type: 'textarea',
            instance: textarea,
            setContent: (text) => textarea.value = text,
            getContent: () => textarea.value,
            enable: (enabled) => textarea.disabled = !enabled
        };
    }
    
    currentEditor = initEditor();
    
    // Connect to Braid URL
    async function connect(url) {
        if (currentClient) {
            await currentClient.stop();
        }
        
        currentUrl = url;
        
        if (status) {
            status.textContent = "Connecting...";
            status.className = "status-text";
        }
        
        currentClient = simpleton_client(url, {
            on_state: (state) => {
                isConnected = true;
                currentEditor.setContent(state);
                currentEditor.enable(true);
                
                if (status) {
                    status.textContent = "Connected";
                    status.className = "status-text connected";
                }
                
                // Update preview
                if (preview) {
                    preview.innerHTML = mdToHtml(state, url);
                }
            },
            get_state: () => currentEditor.getContent(),
            on_patches: (patches) => {
                console.log("[UnifiedPages] Received patches:", patches);
                // Apply patches if needed
            },
            on_error: (err) => {
                console.error("[UnifiedPages] Braid error:", err);
                if (status) {
                    status.textContent = "Error: " + (err.message || 'Unknown');
                    status.className = "status-text error";
                }
            }
        });
    }
    
    // Event handlers
    if (connectBtn && urlInput) {
        connectBtn.addEventListener('click', () => {
            const url = urlInput.value.trim();
            if (url) connect(url);
        });
        
        // Enter key on input
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = urlInput.value.trim();
                if (url) connect(url);
            }
        });
    }
    
    // Editor change handling
    if (currentEditor.type === 'textarea') {
        textarea.addEventListener('input', () => {
            if (currentClient && isConnected) {
                currentClient.changed();
                if (preview) {
                    preview.innerHTML = mdToHtml(textarea.value, currentUrl);
                }
            }
        });
    } else if (currentEditor.type === 'quill') {
        currentEditor.instance.on('text-change', () => {
            if (currentClient && isConnected) {
                currentClient.changed();
                if (preview) {
                    preview.innerHTML = mdToHtml(currentEditor.getContent(), currentUrl);
                }
            }
        });
    }
    
    // Auto-connect if URL present
    if (urlInput && urlInput.value) {
        connect(urlInput.value);
    }
    
    console.log("[UnifiedPages] Initialized with", currentEditor.type, "editor");
    
    // Return API for external control
    return {
        connect,
        disconnect: () => currentClient?.stop(),
        getState: () => currentEditor?.getContent(),
        setState: (text) => currentEditor?.setContent(text)
    };
}

// Also re-export for use in other modules
export { simpleton_client };
