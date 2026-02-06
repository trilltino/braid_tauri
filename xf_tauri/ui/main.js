import { showToast, invoke, listen, setActiveNav } from './apps/shared/utils.js';
import { setupQuill, setupExplorerResizer } from './apps/explorer/editor.js';
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
            const section = btn.getAttribute('data-section');
            window.switchView(viewName, section);
            setActiveNav(btn);
        });
    });

    // Initialize Modules
    initAuth(onLoginSuccess);
    initFeed();
    initExplorer();
    initChat();
    initAi();
    setupExplorerResizer();

    // Global UI Logic
    setupAddFriendOverlay();

    // Global Save Helper
    window.debounceSave = () => {
        if (window.saveTimeout) clearTimeout(window.saveTimeout);
        window.saveTimeout = setTimeout(() => saveExplorerFile(true), 2000);
    };

    setupRealtimeListeners();
}

function setupAddFriendOverlay() {
    const friendOverlay = document.getElementById('friend-overlay');
    const friendEmail = document.getElementById('friend-email');
    const friendMessage = document.getElementById('friend-message');
    const sendBtn = document.getElementById('friend-send-btn');
    const closeBtn = document.getElementById('friend-close-btn');

    window.showFriendOverlay = () => {
        if (friendOverlay) {
            friendOverlay.style.display = 'flex';
            if (friendEmail) friendEmail.focus();
        }
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (friendOverlay) friendOverlay.style.display = 'none';
        });
    }

    if (friendOverlay) {
        friendOverlay.addEventListener('click', (e) => {
            if (e.target === friendOverlay) friendOverlay.style.display = 'none';
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
            const email = friendEmail?.value?.trim();
            const msg = friendMessage?.value?.trim();

            if (!email) {
                showToast("Please enter an email address", "error");
                return;
            }

            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending...';

            try {
                // Tauri Rust standard uses snake_case for to_email
                // But JS invoke converts to camelCase by default to map to Rust.
                // However, we've seen snake_case works in other commands here.
                // We'll use to_email to match chat.js pattern.
                await invoke('send_friend_request_braid', { to_email: email, message: msg || null });
                showToast("Friend request sent!", "success");
                if (friendOverlay) friendOverlay.style.display = 'none';
                if (friendEmail) friendEmail.value = '';
                if (friendMessage) friendMessage.value = '';
            } catch (err) {
                showToast("Failed to send request: " + err, "error");
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = 'Send Request';
            }
        });
    }

    // Global Triggers
    const profileBtn = document.getElementById('btn-profile');
    if (profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.showFriendOverlay();
        });
    }

    // Header Trigger
    const headerAddBtn = document.getElementById('add-contact-header-btn');
    if (headerAddBtn) {
        headerAddBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.showFriendOverlay();
        });
    }
}

function onLoginSuccess(user) {
    document.getElementById("auth-container").classList.add('fade-out');
    setTimeout(() => {
        document.getElementById("auth-container").style.display = "none";
        document.querySelector(".app-container").style.display = "flex";
        window.switchView('mail');
        setActiveNav(document.getElementById('btn-mail'));

        loadConversations();
        loadAiConversations();
        loadMailFeed();
        loadContacts();
        loadPendingRequests();
    }, 600);
}

window.switchView = function (viewName, section = null) {
    console.log("Switching to:", viewName, "section:", section);
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

        // Load Explorer tree when switching to explorer view
        if (viewName === 'explorer') {
            // Update the explorer title based on section
            const titleEl = document.querySelector('#explorer-sidebar h1');
            if (titleEl) {
                if (section === 'local') {
                    titleEl.textContent = 'LinkedLocal';
                } else {
                    titleEl.textContent = 'Braid Explorer';
                }
            }
            window.currentExplorerSection = section;
            import('./apps/explorer/explorer.js').then(mod => {
                if (mod.loadExplorerTree) mod.loadExplorerTree('explorer-tree', section);
            }).catch(e => console.error("Failed to load explorer:", e));
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
