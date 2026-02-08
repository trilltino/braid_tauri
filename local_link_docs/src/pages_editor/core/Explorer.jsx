import { useState, useEffect, useCallback } from 'react';
import { FileText, Search, X, Plus, RotateCw, Trash2 } from 'lucide-react';

/**
 * Unified Explorer Component
 * Works in both Web and Tauri environments
 */
function Explorer({
  apiBaseUrl = 'http://localhost:3001',
  platform = 'web',
  onSelect,
  onCreate,
  activePath,
  searchable = true
}) {
  const [pages, setPages] = useState([]);
  const [filteredPages, setFilteredPages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch pages
  const loadPages = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      let data = [];

      if (platform === 'tauri' && window.__TAURI__) {
        // Use Tauri command
        data = await window.__TAURI__.core.invoke('list_local_pages');
      } else {
        // Use HTTP API
        const res = await fetch(`${apiBaseUrl}/local.org/`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }

      setPages(data || []);
      setFilteredPages(data || []);
    } catch (err) {
      console.error('[Explorer] Failed to load pages:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, platform]);

  // Initial load
  useEffect(() => {
    loadPages();
  }, [loadPages]);

  // Search filter
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredPages(pages);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = pages.filter(page =>
      page.title?.toLowerCase().includes(query) ||
      page.path?.toLowerCase().includes(query)
    );
    setFilteredPages(filtered);
  }, [searchQuery, pages]);

  // Create new page
  const handleCreate = async () => {
    const name = prompt('Enter new document name:');
    if (!name) return;

    const path = name.endsWith('.md') ? name : `${name}.md`;
    const url = `${apiBaseUrl}/local.org/${path}`;

    try {
      if (platform === 'tauri' && window.__TAURI__) {
        await window.__TAURI__.core.invoke('create_local_page', {
          path,
          content: `# ${name}\n\n`
        });
      } else {
        await fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/plain',
            'Merge-Type': 'simpleton'
          },
          body: `# ${name}\n\n`
        });
      }

      // Refresh and select
      await loadPages();
      if (onSelect) onSelect(url, path);
      if (onCreate) onCreate(url, path);
    } catch (err) {
      console.error('[Explorer] Failed to create page:', err);
      alert('Failed to create page: ' + err.message);
    }
  };

  // Delete page
  const handleDelete = async (path, e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${path}"?`)) return;

    try {
      if (platform === 'tauri' && window.__TAURI__) {
        await window.__TAURI__.core.invoke('delete_local_page', { path });
      } else {
        await fetch(`${apiBaseUrl}/local.org/${path}`, { method: 'DELETE' });
      }

      await loadPages();
    } catch (err) {
      console.error('[Explorer] Failed to delete:', err);
    }
  };

  return (
    <div className="explorer-container">
      <div className="explorer-header">
        <h3>Local Pages</h3>
        <button
          className="new-page-btn"
          onClick={handleCreate}
          title="Create new page"
        >
          <Plus size={16} />
        </button>
      </div>

      {searchable && (
        <div className="explorer-search">
          <input
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              className="clear-search"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          ) : (
            <div className="search-icon-placeholder" style={{ position: 'absolute', right: '36px', top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }}>
              <Search size={14} />
            </div>
          )}
        </div>
      )}

      <div className="explorer-content">
        {isLoading && <div className="loading">Loading...</div>}

        {error && (
          <div className="error">
            <p>Error: {error}</p>
            <button onClick={loadPages}>
              <RotateCw size={12} style={{ marginRight: '6px' }} />
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && filteredPages.length === 0 && (
          <div className="empty">
            <p>{searchQuery ? 'No matches found' : 'No pages yet'}</p>
            {!searchQuery && (
              <button onClick={handleCreate}>Create your first page</button>
            )}
          </div>
        )}

        <ul className="pages-list">
          {filteredPages.map(page => (
            <li
              key={page.path}
              className={`page-item ${activePath === page.path ? 'active' : ''}`}
              onClick={() => onSelect && onSelect(
                `${apiBaseUrl}/local.org/${page.path}`,
                page.path
              )}
            >
              <span className="page-icon">
                <FileText size={14} />
              </span>
              <span className="page-title">{page.title || page.path}</span>
              <button
                className="delete-btn"
                onClick={(e) => handleDelete(page.path, e)}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="explorer-footer">
        {filteredPages.length} item{filteredPages.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export default Explorer;
