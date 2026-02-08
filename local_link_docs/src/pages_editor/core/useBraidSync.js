import { useState, useEffect, useRef } from 'react';
import { simpleton_client } from '../shared/simpleton-client';
import * as Diff from 'diff';

// simpleton_client expects a diff function that returns {range: [start, end], content: "string"}
// But 'diff' package returns list of changes. 
// simpleton-client.js has a built-in 'simple_diff' if we don't provide one.
// Let's rely on simpleton-client's default simple_diff for now as it's sufficient for basic text.
// Or we can use 'diff' package if we want smarter line-based diffs? 
// simpleton-client.js:153 calls simple_diff(prev, new)

export function useBraidSync(url) {
  const [text, setTextState] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  // Refs to keep track of state without triggering re-renders in callbacks
  const textRef = useRef('');
  const clientRef = useRef(null);

  // Helper to update text safely
  const updateText = (newText) => {
    textRef.current = newText;
    setTextState(newText);
  };

  useEffect(() => {
    if (!url) return;

    console.log(`Configuring Braid Sync for: ${url}`);
    setConnected(false);
    setError(null);

    try {
      clientRef.current = simpleton_client(url, {
        on_state: (newState) => {
          console.log('Received initial state:', newState);
          updateText(newState);
          setConnected(true);
        },
        on_patches: (patches) => {
          console.log('Received patches:', patches);
          // Apply patches to current text
          let current = textRef.current;
          // simpleton-client.js applies patches internally if we don't provide on_patches
          // BUT if we provide on_patches, we must apply them.
          // Wait, simpleton-client reference applies patches if on_patches is MISSING.
          // If on_patches is present, it calls it and expects us to update our state.
          // AND it updates its own prev_state by calling get_state().

          // Implementation of patch application:
          // Each patch has {range: [start, end], content: "string"}
          // Range is code-points.

          let offset = 0;
          for (let p of patches) {
            // We need a helper to apply slice by code points if possible, 
            // but simple-client uses substring which is UTF-16 code units.
            // simpleton-client.js:240 uses substring.
            // However, simpleton-client.js logic converts ranges to js-indices (UTF-16) before passing to on_patches.
            // So we can use substring.

            current = current.substring(0, p.range[0] + offset) + p.content +
              current.substring(p.range[1] + offset);
            offset += p.content.length - (p.range[1] - p.range[0]);
          }
          updateText(current);
        },
        get_state: () => textRef.current,
        // using default get_patches (simple_diff)
        on_error: (err) => {
          console.error("Braid Error:", err);
          if (err.message.includes('404')) {
            console.log("Resource not found (404). Treating as new file.");
            setConnected(true); // Allow editing
            // We don't update text (keep it empty or what it was)
            // We don't set error
            return;
          }
          setError(err.message);
          setConnected(false);
        },
        content_type: 'text/markdown' // Request markdown
      });
    } catch (e) {
      setError(e.message);
    }

    return () => {
      console.log("Stopping Braid Client");
      if (clientRef.current) {
        clientRef.current.stop();
      }
    };
  }, [url]);

  const setText = (newText) => {
    updateText(newText);
    if (clientRef.current) {
      clientRef.current.changed();
    }
  };

  return { text, setText, connected, error };
}
