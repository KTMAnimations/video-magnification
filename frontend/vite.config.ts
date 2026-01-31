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
    proxy: {
      '/magnify': 'http://localhost:8000',
      '/vitals': { target: 'http://localhost:8000', ws: true },
      '/audio': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
      '/test-videos': 'http://localhost:8000',
    },
  },
})
