import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/magnify': 'http://localhost:8000',
      '/vitals': 'http://localhost:8000',
      '/audio': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/files': 'http://localhost:8000',
    },
  },
})
