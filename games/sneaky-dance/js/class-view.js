// =====================================================
// 교실 그림
//  창문 · 칠판(분필 글씨가 써짐) · 시계(남은 시간) · 교수님(뒷모습/옆모습/앞모습)
//  책상(앞판에 점수 명패) · 학생(앉아 있기 / 작은 춤 / 큰 춤 / 벌서기)
// =====================================================
const ROOM = {
  COL_W: 64,
  FLOOR_Y: 96,      // 바닥 시작
  TEACHER_FOOT: 106, // 교수님 발 위치 (다리는 학생들 뒤로 가려짐)
  DESK_TOP: 118,
  SEAT_FOOT: 136,   // 앉아 있을 때 학생 발 (책상에 가려짐)
  BOARD: { x: 40, y: 16, w: 240, h: 50 },
};

// 칠판에 쓰는 글 (한 번 쓸 때마다 한 줄씩)
const BOARD_LINES = ['1 + 1 = 2', 'x² + y² = r²', '오늘의 숙제: 3쪽', 'E = mc²', '수업 시간엔 조용히', '시험 범위: 1~5단원', '떠들지 말 것!', '몰래 춤 금지!!'];

// ---- 교수님 스프라이트 (36 × 74, 코드로 그림 · 원래 크기 그대로) ----
//  흰머리 · 둥근 안경 · 수염 · 갈색 트위드 재킷(팔꿈치 덧댐) · 나비넥타이
//  back(칠판에 쓰기) · backTilt(낌새: 고개 갸웃) · side(돌아보는 중) · front(반 보기) · angry(딱 걸림)
const PROF_W = 36;
const PROF_H = 74;
const TEACHER_SPR = {};
function initTeacherSprites() {
  TEACHER_SPR.back = buildProf('back', 0);
  TEACHER_SPR.backWrite = buildProf('back', 1);
  TEACHER_SPR.backTilt = buildProf('back', 2);
  TEACHER_SPR.side = buildProf('side', 0);
  TEACHER_SPR.front = buildProf('front', 0);
  TEACHER_SPR.frontL = buildProf('front', -1);
  TEACHER_SPR.frontR = buildProf('front', 1);
  TEACHER_SPR.angry = buildProf('front', 0, true);
}

