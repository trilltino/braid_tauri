/**
 * ThreadView Component
 * 
 * Displays threaded/nested conversations for replies.
 */

import React, { useState, useMemo } from 'react';
import { ChatBubble } from './ChatBubble.jsx';
import './ThreadView.css';

/**
 * Build thread tree from flat message list
 */
function buildThreadTree(messages) {
  const msgMap = new Map();
  const roots = [];

  // First pass: create nodes
  for (const msg of messages) {
    msgMap.set(msg.id, {
      ...msg,
      children: [],
      depth: 0,
      isCollapsed: false
    });
  }

  // Second pass: build tree
  for (const msg of messages) {
    const node = msgMap.get(msg.id);
    if (msg.reply_to && msgMap.has(msg.reply_to)) {
      const parent = msgMap.get(msg.reply_to);
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }

  // Sort by timestamp within each level
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

/**
 * Count total descendants
 */
function countDescendants(node) {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}

/**
 * Thread node component
 */
function ThreadNode({ 
  node, 
  isOwn,
  onEdit, 
  onDelete, 
  onReply,
  onReaction,
  maxDepth = 3,
  renderDepth = 0
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState('');

  const hasReplies = node.children.length > 0;
  const replyCount = countDescendants(node);
  const isDeep = renderDepth >= maxDepth;

  const handleReplySubmit = () => {
    if (!replyContent.trim()) return;
    onReply?.(node.id, replyContent.trim());
    setReplyContent('');
    setShowReplyForm(false);
    setIsCollapsed(false);
  };

  return (
    <div className={`thread-node depth-${Math.min(renderDepth, 5)}`}>
      {/* Thread line connector */}
      {renderDepth > 0 && (
        <div className="thread-connector">
          <div className="thread-line" />
        </div>
      )}

      <div className="thread-content">
        {/* Message bubble */}
        <ChatBubble
          message={node}
          isOwn={isOwn}
          onEdit={onEdit}
          onDelete={onDelete}
          onReply={() => setShowReplyForm(!showReplyForm)}
          onReaction={onReaction}
        />

        {/* Reply count badge */}
        {hasReplies && !isCollapsed && (
          <button 
            className="reply-count-badge"
            onClick={() => setIsCollapsed(true)}
          >
            Hide {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {hasReplies && isCollapsed && (
          <button 
            className="reply-count-badge collapsed"
            onClick={() => setIsCollapsed(false)}
          >
            Show {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {/* Reply form */}
        {showReplyForm && (
          <div className="inline-reply-form">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder={`Reply to ${node.sender?.slice(0, 8)}...`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  handleReplySubmit();
                }
              }}
              autoFocus
            />
            <div className="reply-actions">
              <button onClick={handleReplySubmit}>Reply</button>
              <button onClick={() => setShowReplyForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Children */}
        {!isCollapsed && hasReplies && (
          <div className={`thread-children ${isDeep ? 'thread-deep' : ''}`}>
            {isDeep ? (
              // Show condensed view for deep threads
              <div className="deep-thread-notice">
                <button onClick={() => {}}>
                  Continue thread ({replyCount} more)
                </button>
              </div>
            ) : (
              node.children.map(child => (
                <ThreadNode
                  key={child.id}
                  node={child}
                  isOwn={child.sender === isOwn}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onReply={onReply}
                  onReaction={onReaction}
                  maxDepth={maxDepth}
                  renderDepth={renderDepth + 1}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Main Thread View component
 */
export function ThreadView({ 
  messages, 
  currentUser,
  onEdit,
  onDelete,
  onReply,
  onReaction,
  viewMode = 'threaded' // 'threaded' | 'flat' | 'compact'
}) {
  const threadRoots = useMemo(() => {
    return buildThreadTree(messages);
  }, [messages]);

  // Flat view (chronological)
  if (viewMode === 'flat') {
    const sorted = [...messages].sort((a, b) => 
      new Date(a.created_at) - new Date(b.created_at)
    );

    return (
      <div className="thread-view flat">
        {sorted.map(msg => (
          <ChatBubble
            key={msg.id}
            message={msg}
            isOwn={msg.sender === currentUser}
            onEdit={onEdit}
            onDelete={onDelete}
            onReply={(m) => onReply?.(m.id)}
            onReaction={onReaction}
          />
        ))}
      </div>
    );
  }

  // Compact view (threads collapsed)
  if (viewMode === 'compact') {
    return (
      <div className="thread-view compact">
        {threadRoots.map(node => (
          <CompactThreadItem
            key={node.id}
            node={node}
            currentUser={currentUser}
            onEdit={onEdit}
            onDelete={onDelete}
            onReply={onReply}
            onReaction={onReaction}
          />
        ))}
      </div>
    );
  }

  // Threaded view (default)
  return (
    <div className="thread-view threaded">
      {threadRoots.map(node => (
        <ThreadNode
          key={node.id}
          node={node}
          isOwn={node.sender === currentUser}
          onEdit={onEdit}
          onDelete={onDelete}
          onReply={onReply}
          onReaction={onReaction}
        />
      ))}
    </div>
  );
}

/**
 * Compact thread item (for compact view)
 */
function CompactThreadItem({ 
  node, 
  currentUser,
  onEdit,
  onDelete,
  onReply,
  onReaction
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const replyCount = countDescendants(node);

  return (
    <div className="compact-thread-item">
      <ChatBubble
        message={node}
        isOwn={node.sender === currentUser}
        onEdit={onEdit}
        onDelete={onDelete}
        onReply={(m) => onReply?.(m.id)}
        onReaction={onReaction}
      />
      
      {replyCount > 0 && (
        <button 
          className="expand-thread-btn"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '▼' : '▶'} {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {isExpanded && (
        <div className="expanded-replies">
          {node.children.map(child => (
            <ThreadNode
              key={child.id}
              node={child}
              isOwn={child.sender === currentUser}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              onReaction={onReaction}
              maxDepth={2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Thread stats component
 */
export function ThreadStats({ messages }) {
  const stats = useMemo(() => {
    const total = messages.length;
    const roots = messages.filter(m => !m.reply_to).length;
    const replies = total - roots;
    const threads = new Set(messages.filter(m => m.reply_to).map(m => m.reply_to)).size;
    
    // Find deepest thread
    const nodeMap = new Map();
    for (const m of messages) {
      nodeMap.set(m.id, { ...m, depth: 0 });
    }
    
    let maxDepth = 0;
    for (const m of messages) {
      if (m.reply_to && nodeMap.has(m.reply_to)) {
        const parent = nodeMap.get(m.reply_to);
        const node = nodeMap.get(m.id);
        node.depth = parent.depth + 1;
        maxDepth = Math.max(maxDepth, node.depth);
      }
    }

    return { total, roots, replies, threads, maxDepth };
  }, [messages]);

  return (
    <div className="thread-stats">
      <span>{stats.total} messages</span>
      <span>•</span>
      <span>{stats.roots} top-level</span>
      <span>•</span>
      <span>{stats.replies} replies</span>
      <span>•</span>
      <span>{stats.threads} threads</span>
      {stats.maxDepth > 0 && (
        <>
          <span>•</span>
          <span>max depth: {stats.maxDepth}</span>
        </>
      )}
    </div>
  );
}

/**
 * View mode switcher
 */
export function ViewModeSwitcher({ currentMode, onChange }) {
  const modes = [
    { key: 'threaded', label: 'Threaded', icon: '🧵' },
    { key: 'flat', label: 'Flat', icon: '📃' },
    { key: 'compact', label: 'Compact', icon: '📦' }
  ];

  return (
    <div className="view-mode-switcher">
      {modes.map(mode => (
        <button
          key={mode.key}
          className={currentMode === mode.key ? 'active' : ''}
          onClick={() => onChange(mode.key)}
        >
          <span className="icon">{mode.icon}</span>
          {mode.label}
        </button>
      ))}
    </div>
  );
}
