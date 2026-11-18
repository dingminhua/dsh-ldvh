import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '2ch75157hd.vicp.fun')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const buildStamp = (() => {
  let hash = 'unknown';
  try {
    hash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    void 0;
  }
  return `${hash} @ ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
})();

export default defineConfig({
  define: {
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
