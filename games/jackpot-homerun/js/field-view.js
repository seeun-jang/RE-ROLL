// =====================================================
// 그림 1) 중계 화면 (포수 뒤): 야간 조명 · 관중석 · 외야 펜스 · 잔디 줄무늬 · 마운드의 딜러 투수
//          스트라이크 존 · 노란 배트 막대 · 공 · 타자 뒷모습 (헬멧 + 등번호)
// 그림 2) 타구 화면 (높은 곳에서 내려다봄): 부채꼴 구장 · 수비수 · 공 궤적 · 홈런이면 관중석으로
// =====================================================
function px(ctx, x, y, w, h, k) {
  ctx.fillStyle = C(k);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 관중 (한 번만 만들어 둠)
const CROWD = (() => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 44;
  const g = c.getContext('2d');
  const cols = ['5', '9', 'h', 'b', 'e', 'q', '8', 'p', 'k'];
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = PALETTE['2'];
  g.fillRect(0, 0, 320, 44);
  for (let y = 0; y < 44; y += 5) {
    g.fillStyle = PALETTE[y % 10 ? '3' : '2'];
    g.fillRect(0, y + 4, 320, 1);
    for (let x = (y / 5) % 2 ? 2 : 0; x < 320; x += 4) {
      if (rnd() < 0.12) continue;
      g.fillStyle = PALETTE[cols[(rnd() * cols.length) | 0]];
      g.fillRect(x, y + 1, 2, 2);
      g.fillStyle = PALETTE.n;
      g.fillRect(x, y, 2, 1);
    }
  }
  return c;
})();

// 조명탑 불빛
function drawLights(ctx, frame) {
  for (const x of [20, 300]) {
    px(ctx, x - 1, 0, 2, 16, '2');
    px(ctx, x - 9, 2, 18, 8, '1');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) px(ctx, x - 8 + i * 4, 3 + j * 3, 3, 2, (frame + i * 7 + j) % 90 < 86 ? 'b' : 'a');
  }
}

// ---- 1) 중계 화면 ----
function drawBroadcast(ctx, frame, crowdJump = 0) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HORIZON;
  // 밤하늘 + 관중석
  px(ctx, 0, 0, W, 60, 'o');
  ctx.drawImage(CROWD, 0, 12 - crowdJump);
  drawLights(ctx, frame);
  // 외야 펜스 (광고판)
  const wallTop = H - 14;
  px(ctx, 0, wallTop - 1, W, 1, '9');
  px(ctx, 0, wallTop, W, 12, '1');
  // 광고판: 글씨가 판 안에 쏙 들어가게 (진한 판 + 밝은 글씨 + 외곽선)
  const ads = [['RE:ROLL', '6'], ['잭팟', '8'], ['홈런 더비', 'g'], ['5종 경기', '3'], ['도전!', '7']];
  let ax = -((frame / 2) | 0) % 64;
  for (let i = 0; ax < W; i++, ax += 64) {
    const [txt, col] = ads[((i % ads.length) + ads.length) % ads.length];
    px(ctx, ax + 1, wallTop + 1, 62, 11, col);
    px(ctx, ax + 1, wallTop + 1, 62, 1, 'w');
    KText.draw(ctx, txt, ax + 32, wallTop, C('b'), { align: 'center', font: 'n', outline: C('1') });
  }
  // 잔디: 멀어질수록 줄무늬가 좁아짐
  px(ctx, 0, H - 2, W, 4, 'l'); // 경고 트랙
  let z = 0;
  for (let k = 0; k < 40; k++) {
    const z0 = 1 + k * 4;
    const y0 = H + (CONFIG.CAM_H * CONFIG.FOCAL) / (z0 + CONFIG.CAM_BACK);
    const y1 = H + (CONFIG.CAM_H * CONFIG.FOCAL) / (z0 + 4 + CONFIG.CAM_BACK);
    if (y0 < H + 2) break;
    px(ctx, 0, Math.max(H + 2, y1), W, Math.ceil(y0 - Math.max(H + 2, y1)) + 1, k % 2 ? 'c' : 'd');
    z = k;
  }
  // 내야 흙 (마운드 주변 · 홈 근처)
  const m = project(0, 0, CONFIG.MOUND);
  ellipse(ctx, m.sx, m.sy, 30, 4, 'm');
  ellipse(ctx, m.sx, m.sy - 1, 10, 2, 'r');
  px(ctx, m.sx - 3, m.sy - 2, 6, 1, 'b'); // 투수판
  const homeY = project(0, 0, 1.5).sy;
  ellipse(ctx, W / 2, CONFIG.HEIGHT + 12, 150, CONFIG.HEIGHT + 12 - homeY + 10, 'm');
  // 파울 라인
  for (const sgn of [-1, 1]) {
    const a = project(sgn * 0.3, 0, 0.3);
    const b = project(sgn * 60, 0, 60);
    drawPixelLine(ctx, Math.round(a.sx), Math.round(a.sy), Math.round(b.sx), Math.round(b.sy), C('b'));
  }
  // 타석 선
  for (const sgn of [-1, 1]) {
    const a = project(sgn * 0.45, 0, 0.9);
    const b = project(sgn * 1.25, 0, 0.9);
    const c = project(sgn * 1.25, 0, -0.9);
    drawPixelLine(ctx, Math.round(a.sx), Math.round(a.sy), Math.round(b.sx), Math.round(b.sy), C('k'));
    drawPixelLine(ctx, Math.round(b.sx), Math.round(b.sy), Math.round(c.sx), Math.round(c.sy), C('k'));
  }
}

