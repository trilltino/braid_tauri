//! Pure Braid Protocol Chat Client - NO SSE
//!
//! All real-time updates through Braid subscriptions.
//! No EventSource, no SSE - pure braid-http.

import { showToast, invoke } from '../shared/utils.js';

// Braid subscription state
let currentSubscription = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

export function initChat() {
    // Nav bindings
    const chatBtn = document.getElementById('btn-chat');
    if (chatBtn) chatBtn.addEventListener('click', () => window.switchView('chat'));

    // Chat Input
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    
    if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    // Friend Request Logic
    const addContactBtn = document.getElementById('add-contact-btn');
    const friendOverlay = document.getElementById('friend-overlay');
    if (addContactBtn) {
        addContactBtn.addEventListener('click', () => {
            friendOverlay.style.display = 'flex';
            document.getElementById('friend-email')?.focus();
        });
    }

    document.getElementById('friend-close-btn')?.addEventListener('click', () => {
        friendOverlay.style.display = 'none';
    });

    document.getElementById('friend-send-btn')?.addEventListener('click', sendFriendRequest);

    // Invite Logic
    document.getElementById('chat-share-btn')?.addEventListener('click', generateInvite);

    // Join Logic
    document.getElementById('join-submit-btn')?.addEventListener('click', joinChat);
    
    // File attachment
    document.getElementById('chat-attach-btn')?.addEventListener('click', attachFile);

    // Initial Load
    loadContacts();
    loadConversations();
    loadPendingRequests();
}

// ========== PURE BRAID SUBSCRIPTION ==========

async function startBraidSubscription(conversationId) {
    // Close existing subscription
    if (currentSubscription) {
        await closeBraidSubscription();
    }

    try {
        // Start Braid subscription via Tauri command
        // This uses braid-http's subscription mechanism
        await invoke('start_braid_subscription', { conversationId });
        
        // Listen for Braid updates from Rust
        window.__TAURI__.event.listen('braid-update', (event) => {
            const update = event.payload;
            handleBraidUpdate(update);
        });

        reconnectAttempts = 0;
        updateConnectionStatus('connected');
        
    } catch (e) {
        error(`Failed to start Braid subscription: ${e}`);
        updateConnectionStatus('error');
        
        // Attempt reconnect
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => startBraidSubscription(conversationId), 2000 * reconnectAttempts);
        }
    }
}

async function closeBraidSubscription() {
    try {
        await invoke('stop_braid_subscription');
        currentSubscription = null;
    } catch (e) {
        console.error('Error closing Braid subscription:', e);
    }
}

function handleBraidUpdate(update) {
    debug('[Braid] Received update:', update);
    
    switch(update.type) {
        case 'message':
            renderMessage(update.data);
            break;
        case 'presence':
            updatePresenceIndicator(update.data);
            break;
        case 'typing':
            showTypingIndicator(update.data);
            break;
        case 'heartbeat':
            // Keepalive - connection healthy
            break;
        case 'version':
            // Server is sending version info
            debug('[Braid] Version:', update.version);
            break;
        default:
            debug('[Braid] Unknown update type:', update.type);
    }
}

// ========== MESSAGE HANDLING ==========

export async function sendMessage() {
    const inputId = window.activeChatView === 'ai' ? 'ai-chat-input' : 'chat-input';
    const input = document.getElementById(inputId);
    const content = input?.value?.trim();
    
    if (!content || !window.currentConversationId) return;
    if (input) input.value = '';

    // Optimistically render
    renderMessage({ 
        sender: window.currentUser.email, 
        content: content, 
        created_at: new Date().toISOString() 
    });

    try {
        // Send via Braid PUT
        await invoke('send_message_braid', {
            conversationId: window.currentConversationId,
            content: content
        });
        
        // Response will come via Braid subscription
    } catch (e) { 
        showToast("Failed to send: " + e, "error");
        updateConnectionStatus('offline');
    }
}

export async function loadMessages(conversationId) {
    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    const msgList = document.getElementById(`${baseId}-messages`);
    if (!msgList) return;
    
    try {
        // Get messages via Braid GET
        const messages = await invoke('get_messages_braid', { 
            conversationId,
            sinceVersion: null
        });
        
        msgList.innerHTML = '';
        messages.forEach(renderMessage);
        msgList.scrollTop = msgList.scrollHeight;
    } catch (e) { 
        error("Load messages failed:", e); 
    }
}

