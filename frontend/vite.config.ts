import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/magnify': 'http://localhost:8001',
      '/vitals': { target: 'http://localhost:8001', ws: true },
      '/audio': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/files': 'http://localhost:8001',
      '/test-videos': 'http://localhost:8001',
    },
  },
})
