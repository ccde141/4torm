import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    // 前端 dev 只需监听项目本体（src/ + public/ + index.html + 根级配置）。
    // chokidar 默认扫描整个项目根，下面把所有【非前端源】的重目录排除掉，
    // 等效于把监听收窄到必要代码：
    //   - data/    ：工作流运行时产物区。agent 会在 workspace 里生成源码、写 tsconfig、
    //                跑 npm install（数百 MB / 数万文件）——不排除会灌爆 watcher，
    //                触发 HMR/全量强刷，把正在跑的工作流页面刷掉。
    //   - server/  ：后端源码，有自己的 tsx watch 负责热重载，不在前端模块图内。
    //   - dist/ build/ docs/ ：构建/文档产物。
    //   - electron/ __pycache__ ：桌面壳与 Python 缓存，非前端源。
    // 只有改动 src/、public/、index.html 或根级配置才会触发前端热更新。
    watch: {
      ignored: [
        '**/data/**',
        '**/server/**',
        '**/dist/**',
        '**/build/**',
        '**/docs/**',
        '**/electron/**',
        '**/__pycache__/**',
      ],
    },
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
      // 文档站由 Fastify 自托管在 /docs/;开发态经此代理,使应用内「文档」按钮在 dev/prod 都指向 /docs/
      '/docs': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
  ],
})
