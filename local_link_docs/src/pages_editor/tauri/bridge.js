// Tauri Bridge for Unified Pages Editor
// This bridges the React-based editor into Tauri's vanilla JS UI

import { simpleton_client } from '../shared/simpleton-client.js';
import { mdToHtml } from '../shared/markdown-utils.js';

/**
 * Initialize the unified editor in a Tauri environment
 * @param {Object} options
 * @param {string} options.editorContainer - Selector for editor container
 * @param {string} options.sidebarContainer - Selector for sidebar container  
 * @param {string} options.toolbarContainer - Selector for toolbar container
 * @param {string} options.apiBaseUrl - Base URL for API calls
 */
export function initUnifiedEditor(options = {}) {
  const {
    editorContainer = '#pages-textarea',
    sidebarContainer = '#pages-sidebar',
    toolbarContainer = '#pages-toolbar',
    apiBaseUrl = 'http://localhost:3001'
  } = options;

  const editorEl = document.querySelector(editorContainer);
  const sidebarEl = document.querySelector(sidebarContainer);
  const toolbarEl = document.querySelector(toolbarContainer);
  
  if (!editorEl) {
    console.error('[UnifiedEditor] Editor container not found:', editorContainer);
    return;
  }

  // State
  let currentClient = null;
  let currentUrl = '';
  let isConnected = false;

  // Initialize Quill if available, otherwise use textarea
  function initEditor() {
    if (window.Quill && typeof window.Quill === 'function') {
      return initQuillEditor();
    }
    return initTextareaEditor();
  }

  function initQuillEditor() {
    // Clear existing
    editorEl.innerHTML = '';
    
    // Create Quill container
    const quillContainer = document.createElement('div');
    quillContainer.id = 'unified-quill-editor';
    editorEl.appendChild(quillContainer);
    
    const quill = new window.Quill('#unified-quill-editor', {
      theme: 'snow',
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
    
    quill.on('text-change', () => {
      if (currentClient && isConnected) {
        const md = htmlToMarkdown(quill.root.innerHTML);
        // Update client state
      }
    });
    
    return { type: 'quill', instance: quill };
  }

  function initTextareaEditor() {
    // Use existing textarea
    return { 
      type: 'textarea', 
      instance: editorEl,
      setContent: (text) => editorEl.value = text,
      getContent: () => editorEl.value
    };
  }

  const editor = initEditor();

  // Connect to Braid URL
  async function connect(url) {
    if (currentClient) {
      await currentClient.stop();
    }
    
    currentUrl = url;
    
    currentClient = simpleton_client(url, {
      on_state: (state) => {
        isConnected = true;
        if (editor.type === 'quill') {
          const html = mdToHtml(state, url);
          editor.instance.root.innerHTML = html;
        } else {
          editor.instance.value = state;
        }
        updateStatus('connected');
      },
      get_state: () => {
        if (editor.type === 'quill') {
          return htmlToMarkdown(editor.instance.root.innerHTML);
        }
        return editor.instance.value;
      },
      on_error: (err) => {
        console.error('[UnifiedEditor] Braid error:', err);
        updateStatus('error', err.message);
      }
    });
  }

  function updateStatus(status, message = '') {
    const statusEl = document.querySelector('#pages-status');
    if (statusEl) {
      statusEl.textContent = status === 'connected' ? 'Connected' : 
                              status === 'error' ? `Error: ${message}` : 'Disconnected';
      statusEl.className = `status-text ${status}`;
    }
  }

  // Load local pages for sidebar
  async function loadLocalPages() {
    if (!sidebarEl) return;
    
    try {
      // Use Tauri invoke if available
      let pages = [];
      if (window.__TAURI__?.core?.invoke) {
        pages = await window.__TAURI__.core.invoke('list_local_pages');
      } else {
        const res = await fetch(`${apiBaseUrl}/local.org/`);
        pages = await res.json();
      }
      
      renderSidebar(pages);
    } catch (e) {
      console.error('[UnifiedEditor] Failed to load pages:', e);
    }
  }

  function renderSidebar(pages) {
    if (!sidebarEl) return;
    
    sidebarEl.innerHTML = `
      <h3>Local Pages</h3>
      <div class="local-pages-list">
        ${pages.map(page => `
          <div class="local-page-item" data-path="${page.path}">
            ${page.title}
          </div>
        `).join('')}
      </div>
    `;
    
    // Bind click events
    sidebarEl.querySelectorAll('.local-page-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = item.dataset.path;
        const url = `${apiBaseUrl}/local.org/${path}`;
        connect(url);
      });
    });
  }

  // Initialize toolbar
  function initToolbar() {
    if (!toolbarEl) return;
    
    const urlInput = toolbarEl.querySelector('.url-input');
    const connectBtn = toolbarEl.querySelector('.connect-btn');
    const newBtn = toolbarEl.querySelector('.new-btn');
    
    if (connectBtn && urlInput) {
      connectBtn.addEventListener('click', () => {
        connect(urlInput.value);
      });
    }
    
    if (newBtn) {
      newBtn.addEventListener('click', async () => {
        const name = prompt('Enter new page name:');
        if (name) {
          const path = name.endsWith('.md') ? name : `${name}.md`;
          if (window.__TAURI__?.core?.invoke) {
            await window.__TAURI__.core.invoke('create_local_page', { path, content: '' });
          }
          await loadLocalPages();
          connect(`${apiBaseUrl}/local.org/${path}`);
        }
      });
    }
  }

  // Initialize
  initToolbar();
  loadLocalPages();
  
  console.log('[UnifiedEditor] Initialized in', editor.type, 'mode');
  
  return {
    connect,
    reloadPages: loadLocalPages,
    getState: () => editor.getContent?.() || editor.instance.value
  };
}

// Helper to convert HTML to Markdown (basic)
function htmlToMarkdown(html) {
  // This is a simplified conversion
  // In production, use a proper library like Turndown
  return html
    .replace(/<h1>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, ''); // Remove remaining tags
}
