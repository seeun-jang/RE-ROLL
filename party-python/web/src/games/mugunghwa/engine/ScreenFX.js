// ============================================================
// ScreenFX.js — 화면 흔들림 + 히트 스톱 (손맛 연출)
// ============================================================

export class ScreenFX {
  constructor() {
    this.shakeT = 0;
    this.shakeDur = 0;
    this.amp = 0;
    this.ox = 0;
    this.oy = 0;
    this.stop = 0;
  }

  shake(amp, time) {
    if (amp >= this.amp || this.shakeT <= 0) {
      this.amp = amp;
      this.shakeT = time;
      this.shakeDur = time;
    }
  }

  // 아주 짧게 게임 세계를 멈춤
  hitStop(time) {
    this.stop = Math.max(this.stop, time);
  }

  get hitStopping() { return this.stop > 0; }

  update(dt) {
    if (this.stop > 0) this.stop -= dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / this.shakeDur);
      // 정수 픽셀로만 흔듦
      this.ox = Math.round((Math.random() * 2 - 1) * this.amp * k);
      this.oy = Math.round((Math.random() * 2 - 1) * this.amp * k);
    } else {
      this.ox = 0;
      this.oy = 0;
      this.amp = 0;
    }
  }
}
