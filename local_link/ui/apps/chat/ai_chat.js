//! AI Chat - Pure Braid Protocol - NO SSE
//!
//! The AI chat is now just a regular chat room where @BraidBot is a participant.
//! When you send a message with "@BraidBot!", the server automatically
//! generates a response and adds it to the chat.
//!
//! PURE BRAID PROTOCOL - uses braid-http subscriptions, not SSE.

import { showToast, invoke } from '../shared/utils.js';

let currentAiConversationId = null;
let aiSubscriptionUnlisten = null;
let aiReconnectAttempts = 0;
const MAX_AI_RECONNECT_ATTEMPTS = 5;

export function initAiChat() {
    // Nav bindings
    const aiBtn = document.getElementById('btn-ai');
    if (aiBtn) aiBtn.addEventListener('click', () => window.switchView('ai'));

    // AI Chat Input
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-send-btn');
    
    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendAiMessage());
    }
    
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendAiMessage();
        });
    }

    // Create AI Chat button
    document.getElementById('create-ai-chat-btn')?.addEventListener('click', createAiChat);
    
    // Join AI Chat button
    document.getElementById('ai-join-submit-btn')?.addEventListener('click', joinAiChat);

    // Initial load
    loadAiConversations();
}

export async function createAiChat() {
    const nameInput = document.getElementById('ai-chat-name');
    const name = nameInput?.value?.trim() || 'AI Chat';
    
    try {
        // Create via server - this creates a room with @BraidBot as participant
        const result = await invoke('create_ai_chat_tauri', { name });
        
        showToast(`Created AI chat: ${result.conversation.name}`, 'success');
        
        // Clear input
        if (nameInput) nameInput.value = '';
        
        // Reload and open
        await loadAiConversations();
        openAiConversation(result.conversation.id, result.conversation.name);
        
    } catch (e) {
        showToast("Failed to create AI chat: " + e, "error");
    }
}

export async function loadAiConversations() {
    const aiList = document.getElementById('ai-conversations-list');
    if (!aiList) return;

    try {
        // Get all conversations that have AI participants
        const conversations = await invoke('get_ai_conversations_tauri');
        
        aiList.innerHTML = '';
        
        if (conversations.length === 0) {
            aiList.innerHTML = '<div class="empty-state-mini">No AI chats yet</div>';
            return;
        }
        
        conversations.forEach(conv => {
            const item = document.createElement('div');
            item.className = 'mail-item';
            if (currentAiConversationId === conv.id) item.classList.add('active');
            
            item.innerHTML = `
                <div class="mail-item-header">
                    <span class="sender-name">[AI] ${conv.name || 'AI Chat'}</span>
                </div>
                <div class="mail-subject">AI Assistant</div>
            `;
            
            item.addEventListener('click', () => {
                aiList.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                openAiConversation(conv.id, conv.name || 'AI Chat');
            });
            
            aiList.appendChild(item);
        });
        
    } catch (e) {
        console.error("Load AI conversations failed:", e);
    }
}

export async function openAiConversation(conversationId, name = "AI Chat") {
    currentAiConversationId = conversationId;
    window.activeChatView = 'ai';

    // Hide empty state, show content
    const emptySelection = document.getElementById('ai-empty-selection');
    const contentDisplay = document.getElementById('ai-content-display');
    
    if (emptySelection) emptySelection.style.display = 'none';
    if (contentDisplay) contentDisplay.style.display = 'flex';

    // Update header
    const nameEl = document.getElementById('ai-username');
    if (nameEl) nameEl.textContent = name;

    // Clear and focus input
    const input = document.getElementById('ai-chat-input');
    if (input) {
        input.value = '';
        input.focus();
    }

    // Load messages
    await loadAiMessages(conversationId);
    
    // Start PURE BRAID subscription for real-time updates (NO SSE!)
    startAiBraidSubscription(conversationId);
}

// ========== PURE BRAID SUBSCRIPTION FOR AI CHAT ==========

async function startAiBraidSubscription(conversationId) {
    // Close existing subscription
    if (aiSubscriptionUnlisten) {
        await closeAiBraidSubscription();
    }

    try {
        // Start Braid subscription via Tauri command
        // This uses braid-http's subscription mechanism
        await invoke('start_braid_subscription', { conversationId });
        
        // Listen for Braid updates from Rust
        aiSubscriptionUnlisten = await window.__TAURI__.event.listen('braid-update', (event) => {
            const update = event.payload;
            handleAiBraidUpdate(update);
        });

        aiReconnectAttempts = 0;
        console.log('[AI Chat] Braid subscription connected');
        
    } catch (e) {
        console.error('[AI Chat] Failed to start Braid subscription:', e);
        
        // Attempt reconnect
        if (aiReconnectAttempts < MAX_AI_RECONNECT_ATTEMPTS) {
            aiReconnectAttempts++;
            setTimeout(() => startAiBraidSubscription(conversationId), 2000 * aiReconnectAttempts);
        }
    }
}