function ellipse(ctx, cx, cy, rx, ry, k) {
  ctx.fillStyle = C(k);
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    ctx.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2, 1);
  }
}

// 딜러 투수 (오리지널 도트, 4 자세) · 수비수
const PITCHER_ART = {
  idle: [
    '.....1111.....',
    '....1dddd1....',
    '...1dddddd1...',
    '..1cccccccc1..',
    '...1nnnnnn1...',
    '...1n1nn1n1...',
    '...1n1nn1n1...',
    '...1pnnnnp1...',
    '....1n11n1....',
    '.....1nn1.....',
    '...11b66b11...',
    '..1bb2662bb1..',
    '.1bbb2bb2bbb1.',
    '.1bb12992l1b1.',
    '.1n1.2992lll1.',
    '..1..2222lll1.',
    '.....22221l1..',
    '.....2ii2.1...',
    '.....i11i.....',
    '....1i1.1i1...',
    '....1i1.1i1...',
    '....1i1.1i1...',
    '...1ss1.1ss1..',
    '...1111.1111..',
  ],
  kick: [
    '.....1111.....',
    '....1dddd1....',
    '...1dddddd1...',
    '..1cccccccc1..',
    '...1nnnnnn1...',
    '...1n1nn1n1...',
    '...1n1nn1n1...',
    '...1pnnnnp1...',
    '....1n11n1....',
    '.....1nn1.....',
    '...11b66b11...',
    '..1bb2662bb1..',
    '.1bbb2bb2bbb1.',
    '.1bb12992l1b1.',
    '.1n1.2992lll1.',
    '..1..2222lll1.',
    '.....22221l1..',
    '.....2ii2111..',
    '.....i11iiii1.',
    '....1i11iiss1.',
    '....1i1.1111..',
    '....1i1.......',
    '...1ss1.......',
    '...1111.......',
  ],
  back: [
    '.....1111.....',
    '....1dddd1....',
    '...1dddddd1...',
    '..1cccccccc1..',
    '...1nnnnnn1...',
    '...1n1nn1n1...',
    '...1n1nn1n1...',
    '...1pnnnnp1...',
    '....1n11n1....',
    '.....1nn1.....',
    '1n1.11b66b11..',
    '1b1.1bb2662bb1',
    '.1b1bbb2bb2bb1',
    '..1bbb12992l1.',
    '...1b1.2992ll1',
    '....1..2222ll1',
    '.....2222.1l1.',
    '.....2ii2.....',
    '....1i11i1....',
    '...1i1..1i1...',
    '..1i1....1i1..',
    '..1i1....1i1..',
    '.1ss1...1ss1..',
    '.1111...1111..',
  ],
  throw: [
    '.....1111.....',
    '....1dddd1....',
    '...1dddddd1...',
    '..1cccccccc1..',
    '...1nnnnnn1...',
    '...1n1nn1n1...',
    '...1n1nn1n1...',
    '...1pnnnnp1...',
    '....1n11n1....',
    '.....1nn1.....',
    '...11b66b11...',
    '..1bb2662bb1..',
    '.1bbb2bb2bbb1.',
    '.1bb12992bbb1.',
    '.1l1.2992.1bb1',
    '1lll12222..1n1',
    '1lll.2222...1.',
    '.1l..2ii2.....',
    '....1i11i1....',
    '...1i1..1i1...',
    '..1i1....1i1..',
    '..1i1.....1i1.',
    '.1ss1.....1ss1',
    '.1111.....1111',
  ],
};
const FIELDER_ART = [
  '.111.',
  '1ddd1',
  '1nnn1',
  '1bbb1',
  '1b2b1',
  '.1.1.',
];
const PITCHER_IMG = {};
function pitcherImg(pose) {
  if (!PITCHER_IMG[pose]) PITCHER_IMG[pose] = buildSprite(PITCHER_ART[pose]);
  return PITCHER_IMG[pose];
}

