/**
 * TypingIndicator Component
 * 
 * Shows who's currently typing in the chat.
 */

import React, { useState, useEffect } from 'react';
import './TypingIndicator.css';

const TYPING_TIMEOUT = 5000; // Clear typing after 5 seconds of inactivity
const TYPING_SEND_INTERVAL = 3000; // Send typing event every 3 seconds while typing

/**
 * Hook to track typing state
 */
export function useTyping(roomId, client, isEnabled = true) {
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Map());

  useEffect(() => {
    if (!isEnabled || !client) return;

    let typingTimer = null;
    let sendTimer = null;

    const notifyTyping = () => {
      // Send typing event to server/peers
      client.broadcastTyping?.(true).catch(() => {});
    };

    const stopTyping = () => {
      setIsTyping(false);
      if (sendTimer) {
        clearInterval(sendTimer);
        sendTimer = null;
      }
      client.broadcastTyping?.(false).catch(() => {});
    };

    const handleInput = () => {
      if (!isTyping) {
        setIsTyping(true);
        notifyTyping();
        sendTimer = setInterval(notifyTyping, TYPING_SEND_INTERVAL);
      }

      // Reset stop timer
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(stopTyping, TYPING_TIMEOUT);
    };

    // Listen for other users typing
    const handleTypingEvent = (event) => {
      if (event.user === client.peer) return; // Ignore self

      setTypingUsers(prev => {
        const next = new Map(prev);
        if (event.isTyping) {
          next.set(event.user, {
            timestamp: Date.now(),
            user: event.user
          });
        } else {
          next.delete(event.user);
        }
        return next;
      });
    };

    // Subscribe to typing events
    client.onTypingEvent?.(handleTypingEvent);

    return () => {
      if (typingTimer) clearTimeout(typingTimer);
      if (sendTimer) clearInterval(sendTimer);
      stopTyping();
    };
  }, [roomId, client, isEnabled]);

  // Clean up stale typing indicators
  useEffect(() => {
    if (!isEnabled) return;

    const cleanup = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        const next = new Map();
        for (const [user, data] of prev) {
          if (now - data.timestamp < TYPING_TIMEOUT) {
            next.set(user, data);
          }
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(cleanup);
  }, [isEnabled]);

  const activeTypers = Array.from(typingUsers.values())
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    isTyping,
    typingUsers: activeTypers,
    handleInput
  };
}

/**
 * Typing indicator display component
 */
export function TypingIndicator({ users, className = '' }) {
  if (!users || users.length === 0) return null;

  const getMessage = () => {
    if (users.length === 1) {
      return `${shortenId(users[0].user)} is typing...`;
    }
    if (users.length === 2) {
      return `${shortenId(users[0].user)} and ${shortenId(users[1].user)} are typing...`;
    }
    if (users.length === 3) {
      return `${shortenId(users[0].user)}, ${shortenId(users[1].user)} and ${shortenId(users[2].user)} are typing...`;
    }
    return `${users.length} people are typing...`;
  };

  return (
    <div className={`typing-indicator ${className}`}>
      <div className="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span className="typing-text">{getMessage()}</span>
    </div>
  );
}

/**
 * Typing input wrapper
 */
export function TypingInput({ 
  value, 
  onChange, 
  onTyping,
  placeholder,
  ...props 
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    onChange?.(newValue);
    onTyping?.();
  };

  return (
    <textarea
      value={localValue}
      onChange={handleChange}
      placeholder={placeholder}
      {...props}
    />
  );
}

/**
 * Presence indicator (online/away/offline)
 */
export function PresenceIndicator({ status, className = '' }) {
  const statusConfig = {
    online: { color: '#4caf50', label: 'Online' },
    away: { color: '#ff9800', label: 'Away' },
    offline: { color: '#9e9e9e', label: 'Offline' }
  };

  const config = statusConfig[status] || statusConfig.offline;

  return (
    <span 
      className={`presence-indicator ${status} ${className}`}
      title={config.label}
      style={{ 
        backgroundColor: config.color,
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        display: 'inline-block'
      }}
    />
  );
}

/**
 * User presence list
 */
export function PresenceList({ users, currentUser }) {
  if (!users || users.length === 0) return null;

  return (
    <div className="presence-list">
      <h4>Online — {users.length}</h4>
      {users.map(user => (
        <div 
          key={user.id} 
          className={`presence-item ${user.id === currentUser ? 'me' : ''}`}
        >
          <PresenceIndicator status={user.status} />
          <span className="username">{shortenId(user.id)}</span>
          {user.id === currentUser && <span className="you-badge">You</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Combined typing and presence bar
 */
export function ChatStatusBar({ 
  typingUsers, 
  onlineUsers, 
  currentUser,
  connectionStatus 
}) {
  return (
    <div className="chat-status-bar">
      <TypingIndicator users={typingUsers} />
      
      <div className="status-right">
        {onlineUsers && (
          <span className="online-count">
            {onlineUsers.length} online
          </span>
        )}
        <div className={`connection-badge ${connectionStatus}`}>
          {connectionStatus === 'connected' && '🟢'}
          {connectionStatus === 'connecting' && '🟡'}
          {connectionStatus === 'disconnected' && '🔴'}
          {connectionStatus === 'offline' && '⏸️'}
        </div>
      </div>
    </div>
  );
}

function shortenId(id) {
  if (!id) return 'Unknown';
  return id.slice(0, 8);
}
