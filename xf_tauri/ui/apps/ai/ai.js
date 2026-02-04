import { showToast, invoke } from '../shared/utils.js';
import { renderMessage, loadMessages } from '../chat/chat.js';

export function initAi() {
    const aiChatBtn = document.getElementById('btn-ai-chat');
    const aiChatCreateBtn = document.getElementById('ai-room-create-btn');
    const aiSidebarCreateBtn = document.getElementById('ai-sidebar-create-btn');

    if (aiChatBtn) aiChatBtn.addEventListener('click', () => window.switchView('ai'));
    if (aiChatCreateBtn) aiChatCreateBtn.addEventListener('click', createAiChat);
    if (aiSidebarCreateBtn) aiSidebarCreateBtn.addEventListener('click', createAiChat);

    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-chat-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', () => sendAiMessage());
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendAiMessage();
        });
    }

    document.getElementById('ai-share-btn')?.addEventListener('click', generateAiInvite);
}

export async function loadAiConversations() {
    const aiList = document.getElementById('ai-conversations-list');
    try {
        const conversations = await invoke('get_conversations_tauri');
        if (aiList) {
            aiList.innerHTML = '';
            const aiRooms = conversations.filter(c => !c.is_direct_message);
            if (aiRooms.length === 0) {
                aiList.innerHTML = '<div class="empty-state-mini">No AI sessions</div>';
            } else {
                aiRooms.forEach(conv => renderAiConvItem(conv, aiList));
            }
        }
    } catch (e) { console.error("Load AI conversations failed:", e); }
}

function renderAiConvItem(conv, container) {
    const item = document.createElement('div');
    item.className = 'mail-item';
    if (window.currentConversationId === conv.id) item.classList.add('active');
    
    const name = conv.name || conv.created_by || 'Unnamed Room';
    item.innerHTML = `
        <div class="mail-item-header">
            <span class="sender-name">🤖 ${name}</span>
        </div>
        <div class="mail-subject">Generative Session</div>
    `;
    item.addEventListener('click', () => {
        container.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        openAiConversation(conv.id, name);
    });
    container.appendChild(item);
}

export async function openAiConversation(conversationId, name = "AI Session") {
    window.currentConversationId = conversationId;
    window.activeChatView = 'ai';

    document.getElementById('ai-empty-selection').style.display = 'none';
    const contentDisplay = document.getElementById('ai-content-display');
    contentDisplay.style.display = 'flex';

    document.getElementById('ai-chat-username').textContent = name;
    
    const input = document.getElementById('ai-chat-input');
    if (input) { input.value = ''; input.focus(); }

    loadMessages(conversationId);

    const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
    const shareBtn = document.getElementById('ai-share-btn');
    if (shareBtn) shareBtn.style.display = tokens[conversationId] ? 'block' : 'none';
}

export async function sendAiMessage() {
    const input = document.getElementById('ai-chat-input');
    const content = input?.value?.trim();
    if (!content || !window.currentConversationId) return;
    if (input) input.value = '';

    try {
        const finalContent = `@BraidBot! ${content}`;
        renderMessage({ sender: window.currentUser.email, content: content, created_at: new Date().toISOString() });
        await invoke('send_message_tauri', {
            payload: { conversation_id: window.currentConversationId, content: finalContent, sender: window.currentUser.email }
        });
    } catch (e) { showToast("Failed to send AI message: " + e, "error"); }
}

export async function createAiChat() {
    const name = prompt("Enter AI Chat Room Name:");
    if (!name) return;
    try {
        const res = await invoke('create_ai_chat_tauri', {
            payload: { name, participant_emails: [], is_direct_message: false, resource_url: null, sender: window.currentUser?.email || "current_user" }
        });
        const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
        tokens[res.conversation.id] = res.admin_token;
        localStorage.setItem('xf_admin_tokens', JSON.stringify(tokens));
        showToast("AI Room Created!", "success");
        if (window.switchView) window.switchView('ai');
        await loadAiConversations();
        openAiConversation(res.conversation.id, res.conversation.name);
    } catch (e) { showToast("Failed to create AI Chat: " + e, "error"); }
}

async function generateAiInvite() {
    const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
    const adminToken = tokens[window.currentConversationId];
    if (!adminToken) return showToast("Not an admin", "error");
    try {
        const res = await invoke('generate_invite_tauri', { conversationId: window.currentConversationId, adminToken });
        const display = document.getElementById('invite-url-display');
        if (display) {
            display.value = res.invite_token;
            document.getElementById('invite-overlay').style.display = 'flex';
        }
    } catch (e) { showToast("Invite failed: " + e, "error"); }
}
