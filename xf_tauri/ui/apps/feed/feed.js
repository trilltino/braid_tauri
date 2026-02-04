import { showToast, invoke, listen } from '../shared/utils.js';

let currentPosts = [];
let isSubscribed = false;

export function initFeed() {
    // Listen for real-time mail updates from BraidMailManager
    if (listen) {
        listen('mail-update', (event) => {
            console.log('Mail update received:', event.payload);
            if (isSubscribed) {
                loadMailFeed();
            }
        });
    }

    // Setup subscribe buttons
    const subscribeBtn = document.getElementById('mail-subscribe-btn');
    const rightSubscribeBtn = document.getElementById('right-subscribe-btn');
    
    const handleSubscribe = async () => {
        const btn = subscribeBtn || rightSubscribeBtn;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Subscribing...';
        }
        
        try {
            await invoke('subscribe_braid_mail');
            isSubscribed = true;
            showToast('Subscribed to Braid Mail!', 'success');
            showFeedUI();
            loadMailFeed();
        } catch (err) {
            console.error('Subscribe failed:', err);
            showToast('Subscribe failed: ' + err, 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Subscribe';
            }
        }
    };

    if (subscribeBtn) subscribeBtn.addEventListener('click', handleSubscribe);
    if (rightSubscribeBtn) rightSubscribeBtn.addEventListener('click', handleSubscribe);

    // Compose buttons
    const composeBtn = document.getElementById('mail-compose-btn');
    const sidebarComposeBtn = document.getElementById('sidebar-compose-btn');
    const emptyComposeBtn = document.getElementById('empty-compose-btn');
    const closeComposeBtn = document.getElementById('compose-close-btn');
    const composeOverlay = document.getElementById('compose-overlay');

    const openCompose = () => {
        if (composeOverlay) composeOverlay.style.display = 'flex';
    };

    if (composeBtn) composeBtn.addEventListener('click', openCompose);
    if (sidebarComposeBtn) sidebarComposeBtn.addEventListener('click', openCompose);
    if (emptyComposeBtn) emptyComposeBtn.addEventListener('click', openCompose);

    if (closeComposeBtn && composeOverlay) {
        closeComposeBtn.addEventListener('click', () => {
            composeOverlay.style.display = 'none';
        });
    }

    if (composeOverlay) {
        composeOverlay.addEventListener('click', (e) => {
            if (e.target === composeOverlay) composeOverlay.style.display = 'none';
        });
    }

    const sendBtn = document.getElementById('mail-send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendBraidMail);
    }

    // Refresh button (only works when subscribed)
    const refreshBtn = document.getElementById('mail-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (isSubscribed) {
                loadMailFeed();
            } else {
                showToast('Please subscribe first', 'info');
            }
        });
    }

    // Check subscription status on init
    checkSubscriptionStatus();
}

async function checkSubscriptionStatus() {
    try {
        isSubscribed = await invoke('is_braid_mail_subscribed');
        if (isSubscribed) {
            showFeedUI();
            loadMailFeed();
        } else {
            showSubscribeUI();
        }
    } catch (err) {
        console.error('Failed to check subscription status:', err);
        showSubscribeUI();
    }
}

function showSubscribeUI() {
    const subscribePrompt = document.getElementById('mail-subscribe-prompt');
    const feedContent = document.getElementById('mail-feed-content');
    const rightSubscribeSection = document.getElementById('mail-right-subscribe-section');
    const rightSelectSection = document.getElementById('mail-right-select-msg-section');

    if (subscribePrompt) subscribePrompt.style.display = 'flex';
    if (feedContent) feedContent.style.display = 'none';
    if (rightSubscribeSection) rightSubscribeSection.style.display = 'block';
    if (rightSelectSection) rightSelectSection.style.display = 'none';
}

function showFeedUI() {
    const subscribePrompt = document.getElementById('mail-subscribe-prompt');
    const feedContent = document.getElementById('mail-feed-content');
    const rightSubscribeSection = document.getElementById('mail-right-subscribe-section');
    const rightSelectSection = document.getElementById('mail-right-select-msg-section');

    if (subscribePrompt) subscribePrompt.style.display = 'none';
    if (feedContent) feedContent.style.display = 'block';
    if (rightSubscribeSection) rightSubscribeSection.style.display = 'none';
    if (rightSelectSection) rightSelectSection.style.display = 'block';
}

