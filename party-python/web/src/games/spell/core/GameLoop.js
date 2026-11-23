// ============================================================
// 고정 스텝 게임 루프: 로직은 항상 1/60초 단위로 갱신하고,
// 렌더는 브라우저 프레임마다 한 번 한다.
// ============================================================
import { CONFIG } from '../config.js';

export class GameLoop {
  constructor({ update, render }) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    // 다음 프레임을 먼저 예약 → 한 프레임에서 예외가 나도 루프는 계속 돈다
    this._raf = requestAnimationFrame(this._tick);
    const { STEP, MAX_FRAME } = CONFIG.LOOP;
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME; // 탭 전환 등 큰 공백은 잘라낸다

    // FPS 측정 (디버그 표시용)
    this._fpsAcc += frame;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.acc += frame;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
  }
}
