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
    // 构建戳：注入构建期的 git 短 hash + 时刻，供「改了到底生效没有」自证。
    //
    // **保留理由（2026-09-30）**：其唯一显示位（展示台 `/showcase`）已按 Human 裁定
    // 删除，但本注入**不随之删除**——实测过一次「改了没生效」，正是靠它才把「服务端
    // 未更新」与「浏览器缓存旧文档」区分开（当时页面显示的构建时刻早于最新构建）。
    // 删掉后该判断只剩猜缓存。注入成本为构建期一个字符串常量，运行时不产生任何东西。
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
