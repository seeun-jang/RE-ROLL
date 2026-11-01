// =====================================================
// 볼러 뒤에서 본 레인 (유사 3D 원근)
//  - 물리는 bowling.js 의 위에서 본 2D 좌표 그대로, 그림만 원근으로 바꿔 그림
//  - proj(x, y): 레인 좌표 → 화면 좌표 + 크기 비율 (멀수록 좁고 작게)
//  - 레인 바닥 / 핀 / 공 / 마스킹 유닛(핀 위 간판) / 피니세터 스위퍼 / 핀 표시판 / 볼링장 배경
// =====================================================
const VIEW = {
  CX: 160,        // 레인 가운데 화면 x
  FOUL_SY: 162,   // 파울 라인 화면 y
  PIT_SY: 89,     // 레인 끝(핀 구덩이) 화면 y
  DEPTH: 80,      // 레인 끝까지 거리 (레인 좌표)
  K: 3,           // 파울 라인에서 레인 좌표 1 = 3px
  SHRINK: 0.5,    // 레인 끝에서 폭이 이만큼 줄어듦
  MASK_Y: 76,     // 마스킹 유닛(간판) 위쪽
};

// 레인 좌표 → { x, y, s }  (s = 크기 비율, 파울 라인 1)
function proj(x, y) {
  const V = VIEW;
  if (y < 0) {
    // 어프로치 (파울 라인 앞): 원근 거의 없이 아래로
    const s = 1 - y * 0.004;
    return { x: V.CX + x * V.K * s, y: V.FOUL_SY - y * 1.2, s };
  }
  const yy = Math.min(y, V.DEPTH + 6);
  const f = Math.pow(yy / V.DEPTH, 0.85);
  const s = 1 - (V.SHRINK * yy) / V.DEPTH;
  return { x: V.CX + x * V.K * s, y: V.FOUL_SY - (V.FOUL_SY - V.PIT_SY) * f, s };
}

// 화면 줄 → 레인 깊이 (원근 역변환 표, 한 번만 계산)
let ROW_DEPTH = null;
function rowDepth() {
  if (ROW_DEPTH) return ROW_DEPTH;
  ROW_DEPTH = new Map();
  for (let y = VIEW.DEPTH + 6; y >= -16; y -= 0.05) {
    const r = Math.round(proj(0, y).y);
    if (!ROW_DEPTH.has(r)) ROW_DEPTH.set(r, y);
  }
  return ROW_DEPTH;
}

// ---- 스프라이트 ----
const PIN3D_ART = {
  big: [
    '..111..',
    '.1bbb1.',
    '.1bbk1.',
    '..1b1..',
    '.16661.',
    '..1b1..',
    '.1bbb1.',
    '1bbbbk1',
    '1bbbbk1',
    '1bbbbk1',
    '.1bbk1.',
    '.1bbk1.',
    '..111..',
  ],
  small: [
    '.111.',
    '.1b1.',
    '.161.',
    '.1b1.',
    '1bbb1',
    '1bbk1',
    '1bbk1',
    '.1k1.',
    '.111.',
  ],
};

const SPR3D = {};
function initBowlSprites() {
  for (const size of ['big', 'small']) {
    SPR3D[size] = buildSprite(PIN3D_ART[size]);
    SPR3D[size + 'Gold'] = buildSprite(PIN3D_ART[size], { b: '9', k: '8' });
    SPR3D[size + 'Down'] = rotate90(SPR3D[size]);
    SPR3D[size + 'GoldDown'] = rotate90(SPR3D[size + 'Gold']);
  }
  SPR3D.tiny = buildSprite(['.1.', '1b1', '161', '1b1', '111']); // 전광판 핀 아이콘
  // 공: 캐릭터 색 × 크기(지름 11 · 9 · 7 · 5) × 구르는 3프레임
  SPR3D.balls = CHARACTERS.map((ch) => [11, 9, 7, 5].map((d) => [0, 1, 2].map((f) => buildBall3D(d, ch.color, f))));
}

function rotate90(src) {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(src, 0, 0);
  return c;
}

function buildBall3D(d, color, f) {
  const c = document.createElement('canvas');
  c.width = d;
  c.height = d;
  const g = c.getContext('2d');
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      let k = color;
      if (dist > r - 1) k = '1';
      else if (dx + dy > r * 0.6) k = DARK_OF[color] || '3';
      else if (dx + dy < -r * 0.7) k = 'b';
      g.fillStyle = PALETTE[k];
      g.fillRect(x, y, 1, 1);
    }
  }
  // 손가락 구멍 (굴러가면 위로 돌아감)
  if (d >= 7) {
    const hy = Math.round(r - 1 + [1, -1, 3][f] * (d / 11));
    g.fillStyle = PALETTE['1'];
    g.fillRect(Math.round(r - 2), hy, 1, 1);
    g.fillRect(Math.round(r), hy, 1, 1);
    g.fillRect(Math.round(r - 1), hy + 2, 1, 1);
  }
  return c;
}

