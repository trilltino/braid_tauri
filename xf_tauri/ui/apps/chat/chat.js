//! Chat UI - Pure Braid Protocol - NO SSE
//!
//! All chat operations go through the backend server using pure Braid protocol.
//! Displays sync status indicators for offline/reconnecting states.
//! NO SSE - uses braid-http subscriptions only.

import { showToast, invoke } from '../shared/utils.js';

// Braid subscription state
let chatSubscriptionUnlisten = null;
let chatReconnectAttempts = 0;
const MAX_CHAT_RECONNECT_ATTEMPTS = 5;

export function initChat() {
    // Nav Bindings
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
    
    // Start periodic sync status check
    startSyncStatusPolling();
}

// Sync status polling
function startSyncStatusPolling() {
    setInterval(async () => {
        if (window.currentConversationId) {
            await updateSyncStatus(window.currentConversationId);
        }
    }, 5000); // Check every 5 seconds
}

async function updateSyncStatus(conversationId) {
    try {
        const status = await invoke('get_sync_status', { conversationId });
        renderSyncStatus(status);
    } catch (e) {
        // Server might be down
        renderSyncStatus({ status: 'offline', pending_changes: 0 });
    }
}

function renderSyncStatus(status) {
    const indicator = document.getElementById('sync-status-indicator');
    const text = document.getElementById('sync-status-text');
    
    if (!indicator) return;
    
    // Remove all status classes
    indicator.className = 'sync-status';
    
    switch(status.status) {
        case 'connected':
            indicator.classList.add('connected');
            if (text) text.textContent = '';
            break;
        case 'syncing':
            indicator.classList.add('syncing');
            if (text) text.textContent = 'Syncing...';
            break;
        case 'offline':
            indicator.classList.add('offline');
            if (text) {
                text.textContent = status.pending_changes > 0 
                    ? `Offline (${status.pending_changes} pending)` 
                    : 'Offline';
            }
            break;
        case 'reconnecting':
            indicator.classList.add('reconnecting');
            if (text) text.textContent = 'Reconnecting...';
            break;
        default:
            indicator.classList.add('offline');
    }
}

export async function loadContacts() {
    const contactsList = document.getElementById('contacts-list');
    if (!contactsList) return;
    
    try {
        const contacts = await invoke('get_contacts');
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
        console.error("Load contacts failed:", e); 
    }
}

export async function openChat(contact) {
    if (window.switchView) window.switchView('chat');
    
    try {
        const res = await invoke('create_conversation_tauri', {
            name: contact.username,
            participant_emails: [contact.email],
            isDirectMessage: true,
            sender: window.currentUser.email
        });
        
        const convId = res.id || (res.conversation && res.conversation.id);
        await loadConversations();
        openConversation(convId, contact.username, 'chat');
    } catch (e) { 
        showToast("Failed to start chat: " + e, "error"); 
    }
}

export async function loadConversations() {
    const dmList = document.getElementById('chat-conversations-list');
    
    try {
        const conversations = await invoke('get_conversations_tauri');
        if (dmList) {
            dmList.innerHTML = '';
            const dms = conversations.filter(c => c.is_direct_message);
            
            if (dms.length === 0) {
                dmList.innerHTML = '<div class="empty-state-mini">No active DMs</div>';
            } else {
                dms.forEach(conv => renderConvItem(conv, dmList));
            }
        }
    } catch (e) { 
        console.error("Load conversations failed:", e); 
    }
}

function renderConvItem(conv, container) {
    const item = document.createElement('div');
    item.className = 'mail-item';
    if (window.currentConversationId === conv.id) item.classList.add('active');

    const name = conv.name || conv.created_by || 'Unnamed';
    item.innerHTML = `
        <div class="mail-item-header">
            <span class="sender-name">👤 ${name}</span>
        </div>
        <div class="mail-subject">Direct Message</div>
    `;
    
    item.addEventListener('click', () => {
        container.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        openConversation(conv.id, name, 'chat');
    });
    
    container.appendChild(item);
}

