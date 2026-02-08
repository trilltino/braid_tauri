import { ChevronRight, Play, Book, Settings, Share2, Shield, Rocket } from 'lucide-react';
import CodeSnippet from './components/CodeSnippet';
import DocsLayout from './components/Docs/DocsLayout';

const GettingStarted = () => {
  return (
    <DocsLayout>
      <article className="markdown-body">
        <h1>What is LocalLink?</h1>

        <p className="lead">
          LocalLink is built on the Braid protocol, providing true local-first collaboration. Get up and running in minutes.
        </p>

        <section id="quickstart">
          <h2>Quickstart</h2>
          <p>Initialize a new LocalLink project with our CLI:</p>
          <CodeSnippet
            title="Terminal"
            lang="javascript"
            code={`npx @locallink/cli init my-awesome-app
cd my-awesome-app
npm install && npm run dev`}
          />
        </section>

        <section id="examples">
          <h2>Example: Collaborative Text</h2>
          <p>Creating a synchronized text area is as simple as using a hook:</p>
          <CodeSnippet
            title="App.jsx"
            lang="javascript"
            code={`import { useBraidSync } from '@locallink/react';

function Editor() {
  const { text, setText } = useBraidSync('local.org/scratchpad');

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}`}
          />
        </section>

        <h2>Core features</h2>
        <ul>
          <li>
            <strong>Fast</strong>: LocalLink enables direct connections between devices, allowing them to
            communicate without relying on centralized servers.
          </li>
          <li>
            <strong>Reliable</strong>: LocalLink is designed to work in challenging network conditions. It uses relay
            servers as a fallback when direct connections are not possible.
          </li>
          <li>
            <strong>Secure</strong>: All connections established through LocalLink are authenticated and encrypted
            end-to-end using the QUIC protocol, ensuring data privacy and integrity.
          </li>
          <li>
            <strong>Modular</strong>: LocalLink is built around a system of composable protocols that can be mixed
            and matched to suit the needs of different applications.
          </li>
        </ul>

        <h2>Use cases</h2>
        <ul>
          <li>
            <strong>Local-first, offline-first, peer-to-peer applications</strong>: LocalLink provides the networking
            foundation for building applications that can operate without reliance on servers.
          </li>
        </ul>
      </article>

      <aside className="on-this-page">
        <h4>On this page</h4>
        <ul>
          <li><a href="#features">Core features</a></li>
          <li><a href="#use-cases">Use cases</a></li>
          <li><a href="#intro">Getting started</a></li>
        </ul>
      </aside>
    </DocsLayout>
  );
};

export default GettingStarted;
