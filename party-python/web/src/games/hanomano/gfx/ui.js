// =====================================================
// UI 조각: 디더 무늬 · 둥근 카드 · 패널 · 이름표 · 키캡
// 원본 js/hud.js · js/ui.js · js/sprites.js(키캡) · js/transition.js(디더) 를 옮겼다.
// =====================================================
import { C, DARK_OF, PALETTE } from './palette.js';
import { KText } from './text.js';

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬). level 0~16
export const DITHER = {
  cache: new Map(),
  get(ctx, key, level) {
    const id = key + '|' + level;
    if (!this.cache.has(id)) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = C(key);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) g.fillRect(x, y, 1, 1);
      this.cache.set(id, ctx.createPattern(c, 'repeat'));
    }
    return this.cache.get(id);
  },
};

// 둥근 모서리 카드 (모서리 2칸 깎음)
export function drawCard(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillStyle = C(edge);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  ctx.fillStyle = C(fill);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 4);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 5);
  // 윗부분 반짝
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 3, y + 2, Math.max(0, w - 10), 1);
}

// ---- 9-slice 픽셀 테두리 패널 ----
const PANEL_STYLES = {
  default: { out: '1', border: '9', shade: '8', fill: '2' },
  dark: { out: '1', border: '3', shade: '2', fill: 'o' },
};

export function drawPanel(ctx, x, y, w, h, style = 'default') {
  const s = PANEL_STYLES[style] || PANEL_STYLES.default;
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = C(s.out);
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = C(s.border);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = C(s.shade);
  ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
  ctx.fillRect(x + w - 3, y + 2, 1, h - 4);
  ctx.fillStyle = C(s.fill);
  ctx.fillRect(x + 2, y + 2, w - 5, h - 5);
  if (w > 20 && h > 14) {
    ctx.fillStyle = C('a');
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillRect(x + w - 4, y + 2, 1, 1);
  }
}

// 이름표: 캐릭터 색 카드 + 동그란 얼굴 아이콘 + 진한 이름 글씨. who = { color(팔레트 키), name, face(캔버스) }
export function drawNameCard(ctx, x, y, w, who) {
  const col = who.color;
  drawCard(ctx, x, y, w, 17, col, DARK_OF[col] || '3');
  if (who.face) ctx.drawImage(who.face, x + 1, y);
  // 이름이 칸보다 길면 작은 글꼴로 (얼굴 아이콘 오른쪽 공간에 맞춤)
  const room = w - 21;
  const big = KText.width(who.name, 'b') <= room;
  const name = big ? who.name : KText.fit(who.name, room, 'n');
  KText.draw(ctx, name, x + 19 + room / 2, y + (big ? 2 : 3), C('1'), { align: 'center', font: big ? 'b' : 'n' });
}

// ---- 조작키 키캡 ----
// 밝은 크림색 키 위에 진한 굵은 글씨. strike = 금색(종), plain = 회색(뒤집기)
const KEY_TONES = {
  strike: { body: '9', dark: '8', hi: 't' },
  plain: { body: 'j', dark: 'i', hi: 'k' },
};

function buildKeycap(w, h, tone, label, pressed) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + 2;
  const g = c.getContext('2d');
  const px = (x, y, ww, hh, k) => {
    g.fillStyle = C(k);
    g.fillRect(x, y, ww, hh);
  };
  const dy = pressed ? 2 : 0;
  // 키 두께 (아래쪽)
  px(1, 2, w - 2, h, '1');
  px(1, h - 1, w - 2, 2, tone.dark);
  // 키 윗면
  px(1, dy, w - 2, h, '1');
  px(0, dy + 1, w, h - 2, '1');
  px(1, dy + 1, w - 2, h - 2, pressed ? tone.hi : 'a');
  px(2, dy + 1, w - 4, 1, 'b');
  px(1, dy + h - 3, w - 2, 2, tone.body);
  const tw = KText.width(label, 'b');
  g.drawImage(KText.get(label, PALETTE['1'], 'b'), Math.round((w - tw) / 2) - 1, dy + 2);
  return c;
}

// 키캡은 글자마다 달라서 필요할 때 만들어 캐시 (너비는 글자 길이에 맞춤)
const KEYCAP_CACHE = new Map();
export function getKeycap(label, toneName, pressed) {
  const id = [label, toneName, pressed].join('|');
  if (!KEYCAP_CACHE.has(id)) {
    const w = Math.max(15, KText.width(label, 'b') + 8);
    KEYCAP_CACHE.set(id, buildKeycap(w, 18, KEY_TONES[toneName] || KEY_TONES.plain, label, pressed));
  }
  return KEYCAP_CACHE.get(id);
}

/** 글꼴이 늦게 불러와졌을 때 미리 만든 그림을 버린다 */
export function clearUiCache() {
  KEYCAP_CACHE.clear();
}
