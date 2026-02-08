import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: 'ui', // Serve from the ui directory
    server: {
        port: 1420,
        strictPort: true,
        watch: {
            usePolling: true // Windows sometimes needs this for reliable watches
        }
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true
    }
});
