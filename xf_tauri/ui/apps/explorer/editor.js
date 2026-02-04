import { showToast, invoke } from '../shared/utils.js';

export function setupQuill(onTextChange) {
    console.log("Setting up Quill...");
    const selector = '#quill-editor-container';
    const container = document.querySelector(selector);
    if (!container) {
        console.error("Quill Container NOT FOUND:", selector);
        return null;
    }

    // Clear any existing content
    container.innerHTML = '';

    const quill = new Quill(selector, {
        theme: 'snow',
        placeholder: 'Select a file to edit...',
        modules: {
            syntax: { highlight: text => (window.hljs ? hljs.highlightAuto(text).value : text) },
            toolbar: [['bold', 'italic'], ['blockquote', 'code-block'], ['link', 'image']]
        }
    });
    window.quill = quill;

    // Initially show empty state, hide editor until file is selected
    const emptyView = document.getElementById('explorer-info');
    const editorView = document.getElementById('explorer-editor-container');
    if (emptyView) emptyView.style.display = 'flex';
    if (editorView) editorView.style.display = 'none';

    quill.enable(false);

    if (onTextChange) {
        quill.on('text-change', (delta, oldDelta, source) => {
            if (source === 'user') onTextChange();
        });
    }

    // Image Drag & Drop Handler
    container.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            const files = Array.from(e.dataTransfer.files);
            for (const file of files) {
                handleFileUpload(file);
            }
        }
    });
    container.addEventListener('dragover', (e) => e.preventDefault());

    console.log("Quill setup complete");
    return quill;
}

export async function handleFileUpload(file) {
    const quill = window.quill;
    if (!quill) return;

    const range = quill.getSelection(true);
    const placeholder = `Uploading ${file.name}...`;
    quill.insertText(range.index, placeholder, 'italic');

    try {
        const buffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        showToast(`Uploading ${file.name}...`, "info");

        // Use global activeNode for reference
        const activeNode = window.activeNode;
        let destinationUrl = null;
        if (activeNode && activeNode.relative_path.includes('braid.org')) {
            const baseUrl = activeNode.relative_path.split('/').slice(0, 3).join('/');
            destinationUrl = `${baseUrl}/blobs/${file.name}`;
        }

        if (destinationUrl) {
            await invoke('push_binary_file', {
                url: destinationUrl,
                data: bytes,
                contentType: file.type || 'application/octet-stream'
            });
            quill.deleteText(range.index, placeholder.length);
            if (file.type.startsWith('image/')) {
                quill.insertEmbed(range.index, 'image', destinationUrl);
            } else {
                quill.insertText(range.index, `[Download ${file.name}](${destinationUrl})`);
            }
        } else {
            const hash = await invoke('save_explorer_blob', {
                data: bytes,
                contentType: file.type || 'application/octet-stream'
            });
            quill.deleteText(range.index, placeholder.length);
            const localUrl = `http://127.0.0.1:45678/api/blob/${hash}`;
            if (file.type.startsWith('image/')) {
                quill.insertEmbed(range.index, 'image', localUrl);
            } else {
                quill.insertText(range.index, `[${file.name}](${localUrl})`);
            }
        }
        showToast(`${file.name} uploaded!`, "success");
        if (window.debounceSave) window.debounceSave();
    } catch (e) {
        console.error("Upload failed:", e);
        showToast("Upload failed: " + e, "error");
        quill.deleteText(range.index, placeholder.length);
    }
}

export function setupResizer() {
    const resizer = document.getElementById('explorer-resizer');
    const sidebar = document.getElementById('explorer-sidebar');
    if (!resizer || !sidebar) return;
    let isResizing = false;
    resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const width = e.clientX - sidebar.getBoundingClientRect().left;
        if (width > 150 && width < 600) sidebar.style.width = width + 'px';
    });
    document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; });
}
