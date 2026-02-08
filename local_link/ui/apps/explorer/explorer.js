import { showToast, invoke } from '../shared/utils.js';
import { setupQuill, setupExplorerResizer } from './editor.js';
import { simpleton_client } from '../../lib/simpleton-client.js';


export function initExplorer() {
    // Setup Quill editor immediately so it's ready when files are clicked
    setupQuill(() => {
        // Auto-save on text change
        if (window.saveTimeout) clearTimeout(window.saveTimeout);
        window.saveTimeout = setTimeout(() => saveExplorerFile(true), 2000);
    });

    const editBtn = document.getElementById('explorer-edit-btn');
    if (editBtn) editBtn.addEventListener('click', enableExplorerEdit);

    const refreshBtn = document.getElementById('explorer-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        loadExplorerTree('explorer-tree', window.currentExplorerSection);
    });

    const newBtn = document.getElementById('explorer-new-btn');
    if (newBtn) newBtn.addEventListener('click', createLocalPage);

    // Setup resizer and toggle
    setupExplorerResizer();

    // URL Explorer Bindings
    const goBtn = document.getElementById('braid-url-go');
    const urlInput = document.getElementById('braid-url-bar');

    if (goBtn) goBtn.addEventListener('click', openBraidUrl);
    if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') openBraidUrl();
        });
    }
}

export async function loadExplorerTree(containerId = 'explorer-tree', section = null) {
    console.log(`Loading Explorer Tree into ${containerId} (Section: ${section})...`);
    const treeContainer = document.getElementById(containerId);

    try {
        const nodes = await invoke('get_braid_explorer_tree', { section: section });
        console.log("Explorer nodes received:", nodes);
        renderExplorerTree(nodes || [], treeContainer, 0, section);
    } catch (e) {
        console.error("Failed to load explorer tree:", e);
        if (treeContainer) treeContainer.innerHTML = `<div class="error-state">Sync Error: ${e}</div>`;
    }
}

export function renderExplorerTree(nodes, container, level = 0, section = null) {
    if (!container) return;
    if (level === 0) container.innerHTML = '';

    if (!nodes || nodes.length === 0) {
        if (level === 0) {
            let emptyHtml = `
                <div class="empty-state-mini" style="padding: 24px; text-align: center;">
                    <p style="margin-bottom: 12px;">No files found.</p>
                    <button class="accent-btn small" onclick="window.loadExplorerTree('${container.id}', '${section || ''}')">Reload</button>
                </div>`;

            if (section === 'braid.org') {
                emptyHtml = `
                <div class="empty-state-mini" style="padding: 24px; text-align: center;">
                    <p style="margin-bottom: 12px;">Braid Wiki not found locally.</p>
                    <button class="accent-btn small" id="download-wiki-btn-${container.id}">Download Braid Wiki</button>
                </div>`;
            } else if (section === 'local') {
                emptyHtml = `
                <div class="empty-state-mini" style="padding: 24px; text-align: center;">
                    <p style="margin-bottom: 12px;">Local files empty.</p>
                    <p style="font-size: 11px; opacity: 0.6;">Create files to see them here.</p>
                </div>`;
            }

            container.innerHTML = emptyHtml;

            // Bind download button if present
            const downloadBtn = document.getElementById(`download-wiki-btn-${container.id}`);
            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    console.log("[Explorer] Download Wiki button clicked");
                    downloadBtn.disabled = true;
                    downloadBtn.textContent = "Downloading...";
                    try {
                        console.log("[Explorer] Invoking download_default_wiki...");
                        await invoke('download_default_wiki');
                        console.log("[Explorer] Download command matched. Reloading tree...");
                        showToast("Wiki downloaded!", "success");
                        loadExplorerTree(container.id, section);
                    } catch (e) {
                        showToast("Download failed: " + e, "error");
                        downloadBtn.disabled = false;
                        downloadBtn.textContent = "Try Again";
                    }
                });
            }
        }
        return;
    }

    const ul = document.createElement('ul');
    ul.className = 'tree-list';

    nodes.forEach(node => {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.style.display = 'block';

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.style.paddingLeft = `${12 + level * 16}px`;

        const chevron = node.is_dir ? '<span class="tree-chevron">▸</span>' : '<span class="tree-chevron-spacer"></span>';
        const icon = node.is_dir
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';

        row.innerHTML = `${chevron} <span class="tree-icon">${icon}</span> <span class="tree-name" title="${node.name}">${node.name}</span>`;

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (node.is_dir) {
                const expanded = li.classList.toggle('expanded');
                const chevronEl = row.querySelector('.tree-chevron');
                if (chevronEl) chevronEl.textContent = expanded ? '▾' : '▸';
            } else {
                document.querySelectorAll('.tree-row').forEach(el => el.classList.remove('active'));
                row.classList.add('active');
                handleFileClick(node);
            }
        });

        li.appendChild(row);
        if (node.is_dir && node.children && node.children.length > 0) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            renderExplorerTree(node.children, childContainer, level + 1, section);
            li.appendChild(childContainer);
        }
        ul.appendChild(li);
    });
    container.appendChild(ul);
}

