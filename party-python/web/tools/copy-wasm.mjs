// MediaPipe 손 인식 엔진(wasm) 파일을 public/ 으로 복사한다 — 서버가 같은 주소에서 내려주도록.
// npm run dev / npm run build 때 자동으로 실행된다. (과일자르기 등 카메라 게임에 필요)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dst = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.warn('[copy-wasm] @mediapipe/tasks-vision 이 설치되지 않았습니다. npm install 을 먼저 실행하세요.');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-wasm] wasm 복사 완료 →', dst);
