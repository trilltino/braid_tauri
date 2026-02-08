import DocsLayout from '../../components/Docs/DocsLayout'
import CodeSnippet from '../../components/CodeSnippet'

const QtPage = () => {
    return (
        <DocsLayout>
            <div className="markdown-body">
                <div className="breadcrumb">Frameworks / Qt</div>
                <div className="framework-logo-container" style={{ marginBottom: '24px' }}>
                    <img src="/frameworks/qt.webp" alt="Qt Logo" style={{ height: '80px', borderRadius: '12px' }} />
                </div>
                <h1>Qt & QML Integration</h1>
                <p className="lead">
                    Professional, industrial-grade desktop UIs meet modern decentralized collaboration.
                </p>

                <section>
                    <h2>C++ & QML Support</h2>
                    <p>
                        LocalLink provides a native C++ library for Qt applications, with high-level QML bindings for declarative UI development.
                    </p>
                </section>

                <section>
                    <h2>Reactive QML Bindings</h2>
                    <p>
                        Bind your QML properties directly to Braid documents. When the document changes via a peer update, your UI refreshes automatically.
                    </p>
                    <CodeSnippet
                        title="QML Reactive Binding"
                        lang="javascript"
                        code={`import LocalLink 1.0

BraidDocument {
    id: doc
    url: "braid://peer/settings.json"
}

TextField {
    text: doc.content.userName
    onTextChanged: doc.patch({userName: text})
}`}
                    />
                </section>

                <section>
                    <h2>Performance</h2>
                    <ul>
                        <li>Zero-copy data transfers</li>
                        <li>Native thread safety</li>
                        <li>Small footprint for embedded systems</li>
                        <li>Direct GPU rendering with QPainter/SceneGraph</li>
                    </ul>
                </section>
            </div>
        </DocsLayout>
    )
}

export default QtPage
