import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }
          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          if (id.includes(`${path.sep}node_modules${path.sep}@radix-ui${path.sep}`)) {
            return 'radix-vendor'
          }
          if (id.includes(`${path.sep}node_modules${path.sep}recharts${path.sep}`)) {
            return 'chart-vendor'
          }
          if (id.includes(`${path.sep}node_modules${path.sep}gantt-task-react${path.sep}`)) {
            return 'gantt-vendor'
          }
          if (/[\\/]node_modules[\\/](@tanstack|zustand|axios)[\\/]/.test(id)) {
            return 'query-vendor'
          }
        },
      },
    },
  },
})
