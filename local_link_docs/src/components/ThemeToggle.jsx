import { useState, useEffect } from 'react';

const ThemeToggle = () => {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const isLightInitial = savedTheme === 'light';
    setIsLight(isLightInitial);

    if (isLightInitial) {
      document.documentElement.classList.add('light-mode');
    }
    updateSystemMeta(isLightInitial);
  }, []);

  const updateSystemMeta = (light) => {
    // Update Favicon
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) {
      favicon.href = light ? '/favicon-white.svg' : '/favicon-black.svg';
    }

    // Update Theme Color Meta
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) {
      metaTheme = document.createElement('meta');
      metaTheme.name = 'theme-color';
      document.getElementsByTagName('head')[0].appendChild(metaTheme);
    }
    metaTheme.content = light ? '#ffffff' : '#000000';
  };

  const toggleTheme = () => {
    const newVal = !isLight;
    setIsLight(newVal);
    if (newVal) {
      document.documentElement.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark');
    }
    updateSystemMeta(newVal);
  };

  return (
    <div className="theme-toggle">
      <div
        className={`theme-switch ${isLight ? 'active' : ''}`}
        onClick={toggleTheme}
        aria-label="Toggle Theme"
      >
        <div className="theme-switch-knob"></div>
      </div>
    </div>
  );
};

export default ThemeToggle;
