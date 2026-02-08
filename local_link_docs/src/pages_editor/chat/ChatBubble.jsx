/**
 * ChatBubble Component
 * 
 * Displays a single chat message with:
 * - Right-click context menu for edit/delete
 * - Edit history viewer
 * - File attachments
 * - Reactions
 * - Reply indicator
 */

import React, { useState, useRef, useCallback } from 'react';
import './ChatBubble.css';

export function ChatBubble({ 
  message, 
  isOwn,
  onEdit,
  onDelete,
  onReply,
  onReaction,
  onViewHistory
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const bubbleRef = useRef(null);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setShowMenu(false);
  }, []);

  const handleEdit = () => {
    setIsEditing(true);
    setEditContent(message.content);
    setShowMenu(false);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && editContent !== message.content) {
      onEdit?.(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(message.content);
  };

  const handleDelete = () => {
    if (confirm('Delete this message? This cannot be undone.')) {
      onDelete?.(message.id);
    }
    setShowMenu(false);
  };

  const handleReply = () => {
    onReply?.(message);
    setShowMenu(false);
  };

  const handleViewHistory = () => {
    setShowHistory(true);
    setShowMenu(false);
  };

  const handleReaction = (emoji) => {
    onReaction?.(message.id, emoji);
  };

  const formatTime = (iso) => {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (iso) => {
    const date = new Date(iso);
    return date.toLocaleDateString();
  };

  // Close menu on click outside
  React.useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

  // Deleted message
  if (message.deleted) {
    return (
      <div className={`chat-bubble deleted ${isOwn ? 'own' : ''}`}>
        <span className="deleted-text">Message deleted</span>
      </div>
    );
  }

  const hasEditHistory = message.edit_history && message.edit_history.length > 0;

  return (
    <>
      <div 
        ref={bubbleRef}
        className={`chat-bubble ${isOwn ? 'own' : 'other'} ${hasEditHistory ? 'edited' : ''}`}
        onContextMenu={handleContextMenu}
      >
        {/* Reply reference */}
        {message.reply_to && (
          <div className="reply-ref">
            <span className="reply-label">Replying to</span>
            <span className="reply-preview">{message.reply_to}</span>
          </div>
        )}

        {/* Sender name (for others' messages) */}
        {!isOwn && (
          <div className="sender-name">{message.sender?.slice(0, 8)}...</div>
        )}

        {/* Message content */}
        {isEditing ? (
          <div className="edit-mode">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) handleSaveEdit();
                if (e.key === 'Escape') handleCancelEdit();
              }}
              autoFocus
            />
            <div className="edit-actions">
              <button onClick={handleSaveEdit} className="save">Save</button>
              <button onClick={handleCancelEdit} className="cancel">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="content">{message.content}</div>
        )}

        {/* File attachments */}
        {message.blob_refs && message.blob_refs.length > 0 && (
          <div className="attachments">
            {message.blob_refs.map((blob, i) => (
              <FileAttachment key={i} blob={blob} />
            ))}
          </div>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r, i) => (
              <span key={i} className="reaction" title={r.user}>
                {r.emoji}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="bubble-footer">
          <span className="timestamp" title={formatDate(message.created_at)}>
            {formatTime(message.created_at)}
          </span>
          {hasEditHistory && (
            <span 
              className="edited-badge" 
              onClick={handleViewHistory}
              title="View edit history"
            >
              edited
            </span>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {showMenu && (
        <ContextMenu 
          x={menuPos.x} 
          y={menuPos.y}
          isOwn={isOwn}
          hasHistory={hasEditHistory}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onReply={handleReply}
          onViewHistory={handleViewHistory}
          onClose={handleCloseMenu}
        />
      )}

      {/* Edit History Modal */}
      {showHistory && (
        <EditHistoryModal
          message={message}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}

function ContextMenu({ x, y, isOwn, hasHistory, onEdit, onDelete, onReply, onViewHistory, onClose }) {
  return (
    <div 
      className="context-menu" 
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onReply}>
        <span className="icon">↩</span> Reply
      </button>
      
      {isOwn && (
        <>
          <button onClick={onEdit}>
            <span className="icon">✎</span> Edit Message
          </button>
          {hasHistory && (
            <button onClick={onViewHistory}>
              <span className="icon">🕐</span> View Edit History
            </button>
          )}
          <div className="menu-divider" />
          <button onClick={onDelete} className="danger">
            <span className="icon">🗑</span> Delete Message
          </button>
        </>
      )}
    </div>
  );
}

function EditHistoryModal({ message, onClose }) {
  const history = message.edit_history || [];
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="edit-history-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit History</h3>
        <div className="history-list">
          {/* Original version */}
          {history[0] && (
            <div className="history-item original">
              <div className="history-header">
                <span className="version-label">Original</span>
                <span className="time">{new Date(history[0].timestamp).toLocaleString()}</span>
              </div>
              <div className="history-content">{history[0].content}</div>
            </div>
          )}
          
          {/* Edits */}
          {history.slice(1).map((edit, i) => (
            <div key={i} className="history-item edit">
              <div className="history-header">
                <span className="version-label">Edit {i + 1}</span>
                <span className="time">{new Date(edit.timestamp).toLocaleString()}</span>
              </div>
              <div className="history-content">{edit.content}</div>
            </div>
          ))}
          
          {/* Current version */}
          <div className="history-item current">
            <div className="history-header">
              <span className="version-label">Current</span>
              <span className="time">{message.edited_at ? new Date(message.edited_at).toLocaleString() : 'Now'}</span>
            </div>
            <div className="history-content">{message.content}</div>
          </div>
        </div>
        <button className="close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function FileAttachment({ blob }) {
  const isImage = blob.content_type?.startsWith('image/');
  const isVideo = blob.content_type?.startsWith('video/');
  
  const handleClick = () => {
    // Open blob in new tab or download
    window.open(`/blob/${blob.hash}`, '_blank');
  };

  if (isImage) {
    return (
      <div className="attachment image" onClick={handleClick}>
        <img 
          src={`/blob/${blob.hash}?thumb=300`} 
          alt={blob.filename}
          loading="lazy"
        />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="attachment video" onClick={handleClick}>
        <div className="video-thumb">
          <span className="play-icon">▶</span>
        </div>
        <span className="filename">{blob.filename}</span>
      </div>
    );
  }

  return (
    <div className="attachment file" onClick={handleClick}>
      <div className="file-icon">📄</div>
      <div className="file-info">
        <div className="filename">{blob.filename}</div>
        <div className="filesize">{formatFileSize(blob.size)}</div>
      </div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
