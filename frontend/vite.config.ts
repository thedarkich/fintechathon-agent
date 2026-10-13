import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies /api to the FastAPI backend on :8000.
// The production build in dist/ is served by the backend at /.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
})