// 딜러 투수 (마운드): pose 0 서 있기 · 1 다리 들기 · 2 팔 뒤로 · 3 던짐
function drawPitcher(ctx, pose, frame) {
  const m = project(0, 0, CONFIG.MOUND);
  const img = pitcherImg(['idle', 'kick', 'back', 'throw'][pose] || 'idle');
  const bob = pose === 0 ? Math.round(Math.sin(frame / 20) * 0.6) : 0;
  ellipse(ctx, m.sx, m.sy, 7, 1, 'r');
  ctx.drawImage(img, Math.round(m.sx - img.width / 2), Math.round(m.sy - img.height) + bob);
}

// 스트라이크 존: 중계 그래픽처럼 모서리 꺾쇠 + 옅은 판 + 3x3 칸
function drawZone(ctx, frame, flash) {
  const Z = CONFIG.ZONE;
  const a = project(-Z.HALF_W, Z.HIGH, 0);
  const b = project(Z.HALF_W, Z.LOW, 0);
  const x0 = Math.round(a.sx);
  const y0 = Math.round(a.sy);
  const w = Math.round(b.sx - a.sx);
  const h = Math.round(b.sy - a.sy);
  ctx.fillStyle = DITHER.get(ctx, 'b', 1);
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = DITHER.get(ctx, 'b', 3);
  for (const k of [1, 2]) {
    ctx.fillRect(x0 + Math.round((w * k) / 3), y0 + 2, 1, h - 4);
    ctx.fillRect(x0 + 2, y0 + Math.round((h * k) / 3), w - 4, 1);
  }
  const col = flash ? '9' : 'b';
  const L = 7;
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]]) {
    px(ctx, sx > 0 ? cx : cx - L + 1, sy > 0 ? cy : cy, L, 1, '1');
    px(ctx, sx > 0 ? cx : cx, sy > 0 ? cy : cy - L + 1, 1, L, '1');
    px(ctx, sx > 0 ? cx + 1 : cx - L + 1, sy > 0 ? cy + 1 : cy - 1, L - 1, 1, col);
    px(ctx, sx > 0 ? cx + 1 : cx - 1, sy > 0 ? cy + 1 : cy - L + 1, 1, L - 1, col);
  }
  return { x0, y0, w, h };
}

// 투구 위치 기록 (이번 타석 공들이 지나간 자리 · 번호)
const TRACK_COLOR = { strike: '5', miss: '5', ball: 'e', foul: 'k', fly: 'j', pop: 'j', ground: 'j', single: '9', double: '9', triple: '9', hr: '9' };
function drawPitchTrack(ctx, log) {
  log.forEach((l, i) => {
    const p = project(l.tx, l.ty, 0);
    const x = Math.round(p.sx);
    const y = Math.round(p.sy);
    const col = TRACK_COLOR[l.result] || 'k';
    px(ctx, x - 3, y - 2, 7, 5, '1');
    px(ctx, x - 2, y - 3, 5, 7, '1');
    px(ctx, x - 2, y - 2, 5, 5, col);
    BitmapFont.draw(ctx, String((i + 1) % 10), x, y - 2, C('1'), { align: 'center' });
  });
}

