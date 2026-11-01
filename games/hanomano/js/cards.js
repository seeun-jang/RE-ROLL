// =====================================================
// 과일 카드: 덱 만들기 + 카드 그림 (앞면/뒷면) + 종 그림
//  카드 = { fruit: 0~3, n: 1~5 }  (과일 n개가 그려진 카드)
//  과일은 슬롯머신 느낌: 체리 · 레몬 · 라임 · 포도
// =====================================================
const CARD_W = 32;
const CARD_H = 40;

// 56장 덱 (섞어서)
function makeDeck() {
  const deck = [];
  CONFIG.FRUITS.forEach((_, f) => {
    for (const [n, count] of Object.entries(CONFIG.CARD_COUNTS)) {
      for (let k = 0; k < count; k++) deck.push({ fruit: f, n: +n });
    }
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---- 픽셀 도형 도우미 ----
function pxCircle(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
    g.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}

// 과일 아이콘 (9x9, 진한 외곽선 포함)
function buildFruit(f) {
  const c = document.createElement('canvas');
  c.width = 11;
  c.height = 11;
  const g = c.getContext('2d');
  const O = PALETTE['1'];
  if (f === 0) {
    // 체리: 빨간 알 두 개 + 초록 꼭지
    g.fillStyle = PALETTE.c;
    g.fillRect(4, 1, 1, 4);
    g.fillRect(5, 1, 3, 1);
    g.fillRect(7, 2, 1, 4);
    g.fillStyle = PALETTE.d;
    g.fillRect(5, 0, 3, 1);
    pxCircle(g, 3, 7, 3, O);
    pxCircle(g, 7, 8, 3, O);
    pxCircle(g, 3, 7, 2, PALETTE['6']);
    pxCircle(g, 7, 8, 2, PALETTE['6']);
    g.fillStyle = PALETTE['5'];
    g.fillRect(2, 6, 1, 1);
    g.fillRect(6, 7, 1, 1);
  } else if (f === 1) {
    // 레몬: 노란 타원 + 뾰족한 양 끝
    g.fillStyle = O;
    g.fillRect(1, 3, 9, 5);
    g.fillRect(2, 2, 7, 7);
    g.fillRect(0, 5, 11, 1);
    g.fillStyle = PALETTE['9'];
    g.fillRect(2, 3, 7, 5);
    g.fillRect(1, 4, 9, 3);
    g.fillStyle = PALETTE.t;
    g.fillRect(3, 3, 3, 1);
    g.fillStyle = PALETTE['8'];
    g.fillRect(3, 7, 5, 1);
  } else if (f === 2) {
    // 라임: 초록 동그라미 단면 (조각 무늬)
    pxCircle(g, 5, 5, 5, O);
    pxCircle(g, 5, 5, 4, PALETTE.d);
    pxCircle(g, 5, 5, 3, PALETTE.e);
    g.fillStyle = PALETTE.d;
    g.fillRect(5, 2, 1, 7);
    g.fillRect(2, 5, 7, 1);
    g.fillStyle = PALETTE.b;
    g.fillRect(5, 5, 1, 1);
  } else {
    // 포도: 보라 알갱이 송이 + 잎
    g.fillStyle = PALETTE.d;
    g.fillRect(6, 0, 3, 2);
    g.fillStyle = PALETTE.l;
    g.fillRect(5, 1, 1, 2);
    const berries = [[3, 4], [7, 4], [5, 4], [4, 6], [6, 6], [5, 8]];
    for (const [x, y] of berries) pxCircle(g, x, y, 2, O);
    for (const [x, y] of berries) pxCircle(g, x, y, 1, PALETTE['3']);
    g.fillStyle = PALETTE.q;
    for (const [x, y] of berries) g.fillRect(x - 1, y - 1, 1, 1);
  }
  return c;
}

// 과일 개수별 자리 (주사위처럼)
const PIP_POS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.22], [0.75, 0.78]],
  3: [[0.25, 0.2], [0.5, 0.5], [0.75, 0.8]],
  4: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.78], [0.73, 0.78]],
  5: [[0.27, 0.2], [0.73, 0.2], [0.5, 0.5], [0.27, 0.8], [0.73, 0.8]],
};

// 둥근 카드 바탕
function cardBase(g, fill, edge) {
  g.fillStyle = PALETTE['1'];
  g.fillRect(2, 0, CARD_W - 4, CARD_H);
  g.fillRect(1, 1, CARD_W - 2, CARD_H - 2);
  g.fillRect(0, 2, CARD_W, CARD_H - 4);
  g.fillStyle = PALETTE[edge];
  g.fillRect(2, 1, CARD_W - 4, CARD_H - 2);
  g.fillRect(1, 2, CARD_W - 2, CARD_H - 4);
  g.fillStyle = PALETTE[fill];
  g.fillRect(3, 2, CARD_W - 6, CARD_H - 4);
  g.fillRect(2, 3, CARD_W - 4, CARD_H - 6);
}

