/**
 * ReactionBar Component
 * 
 * Displays message reactions and provides emoji picker.
 */

import React, { useState, useRef, useEffect } from 'react';
import './ReactionBar.css';

// Common emoji reactions
const COMMON_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏'];

// Extended emoji picker categories
const EMOJI_CATEGORIES = {
  'Frequently Used': ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏', '👎', '🤔'],
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'],
  'Gestures': ['👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦵', '🦿', '🦶', '👣', '👂', '🦻', '👃', '🫀', '🫁', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭'],
  'Objects': ['💼', '📁', '📂', '🗂️', '📅', '📆', '🗒️', '🗓️', '📇', '📈', '📉', '📊', '📋', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗃️', '🗄️', '🗑️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️', '🔨', '🪓', '⛏️', '⚒️', '🛠️', '🗡️', '⚔️', '🔫', '🪃', '🏹', '🛡️', '🪚', '🔧', '🪛', '🔩', '⚙️', '🗜️', '⚖️', '🦯', '🔗', '⛓️', '🪝', '🧰', '🧲', '🪜', '⚗️', '🧪', '🧫', '🧬', '🔬', '🔭', '📡', '💉', '🩸', '💊', '🩹', '🩺', '🌡️', '🧹', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🖼️', '🧵', '🪡', '🧶', '🪢', '🛍️', '📿', '💎', '💍', '💄', '💋', '👄', '🦷', '👅', '👂', '🦻', '👃', '👣', '👁️', '👀', '🧠', '🫀', '🫁', '🦴', '🦷', '👅', '👄', '💋']
};

export function ReactionBar({ 
  message, 
  isOwn,
  currentUser,
  onAddReaction,
  onRemoveReaction 
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Frequently Used');
  const pickerRef = useRef(null);
  const buttonRef = useRef(null);

  // Group reactions by emoji
  const reactionGroups = {};
  if (message.reactions) {
    for (const reaction of message.reactions) {
      if (!reactionGroups[reaction.emoji]) {
        reactionGroups[reaction.emoji] = [];
      }
      reactionGroups[reaction.emoji].push(reaction);
    }
  }

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPicker) return;
    
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showPicker]);

  const handleReactionClick = (emoji) => {
    const hasReacted = reactionGroups[emoji]?.some(r => r.user === currentUser);
    
    if (hasReacted) {
      onRemoveReaction?.(message.id, emoji);
    } else {
      onAddReaction?.(message.id, emoji);
    }
  };

  const handleAddNewReaction = (emoji) => {
    onAddReaction?.(message.id, emoji);
    setShowPicker(false);
  };

  const hasAnyReactions = Object.keys(reactionGroups).length > 0;

  return (
    <div className="reaction-bar">
      {/* Existing reactions */}
      {hasAnyReactions && (
        <div className="reaction-chips">
          {Object.entries(reactionGroups).map(([emoji, users]) => {
            const hasReacted = users.some(r => r.user === currentUser);
            const isPending = message._pending;
            
            return (
              <button
                key={emoji}
                className={`reaction-chip ${hasReacted ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                onClick={() => handleReactionClick(emoji)}
                title={users.map(u => u.user).join(', ')}
              >
                <span className="emoji">{emoji}</span>
                <span className="count">{users.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick reactions (show on hover or when no reactions) */}
      <div className="quick-reactions">
        {COMMON_REACTIONS.slice(0, 4).map(emoji => (
          <button
            key={emoji}
            className="quick-emoji"
            onClick={() => handleReactionClick(emoji)}
            title="Add reaction"
          >
            {emoji}
          </button>
        ))}
        
        {/* Add reaction button */}
        <button
          ref={buttonRef}
          className="add-reaction-btn"
          onClick={() => setShowPicker(!showPicker)}
          title="Add reaction"
        >
          {showPicker ? '×' : '+'}
        </button>
      </div>

      {/* Emoji Picker */}
      {showPicker && (
        <div ref={pickerRef} className="emoji-picker">
          <div className="picker-header">
            {Object.keys(EMOJI_CATEGORIES).map(cat => (
              <button
                key={cat}
                className={activeCategory === cat ? 'active' : ''}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          
          <div className="picker-content">
            {EMOJI_CATEGORIES[activeCategory].map(emoji => (
              <button
                key={emoji}
                className="emoji-btn"
                onClick={() => handleAddNewReaction(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact reaction display (for message list)
 */
export function CompactReactions({ reactions, maxShown = 3 }) {
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const groups = {};
  for (const r of reactions) {
    groups[r.emoji] = (groups[r.emoji] || 0) + 1;
  }

  const entries = Object.entries(groups);
  const shown = entries.slice(0, maxShown);
  const remaining = entries.length - maxShown;

  return (
    <span className="compact-reactions">
      {shown.map(([emoji, count]) => (
        <span key={emoji} className="compact-reaction">
          {emoji}{count > 1 && <sub>{count}</sub>}
        </span>
      ))}
      {remaining > 0 && (
        <span className="more-reactions">+{remaining}</span>
      )}
    </span>
  );
}