// 노란 배트 막대 (공이 지나갈 줄에 맞추기): 반투명 기둥 + 위아래 삼각 표시
function drawBatBar(ctx, batX, swingK, zone) {
  const x = Math.round(CONFIG.WIDTH / 2 + batX);
  const y0 = zone.y0 - 3;
  const h = zone.h + 6;
  ctx.fillStyle = DITHER.get(ctx, '9', swingK > 0 ? 12 : 5);
  ctx.fillRect(x - 6, y0, 13, h);
  px(ctx, x - 6, y0, 1, h, '8');
  px(ctx, x + 6, y0, 1, h, '8');
  px(ctx, x, y0, 1, h, swingK > 0 ? 'b' : 't');
  for (const [yy, dir] of [[y0 - 5, 1], [y0 + h + 4, -1]]) {
    for (let i = 0; i < 4; i++) {
      px(ctx, x - 4 + i, yy + i * dir, 9 - i * 2, 1, '1');
      px(ctx, x - 3 + i, yy + i * dir, 7 - i * 2, 1, '9');
    }
  }
}

// 공 (원근으로 커짐) + 바닥 그림자
function drawBall(ctx, pos, gold, frame) {
  const p = project(pos.x, pos.y, pos.z);
  const sh = project(pos.x, 0, pos.z);
  const r = Math.max(0.6, 0.037 * p.s);
  ctx.fillStyle = DITHER.get(ctx, '1', 8);
  ctx.fillRect(Math.round(sh.sx - r), Math.round(sh.sy), Math.max(1, Math.round(r * 2)), 1);
  const rr = Math.round(r);
  if (rr <= 1) {
    px(ctx, p.sx - 1, p.sy - 1, 2, 2, gold ? '9' : 'b');
    return;
  }
  for (let dy = -rr; dy <= rr; dy++) {
    const hw = Math.round(Math.sqrt(rr * rr - dy * dy));
    px(ctx, p.sx - hw, p.sy + dy, hw * 2 + 1, 1, gold ? (dy < 0 ? 't' : '9') : dy < 0 ? 'b' : 'k');
  }
  // 실밥
  if (rr >= 3) {
    px(ctx, p.sx - rr + 1, p.sy - 1, 1, 2, '6');
    px(ctx, p.sx + rr - 1, p.sy - 1, 1, 2, '6');
  }
  if (gold && frame % 6 < 3) px(ctx, p.sx + rr, p.sy - rr, 1, 1, 'b');
}

// 타자 뒷모습 (투수를 바라봄): 캐릭터 실루엣을 부위별 색으로 칠하고 뒤에서 보이는 소품을 더함
//  bands: [위 비율, 아래 비율, 색] · 그림 파일 픽셀은 읽지 않고 합성만 씀 (file:// 에서도 동작)
const BACK_LOOK = [
  // 럼블 (곰): 갈색 털 · 초록 후드 · 배낭
  { bands: [[0, 0.52, 'm'], [0.52, 0.86, 'c'], [0.86, 1, 'r']], extra: 'pack', num: 'a' },
  // 나르 (고양이): 보라 마법 모자 · 흰 털 · 보라 망토 · 흰 꼬리
  { bands: [[0, 0.27, 'v'], [0.27, 0.55, 'w'], [0.55, 0.9, '3'], [0.9, 1, 'w']], extra: 'catTail', num: '9' },
  // 꽥스 (오리): 파란 모자 · 노란 머리 · 파란 재킷 · 가방끈
  { bands: [[0, 0.26, 'g'], [0.26, 0.55, '9'], [0.55, 0.85, 'g'], [0.85, 1, '8']], extra: 'strap', num: 'b' },
  // 볼리베어 (호랑이): 주황 털 + 줄무늬 · 빨간 스카프 · 카키 옷 · 줄무늬 꼬리
  { bands: [[0, 0.5, 'u'], [0.5, 0.56, '6'], [0.56, 0.88, 'c'], [0.88, 1, 'l']], extra: 'tiger', num: 'a' },
  // 에코 (시바): 주황 털 · 검은 티셔츠 · 말린 꼬리
  { bands: [[0, 0.48, 'u'], [0.48, 0.78, '2'], [0.78, 1, 'u']], extra: 'shiba', num: 'b' },
];

function tinted(src, color) {
  return buildFlash(src, typeof color === 'string' && color.length === 1 ? PALETTE[color] : color);
}

// 실루엣 모양 그대로 무늬(디더)를 씌움
function patternSil(src, key, level) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  const t = document.createElement('canvas');
  t.width = 4;
  t.height = 4;
  const tg = t.getContext('2d');
  tg.fillStyle = PALETTE[key];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) tg.fillRect(x, y, 1, 1);
  g.fillStyle = g.createPattern(t, 'repeat');
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

