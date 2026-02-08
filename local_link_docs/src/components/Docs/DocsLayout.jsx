import { useState } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import './DocsLayout.css';

const DocsLayout = ({ children, fullWidth = false }) => {
  const [readingMode, setReadingMode] = useState(false);

  return (
    <div className={`docs-container ${readingMode ? 'reading-mode' : ''}`}>
      {!readingMode && <Sidebar />}
      <main className="docs-main">
        <Navbar readingMode={readingMode} toggleReadingMode={() => setReadingMode(!readingMode)} />
        <div className={`content-wrapper ${fullWidth ? 'full-width' : ''}`}>
          {children}
        </div>
      </main>
    </div>
  );
};

export default DocsLayout;