export async function loadMailFeed() {
    if (!isSubscribed) {
        console.log('Not subscribed, skipping feed load');
        return;
    }

    console.log("Fetching Mail Feed...");
    const feedContent = document.getElementById('mail-feed-content');
    if (feedContent) {
        feedContent.innerHTML = '<div class="loading-state">Refreshing feed...</div>';
    }

    try {
        const [localPosts, networkPosts] = await Promise.all([
            invoke('get_mail_feed').catch(e => { console.error("Local feed error:", e); return []; }),
            invoke('get_mail_feed_braid').catch(e => { console.warn("Network feed error:", e); return []; })
        ]);

        const postMap = new Map();
        localPosts.forEach(p => {
            const url = p.url || `local-${p.timestamp}`;
            postMap.set(url, { ...p, url, is_network: false });
        });

        networkPosts.forEach(p => {
            const url = p.id || p.link || p.url;
            if (!url) return;
            postMap.set(url, { ...p, url, is_network: true });
        });

        let allPosts = Array.from(postMap.values());
        allPosts.sort((a, b) => (b.date || 0) - (a.date || 0));

        if (!allPosts.some(p => p.date)) allPosts.reverse();

        renderMailFeed(allPosts);
    } catch (e) {
        console.error("Failed to load mail feed:", e);
        if (feedContent) {
            feedContent.innerHTML = `<div class="error-state">Failed to load feed: ${e}</div>`;
        }
    }
}

function renderMailFeed(posts) {
    currentPosts = posts;
    const feedContent = document.getElementById('mail-feed-content');
    if (!feedContent) return;

    feedContent.innerHTML = '';
    if (!posts || posts.length === 0) {
        feedContent.innerHTML = '<div class="empty-state">No messages yet</div>';
        return;
    }

    posts.forEach((post, index) => {
        const item = document.createElement('div');
        item.className = 'feed-card mail-item';
        const from = Array.isArray(post.from) ? post.from[0] : (post.from || 'Unknown');
        const subject = post.subject || '(No Subject)';
        const date = post.date ? new Date(post.date).toLocaleDateString() : '';
        const origin = post.url && post.url.includes('braid.org') ? 'Braid Network' : 'Local Node';

        item.innerHTML = `
            <div class="feed-card-header">
                <div class="feed-origin">${origin}</div>
                <span class="mail-date">${date}</span>
            </div>
            <div class="feed-card-title">${subject}</div>
            <div class="feed-card-footer">
                <div class="feed-author">
                    <div class="profile-icon">
                        <img src="https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(from)}">
                    </div>
                    <span>${from}</span>
                </div>
            </div>
        `;
        item.addEventListener('click', () => selectMailItem(index, item));
        feedContent.appendChild(item);
    });

    if (posts.length > 0) selectMailItem(0, feedContent.querySelector('.mail-item'));
}

export function selectMailItem(index, itemElement) {
    if (window.switchView) window.switchView('mail');
    document.querySelectorAll('#mail-feed-content .mail-item').forEach(el => el.classList.remove('active'));
    itemElement.classList.add('active');

    const post = currentPosts[index];
    if (!post) return;

    document.getElementById('mail-empty-selection').style.display = 'none';
    const contentDisplay = document.getElementById('mail-content-display');
    contentDisplay.style.display = 'flex';

    const from = Array.isArray(post.from) ? post.from[0] : (post.from || 'Unknown');
    document.getElementById('detail-subject').textContent = post.subject || '(No Subject)';
    document.getElementById('detail-sender').textContent = from;
    document.getElementById('detail-date').textContent = post.date ? new Date(post.date).toLocaleString() : 'Unknown Date';

    const bodyEl = document.getElementById('detail-body');
    const body = post.body || '';
    bodyEl.innerHTML = body.trim().startsWith('<') ? body : body.replace(/\n/g, '<br>');

    const avatarEl = document.getElementById('detail-avatar');
    if (avatarEl) {
        avatarEl.innerHTML = `<img src="https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(from)}" alt="${from}">`;
    }
}

export async function sendBraidMail() {
    const subjectEl = document.getElementById('mail-subject');
    const bodyEl = document.getElementById('mail-body');
    const subject = subjectEl?.value;
    const body = bodyEl?.value;

    if (!subject || !body) {
        showToast("Please fill in both subject and body", "error");
        return;
    }

    const sendBtn = document.getElementById('mail-send-btn');
    sendBtn.disabled = true;
    const originalText = sendBtn.textContent;
    sendBtn.textContent = "Sending...";

    try {
        await invoke('send_mail', { subject, body });
        showToast("Message sent successfully!", "success");
        subjectEl.value = '';
        bodyEl.value = '';
        document.getElementById('compose-overlay').style.display = 'none';
        setTimeout(loadMailFeed, 1000);
    } catch (err) {
        showToast("Send failed: " + err, "error");
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
    }
}
