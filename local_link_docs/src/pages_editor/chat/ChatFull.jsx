/**
 * ChatFull Component
 * 
 * Full-featured chat integrating all phases:
 * - Offline queue with persistence
 * - Reactions with emoji picker
 * - Typing indicators
 * - BraidFS mount integration
 * - Threaded conversations
 * - Full-text search
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createOfflineChatClient } from './chat-client-offline.js';
import { ChatBubble } from './ChatBubble.jsx';
import { ReactionBar } from './ReactionBar.jsx';
import { 
  TypingIndicator, 
  useTyping,
  PresenceList,
  ChatStatusBar 
} from './TypingIndicator.jsx';
import { BraidFSMount, QuickMountButton } from './BraidFSMount.jsx';
import { ThreadView, ViewModeSwitcher, ThreadStats } from './ThreadView.jsx';
import { ChatSearch, SearchStats } from './ChatSearch.jsx';
import './ChatFull.css';

export function ChatFull({ 
  roomId, 
  daemonPort = 45678,
  peers = [],
  currentUser
}) {
  // State
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [syncStatus, setSyncStatus] = useState({ status: 'disconnected' });
  const [viewMode, setViewMode] = useState('threaded');
  const [showMountPanel, setShowMountPanel] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);

  // Refs
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Initialize client
  useEffect(() => {
    const client = createOfflineChatClient(roomId, {
      onMessages: (msgs) => {
        setMessages(msgs);
      },
      onMessageUpdate: (msg) => {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === msg.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = msg;
            return updated;
          }
          return [...prev, msg];
        });
      },
      onSyncStatusChange: (status) => {
        setSyncStatus(status);
      },
      onError: (err) => {
        console.error('Chat error:', err);
      },
      daemonPort,
      enableOffline: true
    });

    clientRef.current = client;
    client.init();

    return () => client.disconnect();
  }, [roomId, daemonPort]);

  // Typing detection
  const { isTyping, handleInput } = useTyping(roomId, clientRef.current, true);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handlers
  const handleSend = useCallback(async () => {
    if (!inputText.trim() && attachments.length === 0) return;
    
    try {
      await clientRef.current?.sendMessage(inputText, {
        replyTo: replyingTo?.id,
        attachments
      });
      setInputText('');
      setReplyingTo(null);
      setAttachments([]);
    } catch (err) {
      console.error('Send failed:', err);
    }
  }, [inputText, attachments, replyingTo]);

  const handleEdit = useCallback(async (msgId, newContent) => {
    try {
      await clientRef.current?.editMessage(msgId, newContent);
    } catch (err) {
      console.error('Edit failed:', err);
    }
  }, []);

  const handleDelete = useCallback(async (msgId) => {
    try {
      await clientRef.current?.deleteMessage(msgId);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, []);

  const handleReply = useCallback((msg) => {
    setReplyingTo(msg);
  }, []);

  const handleReaction = useCallback(async (msgId, emoji) => {
    try {
      await clientRef.current?.addReaction(msgId, emoji);
    } catch (err) {
      console.error('Reaction failed:', err);
    }
  }, []);

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch(`http://localhost:${daemonPort}/blob/${file.name}`, {
          method: 'PUT',
          body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        const result = await response.json();
        setAttachments(prev => [...prev, {
          hash: result.hash,
          filename: file.name,
          content_type: file.type,
          size: file.size
        }]);
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
  }, [daemonPort]);

  const removeAttachment = useCallback((idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleJumpToMessage = useCallback((msgId) => {
    const element = document.getElementById(`msg-${msgId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('highlight');
      setTimeout(() => element.classList.remove('highlight'), 2000);
    }
  }, []);

  const myPeerId = clientRef.current?.peer || '';

  return (
    <div className="chat-full">
      {/* Header */}
      <div className="chat-header-full">
        <div className="header-left">
          <h3>#{roomId}</h3>
          <QuickMountButton 
            peer={{ id: roomId }} 
            onMount={() => setShowMountPanel(true)}
          />
        </div>
        
        <div className="header-center">
          <SearchStats messages={messages} />
        </div>
        
        <div className="header-right">
          <button 
            className={`header-btn ${showSearch ? 'active' : ''}`}
            onClick={() => setShowSearch(!showSearch)}
          >
            🔍
          </button>
          <button 
            className={`header-btn ${showMountPanel ? 'active' : ''}`}
            onClick={() => setShowMountPanel(!showMountPanel)}
          >
            🖇️
          </button>
          <ViewModeSwitcher currentMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="search-bar-wrapper">
          <ChatSearch 
            messages={messages}
            onJumpToMessage={handleJumpToMessage}
          />
        </div>
      )}

      {/* BraidFS Mount Panel */}
      {showMountPanel && (
        <div className="mount-panel">
          <BraidFSMount 
            peers={peers}
            onMount={(peer, path) => console.log('Mounted:', peer, path)}
            onUnmount={(peer) => console.log('Unmounted:', peer)}
          />
        </div>
      )}

      {/* Presence sidebar */}
      <div className="chat-layout">
        <div className="presence-sidebar">
          <PresenceList 
            users={onlineUsers.map(id => ({ id, status: 'online' }))}
            currentUser={myPeerId}
          />
        </div>

        {/* Main chat area */}
        <div className="chat-main">
          {/* Thread stats */}
          <div className="thread-stats-wrapper">
            <ThreadStats messages={messages} />
          </div>

          {/* Messages */}
          <div className="messages-container">
            <ThreadView
              messages={messages}
              currentUser={myPeerId}
              viewMode={viewMode}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onReply={handleReply}
              onReaction={handleReaction}
            />
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          <TypingIndicator users={typingUsers} />

          {/* Status bar */}
          <ChatStatusBar
            typingUsers={typingUsers}
            onlineUsers={onlineUsers}
            currentUser={myPeerId}
            connectionStatus={syncStatus.status}
          />

          {/* Reply indicator */}
          {replyingTo && (
            <div className="reply-indicator-full">
              <span>Replying to {replyingTo.sender?.slice(0, 8)}...</span>
              <span className="reply-preview">{replyingTo.content.slice(0, 60)}...</span>
              <button onClick={() => setReplyingTo(null)}>×</button>
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="attachment-previews-full">
              {attachments.map((att, i) => (
                <div key={i} className="attachment-chip-full">
                  <span>{att.filename}</span>
                  <button onClick={() => removeAttachment(i)}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="input-area-full">
            <button 
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                handleInput();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              rows={1}
            />
            
            <button 
              className="send-btn-full"
              onClick={handleSend}
              disabled={!inputText.trim() && attachments.length === 0}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