const BACK_CACHE = [];
function batterBack(i) {
  if (BACK_CACHE[i]) return BACK_CACHE[i];
  const L = BACK_LOOK[i];
  const src = SPR.players[i].frames[0];
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = w + 2;
  c.height = h + 2;
  const g = c.getContext('2d');
  const clip = (x, y, cw, ch, fn) => {
    g.save();
    g.beginPath();
    g.rect(x, y, cw, ch);
    g.clip();
    fn();
    g.restore();
  };
  // 외곽선
  const out = tinted(src, '1');
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) g.drawImage(out, dx, dy);
  // 부위별 색
  for (const [a, b, col] of L.bands) {
    const y0 = Math.round(h * a) + 1;
    const y1 = Math.round(h * b) + 1;
    clip(0, y0, w + 2, y1 - y0, () => g.drawImage(tinted(src, col), 1, 1));
  }
  // 입체감: 오른쪽은 한 단계 어두운 색 (무늬 없이 깔끔하게)
  const SHADE = { m: 'r', r: 's', c: '2', w: 'k', v: '2', 3: '2', g: 'f', 9: '8', 8: 'u', u: 'm', 6: '7', l: 's', 2: '1' };
  for (const [a, b, col] of L.bands) {
    const y0 = Math.round(h * a) + 1;
    const y1 = Math.round(h * b) + 1;
    clip(Math.round(w * 0.7) + 1, y0, w, y1 - y0, () => g.drawImage(tinted(src, SHADE[col] || '1'), 1, 1));
  }
  // 머리와 몸 경계 (목 그림자)
  const neck = Math.round(h * (L.bands[0][2] === 'v' || L.bands[0][2] === 'g' ? L.bands[1][1] : L.bands[0][1])) + 1;
  clip(0, neck, w + 2, 1, () => g.drawImage(patternSil(src, '1', 10), 1, 1));
  const P = (x, y, ww, hh, k) => {
    g.fillStyle = PALETTE[k];
    g.fillRect(Math.round(x) + 1, Math.round(y) + 1, ww, hh);
  };
  const cx = w / 2;
  // 소품
  if (L.extra === 'pack') {
    const x0 = Math.round(w * 0.24);
    const y0 = Math.round(h * 0.5);
    const pw = Math.round(w * 0.52);
    const ph = Math.round(h * 0.32);
    P(x0 - 1, y0 - 1, pw + 2, ph + 2, '1');
    P(x0, y0, pw, ph, 'i');
    P(x0, y0, pw, 4, 'j');
    P(x0 + 2, y0 + ph - 3, pw - 4, 1, '2');
    P(cx - 3, y0 + 6, 7, 6, '1');
    P(cx - 2, y0 + 7, 5, 4, 'e');
    BitmapFont.draw(g, String(i + 1), Math.round(cx) + 1, y0 + 7, PALETTE['1'], { align: 'center' });
  }
  if (L.extra === 'catTail') {
    for (let k = 0; k < 9; k++) {
      const tx = cx + 3 + k * 1.3;
      const ty = h * 0.9 - k * 1.6 - Math.sin(k / 2) * 2;
      P(tx - 1, ty - 1, 4, 4, '1');
    }
    for (let k = 0; k < 9; k++) {
      const tx = cx + 3 + k * 1.3;
      const ty = h * 0.9 - k * 1.6 - Math.sin(k / 2) * 2;
      P(tx, ty, 2, 2, k > 6 ? 'k' : 'w');
    }
    P(cx - 6, h * 0.04, 1, 1, '9');
    P(cx + 4, h * 0.12, 1, 1, '9');
  }
  if (L.extra === 'strap') {
    for (let k = 0; k < 16; k++) P(w * 0.72 - k * 1.2, h * 0.56 + k * 0.9, 2, 1, 'l');
    P(cx - 2, h * 0.86, 5, 3, '1');
    P(cx - 1, h * 0.86, 3, 2, '9');
  }
  if (L.extra === 'tiger') {
    // 머리 뒤 줄무늬
    for (const [x, y, len] of [[cx - 6, h * 0.12, 4], [cx, h * 0.08, 5], [cx + 5, h * 0.12, 4], [cx - 3, h * 0.28, 3], [cx + 3, h * 0.3, 3]]) P(x, y, 2, len, '1');
    // 스카프 매듭 (등 쪽 삼각형)
    for (let k = 0; k < 6; k++) P(cx - 6 + k, h * 0.56 + k, 12 - k * 2, 1, k % 2 ? '7' : '6');
    // 꼬리
    for (let k = 0; k < 10; k++) {
      const tx = cx + 4 + k * 1.4;
      const ty = h * 0.92 - k * 1.2;
      P(tx - 1, ty - 1, 4, 4, '1');
      P(tx, ty, 2, 2, k % 3 === 2 ? '1' : 'u');
    }
  }
  if (L.extra === 'shiba') {
    // 말린 꼬리 (등 위로 동그랗게)
    const tx = cx + 1;
    const ty = h * 0.72;
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * Math.PI * 1.7;
      const r = 5 - a * 0.22;
      P(tx + Math.cos(ang) * r - 1, ty + Math.sin(ang) * r - 1, 4, 4, '1');
    }
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * Math.PI * 1.7;
      const r = 5 - a * 0.22;
      P(tx + Math.cos(ang) * r, ty + Math.sin(ang) * r, 2, 2, a > 8 ? 'a' : 'u');
    }
  }
  // 등번호 (배낭이 없는 캐릭터)
  if (L.extra !== 'pack') {
    const ny = Math.round(h * (L.extra === 'shiba' ? 0.52 : 0.6));
    BitmapFont.draw(g, String(i + 1), Math.round(cx) + 1 - (L.extra === 'catTail' ? 3 : 0), ny, PALETTE[L.num], { align: 'center', scale: 2 });
  }
  BACK_CACHE[i] = c;
  return c;
}

