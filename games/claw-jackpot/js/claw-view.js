// =====================================================
// 인형뽑기 기계 그림 (기계 한 대 = 64px 칸)
//  위 간판(전구 + JACKPOT) · 유리 안(인형 더미 · 집게 · 배출구) · 아래 배출구 문 + 코인 투입구
//  인형: 캐릭터 5종을 닮은 작은 봉제 인형 + 주사위 · 칩 · 황금곰
// =====================================================
const MACHINE = {
  COL_W: 64,
  TOP: 33,       // 간판 위쪽
  GLASS_X: 3,    // 칸 안에서 유리 왼쪽
  GLASS_Y: 44,   // 유리 위쪽 (= 기계 안 좌표 0)
  BASE_Y: 130,   // 아래 받침 위쪽
};

const PLUSH = {};
function initPlushSprites() {
  PLUSH.bear = buildPlush('r', 'round', { snout: 'n', size: 14 });
  PLUSH.cat = buildPlush('w', 'pointy', { inner: 'p', whisker: true, size: 14 });
  PLUSH.duck = buildPlush('t', 'none', { beak: 'u', tuft: true, size: 14 });
  PLUSH.tiger = buildPlush('8', 'round', { stripes: true, snout: 'w', size: 14 });
  PLUSH.shiba = buildPlush('u', 'pointy', { inner: 'w', cheeks: 'w', size: 14 });
  PLUSH.gold = buildPlush('9', 'round', { snout: 't', gold: true, size: 17 });
  PLUSH.dice = buildDice();
  PLUSH.chip = buildChip();
  // 작은 그림 (받침에 줄 세우는 용도, 절반 크기)
  PLUSH.mini = {};
  for (const k of Object.keys(PLUSH)) {
    if (k === 'mini') continue;
    const src = PLUSH[k];
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, src.width, src.height, 0, 0, 8, 8);
    PLUSH.mini[k] = c;
  }
}

// 봉제 인형 얼굴 (size 12 기본): fur = 털 색, ears = round | pointy | none
function buildPlush(fur, ears, o = {}) {
  const S = o.size || 12;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const px = (x, y, w, h, k) => {
    g.fillStyle = PALETTE[k];
    g.fillRect(x, y, w, h);
  };
  const r = S / 2 - 0.5;
  const cy = S / 2 + 0.5;
  // 얼굴 동그라미 (외곽선 포함)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - cy);
      if (d > r) continue;
      g.fillStyle = PALETTE[d > r - 1 ? '1' : fur];
      g.fillRect(x, y, 1, 1);
    }
  }
  // 귀
  if (ears === 'round') {
    px(1, 0, 3, 3, '1');
    px(S - 4, 0, 3, 3, '1');
    px(2, 1, 1, 1, fur);
    px(S - 3, 1, 1, 1, fur);
  } else if (ears === 'pointy') {
    px(1, 0, 1, 3, '1');
    px(2, 1, 1, 2, '1');
    px(S - 2, 0, 1, 3, '1');
    px(S - 3, 1, 1, 2, '1');
    if (o.inner) {
      px(2, 2, 1, 1, o.inner);
      px(S - 3, 2, 1, 1, o.inner);
    }
  }
  // 눈 (반짝 점) + 볼터치
  const ey = Math.round(S * 0.45);
  px(Math.round(S * 0.3), ey, 1, 2, '1');
  px(S - 1 - Math.round(S * 0.3), ey, 1, 2, '1');
  if (S >= 14) {
    px(Math.round(S * 0.3) - 1, ey + 2, 2, 1, 'p');
    px(S - 1 - Math.round(S * 0.3), ey + 2, 2, 1, 'p');
    px(3, 3, 2, 1, 'w');
  }
  // 주둥이 / 부리
  if (o.snout) px(Math.round(S / 2) - 2, ey + 2, 4, 2, o.snout);
  if (o.snout) px(Math.round(S / 2) - 1, ey + 2, 2, 1, '1');
  if (o.beak) px(Math.round(S / 2) - 2, ey + 2, 4, 2, o.beak);
  if (o.tuft) px(Math.round(S / 2) - 1, 0, 2, 2, '1');
  if (o.cheeks) {
    px(1, ey + 2, 2, 2, o.cheeks);
    px(S - 3, ey + 2, 2, 2, o.cheeks);
  }
  if (o.stripes) {
    px(Math.round(S / 2) - 1, 2, 2, 1, '1');
    px(1, ey, 1, 1, '1');
    px(S - 2, ey, 1, 1, '1');
  }
  if (o.whisker) {
    px(0, ey + 2, 2, 1, 'j');
    px(S - 2, ey + 2, 2, 1, 'j');
  }
  if (o.gold) {
    // 왕관 (가운데 위)
    px(Math.round(S / 2) - 2, 0, 5, 2, '8');
    px(Math.round(S / 2) - 2, 0, 1, 1, '9');
    px(Math.round(S / 2), 0, 1, 1, '9');
    px(Math.round(S / 2) + 2, 0, 1, 1, '9');
    // 반짝 하이라이트
    px(3, 3, 2, 1, 't');
    px(3, 4, 1, 1, 't');
  }
  return c;
}

