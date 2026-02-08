import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Home from './Home.jsx'
import GettingStarted from './GettingStarted.jsx'
import Pages from './Pages.jsx'
import TauriPage from './pages/frameworks/Tauri.jsx'
import ElectronPage from './pages/frameworks/Electron.jsx'
import QtPage from './pages/frameworks/Qt.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/getting-started" element={<GettingStarted />} />
        <Route path="/pages" element={<Pages />} />
        <Route path="/frameworks/tauri" element={<TauriPage />} />
        <Route path="/frameworks/electron" element={<ElectronPage />} />
        <Route path="/frameworks/qt" element={<QtPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