// 앞모습 (소개 화면용): 원래 그림 + 외곽선
const BATTER_CACHE = [];
function batterImg(i, f) {
  const id = i * 2 + f;
  if (BATTER_CACHE[id]) return BATTER_CACHE[id];
  const src = SPR.players[i].frames[f];
  const c = document.createElement('canvas');
  c.width = src.width + 2;
  c.height = src.height + 2;
  const g = c.getContext('2d');
  const out = buildFlash(src, PALETTE['1']);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) g.drawImage(out, dx, dy);
  g.drawImage(src, 1, 1);
  BATTER_CACHE[id] = c;
  return c;
}

// 타자 (뒷모습 2배): swingK 0 = 준비, 0~1 = 휘두르는 중
function drawBatter(ctx, i, swingK, frame) {
  const img = batterBack(i);
  const S = 2;
  const w = img.width * S;
  const h = img.height * S;
  const cx = 82;
  const by = CONFIG.HEIGHT - 6;
  const lean = swingK > 0 ? Math.round(Math.sin(swingK * Math.PI) * 5) : 0;
  const breath = swingK > 0 ? 0 : Math.round(Math.sin(frame / 16));
  const x0 = Math.round(cx - w / 2) + lean;
  const y0 = by - h + breath;
  // 발밑 그림자
  ctx.fillStyle = DITHER.get(ctx, '1', 10);
  ellipseFill(ctx, cx + lean, by - 1, w * 0.45, 4);
  // 방망이: 준비 땐 오른 어깨 뒤로 세움(몸 뒤) → 휘두르면 앞으로 돌아 나옴
  const hx = cx + w * 0.26 + lean;
  const hy = y0 + h * 0.46;
  const ang = swingK > 0 ? -1.05 + swingK * 2.7 : -1.05 + Math.sin(frame / 12) * 0.06;
  const len = 54;
  const ex = Math.round(hx + Math.cos(ang) * len);
  const ey = Math.round(hy + Math.sin(ang) * len * 0.8);
  const behind = swingK < 0.3;
  const bat = () => {
    drawPixelLine(ctx, Math.round(hx), Math.round(hy), ex, ey, C('1'), 6);
    drawPixelLine(ctx, Math.round(hx), Math.round(hy), Math.round(hx + (ex - hx) * 0.35), Math.round(hy + (ey - hy) * 0.35), C('s'), 3);
    drawPixelLine(ctx, Math.round(hx + (ex - hx) * 0.35), Math.round(hy + (ey - hy) * 0.35), ex, ey, C('u'), 4);
    drawPixelLine(ctx, Math.round(hx + (ex - hx) * 0.5), Math.round(hy + (ey - hy) * 0.5) - 1, ex, ey - 1, C('t'), 1);
    if (swingK > 0.2 && swingK < 0.8) {
      for (let k = 1; k <= 3; k++) {
        const a2 = ang - k * 0.25;
        px(ctx, hx + Math.cos(a2) * len, hy + Math.sin(a2) * len * 0.8, 2, 2, 'b');
      }
    }
  };
  if (behind) bat();
  ctx.drawImage(img, x0, y0, w, h);
  if (!behind) {
    bat();
    // 휘두를 땐 앞으로 나온 장갑이 보임
    px(ctx, hx - 4, hy - 4, 8, 8, '1');
    px(ctx, hx - 3, hy - 3, 6, 6, CHARACTERS[i].color);
    px(ctx, hx - 3, hy - 3, 6, 2, 'w');
  }
}