export async function openBraidUrl() {
    const input = document.getElementById('braid-url-bar');
    const url = input?.value?.trim();
    if (!url) {
        showToast("Please enter a URL", "error");
        return;
    }

    // Block absolute local paths like C:\ or \\network
    if (url.match(/^[a-zA-Z]:/) || url.startsWith('\\\\') || url.startsWith('/')) {
        showToast("Local paths cannot be opened as Braid URLs.", "error");
        return;
    }

    const btn = document.getElementById('braid-url-go');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    // Check if this is a local.org URL
    const localOrgMatch = url.match(/^(?:https?:\/\/)?local\.org\/(.+)/i);
    if (localOrgMatch) {
        const pageName = localOrgMatch[1].replace(/\.md$/i, ''); // Strip .md if provided
        const relativePath = `local.org/${pageName}.md`;

        // Create a synthetic FileNode for the local file
        const node = {
            name: `${pageName}.md`,
            is_dir: false,
            is_network: false,
            relative_path: relativePath,
            full_path: '', // Will be resolved by backend
            children: []
        };

        showToast(`Opening local page: ${pageName}`, "info");

        try {
            await handleFileClick(node);
            // Refresh tree to show the file in the sidebar
            await loadExplorerTree('explorer-tree', 'local');
        } catch (e) {
            showToast("Failed to open local page: " + e, "error");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '→'; }
        }
        return;
    }

    // Handle remote Braid URLs (original logic)
    let finalUrl = url.startsWith('http') ? url : 'https://' + url;

    const domain = new URL(finalUrl).hostname;
    const cookie = prompt(`Enter Access Token/Cookie for ${domain}`);

    if (cookie) {
        try {
            await invoke('set_sync_editor_cookie', { domain, value: cookie });
        } catch (e) { console.warn("Cookie set failed:", e); }
    }

    showToast(`Syncing ${finalUrl}...`, "info");

    try {
        await invoke('add_braid_sync_subscription', { url: finalUrl });
        await loadExplorerTree();
        showToast("Synced!", "success");
    } catch (e) {
        showToast("Failed to sync: " + e, "error");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '→'; }
    }
}

export async function handleFileClick(node) {
    console.log("File Clicked:", node.name);
    window.activeNode = node;

    // Show editor, hide empty state
    const infoView = document.getElementById('explorer-info');
    const editorView = document.getElementById('explorer-editor-container');
    const headerActions = document.getElementById('explorer-header-actions');

    if (infoView) infoView.style.display = 'none';
    if (editorView) editorView.style.display = 'flex';
    if (headerActions) headerActions.style.display = 'flex';

    const urlBar = document.getElementById('explorer-url');
    if (urlBar) urlBar.value = node.relative_path;

    // Ensure Quill is initialized
    let quill = window.quill;
    const isAi = window.activeChatView === 'ai';
    const editorSelector = isAi ? '#ai-quill-container' : '#quill-editor-container';

    if (window.quillInstances && window.quillInstances[editorSelector]) {
        quill = window.quillInstances[editorSelector];
    }

    if (!quill) {
        console.log("Re-initializing Quill...");
        setupQuill(() => saveExplorerFile(true), editorSelector);
        quill = window.quillInstances[editorSelector];
    }

    // Update global active quill for saveExplorerFile to use
    window.activeQuill = quill;

    const isNetwork = node.is_network;
    const isLocalOrg = node.relative_path.startsWith('local.org/');
    const domain = isNetwork && node.relative_path.includes("braid.org") ? "braid.org" : "unknown";

    // Stop previous Braid client if any
    if (window.activeBraidClient) {
        console.log("Stopping previous Braid client");
        window.activeBraidClient.stop();
        window.activeBraidClient = null;
    }

    const loadContent = async (isManualReload = false, retryCount = 0) => {
        if (isLocalOrg) {
            setupLocalOrgSync(node, quill);
            return;
        }

        try {
            let content, versionId;
            if (isNetwork) {
                const normalizedPath = node.relative_path.replace(/\\/g, '/');
                const url = normalizedPath.startsWith('http') ? normalizedPath : `https://${normalizedPath}`;

                // Attempt load
                const page = await invoke('get_sync_editor_page', { url });
                content = page.content;
                versionId = page.version;

                if (content && isManualReload) {
                    await invoke('write_explorer_file', { relativePath: node.relative_path, content });
                    showToast(`Updated local file with Braid version`, "success");
                }
            } else {
                content = await invoke('read_explorer_file', { relativePath: node.relative_path });
            }

            if (quill) {
                console.log(`[Explorer] Loading content for ${node.name} (${content ? content.length : 0} bytes)`);
                // Basic Image Detection (very naive, assumes text content is not binary garbage)
                if (node.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                    quill.setText(`[Image File: ${node.name}]\n(Binary rendering not yet supported via text editor)`);
                    // TODO: Base64 fetch
                } else {
                    // Reset first to ensure clean state
                    quill.setText('');

                    if (node.name.endsWith('.md')) {
                        // Ensure we pass a string
                        quill.setText(content || '');
                    }
                    else if (node.name.endsWith('.html')) {
                        quill.clipboard.dangerouslyPasteHTML(content || '');
                    }
                    else {
                        quill.setText(content || '');
                    }
                }
            }

            const syncStatus = document.getElementById("explorer-sync-status");
            if (syncStatus) {
                if (versionId) syncStatus.innerHTML = `<span style="color:#a855f7">Ver: ${versionId}</span>`;
                else syncStatus.textContent = isNetwork ? "Network Resource" : "Local File";
            }

            // Enable editor if successful
            if (quill) {
                quill.enable(true);
                // Only focus if we didn't just type manually
                // quill.focus(); 
            }

        } catch (e) {
            console.warn("Load failed", e);
            const errStr = e.toString();

            // Smart Auth Handling: Retry ONLY ONCE
            if (isNetwork && retryCount < 1) {
                const shouldRetry = confirm(`Failed to load ${node.name}. Do you want to enter an Access Cookie?`);
                if (shouldRetry) {
                    const domain = isNetwork && node.relative_path.includes("braid.org") ? "braid.org" : "unknown";
                    const cookie = prompt(`Enter Cookie for ${domain}`);
                    if (cookie) {
                        try {
                            await invoke('set_sync_editor_cookie', { domain, value: cookie });
                            // Retry once
                            await loadContent(true, retryCount + 1);
                        } catch (cookieErr) {
                            showToast("Failed to set cookie: " + cookieErr, "error");
                        }
                    }
                } else {
                    showToast("Load aborted", "info");
                }
            } else {
                showToast("Failed to read file: " + e, "error");
                if (window.quill) window.quill.setText(`Error loading file:\n${e}`);
            }
        }
    };

    await loadContent(false);
}