const CARD_CACHE = new Map();
function cardFace(card) {
  const id = card.fruit + ':' + card.n;
  if (CARD_CACHE.has(id)) return CARD_CACHE.get(id);
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext('2d');
  cardBase(g, 'w', 'k');
  const icon = SPR.fruits[card.fruit];
  for (const [fx, fy] of PIP_POS[card.n]) {
    g.drawImage(icon, Math.round(3 + fx * (CARD_W - 6) - icon.width / 2), Math.round(3 + fy * (CARD_H - 6) - icon.height / 2));
  }
  // 모서리에 숫자 (작게)
  BitmapFont.draw(g, String(card.n), 4, 3, PALETTE[CONFIG.FRUITS[card.fruit].color === '9' ? '8' : CONFIG.FRUITS[card.fruit].color]);
  CARD_CACHE.set(id, c);
  return c;
}

// 카드 뒷면 (카지노 빨강 + 금색 마름모 + 하노마노 'H')
function cardBack() {
  if (CARD_CACHE.has('back')) return CARD_CACHE.get('back');
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext('2d');
  cardBase(g, '6', '9');
  g.fillStyle = PALETTE['7'];
  for (let y = 4; y < CARD_H - 4; y += 4) for (let x = 4 + ((y / 4) % 2) * 2; x < CARD_W - 4; x += 4) g.fillRect(x, y, 2, 2);
  g.fillStyle = PALETTE['9'];
  const cx = CARD_W / 2;
  const cy = CARD_H / 2;
  for (let k = 0; k < 7; k++) {
    g.fillRect(cx - k, cy - 7 + k, k * 2 + 1, 1);
    g.fillRect(cx - k, cy + 7 - k, k * 2 + 1, 1);
  }
  g.fillStyle = PALETTE['6'];
  g.fillRect(cx - 3, cy - 3, 2, 7);
  g.fillRect(cx + 2, cy - 3, 2, 7);
  g.fillRect(cx - 1, cy, 3, 1);
  CARD_CACHE.set('back', c);
  return c;
}

// 펼쳐진 카드 위의 과일별 합계 → 정확히 5개인 과일이 있나
function fruitTotals(tops) {
  const sum = CONFIG.FRUITS.map(() => 0);
  for (const c of tops) if (c) sum[c.fruit] += c.n;
  return sum;
}

function bellIsRight(tops) {
  return fruitTotals(tops).some((v) => v === CONFIG.TARGET);
}

// 종을 친 순간의 판정 설명: { ok, text, fruit }
//  맞음 → '라임 2+3 = 5개!'   틀림 → '포도 4개뿐!' (5개에 제일 가까운 과일)
function bellReason(tops) {
  const T = CONFIG.TARGET;
  const sum = fruitTotals(tops);
  const f = sum.findIndex((v) => v === T);
  if (f >= 0) {
    const parts = tops.filter((c) => c && c.fruit === f).map((c) => c.n);
    return { ok: true, text: `${CONFIG.FRUITS[f].name} ${parts.join('+')} = ${T}개!`, fruit: f };
  }
  let best = -1;
  for (let i = 0; i < sum.length; i++) if (sum[i] > 0 && (best < 0 || Math.abs(sum[i] - T) < Math.abs(sum[best] - T))) best = i;
  if (best < 0) return { ok: false, text: '과일이 없어요!', fruit: -1 };
  return { ok: false, text: `${CONFIG.FRUITS[best].name} ${sum[best]}개${sum[best] < T ? '뿐' : ''}! (${T}개 아님)`, fruit: best };
}

// 종 (금색 돔 + 나무 받침 + 누름 버튼). shake: 흔들림, pressed: 눌림
function drawBell(ctx, cx, cy, shake = 0, pressed = false) {
  const dx = Math.round(Math.sin(shake * 1.7) * Math.min(2, shake / 4));
  const x = cx + dx;
  const by = cy + 10;
  // 받침
  ctx.fillStyle = PALETTE['1'];
  ctx.fillRect(cx - 18, by - 1, 36, 8);
  ctx.fillStyle = PALETTE.l;
  ctx.fillRect(cx - 17, by, 34, 6);
  ctx.fillStyle = PALETTE.m;
  ctx.fillRect(cx - 17, by, 34, 2);
  // 돔
  const top = cy - 12 + (pressed ? 2 : 0);
  ctx.fillStyle = PALETTE['1'];
  for (let y = top; y <= by; y++) {
    const k = (y - top) / (by - top);
    const half = Math.round(5 + Math.sqrt(k) * 11);
    ctx.fillRect(x - half - 1, y, half * 2 + 2, 1);
  }
  for (let y = top + 1; y < by; y++) {
    const k = (y - top) / (by - top);
    const half = Math.round(5 + Math.sqrt(k) * 11);
    ctx.fillStyle = PALETTE['8'];
    ctx.fillRect(x - half, y, half * 2, 1);
    ctx.fillStyle = PALETTE['9'];
    ctx.fillRect(x - half, y, Math.round(half * 1.3), 1);
    ctx.fillStyle = PALETTE.t;
    ctx.fillRect(x - half + 3, y, 2, 1);
  }
  // 누름 버튼
  ctx.fillStyle = PALETTE['1'];
  ctx.fillRect(x - 3, top - 4, 7, 5);
  ctx.fillStyle = PALETTE.k;
  ctx.fillRect(x - 2, top - 3, 5, 3);
  ctx.fillStyle = PALETTE.b;
  ctx.fillRect(x - 2, top - 3, 2, 1);
}
