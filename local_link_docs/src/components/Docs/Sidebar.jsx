import { Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const Sidebar = () => {
  return (
    <aside className="docs-sidebar">
      <div className="sidebar-header">
        <NavLink to="/" className="sidebar-logo">LocalLink.</NavLink>
      </div>

      <div className="sidebar-search">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input type="text" placeholder="Search..." aria-label="Search documentation" />
          <span className="search-shortcut">Ctrl K</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <h3 className="nav-section-title">Getting Started</h3>
          <ul className="nav-list">
            <li className="nav-item">
              <NavLink
                to="/getting-started"
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                What is LocalLink?
              </NavLink>
            </li>
            <li className="nav-item">
              <a href="#quickstart">Quickstart</a>
            </li>
            <li className="nav-item">
              <a href="#examples">Examples & Apps</a>
            </li>
          </ul>
        </div>

      </nav>
    </aside>
  );
};

export default Sidebar;