function buildProf(view, pose, angry = false) {
  const c = document.createElement('canvas');
  c.width = PROF_W;
  c.height = PROF_H;
  const g = c.getContext('2d');
  const px = (x, y, w, h, k) => {
    g.fillStyle = PALETTE[k];
    g.fillRect(x, y, w, h);
  };
  // 외곽선 있는 둥근 덩어리 (가로 반폭 함수)
  const blob = (cx, y0, y1, half, fill, out = '1') => {
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const hw = half(Math.max(y0, Math.min(y1, y)));
      px(Math.round(cx - hw) - 1, y, Math.round(hw * 2) + 2, 1, out);
    }
    for (let y = y0; y <= y1; y++) {
      const hw = half(y);
      px(Math.round(cx - hw), y, Math.round(hw * 2), 1, fill);
    }
  };
  const side = view === 'side';
  const cx = 18;
  // ---- 다리 + 구두 ----
  const legs = side ? [[14, 6]] : [[11, 6], [19, 6]];
  for (const [lx, lw] of legs) {
    px(lx - 1, 50, lw + 2, 20, '1');
    px(lx, 50, lw, 19, 'i');
    px(lx + lw - 2, 50, 1, 19, 'v');
    px(lx - 2, 68, lw + 4, 5, '1');
    px(lx - 1, 69, lw + 2, 3, 's');
    px(lx, 69, 2, 1, 'j');
  }
  // ---- 몸통 (트위드 재킷) ----
  const bw = side ? 8 : 12;
  blob(cx, 22, 52, (y) => (y < 25 ? bw - (25 - y) * 1.2 : bw), 'r');
  // 트위드 무늬
  for (let y = 24; y < 52; y += 3) for (let x = cx - bw + 1 + (y % 2); x < cx + bw - 1; x += 4) px(x, y, 1, 1, 'l');
  if (view === 'front') {
    // 셔츠 V + 나비넥타이 + 깃 + 단추
    for (let k = 0; k < 12; k++) px(cx - 4 + Math.floor(k / 3), 22 + k, 8 - Math.floor(k / 3) * 2, 1, 'w');
    px(cx - 4, 23, 3, 3, angry ? '6' : '7');
    px(cx + 1, 23, 3, 3, angry ? '6' : '7');
    px(cx - 1, 24, 2, 1, '1');
    px(cx - 6, 22, 2, 9, 'l');
    px(cx + 4, 22, 2, 9, 'l');
    px(cx - 1, 38, 2, 2, '1');
    px(cx - 1, 44, 2, 2, '1');
  } else if (!side) {
    px(cx, 24, 1, 27, 'l'); // 등 솔기
    px(cx - 3, 46, 6, 1, 'l'); // 뒤트임
  } else {
    px(cx + 4, 24, 3, 6, 'w'); // 옆에서 보이는 셔츠 깃
  }
  // ---- 팔 ----
  const arm = (x, y0, len, patch) => {
    px(x - 1, y0 - 1, 7, len + 2, '1');
    px(x, y0, 5, len, 'r');
    px(x + 4, y0, 1, len, 'l');
    if (patch) px(x + 1, y0 + Math.floor(len / 2) - 2, 3, 4, 'l'); // 팔꿈치 덧댐
    px(x, y0 + len, 5, 4, 'n');
    px(x, y0 + len + 3, 5, 1, 'u');
  };
  if (view === 'back') {
    arm(1, 24, 24, true);
    // 오른팔을 들어 칠판에 씀 (분필) — pose 1 은 조금 더 높이
    const top = pose === 1 ? 2 : 5;
    px(28, top - 1, 7, 26 - top + 1, '1');
    px(29, top, 5, 25 - top, 'r');
    px(30, top + 8, 3, 4, 'l');
    px(29, top - 3, 5, 4, 'n');
    px(31, top - 6, 2, 3, 'b'); // 분필
  } else if (side) {
    arm(cx - 3, 25, 22, true);
  } else {
    arm(1, 24, 24, false);
    arm(30, 24, 24, false);
  }
  // ---- 머리 ----
  const tilt = view === 'back' && pose === 2 ? 2 : 0;
  const hx = cx + tilt + (side ? 1 : 0);
  const head = (y) => {
    const t = (y - 2) / 18;
    return 8.5 * Math.sqrt(Math.max(0.15, 1 - (2 * t - 1) * (2 * t - 1) * 0.55));
  };
  blob(hx, 2, 20, head, 'n');
  if (view === 'back') {
    // 뒤통수: 정수리는 반짝 대머리, 귀 높이에 흰머리 띠, 그 아래 목덜미
    for (let y = 8; y <= 15; y++) {
      const hw = head(y);
      px(Math.round(hx - hw), y, Math.round(hw * 2), 1, 'k');
    }
    px(hx - 6, 9, 12, 1, 'j');
    for (let y = 16; y <= 20; y++) {
      const hw = head(y) - 1;
      px(Math.round(hx - hw), y, Math.round(hw * 2), 1, 'u');
    }
    px(hx - 3, 4, 3, 2, 'w'); // 정수리 반짝
    px(Math.round(hx - head(10)) - 1, 10, 2, 4, 'u'); // 귀
    px(Math.round(hx + head(10)) - 1, 10, 2, 4, 'u');
    if (pose === 2) px(Math.round(hx + head(10)), 9, 2, 6, 'n'); // 갸웃할 때 귀 쫑긋
  } else if (side) {
    // 옆모습: 오른쪽을 봄 · 코 · 안경 한 알 · 뒷머리와 수염
    for (let y = 8; y <= 17; y++) px(Math.round(hx - head(y)), y, 5, 1, 'k');
    px(hx + 8, 11, 2, 3, 'n'); // 코
    px(hx + 8, 13, 2, 1, 'u');
    px(hx + 3, 9, 5, 4, '1');
    px(hx + 4, 10, 3, 2, 'h');
    px(hx - 2, 10, 5, 1, '1'); // 안경다리
    px(hx + 1, 16, 7, 4, 'k'); // 수염
    px(hx - 1, 11, 2, 3, 'u'); // 귀
  } else {
    // 앞모습: 벗겨진 이마 · 양옆 흰머리 · 둥근 안경 · 콧수염과 턱수염
    px(hx - 9, 7, 3, 8, 'k');
    px(hx + 6, 7, 3, 8, 'k');
    px(hx - 3, 3, 4, 1, 'w');
    // 눈썹
    if (angry) {
      px(hx - 7, 6, 4, 1, '1');
      px(hx - 4, 7, 1, 1, '1');
      px(hx + 3, 6, 4, 1, '1');
      px(hx + 3, 7, 1, 1, '1');
    } else {
      px(hx - 7, 7, 4, 1, 'j');
      px(hx + 3, 7, 4, 1, 'j');
    }
    // 둥근 안경
    for (const ex of [hx - 6, hx + 2]) {
      px(ex, 8, 5, 5, '1');
      px(ex + 1, 9, 3, 3, angry ? 'p' : 'h');
      px(ex + 1, 9, 1, 1, 'w');
    }
    px(hx - 1, 10, 3, 1, '1');
    // 눈동자 (보는 방향)
    px(hx - 5 + pose + 1, 10, 1, 2, '1');
    px(hx + 3 + pose + 1, 10, 1, 2, '1');
    if (angry) {
      px(hx - 5, 10, 2, 2, '6');
      px(hx + 4, 10, 2, 2, '6');
    }
    px(hx, 13, 1, 2, 'u'); // 코
    // 수염 (흰 콧수염 + 턱수염)
    px(hx - 4, 15, 9, 2, 'k');
    blob(hx, 17, 21, (y) => 6 - (y - 17) * 1.2, 'k', 'j');
    if (angry) px(hx - 2, 16, 5, 2, '7'); // 버럭 벌린 입
    // 볼
    px(hx - 8, 13, 2, 1, 'p');
    px(hx + 7, 13, 2, 1, 'p');
  }
  return c;
}

