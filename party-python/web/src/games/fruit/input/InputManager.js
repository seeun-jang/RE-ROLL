// ============================================================
//  입력 관리자 — 마우스/터치와 모션 인식 입력을 하나의 "칼 점" 큐로 합친다
// ============================================================
import { MotionInput } from './MotionInput.js';
import { PointerInput } from './PointerInput.js';

export class InputManager {
  constructor(el) {
    this.queue = [];
    this.pointer = new PointerInput(this);
    this.motion = new MotionInput(this);
    this.onUserGesture = null;
    this.pointer.attach(el);
  }

  push(point) {
    this.queue.push(point);
  }

  /** 이번 프레임에 쌓인 입력 점들을 꺼낸다 */
  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  /** 지금 화면에 그릴 커서 — 손이 보이면 손 커서, 아니면 마우스 커서 */
  get cursor() {
    if (this.motion.running && this.motion.cursor.visible) return this.motion.cursor;
    return this.pointer.cursor;
  }

  destroy() {
    this.pointer.detach();
    if (this.motion.running) this.motion.stop();
  }
}