// ---- 레인 바닥 (화면 줄마다 깊이를 구해서 칠함) ----
function drawLane3D(ctx, frame = 0) {
  const L = CONFIG.LANE;
  const rows = rowDepth();
  for (let sy = VIEW.PIT_SY; sy < CONFIG.HEIGHT; sy++) {
    const y = rows.has(sy) ? rows.get(sy) : -16;
    const p = proj(0, y);
    const s = p.s;
    const half = L.HALF * VIEW.K * s;
    const gut = (L.HALF + 5) * VIEW.K * s;
    const wall = (L.WALL + 4) * VIEW.K * s;
    const cx = VIEW.CX;
    // 옆 바닥 (어두운 카펫 + 이웃 레인 불빛)
    ctx.fillStyle = C(sy % 4 === 0 ? '2' : 'o');
    ctx.fillRect(0, sy, CONFIG.WIDTH, 1);
    if (y > 47) {
      // 핀 데크 옆 킥백 벽
      ctx.fillStyle = C(y > VIEW.DEPTH - 2 ? '1' : 's');
      ctx.fillRect(Math.round(cx - wall), sy, Math.round(wall * 2), 1);
    }
    if (y > VIEW.DEPTH) {
      // 핀 구덩이
      ctx.fillStyle = C('o');
      ctx.fillRect(Math.round(cx - gut), sy, Math.round(gut * 2), 1);
      continue;
    }
    if (y >= 0) {
      // 거터 (둥근 홈: 가장자리 밝게)
      ctx.fillStyle = C('i');
      ctx.fillRect(Math.round(cx - gut), sy, Math.round(gut - half), 1);
      ctx.fillRect(Math.round(cx + half), sy, Math.round(gut - half) + 1, 1);
      ctx.fillStyle = C('2');
      ctx.fillRect(Math.round(cx - gut + (gut - half) * 0.3), sy, Math.max(1, Math.round((gut - half) * 0.5)), 1);
      ctx.fillRect(Math.round(cx + half + (gut - half) * 0.25), sy, Math.max(1, Math.round((gut - half) * 0.5)), 1);
    }
    // 레인 / 어프로치 나무
    const wood = y < 0 ? 'n' : y > 50 ? 'n' : 'm';
    ctx.fillStyle = C(wood);
    ctx.fillRect(Math.round(cx - half), sy, Math.round(half * 2) + 1, 1);
    if (y >= 0 && y <= 50) {
      // 판자 줄 (원근으로 모이는 선)
      ctx.fillStyle = C('u');
      for (let bx = -L.HALF + 4; bx < L.HALF; bx += 4) ctx.fillRect(Math.round(cx + bx * VIEW.K * s), sy, 1, 1);
    }
  }
  // 파울 라인
  const f0 = proj(0, 0);
  ctx.fillStyle = C('6');
  ctx.fillRect(Math.round(f0.x - (L.HALF + 5) * VIEW.K), Math.round(f0.y), (L.HALF + 5) * VIEW.K * 2, 2);
  // 조준 화살표 (7개, 가운데가 가장 멀리)
  for (let i = -3; i <= 3; i++) {
    const a = proj(i * 5, 17 + (3 - Math.abs(i)) * 1.6);
    const w = Math.max(1, Math.round(2 * a.s));
    ctx.fillStyle = C('l');
    ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
    ctx.fillRect(Math.round(a.x) - w, Math.round(a.y) + 1, w * 2 + 1, 1);
  }
  // 점 (어프로치 쪽)
  for (let i = -2; i <= 2; i++) {
    const d = proj(i * 6, 6);
    ctx.fillStyle = C('l');
    ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
    const a = proj(i * 6, -7);
    ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
  }
}

// 마스킹 유닛 (핀 위 간판): 네온 '잭팟' + 깜빡이는 전구
function drawMasking(ctx, frame, laneNo = 7) {
  const y0 = VIEW.MASK_Y;
  const back = proj(0, VIEW.DEPTH);
  const half = Math.round((CONFIG.LANE.WALL + 10) * VIEW.K * back.s);
  const x0 = VIEW.CX - half;
  ctx.fillStyle = C('1');
  ctx.fillRect(x0 - 1, y0, half * 2 + 2, VIEW.PIT_SY - y0 + 2);
  ctx.fillStyle = C('7');
  ctx.fillRect(x0, y0 + 1, half * 2, VIEW.PIT_SY - y0);
  for (let i = 0; i < half / 3; i++) {
    ctx.fillStyle = C((i + (frame >> 3)) % 3 ? '8' : '9');
    ctx.fillRect(x0 + 2 + i * 6, y0 + 2, 2, 1);
    ctx.fillRect(x0 + 2 + i * 6, VIEW.PIT_SY - 1, 2, 1);
  }
  KText.draw(ctx, '잭팟', VIEW.CX, y0 + 2, (frame >> 5) % 8 ? C('9') : C('a'), { align: 'center', font: 'n' });
  BitmapFont.draw(ctx, String(laneNo), x0 + 4, y0 + 6, C('k'));
}

