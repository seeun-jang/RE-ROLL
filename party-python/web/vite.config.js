import { defineConfig } from 'vite';

// 개발 모드(npm run dev): 화면은 5173 에서 열리고, /api 와 /ws 요청은 Python 서버(8000)로 넘긴다.
// 배포 모드(npm run build): dist 폴더를 Python 서버가 같은 주소에서 함께 제공한다.
const BACKEND = process.env.PARTY_BACKEND || 'http://127.0.0.1:8000';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
