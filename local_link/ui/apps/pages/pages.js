import { simpleton_client } from '../../lib/simpleton-client.js';

export function initPages() {
    console.log("Initializing Pages Module...");
    
    const connectBtn = document.getElementById('pages-connect-btn');
    const urlInput = document.getElementById('pages-url-input');
    const urlForm = document.getElementById('pages-url-form');
    const textarea = document.getElementById('pages-textarea');
    const preview = document.getElementById('pages-preview');
    const status = document.getElementById('pages-status');

    let client = null;
    let currentUrl = '';

    // Markdown Renderer setup
    const renderMarkdown = (text) => {
        if (!window.marked) return text;
        const renderer = new window.marked.Renderer();
        const originalImage = renderer.image;

        renderer.image = (href, title, text) => {
            if (href && href.startsWith('/') && currentUrl) {
                try {
                    const origin = new URL(currentUrl).origin;
                    href = `${origin}${href}`;
                } catch (e) { }
            }
            return originalImage.call(renderer, href, title, text);
        };
        
        preview.innerHTML = window.marked.parse(text, { renderer });
    };

    const connect = async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        if (client) {
            await client.stop();
            client = null;
        }

        currentUrl = url;
        status.textContent = "Connecting...";
        status.className = "status-text";
        textarea.disabled = true;
        textarea.value = "Loading...";

        try {
            client = simpleton_client(url, {
                apply_remote_update: (update) => {
                    // Simpleton client handles patches internaly if we return string
                    // But here we want the resulting state
                    return update.state;
                },
                on_state: (state) => {
                    if (textarea.value !== state) {
                       textarea.value = state;
                    }
                    renderMarkdown(state);
                    status.textContent = "Connected";
                    status.className = "status-text connected";
                    textarea.disabled = false;
                },
                get_state: () => textarea.value,
                on_error: (err) => {
                    console.error("Braid Error:", err);
                    status.textContent = "Error";
                    status.className = "status-text error";
                }
            });

            // Handle local edits
            textarea.oninput = () => {
                client.changed();
                renderMarkdown(textarea.value);
            };

        } catch (e) {
            console.error("Connection failed:", e);
            status.textContent = "Failed";
            status.className = "status-text error";
            textarea.value = "Connection failed.";
        }
    };

    if (connectBtn) connectBtn.addEventListener('click', (e) => {
        e.preventDefault();
        connect();
    });

    if (urlForm) urlForm.addEventListener('submit', (e) => {
        e.preventDefault();
        connect();
    });

    // Auto-connect if URL is present (optional)
    if (urlInput.value) connect();
}
