import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies /api to the FastAPI backend on :8000.
// The production build in dist/ is served by the backend at /.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    // Keep the browser's Host header: the backend's same-origin check compares it with Origin.
    // (A bare string target makes Vite rewrite Host to :8000, and every signed-in write gets CROSS_SITE.)
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
})