function ellipseFill(ctx, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    ctx.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2, 1);
  }
}

// 포수 미트 (공이 들어오면 잠깐)
function drawMitt(ctx, pos) {
  const p = project(pos.x, pos.y, 0);
  ellipse(ctx, p.sx, p.sy + 2, 10, 7, '1');
  ellipse(ctx, p.sx, p.sy + 2, 9, 6, 'l');
  ellipse(ctx, p.sx, p.sy + 1, 5, 3, 'r');
}

// ---- 2) 타구 화면 (높은 데서 내려다보는 부채꼴 구장) ----
const FV = { HOR: 26, A: 3416, Z0: 25.3, B: 150 };
function fproj(x, z, h = 0) {
  const d = z + FV.Z0;
  return { sx: CONFIG.WIDTH / 2 + (x * FV.B) / d, sy: FV.HOR + FV.A / d - (h * FV.B) / d };
}

function drawFieldView(ctx, frame, crowdJump = 0) {
  const W = CONFIG.WIDTH;
  px(ctx, 0, 0, W, CONFIG.HEIGHT, 'o');
  ctx.drawImage(CROWD, 0, -4 - crowdJump);
  drawLights(ctx, frame);
  // 구장: 방향 -45~45 도, 거리 0~펜스 를 줄 단위로 칠함
  const rowsY = [];
  for (let y = 30; y < CONFIG.HEIGHT; y++) rowsY.push(y);
  // 펜스 바깥 (관중석 아래 벽)
  px(ctx, 0, 30, W, CONFIG.HEIGHT - 30, '2');
  // 부채꼴: 각도마다 세로 띠로 근사
  for (let deg = -46; deg <= 46; deg += 0.5) {
    const R = fenceAt(Math.max(-45, Math.min(45, deg)));
    const a = (deg * Math.PI) / 180;
    const p0 = fproj(Math.sin(a) * 0, 0);
    const p1 = fproj(Math.sin(a) * R, Math.cos(a) * R);
    const p2 = fproj(Math.sin(a) * (R + 4), Math.cos(a) * (R + 4));
    drawPixelLine(ctx, Math.round(p0.sx), Math.round(p0.sy), Math.round(p1.sx), Math.round(p1.sy), C('d'), 3);
    // 펜스 (초록 벽 + 노란 줄)
    px(ctx, p1.sx - 1, p2.sy - 4, 3, 5, 'c');
    px(ctx, p1.sx - 1, p2.sy - 5, 3, 1, '9');
  }
  // 잔디 줄무늬 (거리 띠)
  for (let r = 10; r < 125; r += 10) {
    if (((r / 10) | 0) % 2) continue;
    for (let deg = -44; deg <= 44; deg += 0.6) {
      if (r > fenceAt(deg) - 5) continue;
      const a = (deg * Math.PI) / 180;
      const p = fproj(Math.sin(a) * r, Math.cos(a) * r);
      const q = fproj(Math.sin(a) * (r + 5), Math.cos(a) * (r + 5));
      drawPixelLine(ctx, Math.round(p.sx), Math.round(p.sy), Math.round(q.sx), Math.round(q.sy), C('c'), 2);
    }
  }
  // 경고 트랙
  for (let deg = -45; deg <= 45; deg += 0.5) {
    const R = fenceAt(deg);
    const a = (deg * Math.PI) / 180;
    const p = fproj(Math.sin(a) * (R - 4), Math.cos(a) * (R - 4));
    px(ctx, p.sx - 1, p.sy, 3, 1, 'm');
  }
  // 내야 흙 다이아몬드
  const base = (x, z) => fproj(x, z);
  const B = 27.43 / Math.SQRT2;
  for (let z = -2; z < 2 * B + 6; z += 0.5) {
    const half = z < B ? z + 3 : 2 * B - z + 3;
    if (half <= 0) continue;
    const a = fproj(-half, z);
    const b = fproj(half, z);
    px(ctx, a.sx, a.sy, b.sx - a.sx, 1, 'm');
  }
  for (let z = 4; z < 2 * B - 4; z += 0.5) {
    const half = z < B ? z - 4 : 2 * B - z - 4;
    if (half <= 0) continue;
    const a = fproj(-half, z);
    const b = fproj(half, z);
    px(ctx, a.sx, a.sy, b.sx - a.sx, 1, 'd');
  }
  // 파울 라인
  for (const s of [-1, 1]) {
    const a = fproj(0, 0);
    const b = fproj(s * 85, 85);
    drawPixelLine(ctx, Math.round(a.sx), Math.round(a.sy), Math.round(b.sx), Math.round(b.sy), C('b'));
  }
  // 베이스 · 마운드 · 홈
  for (const [x, z] of [[B, B], [0, 2 * B], [-B, B]]) {
    const p = base(x, z);
    px(ctx, p.sx - 1, p.sy - 1, 3, 2, 'b');
  }
  const mp = fproj(0, 18.4);
  ellipse(ctx, mp.sx, mp.sy, 4, 1, 'r');
  const hp = fproj(0, 0);
  px(ctx, hp.sx - 2, hp.sy - 1, 5, 2, 'b');
  // 거리 표시
  for (const [deg, txt] of [[-44, `${CONFIG.FENCE_LINE}`], [0, `${CONFIG.FENCE_CENTER}`], [44, `${CONFIG.FENCE_LINE}`]]) {
    const a = (deg * Math.PI) / 180;
    const R = fenceAt(deg) + 3;
    const p = fproj(Math.sin(a) * R, Math.cos(a) * R);
    BitmapFont.draw(ctx, txt, Math.round(p.sx), Math.round(p.sy) - 12, C('a'), { align: 'center' });
  }
}

