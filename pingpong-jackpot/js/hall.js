// =====================================================
// 마법사 성 카지노 탁구장 (패럴랙스 배경) + 탁구대
//  1) 성벽 + 아치 창문 너머 달밤      (아주 천천히)
//  2) 슬롯머신 줄 (불빛이 번쩍)       (조금 더)
//  3) 관중 (공을 눈으로 따라감!)      (더 많이) — 득점하면 들썩
//  4) 흔들리는 샹들리에
//  5) 카지노 카펫 바닥 + 탁구대 (고정)
//  공 위치에 따라 층마다 다른 속도로 밀려서 입체감이 생김
// =====================================================
class Hall {
  constructor() {
    if (!Hall.layers) Hall.layers = Hall.build();
    this.cam = 0;
    this.camP = 0;
    this.excite = 0;
    this.lookX = CONFIG.WIDTH / 2; // 관중이 보는 곳 (공)
    this.crowd = [];
    const cols = ['2', '3', 'i', '7', 'f', '4', 'c'];
    for (let i = 0; i < 24; i++) {
      this.crowd.push({ x: -16 + i * 15 + (i % 3) * 2, row: i % 2, col: cols[(i * 5) % cols.length], phase: i * 1.3, sign: i % 6 === 3 });
    }
  }

  static build() {
    const W = CONFIG.WIDTH;
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return [c, c.getContext('2d')];
    };
    const rect = (g, x, y, w, h, k) => {
      g.fillStyle = C(k);
      g.fillRect(x, y, w, h);
    };
    // 1) 성벽 + 아치 창문
    const [wall, wg] = mk(W + 80, 70);
    rect(wg, 0, 0, W + 80, 70, '2');
    for (let y = 0; y < 70; y += 8) {
      for (let x = (y / 8) % 2 ? -8 : 0; x < W + 80; x += 16) {
        rect(wg, x, y, 16, 1, '1');
        rect(wg, x, y, 1, 8, '1');
        rect(wg, x + 1, y + 1, 14, 1, '3');
      }
    }
    for (let i = 0; i < 5; i++) {
      const cx = 40 + i * 80;
      for (let y = 6; y < 50; y++) {
        const half = y < 18 ? Math.round(Math.sqrt(Math.max(0, 144 - (18 - y) ** 2))) : 12;
        rect(wg, cx - half - 2, y, half * 2 + 4, 1, '1');
        rect(wg, cx - half, y, half * 2, 1, y < 30 ? 'o' : 'f');
      }
      rect(wg, cx - 1, 8, 2, 42, '1');
      for (let k = 0; k < 3; k++) rect(wg, cx - 9 + ((k * 11 + i * 7) % 18), 12 + ((k * 7 + i * 5) % 14), 1, 1, 'a');
    }
    const mx = 40 + 2 * 80 + 6;
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y <= 25) rect(wg, mx + x, 20 + y, 1, 1, x * x + y * y > 16 ? 't' : 'a');

    // 2) 슬롯머신 줄 (불빛은 실시간)
    const [slots, sg] = mk(W + 120, 34);
    rect(sg, 0, 30, W + 120, 4, '1');
    for (let x = 0; x < W + 120; x += 30) {
      rect(sg, x + 2, 0, 26, 30, '1');
      rect(sg, x + 3, 1, 24, 28, '6');
      rect(sg, x + 3, 1, 24, 2, '5');
      rect(sg, x + 5, 6, 20, 9, '1');
      for (let r = 0; r < 3; r++) rect(sg, x + 6 + r * 6, 7, 5, 7, 'a');
      rect(sg, x + 5, 18, 20, 3, '7');
      rect(sg, x + 26, 8, 2, 8, 'j');
      rect(sg, x + 26, 6, 3, 3, '9');
    }

    // 5) 카지노 카펫 (원근감: 뒤가 좁고 앞이 넓음, 빨강 바탕 + 금색 마름모)
    const FY0 = 112;
    const floorH = CONFIG.HEIGHT - FY0;
    const [floor, fg] = mk(W, floorH);
    const vy = 40;
    for (let yy = 0; yy < floorH; yy++) {
      const y = yy + FY0;
      const s = (y - vy) / (CONFIG.HEIGHT - vy);
      for (let x = 0; x < W; x++) {
        const u = (x - W / 2) / s / 12;
        const v = (1 / s) * 9;
        const du = Math.abs(((u % 2) + 2) % 2 - 1);
        const dv = Math.abs(((v % 2) + 2) % 2 - 1);
        // 어두운 바탕에 은은한 무늬 (선수와 공이 잘 보이게)
        let k = '7';
        const d = du + dv;
        if (d < 0.12) k = '8';
        else if (Math.abs(d - 1) < 0.07) k = '6';
        rect(fg, x, yy, 1, 1, k);
      }
    }
    return { wall, slots, floor, FY0 };
  }

  // focusX: 공 위치 (카메라·관중 시선)
  update(frame, focusX) {
    this.camP = this.cam;
    this.cam += (focusX - CONFIG.WIDTH / 2 - this.cam) * 0.05;
    this.lookX += (focusX - this.lookX) * 0.25;
    if (this.excite > 0) this.excite--;
  }

  renderBack(ctx, frame, alpha = 1) {
    const W = CONFIG.WIDTH;
    const L = Hall.layers;
    const cam = this.camP + (this.cam - this.camP) * alpha;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    // 1) 성벽
    ctx.drawImage(L.wall, Math.round(-40 - cam * 0.1), 31);
    // 2) 슬롯머신 + 번쩍이는 릴
    const sx = Math.round(-60 - cam * 0.25);
    ctx.drawImage(L.slots, sx, 74);
    for (let x = 0; x < W + 120; x += 30) {
      const on = ((x / 30 + ((frame / 10) | 0)) % 4) === 0 || this.excite > 0;
      ctx.fillStyle = C(on ? '9' : '8');
      ctx.fillRect(sx + x + 6, 93, 18, 2);
      // 릴 그림 (7 / 체리 / 별 이 돌아감)
      for (let r = 0; r < 3; r++) {
        const sym = ((frame >> (this.excite > 0 ? 1 : 4)) + r * 3 + x) % 3;
        ctx.fillStyle = C(['6', '5', '9'][sym]);
        ctx.fillRect(sx + x + 7 + r * 6, 83, 3, 3);
      }
    }
    // 3) 관중: 공을 눈으로 따라감
    const cx = -cam * 0.45;
    const jump = this.excite > 0 ? 3 : 1;
    for (const p of this.crowd) {
      const x = Math.round(p.x + cx);
      if (x < -12 || x > W + 12) continue;
      const by = 116 - p.row * 6;
      const b = Math.round(Math.abs(Math.sin(frame / (this.excite > 0 ? 5 : 16) + p.phase)) * jump);
      ctx.fillStyle = C('1');
      ctx.fillRect(x - 6, by - 12 - b, 12, 13);
      ctx.fillStyle = C(p.col);
      ctx.fillRect(x - 5, by - 6 - b, 10, 7);
      ctx.fillStyle = C('n');
      ctx.fillRect(x - 3, by - 12 - b, 6, 6);
      // 눈: 공 쪽을 봄
      const look = Math.max(-1, Math.min(1, Math.round((this.lookX - x) / 40)));
      ctx.fillStyle = C('1');
      ctx.fillRect(x - 2 + look, by - 10 - b, 1, 2);
      ctx.fillRect(x + 1 + look, by - 10 - b, 1, 2);
      if (p.sign && (this.excite > 0 || frame % 70 < 45)) {
        ctx.fillStyle = C('9');
        ctx.fillRect(x - 5, by - 22 - b, 11, 7);
        ctx.fillStyle = C('6');
        ctx.fillRect(x - 3, by - 20 - b, 7, 3);
        ctx.fillStyle = C('1');
        ctx.fillRect(x, by - 15 - b, 1, 3);
      }
    }
    // 4) 샹들리에
    for (let i = 0; i < (this.noLamps ? 0 : 3); i++) {
      const lx = Math.round(60 + i * 100 - cam * 0.6);
      const sw = Math.round(Math.sin(frame / 40 + i) * 2);
      const x = lx + sw;
      ctx.fillStyle = C('8');
      ctx.fillRect(lx, 31, 1, 8);
      ctx.fillStyle = C('1');
      ctx.fillRect(x - 9, 38, 19, 5);
      ctx.fillStyle = C('8');
      ctx.fillRect(x - 8, 39, 17, 3);
      for (let k = -8; k <= 8; k += 4) {
        ctx.fillStyle = C((frame / 8 + k) % 3 < 1.5 ? 'b' : 't');
        ctx.fillRect(x + k, 36, 1, 2);
        ctx.fillStyle = C('h');
        ctx.fillRect(x + k, 43, 1, 2);
      }
    }
    // 5) 카펫
    ctx.drawImage(L.floor, 0, L.FY0);
  }

  // 탁구대 (파란 판 + 흰 선 + 다리)
  renderTable(ctx) {
    const T = CONFIG.TABLE;
    const y = T.Y;
    // 다리
    ctx.fillStyle = C('1');
    for (const lx of [T.LEFT + 10, T.RIGHT - 13, T.NET_X - 1]) ctx.fillRect(lx, y + 6, 3, CONFIG.FLOOR_Y - y - 6);
    ctx.fillStyle = C('i');
    for (const lx of [T.LEFT + 11, T.RIGHT - 12]) ctx.fillRect(lx, y + 6, 1, CONFIG.FLOOR_Y - y - 6);
    // 윗면 (뒤가 살짝 좁은 원근)
    ctx.fillStyle = C('1');
    ctx.fillRect(T.LEFT - 1, y - 1, T.RIGHT - T.LEFT + 2, 9);
    for (let r = 0; r < 4; r++) {
      const inset = 3 - r;
      ctx.fillStyle = C(r === 0 ? 'b' : 'g');
      ctx.fillRect(T.LEFT + inset, y + r, T.RIGHT - T.LEFT - inset * 2, 1);
    }
    ctx.fillStyle = C('b');
    ctx.fillRect(T.LEFT, y + 3, T.RIGHT - T.LEFT, 1);
    ctx.fillRect(T.LEFT + 3, y, 1, 4);
    ctx.fillRect(T.RIGHT - 4, y, 1, 4);
    // 옆면
    ctx.fillStyle = C('f');
    ctx.fillRect(T.LEFT, y + 4, T.RIGHT - T.LEFT, 3);
    ctx.fillStyle = C('9');
    ctx.fillRect(T.NET_X - 14, y + 5, 28, 1); // 금색 로고 줄
  }

  // 네트 (공 앞에 그림)
  renderNet(ctx) {
    const T = CONFIG.TABLE;
    const top = T.NET_TOP;
    ctx.fillStyle = C('1');
    ctx.fillRect(T.NET_X - 1, top - 1, 3, T.Y - top + 4);
    for (let y = top + 2; y < T.Y; y += 2) {
      ctx.fillStyle = C('k');
      ctx.fillRect(T.NET_X, y, 1, 1);
    }
    ctx.fillStyle = C('b');
    ctx.fillRect(T.NET_X - 1, top, 3, 2);
  }
}