// 교수님 그리기: 칠판(뒷모습) → 옆모습 → 앞모습으로 돌아봄 (돌아설 때도 옆모습을 거침)
function drawTeacher(ctx, teacher, frame, angry) {
  const x = Math.round(teacher.x);
  const y = ROOM.TEACHER_FOOT - PROF_H;
  const f = teacher.facing;
  let img;
  if (teacher.state === 'write') img = (frame >> 3) % 2 ? TEACHER_SPR.back : TEACHER_SPR.backWrite;
  else if (teacher.state === 'tell') img = TEACHER_SPR.backTilt;
  else if (f < 0.35) img = TEACHER_SPR.back;
  else if (f < 0.75) img = TEACHER_SPR.side;
  else if (angry) img = TEACHER_SPR.angry;
  else img = [TEACHER_SPR.frontL, TEACHER_SPR.front, TEACHER_SPR.frontR, TEACHER_SPR.front][(frame >> 4) % 4];
  // 낌새 · 화날 때 살짝 떨림
  const jit = teacher.state === 'tell' && frame % 12 < 2 ? 1 : 0;
  ctx.drawImage(img, x - PROF_W / 2 + jit, y);
}

// ---- 교실 배경 ----
function drawRoom(ctx, frame, timeLeft, total) {
  const W = CONFIG.WIDTH;
  // 벽
  ctx.fillStyle = C('n');
  ctx.fillRect(0, 14, W, ROOM.FLOOR_Y - 14);
  ctx.fillStyle = DITHER.get(ctx, 'u', 2);
  ctx.fillRect(0, 14, W, ROOM.FLOOR_Y - 14);
  // 굽도리
  ctx.fillStyle = C('l');
  ctx.fillRect(0, ROOM.FLOOR_Y - 4, W, 4);
  // 바닥 (나무 마루)
  ctx.fillStyle = C('m');
  ctx.fillRect(0, ROOM.FLOOR_Y, W, CONFIG.HEIGHT - ROOM.FLOOR_Y);
  ctx.fillStyle = C('r');
  for (let y = ROOM.FLOOR_Y + 5; y < CONFIG.HEIGHT; y += 7) ctx.fillRect(0, y, W, 1);
  for (let y = ROOM.FLOOR_Y; y < CONFIG.HEIGHT; y += 7) for (let x = ((y / 7) % 2) * 20; x < W; x += 40) ctx.fillRect(x, y, 1, 5);
  // 창문 (왼쪽, 구름이 흘러감)
  ctx.fillStyle = C('1');
  ctx.fillRect(4, 22, 30, 36);
  ctx.fillStyle = C('h');
  ctx.fillRect(6, 24, 26, 32);
  ctx.fillStyle = C('b');
  const cx = ((frame * 0.1) % 40) - 8;
  ctx.fillRect(6 + Math.round(cx), 30, 9, 3);
  ctx.fillRect(8 + Math.round(cx), 29, 5, 1);
  ctx.fillStyle = C('1');
  ctx.fillRect(18, 24, 1, 32);
  ctx.fillRect(6, 39, 26, 1);
  // 칠판
  const B = ROOM.BOARD;
  ctx.fillStyle = C('l');
  ctx.fillRect(B.x - 3, B.y - 3, B.w + 6, B.h + 8);
  ctx.fillStyle = C('1');
  ctx.fillRect(B.x - 1, B.y - 1, B.w + 2, B.h + 2);
  ctx.fillStyle = C('c');
  ctx.fillRect(B.x, B.y, B.w, B.h);
  ctx.fillStyle = DITHER.get(ctx, 'd', 2);
  ctx.fillRect(B.x, B.y, B.w, B.h);
  // 분필 받침 + 분필
  ctx.fillStyle = C('r');
  ctx.fillRect(B.x, B.y + B.h + 1, B.w, 3);
  ctx.fillStyle = C('b');
  ctx.fillRect(B.x + 20, B.y + B.h, 4, 1);
  ctx.fillStyle = C('5');
  ctx.fillRect(B.x + 28, B.y + B.h, 3, 1);
  // 시계 (오른쪽 벽): 남은 시간만큼 빨간 부채꼴이 줄어듦
  const ox = 302;
  const oy = 34;
  drawPixelRing(ctx, ox, oy, 11, C('1'), 1);
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      if (dx * dx + dy * dy > 100) continue;
      const ang = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      const left = (timeLeft / total) * Math.PI * 2;
      ctx.fillStyle = ang < left ? C('5') : C('b');
      ctx.fillRect(ox + dx, oy + dy, 1, 1);
    }
  }
  ctx.fillStyle = C('1');
  ctx.fillRect(ox, oy - 8, 1, 8);
  ctx.fillRect(ox, oy, 5, 1);
}

