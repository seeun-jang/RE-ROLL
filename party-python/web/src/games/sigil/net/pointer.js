// =====================================================
// 입력: 마우스 / 터치(포인터) + 키보드 — 원본 js/input.js 의 attachPointer 를 옮긴 것
//  화면 확대 배율을 고려해서 게임 좌표(320x180)로 바꿔 둠
//  detach() 로 모두 떼어 낼 수 있다(여러 게임이 한 페이지에 번갈아 뜨므로).
// =====================================================
import { CONFIG } from '../config.js';

export function attachPointer(canvas, onFirstInput) {
  const mouse = { x: 0, y: 0, down: false, pressed: false, right: false, inside: false };
  const toGame = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    mouse.x = ((e.clientX - r.left) / r.width) * CONFIG.WIDTH;
    mouse.y = ((e.clientY - r.top) / r.height) * CONFIG.HEIGHT;
    mouse.inside = mouse.x >= 0 && mouse.y >= 0 && mouse.x < CONFIG.WIDTH && mouse.y < CONFIG.HEIGHT;
  };
  const down = (e) => {
    toGame(e);
    if (onFirstInput) onFirstInput();
    if (e.button === 2) {
      mouse.right = true;
      return;
    }
    mouse.down = true;
    mouse.pressed = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 일부 브라우저는 실패해도 그리기는 된다 */ }
    e.preventDefault();
  };
  const up = (e) => {
    toGame(e);
    if (e.button !== 2) mouse.down = false;
  };
  const menu = (e) => e.preventDefault();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', toGame);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', menu);
  return {
    mouse,
    /** 매 프레임 끝: '방금 눌림' 표시를 지운다 */
    endFrame() {
      mouse.pressed = false;
      mouse.right = false;
    },
    detach() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', toGame);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('contextmenu', menu);
    },
  };
}
