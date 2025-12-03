import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // allow any Cloudflare quick tunnel host
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/compose': {
        target: process.env.VITE_API_BASE || 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