// 칠판 글씨: lines = 다 쓴 줄들, cur = 쓰는 중인 줄과 진행도
function drawBoardText(ctx, lines, cur, k) {
  const B = ROOM.BOARD;
  const shown = [...lines];
  if (cur) shown.push(cur.slice(0, Math.ceil(cur.length * k)));
  // 칠판에는 3줄까지 (넘치면 오래된 줄부터 지워짐)
  const view = shown.slice(-3);
  view.forEach((s, i) => KText.draw(ctx, s, B.x + 8, B.y + 3 + i * 15, C('b'), { font: 's' }));
}

// ---- 책상 + 학생 ----
// s: 학생 상태 { def, index, mode, danceT, recover, punishT, out, outT, strikes, fever, score }
function drawDesk(ctx, cx, s, frame) {
  const top = ROOM.DESK_TOP;
  // 학생 (책상 뒤) — 복도로 나가는 중이면 따로 그림
  if (!s.out) drawStudent(ctx, cx, s, frame);
  // 책상 윗판 + 앞판
  ctx.fillStyle = C('1');
  ctx.fillRect(cx - 26, top - 1, 52, 21);
  ctx.fillStyle = C('t');
  ctx.fillRect(cx - 25, top, 50, 3);
  ctx.fillStyle = C('m');
  ctx.fillRect(cx - 24, top + 3, 48, 16);
  ctx.fillStyle = C('u');
  ctx.fillRect(cx - 24, top + 3, 48, 1);
  // 명패 (점수) — 칸을 키워서 숫자가 또렷하게
  ctx.fillStyle = C('1');
  ctx.fillRect(cx - 16, top + 4, 32, 14);
  ctx.fillStyle = C('a');
  ctx.fillRect(cx - 15, top + 5, 30, 12);
  KText.draw(ctx, String(Math.floor(s.score)), cx, top + 5, C('1'), { align: 'center', font: 's' });
  // 경고 카드 (걸린 횟수): 노랑 · 노랑 · 빨강 — 책상 왼쪽 위
  for (let i = 0; i < CONFIG.MAX_STRIKES; i++) {
    const kx = cx - 25 + i * 6;
    ctx.fillStyle = C('1');
    ctx.fillRect(kx, top - 9, 6, 9);
    ctx.fillStyle = i < s.strikes ? C(i === CONFIG.MAX_STRIKES - 1 ? '6' : '9') : C('i');
    ctx.fillRect(kx + 1, top - 8, 4, 7);
    if (i < s.strikes) {
      ctx.fillStyle = C('w');
      ctx.fillRect(kx + 1, top - 8, 1, 2);
    }
  }
  // 피버 배수: 책상 오른쪽 위 어두운 꼬리표
  if (s.fever > 0 && !s.out) {
    const m = `X${CONFIG.FEVER[s.fever]}`;
    const w = BitmapFont.measure(m) + 5;
    const col = s.fever >= 3 ? (frame % 20 < 10 ? '5' : '9') : s.fever === 2 ? '8' : 'e';
    ctx.fillStyle = C(col);
    ctx.fillRect(cx + 25 - w, top - 9, w, 9);
    ctx.fillStyle = C('1');
    ctx.fillRect(cx + 26 - w, top - 8, w - 2, 7);
    BitmapFont.draw(ctx, m, cx + 23, top - 7, C(col), { align: 'right' });
  }
  if (s.out && s.outT > 70) {
    // 빈자리에 '복도' 팻말
    drawCard(ctx, cx - 18, top - 24, 36, 16, '1', '6');
    KText.draw(ctx, '복도', cx, top - 22, C('5'), { align: 'center', font: 's' });
  }
}

