// =====================================================
// 화면 전환: 픽셀 디더 페이드 / 원형 와이프
// 닫힘(out) → 콜백 실행 → 열림(in)
// =====================================================
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

class Transition {
  constructor(type, onMiddle, duration = 28) {
    this.type = type; // 'fade' | 'circle'
    this.onMiddle = onMiddle;
    this.duration = duration;
    this.t = 0;
    this.phase = 'out';
    this.done = false;
    if (!Transition.patterns) Transition.buildPatterns();
  }

  // 0~16단계 디더 패턴을 미리 만들어 둠
  static buildPatterns() {
    Transition.patterns = [];
    for (let level = 0; level <= 16; level++) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = PALETTE.o;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) g.fillRect(x, y, 1, 1);
      Transition.patterns.push(c);
    }
  }

  update() {
    this.t++;
    if (this.phase === 'out' && this.t >= this.duration) {
      this.phase = 'hold';
      this.t = 0;
      if (this.onMiddle) this.onMiddle();
    } else if (this.phase === 'hold' && this.t >= 6) {
      this.phase = 'in';
      this.t = 0;
    } else if (this.phase === 'in' && this.t >= this.duration) {
      this.done = true;
    }
  }

  // 0 = 완전히 보임, 1 = 완전히 가려짐
  get amount() {
    if (this.phase === 'out') return this.t / this.duration;
    if (this.phase === 'hold') return 1;
    return 1 - this.t / this.duration;
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const a = this.amount;
    if (this.type === 'circle') {
      // 원형 와이프: 행마다 구멍 폭을 계산해 정수 픽셀로 칠함
      const maxR = Math.hypot(W, H) / 2;
      const r = Math.floor(maxR * (1 - a));
      const cx = W / 2;
      const cy = H / 2;
      ctx.fillStyle = PALETTE.o;
      for (let y = 0; y < H; y++) {
        const dy = y - cy;
        if (Math.abs(dy) >= r) {
          ctx.fillRect(0, y, W, 1);
        } else {
          const hw = Math.floor(Math.sqrt(r * r - dy * dy));
          ctx.fillRect(0, y, Math.max(0, cx - hw), 1);
          ctx.fillRect(cx + hw, y, W - (cx + hw), 1);
        }
      }
    } else {
      const level = Math.round(a * 16);
      if (level <= 0) return;
      ctx.fillStyle = ctx.createPattern(Transition.patterns[level], 'repeat');
      ctx.fillRect(0, 0, W, H);
    }
  }
}