function buildDice() {
  const S = 12;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE['1'];
  g.fillRect(1, 0, S - 2, S);
  g.fillRect(0, 1, S, S - 2);
  g.fillStyle = PALETTE.w;
  g.fillRect(1, 1, S - 2, S - 2);
  g.fillStyle = PALETTE.k;
  g.fillRect(1, S - 3, S - 2, 2);
  g.fillStyle = PALETTE['6'];
  for (const [x, y] of [[2, 2], [8, 2], [5, 5], [2, 8], [8, 8]]) g.fillRect(x, y, 2, 2);
  return c;
}

function buildChip() {
  const S = 10;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2);
      if (d > S / 2 - 0.3) continue;
      const edge = d > S / 2 - 1.3;
      const notch = edge && (x + y) % 3 === 0;
      g.fillStyle = PALETTE[d > S / 2 - 0.9 && !notch ? '1' : notch ? 'b' : d < 1.6 ? '9' : '6'];
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function drawPrize(ctx, gx, gy, p) {
  const img = PLUSH[p.type];
  ctx.drawImage(img, Math.round(gx + p.x - img.width / 2), Math.round(gy + p.y - img.height / 2));
}

// ---- 기계 한 대 ----
// m: Machine, o: { frame, color(캐릭터 색), flash(획득 반짝 남은 시간), gold(황금곰 반짝) }
function drawMachine(ctx, x0, m, o) {
  const M = MACHINE;
  const f = o.frame;
  drawMachineBody(ctx, x0, f, o);
  drawGlass(ctx, x0 + M.GLASS_X, M.GLASS_Y, m, f);
  drawGlassLabels(ctx, x0 + M.GLASS_X, M.GLASS_Y, 1);
  drawMachineBase(ctx, x0, m, f);
}

// 몸체 + 간판 (획득하면 전구가 빠르게 번쩍)
function drawMachineBody(ctx, x0, f, o) {
  const M = MACHINE;
  drawCard(ctx, x0 + 1, M.TOP, 62, 110, '7', o.color);
  ctx.fillStyle = C('1');
  ctx.fillRect(x0 + 3, M.TOP + 2, 58, 8);
  const fast = o.flash > 0;
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = C((i + (f >> (fast ? 1 : 3))) % 2 ? '9' : fast ? 'b' : '8');
    ctx.fillRect(x0 + 5 + i * 6, M.TOP + 2, 2, 1);
  }
  const sign = o.gold > 0 ? (f % 6 < 3 ? C('b') : C('5')) : (f >> 4) % 4 ? C('9') : C('b');
  BitmapFont.draw(ctx, 'JACKPOT', x0 + 32, M.TOP + 4, sign, { align: 'center' });
}

