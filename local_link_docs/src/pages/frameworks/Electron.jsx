import DocsLayout from '../../components/Docs/DocsLayout'
import CodeSnippet from '../../components/CodeSnippet'

const ElectronPage = () => {
    return (
        <DocsLayout>
            <div className="markdown-body">
                <div className="breadcrumb">Frameworks / Electron</div>
                <div className="framework-logo-container" style={{ marginBottom: '24px' }}>
                    <img src="/frameworks/electron.webp" alt="Electron Logo" style={{ height: '80px', borderRadius: '12px' }} />
                </div>
                <h1>Electron Integration</h1>
                <p className="lead">
                    Bring the full power of LocalLink to the world's most popular desktop application framework.
                </p>

                <section>
                    <h2>Seamless Bridge</h2>
                    <p>
                        Our Electron adapter uses a secure Preload script to expose LocalLink's CRDT and Braid capabilities to your renderer process without compromising security.
                    </p>
                </section>

                <section>
                    <h2>Main Process Sync</h2>
                    <p>
                        Handle large data synchronization and background persistence in the Electron Main process while providing a snappy UI in the Renderer.
                    </p>
                    <CodeSnippet
                        title="Electron Main & Renderer Sync"
                        lang="javascript"
                        code={`// in main.js
const { initLocalLink } = require('@locallink/electron-main');
initLocalLink(mainWindow);

// in renderer.js
const { client } = window.LocalLink;
client.subscribe('my-room', (update) => {
  console.log('Received update:', update);
});`}
                    />
                </section>

                <section>
                    <h2>Capabilities</h2>
                    <ul>
                        <li>Full Chromium DevTools support</li>
                        <li>Native menu bar integration</li>
                        <li>Automatic updates via Braid protocol</li>
                        <li>Cross-platform consistency</li>
                    </ul>
                </section>
            </div>
        </DocsLayout>
    )
}

export default ElectronPage
