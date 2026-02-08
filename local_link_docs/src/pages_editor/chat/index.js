/**
 * Chat Module
 * 
 * Local-first chat with Diamond Types CRDT synchronization.
 * 
 * Features:
 * - Offline-first message queue
 * - Real-time reactions with emoji picker
 * - Typing indicators and presence
 * - BraidFS network drive mounting
 * - Threaded conversations
 * - Full-text search
 */

// Core components
export { Chat } from './Chat.jsx';
export { ChatBubble } from './ChatBubble.jsx';
export { createChatClient } from './chat-client.js';

// Offline support
export { 
  createOfflineQueue, 
  OfflineQueue, 
  SyncManager 
} from './offline-queue.js';
export { createOfflineChatClient } from './chat-client-offline.js';

// Reactions
export { 
  ReactionBar, 
  CompactReactions 
} from './ReactionBar.jsx';

// Typing indicators
export { 
  TypingIndicator, 
  TypingInput, 
  PresenceIndicator,
  PresenceList,
  ChatStatusBar,
  useTyping 
} from './TypingIndicator.jsx';

// BraidFS mounting
export { 
  BraidFSMount, 
  QuickMountButton,
  ShareFromDriveDialog 
} from './BraidFSMount.jsx';

// Threading
export { 
  ThreadView, 
  ThreadStats, 
  ViewModeSwitcher 
} from './ThreadView.jsx';

// Search
export { 
  ChatSearch, 
  SearchStats, 
  JumpToMessage 
} from './ChatSearch.jsx';
