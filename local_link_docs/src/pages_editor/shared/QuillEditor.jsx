import React, { useEffect, useRef } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';

// Custom Blot for CodeMirror integration
const BlockEmbed = Quill.import('blots/block/embed');

class CodeMirrorBlot extends BlockEmbed {
    static create(value) {
        const node = super.create();
        node.setAttribute('data-value', JSON.stringify(value));
        node.setAttribute('contenteditable', 'false');
        node.classList.add('quill-codemirror-container');

        // We will initialize CodeMirror in the component after the node is attached
        return node;
    }

    static value(node) {
        return JSON.parse(node.getAttribute('data-value'));
    }
}

CodeMirrorBlot.blotName = 'codemirror';
CodeMirrorBlot.tagName = 'div';
Quill.register(CodeMirrorBlot);

const QuillEditor = ({ value, onChange, connected }) => {
    const quillRef = useRef(null);
    const containerRef = useRef(null);
    const editorRef = useRef(null);
    const isUpdating = useRef(false);

    useEffect(() => {
        if (!editorRef.current || quillRef.current) return;

        // More robust cleanup: remove ANY toolbars currently in the container
        if (containerRef.current) {
            const toolbars = containerRef.current.querySelectorAll('.ql-toolbar');
            toolbars.forEach(tb => tb.remove());
        }

        // Clear any existing content to prevent double initialization in Strict Mode
        editorRef.current.innerHTML = '';

        const quill = new Quill(editorRef.current, {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link', 'image', 'code-block'],
                    ['clean']
                ]
            }
        });

        quillRef.current = quill;

        const viewsRef = new Map();

        const initCM = (node) => {
            if (viewsRef.has(node) || node.querySelector('.cm-editor')) return;

            let data;
            try {
                data = JSON.parse(node.getAttribute('data-value'));
            } catch (e) {
                data = { code: '', lang: 'javascript' };
            }

            const view = new EditorView({
                doc: data.code || '',
                extensions: [
                    basicSetup,
                    data.lang === 'rust' ? rust() : javascript(),
                    oneDark,
                    EditorView.theme({
                        '&': {
                            height: 'auto',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '1px solid var(--color-border)',
                            background: '#1e1e1e !important'
                        },
                        '.cm-scroller': { fontFamily: 'monospace', lineHeight: '1.6' },
                        '.cm-content': { padding: '16px' }
                    }),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            const newCode = update.state.doc.toString();
                            data.code = newCode;
                            node.setAttribute('data-value', JSON.stringify(data));
                            onChange(quill.root.innerHTML);
                        }
                    })
                ],
                parent: node
            });
            viewsRef.set(node, view);
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.classList.contains('quill-codemirror-container')) {
                            initCM(node);
                        } else {
                            node.querySelectorAll('.quill-codemirror-container').forEach(initCM);
                        }
                    }
                });
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        const cleanup = (n) => {
                            if (viewsRef.has(n)) {
                                viewsRef.get(n).destroy();
                                viewsRef.delete(n);
                            }
                        };
                        if (node.classList.contains('quill-codemirror-container')) {
                            cleanup(node);
                        } else {
                            node.querySelectorAll('.quill-codemirror-container').forEach(cleanup);
                        }
                    }
                });
            });
        });

        observer.observe(quill.root, { childList: true, subtree: true });

        // Initial check
        quill.root.querySelectorAll('.quill-codemirror-container').forEach(initCM);

        quill.on('text-change', (delta, oldDelta, source) => {
            if (source === 'user') {
                isUpdating.current = true;
                onChange(quill.root.innerHTML);
            }
        });

        const toolbar = quill.getModule('toolbar');
        toolbar.addHandler('code-block', () => {
            const range = quill.getSelection();
            if (range) {
                quill.insertEmbed(range.index, 'codemirror', { code: '', lang: 'javascript' });
            }
        });

        return () => {
            observer.disconnect();
            viewsRef.forEach(view => view.destroy());
            viewsRef.clear();

            // Comprehensive cleanup
            if (containerRef.current) {
                const toolbars = containerRef.current.querySelectorAll('.ql-toolbar');
                toolbars.forEach(tb => tb.remove());
            }

            if (editorRef.current) {
                editorRef.current.innerHTML = '';
            }
            quillRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!quillRef.current) return;

        const currentHtml = quillRef.current.root.innerHTML;

        if (value === currentHtml) {
            isUpdating.current = false;
            return;
        }

        if (!isUpdating.current) {
            // External update (from Braid or initial load)
            const selection = quillRef.current.getSelection();
            quillRef.current.root.innerHTML = value;
            if (selection) {
                // Wrap in timeout to ensure DOM has updated
                setTimeout(() => {
                    if (quillRef.current) quillRef.current.setSelection(selection);
                }, 0);
            }
        } else {
            // Value mismatch while user is typing (likely due to markdown conversion)
            // We'll reset the flag and let the next cycle handle it to avoid flickering.
            isUpdating.current = false;
        }
    }, [value]);

    return (
        <div ref={containerRef} className={`quill-outer-container ${!connected ? 'disabled' : ''}`}>
            <div ref={editorRef} className="quill-editor-instance" />
        </div>
    );
};

export default QuillEditor;
