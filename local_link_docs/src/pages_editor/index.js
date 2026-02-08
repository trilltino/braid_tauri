// Unified Pages Editor - Works in both Web and Tauri
export { default as WikiEditor } from './core/WikiEditor.jsx';
export { default as QuillEditor } from './shared/QuillEditor.jsx';
export { useBraidSync } from './core/useBraidSync.js';
export { simpleton_client } from './shared/simpleton-client.js';
export { mdToHtml, htmlToMd } from './shared/markdown-utils.js';
export * from './shared/braid-http-client.js';

// Platform detection
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI__;

// Platform-aware API caller
export async function apiCall(endpoint, options = {}, platform = 'web') {
  if (platform === 'tauri' && isTauri()) {
    // Use Tauri commands
    const cmd = endpoint.replace(/^\//, '').replace(/\//g, '_');
    return window.__TAURI__.core.invoke(cmd, options.body);
  }
  // Use regular fetch
  const res = await fetch(endpoint, options);
  return res.json();
}
