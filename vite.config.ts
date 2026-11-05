import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs let the build be served under any sub-path,
  // e.g. /embed/circtime/.
  base: './',
  build: {
    // Emit every asset as a same-origin file (no data: URIs), so the app works
    // under a strict `default-src 'self'` CSP.
    assetsInlineLimit: 0,
  },
});