// 복도로 걸어 나가는 학생 (outT: 0 → 70 동안 오른쪽 문 쪽으로)
function drawWalkOut(ctx, cx, s, frame) {
  if (!s.out || s.outT > 70) return;
  const sp = SPR.players[s.index];
  const k = s.outT / 70;
  const img = sp.frames[0];
  const x = Math.round(cx + k * (CONFIG.WIDTH + 30 - cx));
  const bob = Math.abs(Math.sin(s.outT / 3)) * 2;
  const y = Math.round(ROOM.DESK_TOP - img.height - 6 - bob);
  ctx.save();
  ctx.translate(x + img.width / 2, y);
  ctx.scale(-1, 1); // 오른쪽을 보고 걸어감
  ctx.drawImage(img, 0, 0);
  ctx.restore();
  // 축 처진 땀방울
  ctx.fillStyle = C('h');
  ctx.fillRect(x - img.width / 2 - 2, y + 4, 2, 3);
}

function drawStudent(ctx, cx, s, frame) {
  const sp = SPR.players[s.index];
  const t = s.danceT;
  let img = sp.frames[((frame / 20) | 0) % 2];
  let foot = ROOM.SEAT_FOOT;
  let dx = 0;
  let flip = false;
  let sw = img.width;
  let shH = img.height;
  if (s.punishT > 0) {
    // 벌서기: 일어서서 두 손 번쩍 (풀죽은 표정은 그대로 캐릭터 그림)
    foot = ROOM.SEAT_FOOT - 14;
  } else if (s.mode === 'small') {
    // 작은 춤: 앉은 채로 어깨 들썩 + 좌우로 살랑
    foot -= 2 + Math.round(Math.abs(Math.sin(t / 5)) * 3);
    dx = Math.round(Math.sin(t / 8) * 3);
    flip = (t >> 4) % 2 === 1;
  } else if (s.mode === 'big' || s.mode === 'recover') {
    // 큰 춤: 벌떡 일어나 점프 + 찌그러졌다 늘어남 + 빙글
    const k = s.mode === 'recover' ? s.recover / CONFIG.BIG_RECOVER : 1;
    const ph = Math.abs(Math.sin(t / 4));
    foot -= Math.round((16 + ph * 10) * k);
    dx = Math.round(Math.sin(t / 3) * 6 * k);
    flip = (t >> 3) % 2 === 1;
    const sq = (1 - ph) * 0.18 * k; // 착지할 때 납작
    sw = Math.round(img.width * (1 + sq));
    shH = Math.round(img.height * (1 - sq));
  }
  const x = Math.round(cx + dx - sw / 2);
  const y = foot - shH;
  if (flip) {
    ctx.save();
    ctx.translate(x + sw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, sw, shH);
    ctx.restore();
  } else ctx.drawImage(img, x, y, sw, shH);
  if (s.mode === 'big' && s.punishT === 0) {
    // 신나는 효과선 (양옆)
    ctx.fillStyle = C('9');
    const o = (t >> 2) % 2;
    ctx.fillRect(x - 4, y + 6 + o * 3, 3, 1);
    ctx.fillRect(x - 5, y + 12 - o * 3, 4, 1);
    ctx.fillRect(x + sw + 1, y + 6 + (1 - o) * 3, 3, 1);
    ctx.fillRect(x + sw + 1, y + 12 - (1 - o) * 3, 4, 1);
  }
  if (s.punishT > 0) {
    // 든 두 손 (캐릭터 색 소매) + 머리 위 빨간 '!'
    ctx.fillStyle = C('1');
    ctx.fillRect(cx - 14, y - 7, 4, 14);
    ctx.fillRect(cx + 10, y - 7, 4, 14);
    ctx.fillStyle = C(s.def.color);
    ctx.fillRect(cx - 13, y - 6, 2, 12);
    ctx.fillRect(cx + 11, y - 6, 2, 12);
    ctx.fillStyle = C('n');
    ctx.fillRect(cx - 13, y - 7, 2, 2);
    ctx.fillRect(cx + 11, y - 7, 2, 2);
    if (frame % 20 < 14) {
      ctx.fillStyle = C('1');
      ctx.fillRect(cx - 2, y - 14, 5, 10);
      ctx.fillStyle = C('5');
      ctx.fillRect(cx - 1, y - 13, 3, 5);
      ctx.fillRect(cx - 1, y - 7, 3, 2);
    }
  }
}

// 결과·타이틀 배경: 칠판 초록 + 분필 낙서
function drawChalkBg(ctx, frame) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HEIGHT;
  ctx.fillStyle = C('c');
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = DITHER.get(ctx, 'd', 2);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = DITHER.get(ctx, 'b', 1);
  for (let i = 0; i < 12; i++) {
    const x = (i * 83 + frame * 0.1) % (W + 40) - 20;
    const y = (i * 41) % H;
    ctx.fillRect(Math.round(x), y, 16, 1);
    ctx.fillRect(Math.round(x) + 4, y + 3, 10, 1);
  }
}
