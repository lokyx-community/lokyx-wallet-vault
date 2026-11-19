import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths so the built app can be served from any folder or opened from IPFS.
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
  },
});
