import { showToast, invoke } from '../shared/utils.js';
import { renderMessage, loadMessages } from '../chat/chat.js';

export function initAi() {
    console.log("Initializing AI View...");

    // Initialize File Tree for AI View
    import('../explorer/explorer.js').then(mod => {
        if (mod.loadExplorerTree) mod.loadExplorerTree('ai-tree', 'ai');
    });

    // Initialize Quill for AI View
    import('../explorer/editor.js').then(mod => {
        if (mod.setupQuill) {
            // We need to pass a specific container ID to setupQuill or it defaults to #quill-editor-container
            // Current setupQuill implementation hardcodes #quill-editor-container. 
            // We should probably refactor setupQuill too, but for now let's handle it.
            // Actually, let's just make sure both views use the SAME editor logic if possible, 
            // OR refactor setupQuill to accept a selector.
            // For now, let's assume valid refactor of setupQuill is coming next step.
            mod.setupQuill(null, '#ai-quill-container');
        }
        if (mod.setupResizer) {
            mod.setupResizer('ai-resizer', 'ai-sidebar', 'ai-sidebar-toggle-btn');
        }
    });

    const aiChatBtn = document.getElementById('btn-ai-chat');
    const aiChatCreateBtn = document.getElementById('ai-room-create-btn');
    const aiSidebarCreateBtn = document.getElementById('ai-sidebar-create-btn');
    const aiSidebarCreateBtn2 = document.getElementById('ai-sidebar-create-btn'); 

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

    document.getElementById('ai-share-btn')?.addEventListener('click', () => { /* generateAiInvite removed? check imports */ });


    // Peer Discovery Modal Events
    document.getElementById('peer-discovery-close')?.addEventListener('click', () => {
        document.getElementById('peer-discovery-modal').style.display = 'none';
    });
    document.getElementById('peer-discovery-start')?.addEventListener('click', startPeerDiscoverySession);

    // Wire global functions
    window.createSoloLearnChat = createSoloLearnChat;
    window.createPeerDiscoveryChat = createPeerDiscoveryChat;
    window.createAiChat = createAiChat;

    // Start AI Slogan Rotation
    startAiSloganRotation();
}

export async function loadAiConversations() {
    const aiList = document.getElementById('ai-conversations-list');
    try {
        const conversations = await invoke('get_conversations_braid');
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
            <span class="sender-name">${name}</span>
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
        await invoke('send_message_braid', {
            conversation_id: window.currentConversationId,
            content: finalContent 
        });
    } catch (e) { showToast("Failed to send AI message: " + e, "error"); }
}

export async function createAiChat() {
    const name = prompt("Enter AI Chat Room Name:");
    if (!name) return;
    try {
        const res = await invoke('create_ai_chat_braid', {
            name: name,
            sender: window.currentUser?.email || "current_user"
        });
        const tokens = JSON.parse(localStorage.getItem('xf_admin_tokens') || '{}');
        // Handle both possible response formats (full conversation object or simple ID)
        if (res.conversation) {
            tokens[res.conversation.id] = res.admin_token;
            localStorage.setItem('xf_admin_tokens', JSON.stringify(tokens));
            showToast("AI Room Created!", "success");
            if (window.switchView) window.switchView('ai');
            await loadAiConversations();
            openAiConversation(res.conversation.id, res.conversation.name);
        } else {
            // Fallback for simple response
            showToast("AI Chat Room Created!", "success");
            await loadAiConversations();
        }
    } catch (e) {
        console.error("Failed to create room:", e);
        showToast("Failed to create room: " + e, "error");
    }
}