// 유리 안 (gx, gy = 기계 안 좌표 0,0 의 화면 위치) — 확대 그림에도 그대로 씀
function drawGlass(ctx, gx, gy, m, f) {
  const B = CONFIG.BOX;
  ctx.fillStyle = C('f');
  ctx.fillRect(gx, gy, B.W, B.H);
  ctx.fillStyle = DITHER.get(ctx, '2', 6);
  ctx.fillRect(gx, gy + 40, B.W, B.H - 40);
  // 집게 레일
  ctx.fillStyle = C('i');
  ctx.fillRect(gx, gy + 2, B.W, 2);
  ctx.fillStyle = C('j');
  ctx.fillRect(gx, gy + 2, B.W, 1);
  // 배출구: 아래가 뚫린 검은 구멍 + 투명 칸막이 + 아래 화살표
  ctx.fillStyle = C('o');
  ctx.fillRect(gx, gy + B.H - 6, B.HOLE_W, 6);
  ctx.fillStyle = DITHER.get(ctx, 'h', 4);
  ctx.fillRect(gx, gy + B.WALL_TOP, B.HOLE_W, B.H - B.WALL_TOP - 6);
  ctx.fillStyle = C('h');
  ctx.fillRect(gx + B.HOLE_W - 1, gy + B.WALL_TOP, 2, B.H - B.WALL_TOP);
  ctx.fillStyle = C('b');
  ctx.fillRect(gx + B.HOLE_W - 1, gy + B.WALL_TOP, 2, 1);
  const ax = gx + Math.floor(B.HOLE_W / 2);
  const ay = gy + B.H - 14 + ((f >> 3) % 2);
  ctx.fillStyle = C('9');
  ctx.fillRect(ax - 3, ay, 7, 1);
  ctx.fillRect(ax - 2, ay + 1, 5, 1);
  ctx.fillRect(ax - 1, ay + 2, 3, 1);
  ctx.fillRect(ax, ay + 3, 1, 1);
  // 조준 그림자: 집게 바로 아래 첫 인형(또는 바닥)에 점선 + 그림자
  const c = m.claw;
  if (c.state === 'move') {
    let ty = B.H;
    for (const p of m.prizes) if (Math.abs(p.x - c.x) < p.r - 1) ty = Math.min(ty, p.y - p.r);
    const cx = Math.round(gx + c.x);
    ctx.fillStyle = C('5');
    for (let y = Math.round(gy + c.y + 11); y < gy + ty - 2; y += 3) ctx.fillRect(cx, y, 1, 1);
    ctx.fillStyle = C('1');
    ctx.fillRect(cx - 3, Math.round(gy + ty - 1), 7, 2);
    ctx.fillStyle = C('5');
    ctx.fillRect(cx - 1, Math.round(gy + ty - 1), 3, 1);
  }
  for (const p of m.prizes) drawPrize(ctx, gx, gy, p);
  drawClaw(ctx, gx, gy, m.claw);
  // 황금곰 반짝임
  for (const p of m.prizes) {
    if (p.type !== 'gold' || (f + p.id * 7) % 40 > 8) continue;
    ctx.fillStyle = C('b');
    const sx = Math.round(gx + p.x + 5);
    const sy = Math.round(gy + p.y - 7);
    ctx.fillRect(sx, sy - 1, 1, 3);
    ctx.fillRect(sx - 1, sy, 3, 1);
  }
  // 유리 반사
  ctx.fillStyle = DITHER.get(ctx, 'b', 4);
  ctx.fillRect(gx + 2, gy + 6, 1, 20);
}

// 유리 위 글씨 ('출구') — 확대해도 글씨는 원래 크기로
function drawGlassLabels(ctx, gx, gy, s) {
  const B = CONFIG.BOX;
  // 배출구 칸 안쪽 (칸막이 꼭대기 바로 아래) — 작은 기계는 'OUT', 확대하면 '출구'
  const lx = Math.round(gx + (B.HOLE_W * s) / 2);
  const ly = gy + (B.WALL_TOP + 2) * s;
  if (s === 1) {
    ctx.fillStyle = C('1');
    ctx.fillRect(lx - 7, ly, 13, 7);
    BitmapFont.draw(ctx, 'OUT', lx, ly + 1, C('9'), { align: 'center' });
  } else {
    const tw = KText.width('출구', 'n') + 4;
    ctx.fillStyle = C('1');
    ctx.fillRect(Math.round(lx - tw / 2), ly, tw, 11);
    KText.draw(ctx, '출구', lx, ly, C('9'), { align: 'center', font: 'n' });
  }
}

// 아래 받침: 뽑은 인형 진열 칸 + 코인 투입구
function drawMachineBase(ctx, x0, m, f) {
  const M = MACHINE;
  ctx.fillStyle = C('1');
  ctx.fillRect(x0 + 3, M.BASE_Y, 58, 11);
  ctx.fillStyle = C('2');
  ctx.fillRect(x0 + 4, M.BASE_Y + 1, 38, 9);
  ctx.fillStyle = C('j');
  ctx.fillRect(x0 + 4, M.BASE_Y + 1, 38, 1);
  drawWonRow(ctx, x0 + 5, M.BASE_Y + 2, m.won, 4);
  // 코인 투입구 (COIN 글자 + 동전 구멍)
  ctx.fillStyle = C('i');
  ctx.fillRect(x0 + 44, M.BASE_Y + 1, 16, 9);
  BitmapFont.draw(ctx, 'COIN', x0 + 52, M.BASE_Y + 2, C('9'), { align: 'center' });
  ctx.fillStyle = C('1');
  ctx.fillRect(x0 + 49, M.BASE_Y + 8, 6, 1);
}