export function renderMessage(msg) {
    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    const msgList = document.getElementById(`${baseId}-messages`);
    if (!msgList) return;

    const isBot = msg.sender === "@BraidBot";
    const isSent = msg.sender === window.currentUser?.email;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSent ? 'sent' : 'received'} ${isBot ? 'ai' : ''}`;
    
    const date = new Date(msg.created_at || Date.now());
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Format content with markdown for bot
    let contentHtml = escapeHtml(msg.content);
    if (isBot && window.marked) {
        contentHtml = window.marked.parse(msg.content);
    }
    
    // Render file attachments
    let attachmentsHtml = '';
    if (msg.blob_refs?.length > 0) {
        attachmentsHtml = '<div class="attachments">' + 
            msg.blob_refs.map(blob => {
                if (blob.content_type?.startsWith('image/')) {
                    return `<img src="http://localhost:3001/blobs/${blob.hash}" 
                                  alt="${blob.filename}" class="chat-image"/>`;
                } else {
                    return `<a href="http://localhost:3001/blobs/${blob.hash}" 
                               target="_blank" class="file-attachment">
                                [File] ${blob.filename}
                            </a>`;
                }
            }).join('') + '</div>';
    }
    
    bubble.innerHTML = `
        <div class="message-header">
            <span class="sender">${isBot ? '[AI] ' : ''}${msg.sender}</span>
            <span class="time">${timeStr}</span>
        </div>
        <div class="message-content">${contentHtml}</div>
        ${attachmentsHtml}
    `;
    
    msgList.appendChild(bubble);
    msgList.scrollTop = msgList.scrollHeight;
}

// ========== FRIENDS ==========

async function sendFriendRequest() {
    const email = document.getElementById('friend-email').value;
    const message = document.getElementById('friend-message').value;
    if (!email) return showToast("Enter email", "error");
    
    try {
        await invoke('send_friend_request_braid', { 
            to_email: email, 
            message 
        });
        showToast("Request sent!", "success");
        document.getElementById('friend-overlay').style.display = 'none';
    } catch (e) { 
        showToast("Failed: " + e, "error"); 
    }
}

export async function loadPendingRequests() {
    const reqList = document.getElementById('pending-requests-list');
    const badge = document.getElementById('pending-requests-badge');
    if (!reqList) return;
    
    try {
        const requests = await invoke('get_pending_requests_braid');
        reqList.innerHTML = '';
        
        if (badge) {
            badge.style.display = requests.length > 0 ? 'block' : 'none';
            badge.textContent = requests.length;
        }
        
        if (requests.length === 0) {
            reqList.innerHTML = '<div class="empty-state-mini">No requests</div>';
            return;
        }
        
        requests.forEach(req => {
            const item = document.createElement('div');
            item.className = 'request-item';
            item.innerHTML = `
                <div class="contact-avatar">${req.from_username.charAt(0).toUpperCase()}</div>
                <div class="contact-info">
                    <span class="contact-name">${req.from_username}</span>
                </div>
                <div class="request-actions">
                    <button class="text-btn small accept-req">Accept</button>
                    <button class="text-btn small reject-req">Decline</button>
                </div>
            `;
            item.querySelector('.accept-req').addEventListener('click', () => respondToRequest(req.id, true));
            item.querySelector('.reject-req').addEventListener('click', () => respondToRequest(req.id, false));
            reqList.appendChild(item);
        });
    } catch (e) { 
        error("Load requests failed:", e); 
    }
}

async function respondToRequest(requestId, accept) {
    try {
        await invoke('respond_to_request_braid', { requestId, accept });
        showToast(`Request ${accept ? 'accepted' : 'rejected'}!`, "success");
        loadPendingRequests();
        loadContacts();
    } catch (e) { 
        showToast("Failed: " + e, "error"); 
    }
}

export async function loadContacts() {
    const contactsList = document.getElementById('contacts-list');
    if (!contactsList) return;
    
    try {
        const contacts = await invoke('get_contacts_braid');
        contactsList.innerHTML = '';
        
        if (contacts.length === 0) {
            contactsList.innerHTML = '<div class="empty-state-mini">No contacts yet</div>';
            return;
        }
        
        contacts.forEach(contact => {
            const item = document.createElement('div');
            item.className = 'contact-item';
            const initial = contact.username.charAt(0).toUpperCase();
            item.innerHTML = `
                <div class="contact-avatar">${initial}</div>
                <div class="contact-info">
                    <span class="contact-name">${contact.username}</span>
                    <span class="contact-email">${contact.email}</span>
                </div>
                <div class="contact-status ${contact.is_online ? '' : 'offline'}"></div>
            `;
            item.addEventListener('click', () => openChat(contact));
            contactsList.appendChild(item);
        });
    } catch (e) { 
        error("Load contacts failed:", e); 
    }
}

// ========== CONVERSATIONS ==========

export async function openConversation(conversationId, name = "Chat Room", viewHint) {
    window.currentConversationId = conversationId;
    if (viewHint) window.activeChatView = viewHint;

    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    
    const emptySelection = document.getElementById(`${baseId}-empty-selection`);
    const contentDisplay = document.getElementById(`${baseId}-content-display`);
    
    if (emptySelection) emptySelection.style.display = 'none';
    if (contentDisplay) contentDisplay.style.display = 'flex';

    const nameEl = document.getElementById(`${baseId}-username`);
    if (nameEl) nameEl.textContent = name;

    const input = document.getElementById(window.activeChatView === 'ai' ? 'ai-chat-input' : 'chat-input');
    if (input) { 
        input.value = ''; 
        input.focus(); 
    }

    // Load messages
    await loadMessages(conversationId);
    
    // Start PURE BRAID SUBSCRIPTION (NO SSE!)
    await startBraidSubscription(conversationId);
}

// ========== HELPERS ==========

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connection-status');
    if (!indicator) return;
    
    indicator.className = `connection-status ${status}`;
    
    switch(status) {
        case 'connected':
            indicator.title = 'Braid connected';
            break;
        case 'offline':
            indicator.title = 'Offline';
            break;
        case 'error':
            indicator.title = 'Connection error';
            break;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debug(...args) {
    console.log('[BraidChat]', ...args);
}

function error(...args) {
    console.error('[BraidChat]', ...args);
}

// Handle app shutdown - close subscription gracefully
window.addEventListener('beforeunload', async () => {
    await closeBraidSubscription();
});
