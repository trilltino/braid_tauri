import { ChevronRight, ChevronDown, BookOpen } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import ThemeToggle from '../ThemeToggle';
import './Navbar.css';

const Navbar = ({ className = "", readingMode, toggleReadingMode }) => {
  return (
    <header className={`docs-header ${className}`}>
      <div className="header-left">
        <NavLink
          to="/getting-started"
          className={({ isActive }) => `header-link ${isActive ? 'active' : ''}`}
        >
          Getting Started
        </NavLink>

        <NavLink
          to="/pages"
          className={({ isActive }) => `header-link ${isActive ? 'active' : ''}`}
        >
          Pages
        </NavLink>

        <div className="nav-dropdown">
          <a href="#frameworks" className="header-link">
            UI Frameworks <ChevronDown size={14} />
          </a>
          <div className="dropdown-menu">
            <NavLink to="/frameworks/tauri" className="dropdown-item">Tauri</NavLink>
            <NavLink to="/frameworks/electron" className="dropdown-item">Electron</NavLink>
            <NavLink to="/frameworks/qt" className="dropdown-item">Qt</NavLink>
          </div>
        </div>

        <div className="nav-dropdown">
          <a href="#docs" className="header-link">
            Documentation <ChevronDown size={14} />
          </a>
          <div className="dropdown-menu">
            <a href="#braid_http_rs" className="dropdown-item">braid_http_rs</a>
            <a href="#braid_blob" className="dropdown-item">BraidBlob</a>
            <a href="#braid_fs" className="dropdown-item">braidFs</a>
            <a href="#legit_nfs" className="dropdown-item">legit-nfs</a>
          </div>
        </div>
      </div>
      <div className="header-right">
        <a href="#support" className="header-link">Support</a>
        <a href="#blog" className="header-link">Blog</a>
        <button
          className="header-link icon-btn"
          onClick={toggleReadingMode}
          title={readingMode ? "Exit Reading Mode" : "Reading Mode"}
        >
          <BookOpen size={20} />
        </button>

        <ThemeToggle />
      </div>
    </header>
  );
};

export default Navbar;