async function closeAiBraidSubscription() {
    try {
        await invoke('stop_braid_subscription');
        if (aiSubscriptionUnlisten) {
            aiSubscriptionUnlisten();
            aiSubscriptionUnlisten = null;
        }
    } catch (e) {
        console.error('[AI Chat] Error closing Braid subscription:', e);
    }
}

function handleAiBraidUpdate(update) {
    console.log('[AI Chat] Braid update:', update);
    
    // The update contains the message data
    if (update.data) {
        renderAiMessage(update.data);
    } else if (update.version && update.body) {
        // Parse body if it's a JSON string
        try {
            const data = JSON.parse(update.body);
            renderAiMessage(data);
        } catch (e) {
            // If not JSON, render as plain message
            renderAiMessage({
                id: update.version,
                sender: '@BraidBot',
                content: update.body,
                created_at: new Date().toISOString()
            });
        }
    }
}

export async function loadAiMessages(conversationId) {
    const msgList = document.getElementById('ai-messages');
    if (!msgList) return;

    try {
        const messages = await invoke('get_ai_messages_tauri', { conversationId });
        msgList.innerHTML = '';
        
        messages.forEach(msg => renderAiMessage(msg));
        msgList.scrollTop = msgList.scrollHeight;
        
    } catch (e) {
        console.error("Load AI messages failed:", e);
    }
}

export function renderAiMessage(msg) {
    const msgList = document.getElementById('ai-messages');
    if (!msgList) return;

    // Check if message already exists (for updates like thinking -> response)
    const existingBubble = document.getElementById(`msg-${msg.id}`);
    if (existingBubble) {
        // Update existing message
        const isBot = msg.sender === '@BraidBot';
        const isThinking = msg.content.includes('🤔 *Thinking') || msg.content.includes('Thinking...');
        
        // Format content (support markdown for bot)
        let content = msg.content;
        if (isBot && window.marked && !isThinking) {
            content = window.marked.parse(msg.content);
        }
        
        // Update classes
        existingBubble.className = `chat-bubble received ai ${isThinking ? 'thinking' : ''}`;
        
        // Update content
        const contentDiv = existingBubble.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.innerHTML = content;
        }
        
        msgList.scrollTop = msgList.scrollHeight;
        return;
    }

    const isUser = msg.sender !== '@BraidBot';
    const isBot = msg.sender === '@BraidBot';
    const isThinking = isBot && (msg.content.includes('🤔 *Thinking') || msg.content.includes('Thinking...'));

    const bubble = document.createElement('div');
    bubble.id = `msg-${msg.id}`;
    bubble.className = `chat-bubble ${isUser ? 'sent' : 'received'} ${isBot ? 'ai' : ''} ${isThinking ? 'thinking' : ''}`;
    
    const date = new Date(msg.created_at || Date.now());
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Format content (support markdown for bot)
    let content = msg.content;
    if (isBot && window.marked && !isThinking) {
        content = window.marked.parse(msg.content);
    }
    
    // Add thinking dots animation for thinking state
    const thinkingDots = isThinking ? '<span class="thinking-dots"><span></span><span></span><span></span></span>' : '';
    
    bubble.innerHTML = `
        <div class="message-header">
            <span class="sender">${isBot ? '[AI] ' : ''}${msg.sender}</span>
            <span class="time">${timeStr}</span>
        </div>
        <div class="message-content">${content}${thinkingDots}</div>
    `;
    
    msgList.appendChild(bubble);
    msgList.scrollTop = msgList.scrollHeight;
}

export async function sendAiMessage() {
    const input = document.getElementById('ai-chat-input');
    const content = input?.value?.trim();
    
    if (!content || !currentAiConversationId) return;
    
    // Clear input immediately for responsiveness
    if (input) input.value = '';
    
    // Add @BraidBot trigger if not present (optional - server handles this too)
    const finalContent = content.includes('@BraidBot') ? content : `@BraidBot! ${content}`;
    
    // Optimistically render user message
    renderAiMessage({
        sender: window.currentUser?.email || 'You',
        content: finalContent,
        created_at: new Date().toISOString()
    });
    
    try {
        // Send to server - AI response will come via SSE
        await invoke('send_ai_message_tauri', {
            conversationId: currentAiConversationId,
            content: finalContent,
            sender: window.currentUser?.email || 'anonymous'
        });
        
        // The AI response will arrive via SSE subscription
        
    } catch (e) {
        showToast("Failed to send: " + e, "error");
    }
}

async function joinAiChat() {
    const tokenInput = document.getElementById('ai-join-token-input');
    const token = tokenInput?.value?.trim();
    
    if (!token) return;
    
    try {
        const conv = await invoke('join_ai_chat_tauri', { inviteToken: token });
        showToast(`Joined ${conv.name}!`, 'success');
        
        document.getElementById('ai-join-overlay').style.display = 'none';
        await loadAiConversations();
        openAiConversation(conv.id, conv.name, 'ai');
        
    } catch (e) {
        showToast("Join failed: " + e, "error");
    }
}

// Export for use in main chat module
export { currentAiConversationId };
