import { showToast, invoke, listen, setActiveNav } from './apps/shared/utils.js';
import { setupQuill, setupResizer } from './apps/explorer/editor.js';
import { initAuth } from './apps/auth/auth.js';
import { initFeed, loadMailFeed } from './apps/feed/feed.js';
import { initExplorer, loadExplorerTree, handleFileClick, saveExplorerFile } from './apps/explorer/explorer.js';
import { initChat, loadConversations, loadContacts, loadPendingRequests, renderMessage, openConversation } from './apps/chat/chat.js';
import { initAi, loadAiConversations } from './apps/ai/ai.js';

// --- Global State & Initialization ---
window.views = {};
window.currentUser = null;
window.activeNode = null;
window.currentConversationId = null;
window.activeChatView = 'chat';

function setupApp() {
    console.log("Initializing XFMail Modular Frontend...");

    // Initialize View Cache
    window.views = {
        mail: document.getElementById('mail-view'),
        chat: document.getElementById('chat-view'),
        ai: document.getElementById('ai-view'),
        explorer: document.getElementById('explorer-view')
    };

    // Nav Bindings
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.getAttribute('data-view');
            window.switchView(viewName);
            setActiveNav(btn);
        });
    });

    // Initialize Modules
    initAuth(onLoginSuccess);
    initFeed();
    initExplorer();
    initChat();
    initAi();
    setupResizer();

    // Global Save Helper
    window.debounceSave = () => {
        if (window.saveTimeout) clearTimeout(window.saveTimeout);
        window.saveTimeout = setTimeout(() => saveExplorerFile(true), 2000);
    };

    setupRealtimeListeners();
}

function onLoginSuccess(user) {
    document.getElementById("auth-container").classList.add('fade-out');
    setTimeout(() => {
        document.getElementById("auth-container").style.display = "none";
        document.querySelector(".app-container").style.display = "flex";
        window.switchView('chat');
        setActiveNav(document.getElementById('btn-chat'));

        loadConversations();
        loadAiConversations();
        loadMailFeed();
        loadContacts();
        loadPendingRequests();
    }, 600);
}

window.switchView = function (viewName) {
    console.log("Switching to:", viewName);
    Object.values(window.views).forEach(v => { if (v) v.style.display = 'none'; });
    if (window.views[viewName]) {
        window.views[viewName].style.display = 'flex';

        // Context-aware cleanup/loading
        if (viewName !== 'mail') {
            const mailDisp = document.getElementById('mail-content-display');
            if (mailDisp) mailDisp.style.display = 'none';
        }

        if (viewName === 'chat' || viewName === 'ai') {
            loadConversations();
            loadAiConversations();
        }
    }
};

function setupRealtimeListeners() {
    if (!listen) return;

    listen('realtime-event', (event) => {
        const { event_type, payload } = event.payload;
        console.log(`[Realtime] ${event_type}:`, payload);

        switch (event_type) {
            case 'message':
                if (window.currentConversationId === payload.conversation_id) {
                    if (payload.sender !== window.currentUser?.email) renderMessage(payload);
                } else {
                    showToast(`New message from ${payload.sender}`, "info");
                }
                break;
            case 'friend_requested':
                loadPendingRequests();
                showToast("New friend request!", "info");
                break;
            case 'friend_accepted':
                loadContacts();
                showToast("Request accepted!", "success");
                break;
        }
    });

    listen('fs-update', async (event) => {
        const changedPath = event.payload;
        if (window.activeNode && (window.activeNode.relative_path === changedPath || window.activeNode.relative_path.endsWith(changedPath))) {
            console.log("Active file updated on disk. Fetching...");
            try {
                const content = await invoke('read_sync_editor_file', { path: window.activeNode.relative_path });
                if (window.quill && content !== window.quill.getText()) {
                    const range = window.quill.getSelection();
                    if (window.activeNode.name.endsWith('.html')) window.quill.clipboard.dangerouslyPasteHTML(content);
                    else window.quill.setText(content);
                    if (range) window.quill.setSelection(range);
                }
            } catch (e) { console.error("FS update reload failed:", e); }
        }
    });
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupApp);
} else {
    setupApp();
}
