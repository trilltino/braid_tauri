import { useState, useEffect, useMemo } from 'react'
import { Menu, X, Plus, Save } from 'lucide-react'
import { useBraidSync } from './useBraidSync'
import QuillEditor from '../shared/QuillEditor'
import Explorer from './Explorer'
import { mdToHtml, htmlToMd } from '../shared/markdown-utils'
import './WikiEditor.css'

function WikiEditor({
  initialUrl = 'http://localhost:3001/local.org/home.md',
  apiBaseUrl = 'http://localhost:3001',
  onNavigate,
  platform = 'web' // 'web' or 'tauri'
}) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [activeUrl, setActiveUrl] = useState(initialUrl);
  const [viewMode, setViewMode] = useState('edit'); // 'edit' or 'preview'
  const [showSidebar, setShowSidebar] = useState(false);

  const { text, setText, connected, error } = useBraidSync(activeUrl);

  // Sync Quill HTML with Braid Markdown
  const quillHtml = useMemo(() => {
    return mdToHtml(text, activeUrl);
  }, [text, activeUrl]);

  const handleQuillChange = (newHtml) => {
    const newMd = htmlToMd(newHtml);
    if (newMd !== text) {
      setText(newMd);
    }
  };

  const handleConnect = (e) => {
    e.preventDefault();
    setActiveUrl(urlInput);
  };

  const handleNew = () => {
    const name = prompt("Enter new document name (in local.org):");
    if (name) {
      const path = name.endsWith('.md') ? name : `${name}.md`;
      const newUrl = `${apiBaseUrl}/local.org/${path}`;
      setUrlInput(newUrl);
      setActiveUrl(newUrl);
    }
  };

  const handleSave = () => {
    // With live sync, setText already sends PUT. 
    // This button can force a refresh or just show status.
    if (text) setText(text);
    alert("Changes synced to local.org");
  };

  return (
    <div className="pages-editor-root">
      <div className="pages-toolbar">
        <div className="toolbar-left">
          <button
            className="burger-menu-btn"
            onClick={() => setShowSidebar(!showSidebar)}
            aria-label="Toggle sidebar"
          >
            {showSidebar ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="action-buttons">
            <button onClick={handleNew} className="action-btn new-btn">
              <Plus size={16} />
              New
            </button>
            <button onClick={handleSave} className="action-btn save-btn" disabled={!connected}>
              <Save size={16} />
              Save
            </button>
          </div>
          <form onSubmit={handleConnect} className="url-form">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Braid URL (e.g. local.org/page)..."
            />
            <button type="submit" className="connect-btn">
              {connected ? 'Syncing' : 'Connect'}
            </button>
          </form>
        </div>

        <div className="toolbar-right">
          <div className="view-toggle">
            <button
              className={viewMode === 'edit' ? 'active' : ''}
              onClick={() => setViewMode('edit')}
            >
              Edit
            </button>
            <button
              className={viewMode === 'preview' ? 'active' : ''}
              onClick={() => setViewMode('preview')}
            >
              Preview
            </button>
          </div>
          <div className={`status-indicator ${connected ? 'connected' : ''}`} title={error || (connected ? 'Connected' : 'Disconnected')}>
            <div className="status-dot"></div>
          </div>
        </div>
      </div>

      <div className="editor-area">
        <div className={`sidebar-drawer ${showSidebar ? 'open' : ''}`}>
          <Explorer
            apiBaseUrl={apiBaseUrl}
            platform={platform}
            activePath={activeUrl.split('/').pop()}
            onSelect={(url, path) => {
              setUrlInput(url);
              setActiveUrl(url);
              if (onNavigate) onNavigate(url);
              setShowSidebar(false); // Close on select
            }}
            onCreate={(url, path) => {
              setUrlInput(url);
              setActiveUrl(url);
            }}
          />
        </div>
        {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} />}
        <div className="editor-main">
          {viewMode === 'edit' ? (
            <QuillEditor
              value={quillHtml}
              onChange={handleQuillChange}
              connected={connected}
            />
          ) : (
            <div
              className="markdown-preview"
              dangerouslySetInnerHTML={{ __html: quillHtml }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default WikiEditor