export async function openConversation(conversationId, name = "Chat Room", viewHint) {
    window.currentConversationId = conversationId;
    if (viewHint) window.activeChatView = viewHint;

    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    
    const emptySelection = document.getElementById(`${baseId}-empty-selection`);
    if (emptySelection) emptySelection.style.display = 'none';

    const contentDisplay = document.getElementById(`${baseId}-content-display`);
    if (contentDisplay) contentDisplay.style.display = 'flex';

    const nameEl = document.getElementById(`${baseId}-username`);
    if (nameEl) nameEl.textContent = name;

    const avatar = document.getElementById(`${baseId}-avatar`);
    if (avatar && window.activeChatView === 'chat') {
        avatar.textContent = name.charAt(0).toUpperCase();
    }

    const input = document.getElementById(window.activeChatView === 'ai' ? 'ai-chat-input' : 'chat-input');
    if (input) { 
        input.value = ''; 
        input.focus(); 
    }

    // Load messages from server
    await loadMessages(conversationId);
    
    // Start PURE BRAID subscription for real-time updates (NO SSE!)
    startBraidSubscription(conversationId);
    
    // Check sync status
    await updateSyncStatus(conversationId);

    // Show invite button if admin
    const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
    const shareBtn = document.getElementById(`${baseId}-share-btn`);
    if (shareBtn) shareBtn.style.display = tokens[conversationId] ? 'block' : 'none';
}

// ========== PURE BRAID SUBSCRIPTION (NO SSE!) ==========

async function startBraidSubscription(conversationId) {
    // Close existing subscription
    if (chatSubscriptionUnlisten) {
        await closeBraidSubscription();
    }

    try {
        // Start Braid subscription via Tauri command
        // This uses braid-http's subscription mechanism
        await invoke('start_braid_subscription', { conversationId });
        
        // Listen for Braid updates from Rust
        chatSubscriptionUnlisten = await window.__TAURI__.event.listen('braid-update', (event) => {
            const update = event.payload;
            handleBraidUpdate(update);
        });

        chatReconnectAttempts = 0;
        renderSyncStatus({ status: 'connected' });
        console.log('[Chat] Braid subscription connected');
        
    } catch (e) {
        console.error('[Chat] Failed to start Braid subscription:', e);
        renderSyncStatus({ status: 'offline' });
        
        // Attempt reconnect
        if (chatReconnectAttempts < MAX_CHAT_RECONNECT_ATTEMPTS) {
            chatReconnectAttempts++;
            setTimeout(() => startBraidSubscription(conversationId), 2000 * chatReconnectAttempts);
        }
    }
}

async function closeBraidSubscription() {
    try {
        await invoke('stop_braid_subscription');
        if (chatSubscriptionUnlisten) {
            chatSubscriptionUnlisten();
            chatSubscriptionUnlisten = null;
        }
    } catch (e) {
        console.error('[Chat] Error closing Braid subscription:', e);
    }
}

function handleBraidUpdate(update) {
    console.log('[Chat] Braid update:', update);
    
    // The update contains the message data
    if (update.data) {
        renderMessage(update.data);
    } else if (update.version && update.body) {
        // Parse body if it's a JSON string
        try {
            const data = JSON.parse(update.body);
            renderMessage(data);
        } catch (e) {
            // If not JSON, render as plain message
            renderMessage({
                id: update.version,
                sender: 'system',
                content: update.body,
                created_at: new Date().toISOString()
            });
        }
    }
}

export async function loadMessages(conversationId) {
    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    const msgList = document.getElementById(`${baseId}-messages`);
    if (!msgList) return;
    
    try {
        const messages = await invoke('get_messages_tauri', { conversationId });
        msgList.innerHTML = '';
        messages.forEach(renderMessage);
        msgList.scrollTop = msgList.scrollHeight;
    } catch (e) { 
        console.error("Load messages failed:", e); 
    }
}