// 피니세터 스위퍼: k 0~1 (내려옴 → 쓸고 → 올라감)
function drawSweeper(ctx, k) {
  if (k <= 0 || k >= 1) return;
  let depth;
  let drop;
  if (k < 0.3) {
    depth = 50;
    drop = k / 0.3;
  } else if (k < 0.7) {
    depth = 50 + ((k - 0.3) / 0.4) * 30;
    drop = 1;
  } else {
    depth = 80;
    drop = 1 - (k - 0.7) / 0.3;
  }
  const p = proj(0, depth);
  const half = Math.round((CONFIG.LANE.WALL + 3) * VIEW.K * p.s);
  const bottom = Math.round(VIEW.PIT_SY + (p.y - VIEW.PIT_SY) * drop);
  ctx.fillStyle = C('1');
  ctx.fillRect(VIEW.CX - half - 1, VIEW.PIT_SY, half * 2 + 2, bottom - VIEW.PIT_SY + 1);
  ctx.fillStyle = C('i');
  ctx.fillRect(VIEW.CX - half, bottom - 3, half * 2, 3);
  ctx.fillStyle = C('j');
  ctx.fillRect(VIEW.CX - half, bottom - 3, half * 2, 1);
}

// ---- 핀 + 공 (먼 것부터 그려서 겹침 자연스럽게) ----
// drop: 새 핀이 내려오는 연출 (위로 띄울 px)
function drawPinsAndBall(ctx, rack, ballColor, drop = 0) {
  const items = rack.pins.filter((p) => !p.gone).map((p) => ({ y: p.y, pin: p }));
  const b = rack.ball;
  if (b && !b.gone) items.push({ y: b.y, ball: b });
  items.sort((a, z) => z.y - a.y);
  for (const it of items) {
    if (it.ball) drawBall3D(ctx, it.ball, ballColor);
    else drawPin3D(ctx, it.pin, drop);
  }
}

function drawPin3D(ctx, p, drop = 0) {
  const s = proj(p.x, p.y);
  const size = s.s > 0.6 ? 'big' : 'small';
  const gold = p.gold ? 'Gold' : '';
  if (p.up) {
    const img = SPR3D[size + gold];
    ctx.drawImage(img, Math.round(s.x - img.width / 2), Math.round(s.y - img.height + 1 - drop));
  } else {
    const img = SPR3D[size + gold + 'Down'];
    const tilt = p.fall < 0.4 ? Math.round((0.4 - p.fall) * 10) : 0;
    ctx.drawImage(img, Math.round(s.x - img.width / 2), Math.round(s.y - img.height + 1 - tilt));
  }
}

function drawBall3D(ctx, b, colorIdx) {
  const s = proj(b.x, b.y);
  const d = s.s > 0.92 ? 0 : s.s > 0.78 ? 1 : s.s > 0.6 ? 2 : 3;
  const frames = SPR3D.balls[colorIdx][d];
  const img = frames[Math.floor(Math.abs(b.y) / 2.5) % 3];
  const gy = b.gutter ? 2 : 0; // 거터에 빠지면 조금 가라앉음
  if (b.gutter) ctx.drawImage(img, 0, 0, img.width, img.height - gy, Math.round(s.x - img.width / 2), Math.round(s.y - img.height + gy + 1), img.width, img.height - gy);
  else ctx.drawImage(img, Math.round(s.x - img.width / 2), Math.round(s.y - img.height + 1));
}

// 핀 표시판 (서 있는 핀 = 밝게, 쓰러진 핀 = 어둡게) — 실제 전광판의 핀 표시
function drawPinIndicator(ctx, cx, top, rack, cell = 7) {
  const spots = pinSpots();
  rack.pins.forEach((p, i) => {
    const sp = spots[i];
    const row = Math.round((sp.y - CONFIG.LANE.HEAD_Y) / CONFIG.LANE.PIN_GAP_Y);
    const x = Math.round(cx + (sp.x / CONFIG.LANE.PIN_GAP_X) * cell);
    const y = top + (3 - row) * (cell - 1);
    const up = p.up && !p.gone;
    ctx.fillStyle = C('1');
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.fillStyle = up ? C(p.gold ? '9' : 'b') : C('2');
    ctx.fillRect(x - 1, y - 1, 3, 3);
    if (up) {
      ctx.fillStyle = C(p.gold ? '8' : 'k');
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  });
}

// ---- 볼링장 배경 (어두운 벽 + 네온 줄 + 흐르는 불빛) ----
function drawAlley(ctx, frame) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HEIGHT;
  ctx.fillStyle = C('o');
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C('2');
  for (let y = 0; y < H; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < W; x += 12) ctx.fillRect(x, y, 1, 1);
  const on = (frame >> 4) % 6 !== 0;
  ctx.fillStyle = on ? C('4') : C('3');
  ctx.fillRect(0, 9, W, 1);
  ctx.fillStyle = C('g');
  ctx.fillRect(0, H - 10, W, 1);
  for (let i = 0; i < 20; i++) {
    const sp = i % 2 ? 0.2 : 0.45;
    const x = (i * 61 + frame * sp) % (W + 8) - 4;
    const y = 12 + ((i * 29) % (H - 24));
    ctx.fillStyle = C(i % 3 ? '3' : '8');
    if ((frame + i * 7) % 60 < 48) ctx.fillRect(Math.round(x), y, 1, 1);
  }
}