function startAiSloganRotation() {
    const slogans = ['curiosity.', 'data.', 'context.', 'ideas.', 'model.'];
    let currentSloganIndex = 0;

    const target = document.getElementById('ai-slogan-target');
    const container = document.getElementById('ai-slogan');

    if (target && container) {
        if (window.aiSloganInterval) clearInterval(window.aiSloganInterval);

        const rotate = () => {
            target.style.opacity = '0';
            target.style.transform = 'translateY(10px)';

            setTimeout(() => {
                currentSloganIndex = (currentSloganIndex + 1) % slogans.length;
                target.textContent = slogans[currentSloganIndex];
                target.style.opacity = '1';
                target.style.transform = 'translateY(0)';
            }, 500);
        };

        window.aiSloganInterval = setInterval(rotate, 3000);
    }
}

// Solo Learn: Creates a personal AI session with Ollama
export async function createSoloLearnChat() {
    try {
        const res = await invoke('create_ai_chat_braid', {
            name: `Solo Learn - ${new Date().toLocaleDateString()}`,
            sender: window.currentUser?.email || "current_user"
        });

        const convId = res.conversation?.id || res.id;
        if (convId) {
            showToast("Solo Learn session started!", "success");
            if (window.switchView) window.switchView('ai');
            await loadAiConversations();
            openAiConversation(convId, "Solo Learn");
        } else {
            showToast("Solo Learn session created!", "success");
            await loadAiConversations();
        }
    } catch (e) {
        console.error("Failed to create Solo Learn session:", e);
        showToast("Failed to start Solo Learn: " + e, "error");
    }
}

// Peer Discovery: Opens contact picker for group AI chat
export async function createPeerDiscoveryChat() {
    const modal = document.getElementById('peer-discovery-modal');
    const contactsContainer = document.getElementById('peer-discovery-contacts');

    if (!modal || !contactsContainer) {
        showToast("Peer Discovery modal not found", "error");
        return;
    }

    try {
        const contacts = await invoke('get_contacts_braid');
        contactsContainer.innerHTML = '';

        if (!contacts || contacts.length === 0) {
            contactsContainer.innerHTML = `
                <p style="color: var(--text-dim); text-align: center;">
                    No contacts found.<br>
                    <button class="accent-btn small" style="margin-top: 12px;" onclick="window.showFriendOverlay()">
                        Add Friends First
                    </button>
                </p>`;
        } else {
            contacts.forEach(contact => {
                const item = document.createElement('label');
                item.className = 'contact-checkbox-item';
                item.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; cursor: pointer; margin-bottom: 4px;';
                item.innerHTML = `
                    <input type="checkbox" value="${contact.email}" style="width: 18px; height: 18px;" />
                    <span style="flex: 1;">${contact.username || contact.email}</span>
                `;
                item.addEventListener('mouseenter', () => item.style.background = 'var(--glass)');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                contactsContainer.appendChild(item);
            });
        }

        modal.style.display = 'flex';
    } catch (e) {
        console.error("Failed to load contacts:", e);
        showToast("Failed to load contacts: " + e, "error");
    }
}

// Start Peer Discovery session with selected contacts
async function startPeerDiscoverySession() {
    const contactsContainer = document.getElementById('peer-discovery-contacts');
    const checked = contactsContainer.querySelectorAll('input:checked');
    const emails = Array.from(checked).map(cb => cb.value);

    if (emails.length === 0) {
        showToast("Please select at least one friend", "error");
        return;
    }

    try {
        const res = await invoke('create_ai_chat_braid', {
            name: `Peer Discovery - ${emails.length} friend${emails.length > 1 ? 's' : ''}`,
            sender: window.currentUser?.email || "current_user",
            participant_emails: emails
        });

        const convId = res.conversation?.id || res.id;
        if (convId) {
            document.getElementById('peer-discovery-modal').style.display = 'none';
            showToast("Peer Discovery session created!", "success");
            if (window.switchView) window.switchView('ai');
            await loadAiConversations();
            openAiConversation(convId, `Peer Discovery`);
        } else {
            document.getElementById('peer-discovery-modal').style.display = 'none';
            showToast("Peer Discovery created!", "success");
            await loadAiConversations();
        }
    } catch (e) {
        console.error("Failed to create Peer Discovery:", e);
        showToast("Failed to create Peer Discovery: " + e, "error");
    }
}
