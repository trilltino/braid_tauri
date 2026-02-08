/**
 * ChatSearch Component
 * 
 * Full-text search across messages with filters and highlights.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import './ChatSearch.css';

/**
 * Search index for fast lookups
 */
class SearchIndex {
  constructor() {
    this.documents = new Map();
    this.index = new Map(); // term -> Set(docIds)
  }

  addDocument(id, text, metadata = {}) {
    this.documents.set(id, { text, metadata });
    
    // Tokenize and index
    const terms = this.tokenize(text);
    for (const term of terms) {
      if (!this.index.has(term)) {
        this.index.set(term, new Set());
      }
      this.index.get(term).add(id);
    }
  }

  removeDocument(id) {
    const doc = this.documents.get(id);
    if (!doc) return;

    const terms = this.tokenize(doc.text);
    for (const term of terms) {
      this.index.get(term)?.delete(id);
    }
    this.documents.delete(id);
  }

  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  search(query, options = {}) {
    const { 
      filters = {},
      limit = 50,
      fuzzy = false 
    } = options;

    if (!query.trim()) return [];

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    // Score documents
    const scores = new Map();
    
    for (const term of queryTerms) {
      const matchingDocs = this.index.get(term);
      if (matchingDocs) {
        for (const docId of matchingDocs) {
          const doc = this.documents.get(docId);
          if (!doc) continue;

          // Apply filters
          if (filters.sender && doc.metadata.sender !== filters.sender) continue;
          if (filters.dateFrom && doc.metadata.timestamp < filters.dateFrom) continue;
          if (filters.dateTo && doc.metadata.timestamp > filters.dateTo) continue;
          if (filters.hasAttachments && !doc.metadata.hasAttachments) continue;

          // Calculate score
          const score = (scores.get(docId) || 0) + 1;
          scores.set(docId, score);
        }
      }

      // Fuzzy search for similar terms
      if (fuzzy) {
        for (const [indexedTerm, docs] of this.index) {
          if (this.levenshtein(term, indexedTerm) <= 2) {
            for (const docId of docs) {
              const current = scores.get(docId) || 0;
              scores.set(docId, current + 0.5);
            }
          }
        }
      }
    }

    // Sort by score
    const results = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({
        id,
        score,
        ...this.documents.get(id)
      }));

    return results;
  }

  levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
}

/**
 * Main ChatSearch component
 */
export function ChatSearch({ 
  messages, 
  onJumpToMessage,
  className = '' 
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState({
    sender: '',
    dateFrom: '',
    dateTo: '',
    hasAttachments: false
  });
  const [showFilters, setShowFilters] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build search index
  const searchIndex = useMemo(() => {
    const index = new SearchIndex();
    for (const msg of messages) {
      if (!msg.deleted) {
        index.addDocument(msg.id, msg.content, {
          sender: msg.sender,
          timestamp: new Date(msg.created_at).getTime(),
          hasAttachments: msg.blob_refs?.length > 0
        });
      }
    }
    return index;
  }, [messages]);

  // Perform search
  const results = useMemo(() => {
    if (!query.trim()) return [];
    
    const opts = {};
    if (filters.sender) opts.filters = { sender: filters.sender };
    if (filters.dateFrom) {
      opts.filters = opts.filters || {};
      opts.filters.dateFrom = new Date(filters.dateFrom).getTime();
    }
    if (filters.dateTo) {
      opts.filters = opts.filters || {};
      opts.filters.dateTo = new Date(filters.dateTo).getTime();
    }
    if (filters.hasAttachments) {
      opts.filters = opts.filters || {};
      opts.filters.hasAttachments = true;
    }

    return searchIndex.search(query, opts);
  }, [query, searchIndex, filters]);

  // Get unique senders for filter dropdown
  const senders = useMemo(() => {
    const set = new Set(messages.map(m => m.sender));
    return Array.from(set);
  }, [messages]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  }, [isOpen, results, selectedIndex]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSelect = (result) => {
    onJumpToMessage?.(result.id);
    setIsOpen(false);
    setQuery('');
  };

  // Highlight matching text
  const highlightText = (text, query) => {
    if (!query.trim()) return text;
    
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return text;

    const regex = new RegExp(`(${terms.join('|')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => 
      terms.some(t => part.toLowerCase() === t.toLowerCase()) ? (
        <mark key={i}>{part}</mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className={`chat-search ${className}`}>
      {/* Search input */}
      <div className="search-input-wrapper">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search messages..."
          className="search-input"
        />
        <button 
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
          title="Toggle filters"
        >
          ⚙️
        </button>
        {query && (
          <button 
            className="clear-search"
            onClick={() => {
              setQuery('');
              setResults([]);
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="search-filters">
          <div className="filter-row">
            <label>From:</label>
            <select 
              value={filters.sender} 
              onChange={(e) => setFilters(f => ({ ...f, sender: e.target.value }))}
            >
              <option value="">Anyone</option>
              {senders.map(sender => (
                <option key={sender} value={sender}>
                  {sender.slice(0, 8)}...
                </option>
              ))}
            </select>
          </div>

          <div className="filter-row">
            <label>Date:</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            />
            <span>to</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            />
          </div>

          <div className="filter-row checkbox">
            <label>
              <input
                type="checkbox"
                checked={filters.hasAttachments}
                onChange={(e) => setFilters(f => ({ ...f, hasAttachments: e.target.checked }))}
              />
              Has attachments
            </label>
          </div>
        </div>
      )}

      {/* Results dropdown */}
      {isOpen && query.trim() && (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="no-results">
              No messages found for "{query}"
            </div>
          ) : (
            <>
              <div className="results-header">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              <div className="results-list">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    className={`result-item ${index === selectedIndex ? 'selected' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="result-sender">
                      {result.metadata.sender?.slice(0, 8)}...
                    </div>
                    <div className="result-content">
                      {highlightText(result.text, query)}
                    </div>
                    <div className="result-meta">
                      {new Date(result.metadata.timestamp).toLocaleDateString()}
                      {result.metadata.hasAttachments && ' 📎'}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Search stats component
 */
export function SearchStats({ messages }) {
  const stats = useMemo(() => {
    const totalMessages = messages.length;
    const totalWords = messages.reduce((sum, m) => 
      sum + (m.content?.split(/\s+/).length || 0), 0
    );
    const uniqueSenders = new Set(messages.map(m => m.sender)).size;
    const withAttachments = messages.filter(m => m.blob_refs?.length > 0).length;

    return { totalMessages, totalWords, uniqueSenders, withAttachments };
  }, [messages]);

  return (
    <div className="search-stats-bar">
      <span>{stats.totalMessages.toLocaleString()} messages</span>
      <span>•</span>
      <span>{stats.totalWords.toLocaleString()} words</span>
      <span>•</span>
      <span>{stats.uniqueSenders} participants</span>
      {stats.withAttachments > 0 && (
        <>
          <span>•</span>
          <span>{stats.withAttachments} with files</span>
        </>
      )}
    </div>
  );
}

/**
 * Jump to message button
 */
export function JumpToMessage({ messageId, onClick, children }) {
  return (
    <button 
      className="jump-to-message"
      onClick={() => onClick?.(messageId)}
    >
      {children || 'Jump to message'}
    </button>
  );
}
