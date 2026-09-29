import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

// 允许通过环境变量追加 dev server 可访问主机（如内网穿透域名），默认保留原值以不破坏既有开发访问。
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '2ch75157hd.vicp.fun')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

// https://vite.dev/config/
const buildStamp = (() => {
  let hash = 'unknown';
  try {
    hash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    // 非 git 环境（打包分发）下不阻断构建，退化为 unknown。
  }
  return `${hash} @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
})();

export default defineConfig({
  define: {
    // 展示台据此显示"当前页面加载的是哪一次构建"——避免"改了没生效"只能在缓存上猜。
    __BUILD_STAMP__: JSON.stringify(buildStamp),
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      '@/shared': resolve(__dirname, 'shared'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
