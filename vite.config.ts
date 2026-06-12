import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: (proxy) => {
          // SSE 长连接支持：禁用代理缓冲，防止 SSE 流被提前关闭
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/delegate') || req.url?.includes('/events') || req.url?.includes('/tokens') || req.url?.includes('/compact') || req.url?.includes('/convection')) {
              proxyReq.setHeader('Connection', 'keep-alive');
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              // 禁用缓冲，确保 SSE 事件实时转发
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
      '/skin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
  ],
})
