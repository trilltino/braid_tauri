/**
 * Main Chat Component
 * 
 * Full-featured chat UI with:
 * - Real-time sync via Braid protocol
 * - Message editing with history
 * - File attachments
 * - Reactions
 * - Reply threading
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChatClient } from './chat-client.js';
import { ChatBubble } from './ChatBubble.jsx';
import './Chat.css';

export function Chat({ roomId, daemonPort = 45678 }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState(null);
  
  const clientRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Initialize chat client
  useEffect(() => {
    const client = createChatClient(roomId, {
      onMessages: (msgs) => {
        setMessages(msgs);
        setIsConnected(true);
        setError(null);
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
      onError: (err) => {
        console.error('Chat error:', err);
        setError(err.message);
        setIsConnected(false);
      },
      daemonPort
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [roomId, daemonPort]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      setError(err.message);
    }
  }, [inputText, attachments, replyingTo]);

  const handleEdit = useCallback(async (msgId, newContent) => {
    try {
      await clientRef.current?.editMessage(msgId, newContent);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleDelete = useCallback(async (msgId) => {
    try {
      await clientRef.current?.deleteMessage(msgId);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleReply = useCallback((msg) => {
    setReplyingTo(msg);
  }, []);

  const handleReaction = useCallback(async (msgId, emoji) => {
    try {
      await clientRef.current?.addReaction(msgId, emoji);
    } catch (err) {
      // Silent fail for reactions
    }
  }, []);

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files);
    
    for (const file of files) {
      try {
        // Upload to BraidBlob
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
        setError(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
  }, [daemonPort]);

  const removeAttachment = useCallback((idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const myPeerId = clientRef.current?.peer || '';

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <h3>#{roomId}</h3>
        <div className="connection-status">
          <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="error-banner" onClick={() => setError(null)}>
          {error}
          <span className="dismiss">×</span>
        </div>
      )}

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>No messages yet</p>
            <p className="hint">Be the first to send a message!</p>
          </div>
        ) : (
          messages.map(msg => (
            <ChatBubble
              key={msg.id}
              message={msg}
              isOwn={msg.sender === myPeerId}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onReply={handleReply}
              onReaction={handleReaction}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply indicator */}
      {replyingTo && (
        <div className="reply-indicator">
          <span>Replying to {replyingTo.sender?.slice(0, 8)}...</span>
          <button onClick={() => setReplyingTo(null)}>×</button>
          <div className="reply-preview">{replyingTo.content.slice(0, 100)}...</div>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="attachment-previews">
          {attachments.map((att, i) => (
            <div key={i} className="attachment-chip">
              <span className="filename">{att.filename}</span>
              <button onClick={() => removeAttachment(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="input-area">
        <button 
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
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
          onChange={(e) => setInputText(e.target.value)}
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
          className="send-btn"
          onClick={handleSend}
          disabled={!inputText.trim() && attachments.length === 0}
        >
          Send
        </button>
      </div>
    </div>
  );
}