// 수비수 (작은 딜러 도트) · 달릴 땐 통통 튐
let FIELDER_IMG = null;
function drawFielder(ctx, x, z, moving, frame) {
  if (!FIELDER_IMG) FIELDER_IMG = buildSprite(FIELDER_ART);
  const p = fproj(x, z);
  const sx = Math.round(p.sx);
  const sy = Math.round(p.sy);
  ctx.fillStyle = DITHER.get(ctx, '1', 10);
  ctx.fillRect(sx - 2, sy, 5, 1);
  const hop = moving && frame % 8 < 4 ? 1 : 0;
  ctx.drawImage(FIELDER_IMG, sx - 2, sy - 6 - hop);
}

// 1루로 뛰는 타자 (수비수 도트를 캐릭터 색 헬멧으로)
const RUNNER_IMG = [];
function drawRunner(ctx, i, x, z, moving, frame) {
  if (!RUNNER_IMG[i]) RUNNER_IMG[i] = buildSprite(FIELDER_ART, { d: CHARACTERS[i].color, b: 'w' });
  const p = fproj(x, z);
  const sx = Math.round(p.sx);
  const sy = Math.round(p.sy);
  ctx.fillStyle = DITHER.get(ctx, '1', 10);
  ctx.fillRect(sx - 2, sy, 5, 1);
  const hop = moving && frame % 6 < 3 ? 1 : 0;
  ctx.drawImage(RUNNER_IMG[i], sx - 2, sy - 6 - hop);
  if (moving && frame % 4 < 2) px(ctx, sx - 3, sy - 1, 1, 1, 'k'); // 흙먼지
}

function drawFlightBall(ctx, x, z, h, gold, trail) {
  // 그림자 → 공
  const s = fproj(x, z, 0);
  ctx.fillStyle = DITHER.get(ctx, '1', 10);
  ctx.fillRect(Math.round(s.sx) - 1, Math.round(s.sy), 3, 1);
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const p = fproj(t[0], t[1], t[2]);
    px(ctx, p.sx, p.sy, 1, 1, i > trail.length - 6 ? 'b' : 'k');
  }
  const p = fproj(x, z, h);
  px(ctx, p.sx - 1, p.sy - 1, 3, 3, '1');
  px(ctx, p.sx - 1, p.sy - 1, 2, 2, gold ? '9' : 'b');
}