export function renderMessage(msg) {
    const baseId = window.activeChatView === 'ai' ? 'ai' : 'chat';
    const msgList = document.getElementById(`${baseId}-messages`);
    if (!msgList) return;

    const isBot = msg.sender === "@BraidBot" || msg.sender === "BraidBot";
    const isSent = msg.sender === window.currentUser?.email || 
                   msg.sender === window.currentUser?.username || 
                   msg.sender === "current_user";

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSent ? 'sent' : 'received'} ${isBot ? 'ai' : ''}`;
    
    const date = new Date(msg.created_at || Date.now());
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Format content
    let contentHtml = escapeHtml(msg.content);
    
    // Support markdown for bot messages
    if (isBot && window.marked) {
        contentHtml = window.marked.parse(msg.content);
    }
    
    // Render file attachments if any
    let attachmentsHtml = '';
    if (msg.blob_refs && msg.blob_refs.length > 0) {
        attachmentsHtml = '<div class="attachments">' + 
            msg.blob_refs.map(blob => {
                if (blob.content_type.startsWith('image/')) {
                    return `<img src="http://localhost:3001/blobs/${blob.hash}" 
                                  alt="${blob.filename}" 
                                  class="chat-image" 
                                  loading="lazy"/>`;
                } else {
                    return `<a href="http://localhost:3001/blobs/${blob.hash}" 
                               target="_blank" 
                               class="file-attachment">
                                📎 ${blob.filename} (${formatFileSize(blob.size)})
                            </a>`;
                }
            }).join('') + 
        '</div>';
    }
    
    bubble.innerHTML = `
        <div class="message-header">
            <span class="sender">${isBot ? '🤖 ' : ''}${msg.sender}</span>
            <span class="time">${timeStr}</span>
        </div>
        <div class="message-content">${contentHtml}</div>
        ${attachmentsHtml}
    `;
    
    msgList.appendChild(bubble);
    msgList.scrollTop = msgList.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

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
        await invoke('send_message_tauri', {
            payload: { 
                conversation_id: window.currentConversationId, 
                content: content, 
                sender: window.currentUser.email 
            }
        });
        
        // Server response will come via Braid subscription
    } catch (e) { 
        showToast("Failed to send: " + e, "error");
        // Message will be saved as draft server-side
    }
}

async function attachFile() {
    if (!window.currentConversationId) return;
    
    // Use Tauri's file dialog
    try {
        const selected = await window.__TAURI__.dialog.open({
            multiple: false,
            filters: [{
                name: 'Images & Files',
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'txt', 'md']
            }]
        });
        
        if (selected) {
            // Upload file and send message with attachment
            await invoke('send_message_with_file', {
                conversationId: window.currentConversationId,
                content: '📎 File attachment',
                sender: window.currentUser.email,
                filePath: selected
            });
        }
    } catch (e) {
        showToast("Failed to attach file: " + e, "error");
    }
}

async function sendFriendRequest() {
    const email = document.getElementById('friend-email').value;
    const message = document.getElementById('friend-message').value;
    if (!email) return showToast("Enter email", "error");
    
    try {
        await invoke('send_friend_request_tauri', { 
            toEmail: email, 
            message, 
            senderEmail: window.currentUser.email, 
            senderUsername: window.currentUser.username 
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
        const requests = await invoke('get_pending_friend_requests');
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
                    <button class="icon-btn small accept-req">✅</button>
                    <button class="icon-btn small reject-req">✕</button>
                </div>
            `;
            item.querySelector('.accept-req').addEventListener('click', () => respondToRequest(req.id, 'accept'));
            item.querySelector('.reject-req').addEventListener('click', () => respondToRequest(req.id, 'reject'));
            reqList.appendChild(item);
        });
    } catch (e) { 
        console.error("Load requests failed:", e); 
    }
}

async function respondToRequest(requestId, action) {
    try {
        await invoke('respond_friend_request_tauri', { requestId, action });
        showToast(`Request ${action}ed!`, "success");
        loadPendingRequests();
        loadContacts();
    } catch (e) { 
        showToast("Failed: " + e, "error"); 
    }
}

async function generateInvite() {
    const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
    const adminToken = tokens[window.currentConversationId];
    if (!adminToken) return showToast("Not an admin", "error");
    
    try {
        const res = await invoke('generate_invite_tauri', { 
            conversationId: window.currentConversationId, 
            adminToken 
        });
        
        const display = document.getElementById('invite-url-display');
        if (display) {
            display.value = res.invite_token;
            document.getElementById('invite-overlay').style.display = 'flex';
        }
    } catch (e) { 
        showToast("Invite failed: " + e, "error"); 
    }
}

async function joinChat() {
    const token = document.getElementById('join-token-input').value.trim();
    if (!token) return;
    
    try {
        const conv = await invoke('join_chat_tauri', { inviteToken: token });
        showToast(`Joined ${conv.name}!`, "success");
        document.getElementById('join-overlay').style.display = 'none';
        await loadConversations();
        openConversation(conv.id, conv.name, 'chat');
    } catch (e) { 
        showToast("Join failed: " + e, "error"); 
    }
}

// Handle reconnection
window.addEventListener('online', async () => {
    showToast("Back online - syncing...", "info");
    
    if (window.currentConversationId) {
        renderSyncStatus({ status: 'reconnecting' });
        
        try {
            const result = await invoke('sync_drafts', { 
                conversationId: window.currentConversationId 
            });
            
            if (result.length > 0) {
                showToast(`Synced ${result.length} messages`, 'success');
            }
            
            renderSyncStatus({ status: 'connected' });
            
            // Reload messages
            await loadMessages(window.currentConversationId);
        } catch (e) {
            showToast("Sync failed: " + e, 'error');
            renderSyncStatus({ status: 'offline' });
        }
    }
});

window.addEventListener('offline', () => {
    showToast("Offline mode - messages will be saved as drafts", "warning");
    renderSyncStatus({ status: 'offline' });
});
