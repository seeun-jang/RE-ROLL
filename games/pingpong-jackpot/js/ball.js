// =====================================================
// 탁구공 (옆에서 본 2D: x = 가로, y = 높이)
//  - 매 프레임 중력 → 이동 → 네트 / 탁구대 / 바닥 충돌을 검사해서 '사건'을 돌려줌
//  - CPU 가 공이 어디로 갈지 미리 계산할 수 있게 복제(clone) 가능
// =====================================================
class Ball {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.px = 0;
    this.py = 0;
    this.vx = 0;
    this.vy = 0;
    this.state = 'held';   // held(서브 전) | toss(서브 토스) | flight | dead(득점 후 굴러다님)
    this.serveStage = 0;   // 서브: 1 = 내 코트에 먼저 튀어야 함, 2 = 상대 코트로 가는 중
    this.lastHitter = 0;   // 마지막으로 친 쪽 (0 왼쪽 / 1 오른쪽)
    this.bounces = 0;      // 받는 쪽 코트에 튄 횟수
    this.rest = 0.9;       // 탁구대에서 튀는 힘
    this.netHit = false;
    this.chance = false;   // 높게 뜬 찬스볼
    this.fast = false;     // 스매시 (잔상)
    this.trail = [];
  }

  clone() {
    const b = new Ball();
    Object.assign(b, this);
    b.trail = [];
    return b;
  }

  // 한 프레임 진행 → 일어난 사건 목록 [{ type: 'bounce'|'net'|'floor'|'out', side }]
  step() {
    const T = CONFIG.TABLE;
    const ev = [];
    this.px = this.x;
    this.py = this.y;
    this.vy += CONFIG.BALL.GRAVITY;
    this.x += this.vx;
    this.y += this.vy;
    // 네트에 걸림
    if (!this.netHit && (this.px - T.NET_X) * (this.x - T.NET_X) <= 0 && this.px !== this.x) {
      const k = (T.NET_X - this.px) / (this.x - this.px);
      const yAt = this.py + (this.y - this.py) * k;
      if (yAt > T.NET_TOP && yAt < T.Y + 2) {
        this.netHit = true;
        this.x = T.NET_X - Math.sign(this.vx) * 3;
        this.vx = -this.vx * 0.15;
        this.vy = Math.min(this.vy, 0.5);
        ev.push({ type: 'net' });
      }
    }
    // 탁구대에 튐
    if (this.y >= T.Y && this.py < T.Y && this.x >= T.LEFT && this.x <= T.RIGHT) {
      this.y = T.Y;
      this.vy = -Math.abs(this.vy) * this.rest;
      this.vx *= CONFIG.TABLE_GRIP;
      ev.push({ type: 'bounce', side: this.x < T.NET_X ? 0 : 1 });
    }
    // 바닥
    if (this.y >= CONFIG.FLOOR_Y) {
      this.y = CONFIG.FLOOR_Y;
      this.vy = -Math.abs(this.vy) * 0.45;
      this.vx *= 0.7;
      if (Math.abs(this.vy) < 0.4) this.vy = 0;
      ev.push({ type: 'floor' });
    }
    if (this.x < -20 || this.x > CONFIG.WIDTH + 20) ev.push({ type: 'out' });
    // 꼬리: 스매시는 길게(불꽃), 보통 공은 짧게 (공이 어디로 가는지 잘 보이게)
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > (this.fast ? 7 : 3)) this.trail.shift();
    return ev;
  }

  // 지정한 곳(landX)에 T 프레임 뒤 떨어지도록 속도 계산 (네트를 넘을 때까지 높게 조정)
  launch(landX, T, clearNet = true) {
    const TB = CONFIG.TABLE;
    const g = CONFIG.BALL.GRAVITY;
    for (let tries = 0; tries < 40; tries++) {
      this.vx = (landX - this.x) / T;
      this.vy = (TB.Y - this.y - (g * T * (T + 1)) / 2) / T;
      if (!clearNet) return;
      const n = (TB.NET_X - this.x) / this.vx;
      if (n <= 0) return;
      const yNet = this.y + this.vy * n + (g * n * (n + 1)) / 2;
      if (yNet < TB.NET_TOP - 4) return;
      T += 3; // 네트에 걸릴 것 같으면 더 높게(천천히)
    }
  }

  // 그리기 (프레임 사이 보간)
  render(ctx, alpha) {
    if (this.state === 'gone') return;
    const x = this.px + (this.x - this.px) * alpha;
    const y = this.py + (this.y - this.py) * alpha;
    const T = CONFIG.TABLE;
    // 그림자 (탁구대 위 / 바닥) — 공이 낮을수록 크고 진하게 → 높이를 가늠할 수 있음
    const overTable = x >= T.LEFT && x <= T.RIGHT && y <= T.Y;
    const sy = overTable ? T.Y : CONFIG.FLOOR_Y;
    const h = Math.max(0, sy - y);
    const sw = Math.max(2, 7 - Math.floor(h / 10));
    ctx.fillStyle = C(overTable ? 'f' : '1');
    ctx.fillRect(Math.round(x - sw / 2), sy, sw, 2);
    // 꼬리 (스매시는 불꽃색)
    this.trail.forEach((p, i) => {
      if (i === this.trail.length - 1) return;
      ctx.fillStyle = C(this.fast ? (i % 2 ? '8' : '9') : 'k');
      const s = this.fast ? 2 + Math.floor(i / 3) : 1 + (i > 0 ? 1 : 0);
      ctx.fillRect(Math.round(p.x) - (s >> 1), Math.round(p.y) - 1 - (s >> 1), s, s);
    });
    // 공 (5x5 동그라미 + 외곽선)
    const bx = Math.round(x) - 2;
    const by = Math.round(y) - 3;
    ctx.fillStyle = C('1');
    ctx.fillRect(bx, by - 1, 5, 7);
    ctx.fillRect(bx - 1, by, 7, 5);
    ctx.fillStyle = C(this.fast ? '8' : this.chance ? '9' : 'b');
    ctx.fillRect(bx, by, 5, 5);
    ctx.fillStyle = C(this.fast ? '9' : this.chance ? 't' : 'w');
    ctx.fillRect(bx + 1, by + 1, 2, 2);
    ctx.fillStyle = C(this.fast ? 'u' : this.chance ? '8' : 'k');
    ctx.fillRect(bx + 1, by + 4, 4, 1);
    ctx.fillRect(bx + 4, by + 1, 1, 4);
  }
}
