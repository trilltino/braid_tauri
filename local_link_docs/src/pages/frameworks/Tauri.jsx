import DocsLayout from '../../components/Docs/DocsLayout'
import CodeSnippet from '../../components/CodeSnippet'

const TauriPage = () => {
    return (
        <DocsLayout>
            <div className="markdown-body">
                <div className="breadcrumb">Frameworks / Tauri</div>
                <div className="framework-logo-container" style={{ marginBottom: '24px' }}>
                    <img src="/frameworks/tauri.webp" alt="Tauri Logo" style={{ height: '80px', borderRadius: '12px' }} />
                </div>
                <h1>Tauri Integration</h1>
                <p className="lead">
                    Build smaller, faster, and more secure desktop applications with a web frontend using our first-class Tauri adapter.
                </p>

                <section>
                    <h2>Why Tauri?</h2>
                    <p>
                        Tauri allows you to leverage the performance of Rust while maintaining the flexibility of web technologies for your UI. It's the perfect match for the LocalLink Rust core.
                    </p>
                </section>

                <section>
                    <h2>Tauri Command Bridge</h2>
                    <p>
                        The LocalLink Tauri adapter automatically sets up the IPC bridge, allowing your React components to call native Braid functions with zero configuration.
                    </p>
                    <CodeSnippet
                        title="Tauri Integration Example"
                        lang="javascript"
                        code={`import { invoke } from '@tauri-apps/api/core';
import { useBraidSync } from '@locallink/tauri';

// Everything just works
const { text } = useBraidSync('local.org/home.md');`}
                    />
                </section>

                <section>
                    <h2>Native Features</h2>
                    <ul>
                        <li>System Tray Integration</li>
                        <li>Native File System Access via BraidFS</li>
                        <li>Multi-window collaboration</li>
                        <li>Hardware acceleration</li>
                    </ul>
                </section>
            </div>
        </DocsLayout>
    )
}

export default TauriPage
