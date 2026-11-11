// =====================================================
// 복싱 링 + 카지노 관중석 (패럴랙스 3레이어)
//  1) 먼 관중 (천천히 들썩)  2) 가까운 관중 (빨리 들썩)  3) 링 + 로프 + 조명
// =====================================================
class Ring {
  constructor() {
    this.crowdFar = this.makeCrowd(34, 30, 6);
    this.crowdNear = this.makeCrowd(22, 58, 10);
    this.excite = 0; // 강펀치/KO 때 관중이 크게 들썩
    if (!Ring.mat) Ring.mat = this.buildMat();
  }

  makeCrowd(n, baseY, size) {
    const list = [];
    const cols = ['2', '3', 'i', '7', 'f'];
    for (let i = 0; i < n; i++) {
      list.push({
        x: (i / n) * CONFIG.WIDTH + Math.random() * 8,
        y: baseY + Math.random() * 4,
        s: size + Math.floor(Math.random() * 3),
        col: cols[(Math.random() * cols.length) | 0],
        phase: Math.random() * 10,
        sign: Math.random() < 0.15,
      });
    }
    return list;
  }

  // 링 바닥 (한 번만 그림)
  buildMat() {
    const R = CONFIG.RING;
    const W = CONFIG.WIDTH;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = 70;
    const g = c.getContext('2d');
    const rect = (x, y, w, h, k) => {
      g.fillStyle = PALETTE[k];
      g.fillRect(x, y, w, h);
    };
    // 매트 (사다리꼴: 뒤가 좁고 앞이 넓음)
    for (let y = 0; y < 46; y++) {
      const inset = Math.round((46 - y) * 0.5);
      rect(R.LEFT - 26 + inset, y, R.RIGHT - R.LEFT + 52 - inset * 2, 1, 'k');
      for (let x = R.LEFT - 26 + inset + (y % 4); x < R.RIGHT + 26 - inset; x += 8) if (y % 4 === 0) rect(x, y, 1, 1, 'j');
    }
    // 가운데 마법진 로고
    const cx = W / 2;
    for (let a = 0; a < 80; a++) {
      const ang = (a / 80) * Math.PI * 2;
      rect(Math.round(cx + Math.cos(ang) * 30), Math.round(26 + Math.sin(ang) * 9), 1, 1, '4');
    }
    for (let i = -8; i <= 8; i++) rect(cx + i, 26 - Math.round((8 - Math.abs(i)) * 0.6), 1, 1, '9');
    // 앞 앞치마 (링 옆면)
    rect(R.LEFT - 26, 46, R.RIGHT - R.LEFT + 52, 12, '6');
    rect(R.LEFT - 26, 46, R.RIGHT - R.LEFT + 52, 1, '5');
    rect(R.LEFT - 26, 57, R.RIGHT - R.LEFT + 52, 1, '7');
    return c;
  }

  update(frame) {
    if (this.excite > 0) this.excite--;
  }

  // 뒤쪽 (관중 + 링 바닥 + 뒤 로프)
  renderBack(ctx, frame) {
    const W = CONFIG.WIDTH;
    const R = CONFIG.RING;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    // 천장 조명 (디더 원뿔)
    ctx.fillStyle = ctx.createPattern(Transition.patterns[3], 'repeat');
    for (let y = 24; y < 130; y++) {
      const half = Math.round((y - 24) * 0.75) + 6;
      ctx.fillRect(W / 2 - half, y, half * 2, 1);
    }
    // 관중 (머리 + 어깨 실루엣이 리듬 타며 들썩)
    const jump = this.excite > 0 ? 3 : 1;
    const drawCrowd = (list, speed) => {
      for (const p of list) {
        const b = Math.round(Math.abs(Math.sin(frame / speed + p.phase)) * jump);
        const x = Math.round(p.x);
        const y = Math.round(p.y) - b;
        ctx.fillStyle = C(p.col);
        ctx.fillRect(x - p.s / 2, y, p.s, p.s);
        ctx.fillRect(x - p.s / 2 - 2, y + p.s - 1, p.s + 4, p.s);
        if (p.sign && frame % 40 < 30) {
          // 응원 피켓
          ctx.fillStyle = C('9');
          ctx.fillRect(x - 4, y - 8, 8, 5);
          ctx.fillStyle = C('1');
          ctx.fillRect(x, y - 3, 1, 3);
        }
      }
    };
    drawCrowd(this.crowdFar, 12);
    // 카지노 전광판
    drawPanel(ctx, W / 2 - 66, 3, 132, 18, 'red');
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = (i + ((frame / 8) | 0)) % 2 ? C('9') : C('8');
      ctx.fillRect(W / 2 - 62 + i * 8, 5, 2, 2);
    }
    drawCrowd(this.crowdNear, 8);
    // 관중을 어둡게 (선수가 돋보이도록)
    ctx.fillStyle = ctx.createPattern(Transition.patterns[8], 'repeat');
    ctx.fillRect(0, 26, W, 70);
    // 링 바닥
    ctx.drawImage(Ring.mat, 0, R.FLOOR_Y - 46 + 6);
    // 뒤 로프 3줄 + 기둥
    const ropeCols = ['6', 'b', 'g'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = C(ropeCols[i]);
      ctx.fillRect(R.LEFT - 12, 74 + i * 8, R.RIGHT - R.LEFT + 24, 1);
    }
    ctx.fillStyle = C('j');
    ctx.fillRect(R.LEFT - 14, 70, 3, 26);
    ctx.fillRect(R.RIGHT + 11, 70, 3, 26);
  }

  // 앞쪽 (앞 로프 + 기둥: 선수 앞에 그림)
  renderFront(ctx, frame) {
    const R = CONFIG.RING;
    // 코너 기둥 (홍코너 빨강, 청코너 파랑)
    const post = (x, col) => {
      ctx.fillStyle = C('1');
      ctx.fillRect(x - 3, 118, 6, 26);
      ctx.fillStyle = C(col);
      ctx.fillRect(x - 2, 119, 4, 24);
      ctx.fillStyle = C('b');
      ctx.fillRect(x - 2, 119, 1, 24);
    };
    post(R.LEFT - 24, '6');
    post(R.RIGHT + 24, 'g');
    // 앞 로프 (선수가 잘 보이도록 발목 높이로 낮게, 살짝 출렁임)
    const ropeCols = ['6', 'b', 'g'];
    const sway = Math.round(Math.sin(frame / 20));
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = C(ropeCols[i]);
      ctx.fillRect(R.LEFT - 22, 126 + i * 6 + (i === 1 ? sway : 0), R.RIGHT - R.LEFT + 44, 1);
    }
  }
}
