import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// game-a 단독 테스트용 설정입니다.
// 메인 보드게임에 통합될 때는 메인 앱의 설정이 사용되므로 이 파일은 단독 실행에만 쓰입니다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true, // npm run dev 시 브라우저 자동 열기
  },
});
