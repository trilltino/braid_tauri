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
        // Prompt for optional authentication cookie
        const cookie = prompt(
            'Enter your Braid authentication cookie (optional):\n\n' +
            'This allows you to post messages with your identity.\n' +
            'Leave blank to browse anonymously.',
            ''
        );

        // If user cancelled the prompt, abort
        if (cookie === null) {
            return;
        }

        const btn = subscribeBtn || rightSubscribeBtn;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Subscribing...';
            // Optimistically hide the section if it's the right one, to remove the "grey box"
            if (btn === rightSubscribeBtn) {
                btn.style.opacity = '0.5';
            }
        }

        try {
            // Set authentication if cookie provided
            if (cookie && cookie.trim()) {
                await invoke('set_mail_auth', { cookie: cookie.trim() });
            }

            await invoke('subscribe_braid_mail');
            isSubscribed = true;
            showToast('Subscribed! Fetching messages...', 'success');

            // Force UI update immediately
            showFeedUI();

            // Add a small delay to allow backend to switch contexts if needed, then load
            setTimeout(loadMailFeed, 500);

        } catch (err) {
            console.error('Subscribe failed:', err);
            showToast('Subscribe failed: ' + err, 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Access mail';
                btn.style.opacity = '1';
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
    const mailSidebar = document.getElementById('mail-sidebar');

    if (subscribePrompt) subscribePrompt.style.display = 'none';
    if (feedContent) feedContent.style.display = 'block';
    if (rightSubscribeSection) rightSubscribeSection.style.display = 'none';
    if (rightSelectSection) rightSelectSection.style.display = 'block';
    if (mailSidebar) mailSidebar.style.display = 'flex';
}

export async function loadMailFeed() {
    if (!isSubscribed) {
        console.log('Not subscribed, skipping feed load');
        return;
    }

    console.log("Fetching Mail Feed...");
    localStorage.removeItem('braid_feed_cache'); // FORCE CLEAR CACHE
    const feedContent = document.getElementById('mail-feed-content');
    if (feedContent) {
        feedContent.innerHTML = '<div class="loading-state">Refreshing feed...</div>';
    }

    try {

        // We only need one fetch now as both commands route to the local hydrated server
        const posts = await invoke('get_mail_feed').catch(e => { console.error("Feed error:", e); return []; });

        if (posts.length === 0 && isSubscribed) {
            // If empty but subscribed, it might be syncing. Retry aggressively.
            if (!window.feedRetryCount) window.feedRetryCount = 0;

            if (window.feedRetryCount < 5) {
                window.feedRetryCount++;
                const delay = window.feedRetryCount * 500; // 500ms, 1000ms, 1500ms...
                console.log(`Feed empty, retrying in ${delay}ms (Attempt ${window.feedRetryCount}/5)`);

                if (feedContent) {
                    feedContent.innerHTML = `<div class="loading-state">Syncing messages... (${window.feedRetryCount}/5)</div>`;
                }

                setTimeout(loadMailFeed, delay);
                return; // Stop processing this empty attempt
            }
        }
        // Reset retry count on success or give up
        window.feedRetryCount = 0;

        const postMap = new Map();

        // 1. Load from Cache first
        const cached = localStorage.getItem('braid_feed_cache');
        if (cached) {
            try {
                const cachedPosts = JSON.parse(cached);
                cachedPosts.forEach(p => postMap.set(p.url, p));
            } catch (e) { console.error("Cache parse error", e); }
        }

        // 2. Merge fresh posts
        posts.forEach(p => {
            if (!p) return;
            // Handle different API formats (Braid Mail vs Generic Feed)
            const id = p.id || p.link || p.url;
            if (!id) return;

            const normalized = {
                ...p,  // Spread first so our normalized values override
                url: id,
                is_network: true,
                subject: p.subject || p.title || '(No Subject)',
                from: p.from || p.author || p.sender || 'Anonymous',
                date: p.date || p.published || p.created_at || new Date().toISOString(),
                body: p.body || p.content || p.summary || ''
            };

            // Fix: Ensure 'from' is a string
            // Per braidmail spec: from/to are ALWAYS arrays, defaults are ['anonymous'] and ['public']
            if (Array.isArray(normalized.from)) {
                normalized.from = normalized.from.length > 0 && normalized.from[0] !== 'anonymous'
                    ? normalized.from[0]
                    : 'Anonymous';
            } else if (typeof normalized.from === 'object' && normalized.from !== null) {
                normalized.from = normalized.from.name || 'Anonymous';
            } else if (!normalized.from || normalized.from === 'anonymous') {
                normalized.from = 'Anonymous';
            }

            // Similarly normalize 'to' field
            if (Array.isArray(normalized.to)) {
                normalized.to = normalized.to.length > 0 && normalized.to[0] !== 'public'
                    ? normalized.to.join(', ')
                    : 'Public';
            }

            postMap.set(id, normalized);
        });

        let allPosts = Array.from(postMap.values());

        // Filter out "junk" posts?
        // UPDATE: User wants to see ALL posts found in the index, even if hydration failed.
        // So we relax this filter to show everything that has a valid URL/ID.
        allPosts = allPosts.filter(p => !!p.url);

        allPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        // Save to cache
        localStorage.setItem('braid_feed_cache', JSON.stringify(allPosts.slice(0, 5000))); // Cache top 5000

        renderMailFeed(allPosts);
    } catch (e) {
        console.error("Failed to load mail feed:", e);
        // Try to load from cache if fetch fails
        const cached = localStorage.getItem('braid_feed_cache');
        if (cached) {
            renderMailFeed(JSON.parse(cached));
            showToast("Loaded from cache (Offline)", "info");
        } else if (feedContent) {
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

        // Double-check defaults during render
        // Use shared safe extraction
        const from = getSafeFrom(post);

        const subject = post.subject || (post.url ? `Post ${post.url.split('/').pop()}` : '(No Subject)');

        item.style.animationDelay = `${index * 0.05}s`;
        item.innerHTML = `
            <div class="feed-card-title">${subject}</div>
            <div class="feed-card-footer">
                <div class="feed-author">
                    <div class="profile-icon">
                        <img src="/img/toom-headup.jpg" alt="${from}">
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

// Helper for robust sender extraction
function getSafeFrom(post) {
    let from = post.from || 'Anonymous';
    if (Array.isArray(from)) from = from.length > 0 ? from[0] : 'Anonymous';
    if (typeof from === 'object' && from !== null) from = from.name || 'Anonymous';
    return from;
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

    // Use safe extraction
    const from = getSafeFrom(post);

    document.getElementById('detail-subject').textContent = post.subject || '(No Subject)';
    document.getElementById('detail-sender').textContent = from;
    document.getElementById('detail-date').textContent = post.date ? new Date(post.date).toLocaleString() : 'Unknown Date';

    const bodyEl = document.getElementById('detail-body');
    const body = post.body || '';
    // Simple improved display for mixed content
    bodyEl.innerHTML = body.trim().startsWith('<') ? body : body.replace(/\n/g, '<br>');

    const avatarEl = document.getElementById('detail-avatar');
    if (avatarEl) {
        avatarEl.innerHTML = `<img src="/img/toom-headup.jpg" alt="${from}">`;
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
        await invoke('send_mail', {
            subject,
            body,
            from: window.currentUser?.email || 'anonymous',
            to: ['public']
        });
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
