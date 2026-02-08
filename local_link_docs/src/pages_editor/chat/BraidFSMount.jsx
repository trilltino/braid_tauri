/**
 * BraidFS Mount Component
 * 
 * Provides UI for mounting Braid-synced folders as network drives.
 * Integrates with braidfs-nfs to expose files via NFS.
 */

import React, { useState, useEffect } from 'react';
import './BraidFSMount.css';

const DAEMON_PORT = 45678;
const NFS_PORT = 2049;

/**
 * BraidFS Mount Manager
 */
export function BraidFSMount({ 
  peers,
  onMount,
  onUnmount,
  className = '' 
}) {
  const [mountedPaths, setMountedPaths] = useState(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [mountPoint, setMountPoint] = useState('');
  const [autoMount, setAutoMount] = useState(false);

  // Load mounted paths on mount
  useEffect(() => {
    loadMountedPaths();
    checkNFSStatus();
  }, []);

  /**
   * Load previously mounted paths from storage
   */
  const loadMountedPaths = async () => {
    try {
      if (window.__TAURI__) {
        const { readTextFile, BaseDirectory } = window.__TAURI__.fs;
        const data = await readTextFile('braidfs_mounts.json', { 
          dir: BaseDirectory.AppData 
        });
        const mounts = JSON.parse(data);
        setMountedPaths(new Map(Object.entries(mounts)));
      } else {
        const data = localStorage.getItem('braidfs_mounts');
        if (data) {
          setMountedPaths(new Map(Object.entries(JSON.parse(data))));
        }
      }
    } catch (err) {
      // No previous mounts
    }
  };

  /**
   * Save mounted paths
   */
  const saveMountedPaths = async (paths) => {
    const obj = Object.fromEntries(paths);
    try {
      if (window.__TAURI__) {
        const { writeTextFile, BaseDirectory } = window.__TAURI__.fs;
        await writeTextFile(
          'braidfs_mounts.json',
          JSON.stringify(obj, null, 2),
          { dir: BaseDirectory.AppData }
        );
      } else {
        localStorage.setItem('braidfs_mounts', JSON.stringify(obj));
      }
    } catch (err) {
      console.error('Failed to save mounts:', err);
    }
  };

  /**
   * Check if NFS server is running
   */
  const checkNFSStatus = async () => {
    try {
      const response = await fetch(`http://localhost:${DAEMON_PORT}/status`);
      return response.ok;
    } catch {
      return false;
    }
  };

  /**
   * Start NFS server
   */
  const startNFSServer = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`http://localhost:${DAEMON_PORT}/nfs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: NFS_PORT })
      });
      
      if (!response.ok) {
        throw new Error('Failed to start NFS server');
      }
      
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Mount a peer's folders as network drive
   */
  const handleMount = async () => {
    if (!selectedPeer || !mountPoint) return;

    setIsLoading(true);
    setError(null);

    try {
      // Check if NFS is running
      const isRunning = await checkNFSStatus();
      if (!isRunning) {
        const started = await startNFSServer();
        if (!started) throw new Error('NFS server failed to start');
      }

      // Perform mount via Tauri API
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__;
        
        await invoke('mount_nfs', {
          peerId: selectedPeer,
          mountPoint: mountPoint,
          nfsPort: NFS_PORT
        });
      } else {
        // Web fallback - just store the preference
        console.log('Mount not available in web mode');
      }

      // Update state
      const newPaths = new Map(mountedPaths);
      newPaths.set(selectedPeer, {
        path: mountPoint,
        mountedAt: new Date().toISOString(),
        autoMount
      });
      setMountedPaths(newPaths);
      await saveMountedPaths(newPaths);

      onMount?.(selectedPeer, mountPoint);
      
      // Reset form
      setMountPoint('');
      setSelectedPeer(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Unmount a drive
   */
  const handleUnmount = async (peerId) => {
    setIsLoading(true);
    
    try {
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__;
        await invoke('unmount_nfs', { peerId });
      }

      const newPaths = new Map(mountedPaths);
      newPaths.delete(peerId);
      setMountedPaths(newPaths);
      await saveMountedPaths(newPaths);

      onUnmount?.(peerId);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Open mounted folder
   */
  const openFolder = async (path) => {
    if (window.__TAURI__) {
      const { open } = window.__TAURI__.shell;
      await open(path);
    } else {
      // Web fallback
      console.log('Open folder:', path);
    }
  };

  return (
    <div className={`braidfs-mount ${className}`}>
      <h3>BraidFS Network Drive</h3>
      
      {error && (
        <div className="mount-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Mount form */}
      <div className="mount-form">
        <div className="form-row">
          <label>Peer:</label>
          <select 
            value={selectedPeer || ''} 
            onChange={(e) => setSelectedPeer(e.target.value)}
          >
            <option value="">Select a peer...</option>
            {peers?.map(peer => (
              <option key={peer.id} value={peer.id}>
                {peer.name || peer.id.slice(0, 8)}... 
                {mountedPaths.has(peer.id) && '(mounted)'}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label>Mount Point:</label>
          <div className="mount-input-row">
            <input
              type="text"
              value={mountPoint}
              onChange={(e) => setMountPoint(e.target.value)}
              placeholder="e.g., Z: or /mnt/braid"
            />
            {window.__TAURI__ && (
              <button 
                className="browse-btn"
                onClick={async () => {
                  const { open } = window.__TAURI__.dialog;
                  const selected = await open({ directory: true });
                  if (selected) setMountPoint(selected);
                }}
              >
                Browse...
              </button>
            )}
          </div>
        </div>

        <div className="form-row checkbox">
          <label>
            <input
              type="checkbox"
              checked={autoMount}
              onChange={(e) => setAutoMount(e.target.checked)}
            />
            Auto-mount on startup
          </label>
        </div>

        <button 
          className="mount-btn"
          onClick={handleMount}
          disabled={!selectedPeer || !mountPoint || isLoading}
        >
          {isLoading ? 'Mounting...' : 'Mount Drive'}
        </button>
      </div>

      {/* Mounted drives list */}
      {mountedPaths.size > 0 && (
        <div className="mounted-drives">
          <h4>Mounted Drives</h4>
          {Array.from(mountedPaths.entries()).map(([peerId, info]) => (
            <div key={peerId} className="mounted-item">
              <div className="mount-info">
                <span className="peer-name">{peerId.slice(0, 8)}...</span>
                <span className="mount-path" title={info.path}>
                  {info.path}
                </span>
                {info.autoMount && <span className="auto-badge">Auto</span>}
              </div>
              <div className="mount-actions">
                <button 
                  className="open-btn"
                  onClick={() => openFolder(info.path)}
                  title="Open folder"
                >
                  📂
                </button>
                <button 
                  className="unmount-btn"
                  onClick={() => handleUnmount(peerId)}
                  title="Unmount"
                >
                  ⏏️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help text */}
      <div className="mount-help">
        <p>
          <strong>BraidFS</strong> lets you access synced folders as a network drive.
        </p>
        <ul>
          <li>Files are automatically synced between peers</li>
          <li>Edit files with any application (Photoshop, Word, etc.)</li>
          <li>Conflicts are resolved using Diamond Types CRDT</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Quick mount button for toolbar
 */
export function QuickMountButton({ peer, onMount }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    checkMountStatus();
  }, [peer]);

  const checkMountStatus = async () => {
    try {
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__;
        const mounts = await invoke('get_mounted_drives');
        setIsMounted(mounts.some(m => m.peer === peer.id));
      }
    } catch {
      setIsMounted(false);
    }
  };

  const handleClick = async () => {
    if (isMounted) {
      // Unmount
      if (window.__TAURI__) {
        const { invoke } = window.__TAURI__;
        await invoke('unmount_nfs', { peerId: peer.id });
        setIsMounted(false);
      }
    } else {
      // Mount with default path
      const defaultPath = window.__TAURI__ 
        ? `Z:` // Windows
        : `/mnt/braid-${peer.id.slice(0, 8)}`; // Unix
      
      onMount?.(peer, defaultPath);
      setIsMounted(true);
    }
  };

  return (
    <button 
      className={`quick-mount-btn ${isMounted ? 'mounted' : ''}`}
      onClick={handleClick}
      title={isMounted ? 'Unmount drive' : 'Mount as drive'}
    >
      {isMounted ? '🖇️' : '📂'}
    </button>
  );
}

/**
 * File share dialog for chat
 */
export function ShareFromDriveDialog({ 
  isOpen, 
  onClose, 
  onSelect,
  peerId 
}) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, currentPath]);

  const loadFiles = async () => {
    setIsLoading(true);
    try {
      // In real implementation, this would list files from the mounted drive
      // For now, show mock data
      setFiles([
        { name: 'Documents', type: 'folder', path: '/Documents' },
        { name: 'Photos', type: 'folder', path: '/Photos' },
        { name: 'report.pdf', type: 'file', size: '2.4 MB' },
        { name: 'vacation.png', type: 'image', size: '1.8 MB' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Share from BraidFS</h3>
        
        <div className="breadcrumb">
          <button onClick={() => setCurrentPath('/')}>Root</button>
          <span>/</span>
          <span>{currentPath}</span>
        </div>

        <div className="file-list">
          {isLoading ? (
            <div className="loading">Loading...</div>
          ) : (
            files.map(file => (
              <div 
                key={file.name} 
                className={`file-item ${file.type}`}
                onClick={() => {
                  if (file.type === 'folder') {
                    setCurrentPath(file.path);
                  } else {
                    onSelect?.(file);
                    onClose();
                  }
                }}
              >
                <span className="file-icon">
                  {file.type === 'folder' && '📁'}
                  {file.type === 'file' && '📄'}
                  {file.type === 'image' && '🖼️'}
                </span>
                <span className="file-name">{file.name}</span>
                {file.size && <span className="file-size">{file.size}</span>}
              </div>
            ))
          )}
        </div>

        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