export function enableExplorerEdit() {
    if (window.quill) {
        window.quill.enable(true);
        window.quill.focus();
        showToast("Editor enabled", "info");
        const btn = document.getElementById('explorer-edit-btn');
        if (btn) { btn.textContent = "Editing"; btn.disabled = true; }
    }
}

export async function saveExplorerFile(silent = false) {
    const quill = window.activeQuill || window.quill;
    if (!window.activeNode || !quill) return;

    if (window.activeBraidClient) {
        console.log("Saving via Braid Client");
        window.activeBraidClient.changed();
        if (!silent) showToast("Changes synced", "success");
        return;
    }

    try {
        const content = quill.getText();
        await invoke('write_explorer_file', {
            relativePath: window.activeNode.relative_path,
            content: content
        });
        if (!silent) showToast("File saved", "success");
    } catch (e) {
        showToast("Save failed: " + e, "error");
    }
}

function setupLocalOrgSync(node, quill) {
    const filename = node.relative_path.split('/').pop();
    const url = `http://localhost:3005/local.org/${filename}`;

    console.log(`Setting up Braid Live Sync for: ${url}`);
    showToast("Live Sync Active", "info");

    const syncStatus = document.getElementById("explorer-sync-status");
    if (syncStatus) syncStatus.innerHTML = '<span style="color:#22c55e">Live Sync Active</span>';

    window.activeBraidClient = simpleton_client(url, {
        on_state: (state) => {
            console.log("Received initial state via Braid");
            quill.setText(state || '');
            quill.enable(true);
        },
        on_patches: (patches) => {
            console.log("Received patches via Braid:", patches);
            // Apply patches to Quill
            // Note: simpleton-client gives patches in char offsets
            // Quill uses index-based delta or insert/delete
            // For simplicity, we can use the same logic as App.jsx useBraidSync

            let current = quill.getText();
            let offset = 0;
            for (let p of patches) {
                // p.range is [start, end]
                current = current.substring(0, p.range[0] + offset) + p.content +
                    current.substring(p.range[1] + offset);
                offset += p.content.length - (p.range[1] - p.range[0]);
            }
            // Retain cursor position if possible? 
            // For now, full replace if coming from remote
            quill.setText(current);
        },
        get_state: () => quill.getText(),
        on_error: (err) => {
            console.error("Braid Sync Error:", err);
            showToast("Braid Sync Error: " + err, "error");
            if (syncStatus) syncStatus.innerHTML = '<span style="color:#ef4444">Sync Error</span>';
        }
    });
}


export async function createLocalPage() {
    let name = prompt("Enter new page name (e.g. MyPage):");
    if (!name) return;

    // Ensure .md extension
    if (!name.toLowerCase().endsWith('.md')) {
        name += '.md';
    }

    try {
        const fullPath = await invoke('create_local_page', { name });
        showToast(`Created page: ${name}`, "success");

        // Construct node to open it immediately
        const node = {
            name: name,
            is_dir: false,
            is_network: false,
            relative_path: `local.org/${name}`,
            full_path: fullPath,
            children: []
        };

        // Switch view if needed? No, handleFileClick should handle it
        await handleFileClick(node);

        // Refresh explorer tree
        await loadExplorerTree('explorer-tree', 'local');
    } catch (e) {
        console.error("Create page failed:", e);
        showToast("Failed to create page: " + e, "error");
    }
}