// 뽑은 인형 줄 (작은 그림 · 칸이 모자라면 '+N')
function drawWonRow(ctx, x, y, won, maxN) {
  const n = won.length;
  const show = n > maxN ? won.slice(-(maxN - 1)) : won;
  show.forEach((p, i) => ctx.drawImage(PLUSH.mini[p.type], x + i * 9, y));
  if (n > maxN) BitmapFont.draw(ctx, `+${n - maxN + 1}`, x + (maxN - 1) * 9 + 1, y + 1, C('9'));
}

function drawClaw(ctx, gx, gy, c) {
  const x = Math.round(gx + c.x);
  const y = Math.round(gy + c.y);
  // 줄 (2px)
  ctx.fillStyle = C('1');
  ctx.fillRect(x - 1, gy + 4, 3, Math.max(0, y - gy - 4));
  ctx.fillStyle = C('k');
  ctx.fillRect(x, gy + 4, 1, Math.max(0, y - gy - 4));
  // 머리 (튼튼한 몸통 + 빨간 불빛)
  ctx.fillStyle = C('1');
  ctx.fillRect(x - 5, y - 1, 11, 6);
  ctx.fillStyle = C('j');
  ctx.fillRect(x - 4, y, 9, 4);
  ctx.fillStyle = C('b');
  ctx.fillRect(x - 4, y, 4, 1);
  ctx.fillStyle = C(c.grab ? 'e' : c.state === 'close' ? '9' : '5');
  ctx.fillRect(x, y + 2, 1, 1);
  // 집게발 (2px 굵기): 벌어짐 정도에 따라 바깥으로 · 끝은 안쪽으로 굽음
  const spread = Math.round(1 + c.open * 5);
  for (const s of [-1, 1]) {
    const kx = x + s * 3;
    const tx = x + s * spread;
    drawPixelLine(ctx, kx, y + 5, tx + s, y + 9, C('1'), 2);
    drawPixelLine(ctx, kx, y + 4, tx, y + 8, C('k'), 1);
    ctx.fillStyle = C('1');
    ctx.fillRect(tx - s * 2, y + 10, 3, 2);
    ctx.fillStyle = C('k');
    ctx.fillRect(tx - s, y + 10, 1, 1);
  }
}

// 동전 하나 그림 (코인 개수 옆에)
function drawCoinIcon(ctx, x, y) {
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 1, y, 5, 7);
  ctx.fillRect(x, y + 1, 7, 5);
  ctx.fillStyle = C('9');
  ctx.fillRect(x + 1, y + 1, 5, 5);
  ctx.fillStyle = C('8');
  ctx.fillRect(x + 3, y + 2, 1, 3);
  ctx.fillStyle = C('t');
  ctx.fillRect(x + 1, y + 1, 1, 1);
}

// 남은 코인 (금색 동전)
function drawCoins(ctx, x, y, left, max) {
  for (let i = 0; i < max; i++) {
    const cx = x + i * 4;
    ctx.fillStyle = C('1');
    ctx.fillRect(cx, y, 4, 5);
    ctx.fillStyle = i < left ? C('9') : C('2');
    ctx.fillRect(cx, y + 1, 3, 3);
    if (i < left) {
      ctx.fillStyle = C('t');
      ctx.fillRect(cx, y + 1, 1, 1);
    }
  }
}

// 결과·타이틀 배경: 오락실 바닥 (체크무늬 + 흐르는 네온)
function drawArcade(ctx, frame) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HEIGHT;
  ctx.fillStyle = C('o');
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 10) {
    for (let x = ((y / 10) % 2) * 10; x < W; x += 20) {
      ctx.fillStyle = DITHER.get(ctx, '2', 8);
      ctx.fillRect(x, y, 10, 10);
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = (i * 71 + frame * (i % 2 ? 0.2 : 0.4)) % (W + 10) - 5;
    const y = (i * 23) % H;
    ctx.fillStyle = C(['4', 'h', '9'][i % 3]);
    if ((frame + i * 9) % 50 < 38) ctx.fillRect(Math.round(x), y, 1, 1);
  }
}
