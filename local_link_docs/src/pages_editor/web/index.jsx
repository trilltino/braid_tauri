// Web entry point for Pages Editor
// Used when running in browser (local_link_docs)

import WikiEditor from '../core/WikiEditor.jsx';

// Default export for web usage
export default function WebEditor() {
  return (
    <WikiEditor 
      platform="web"
      apiBaseUrl={import.meta.env.VITE_API_URL || 'http://localhost:3001'}
    />
  );
}

export { WikiEditor };
