// =============================================================
// 그리기 도구 — 원본 js/palette.js · font.js · ui.js(KText · drawPanel) · hud.js(DITHER · 이름표) ·
// sprites.js(캐릭터 PNG · 얼굴 아이콘 · 키캡) · particles.js 를 ES 모듈로 옮긴 것.
// 브라우저 객체(document · Image)는 함수가 불릴 때만 만진다(모듈을 import 만 해서는 아무 일도 없다).
// =============================================================

// ---- 팔레트 (32색) — 스프라이트 문자열의 한 글자 = 팔레트 한 칸 ----
export const PALETTE = {
  o: '#120a1c', 1: '#1a1028', 2: '#3b1f4a', 3: '#6b2f6b', 4: '#a8467a', 5: '#e8606a', 6: '#b8283a', 7: '#6e1830',
  8: '#f4a83a', 9: '#ffd84a', a: '#fff4c8', b: '#ffffff', c: '#2a6b4a', d: '#4aa86a', e: '#9ae07a', f: '#1e3a6e',
  g: '#3a72c8', h: '#7ac8f4', i: '#5a4a5e', j: '#9a8aa0', k: '#d8c8d0', l: '#8a4a2a', m: '#c8784a', n: '#f0c090',
  p: '#ffb8c8', q: '#c8a8f0', r: '#a0603a', s: '#4a2a22', t: '#ffe890', u: '#e09850', v: '#6a4a8a', w: '#fff8fc',
};
export const C = (key) => PALETTE[key];

// ---- 3x5 비트맵 폰트 (숫자/영문 HUD 용) ----
const BITMAP_GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111',
  '!': '010010010000010', '?': '110001010000010', ':': '000010000010000', '.': '000000000000010',
  '-': '000000111000000', '+': '000010111010000', '/': '001001010100100', '%': '101001010100101',
  ',': '000000000010100', '<': '001010100010001', '>': '100010001010100', "'": '010010000000000',
  '^': '010111010010010',
};

export const BitmapFont = {
  measure(str, scale = 1) {
    return Math.max(0, String(str).length * 4 * scale - scale);
  },
  // opts: { align: left|center|right, scale, outline }
  draw(ctx, str, x, y, color, opts = {}) {
    const scale = opts.scale || 1;
    const s = String(str).toUpperCase();
    const w = this.measure(s, scale);
    let px = x;
    if (opts.align === 'center') px = x - w / 2;
    else if (opts.align === 'right') px = x - w;
    px = Math.round(px);
    const py = Math.round(y);
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) this._raw(ctx, s, px + dx * scale, py + dy * scale, opts.outline, scale);
    }
    this._raw(ctx, s, px, py, color, scale);
  },
  _raw(ctx, s, x, y, color, scale) {
    ctx.fillStyle = color;
    for (let i = 0; i < s.length; i++) {
      const g = BITMAP_GLYPHS[s[i]];
      if (g) for (let p = 0; p < 15; p++) if (g[p] === '1') ctx.fillRect(x + (p % 3) * scale, y + ((p / 3) | 0) * scale, scale, scale);
      x += 4 * scale;
    }
  },
};

// ---- 한글 픽셀 폰트 (Galmuri) ----
// 캔버스 글씨는 흐릿하게 그려지므로 4배 크기로 그린 뒤 4x4 칸마다 절반 이상 칠해졌는지로
// 원래 픽셀을 되살려 '딱 떨어지는 픽셀'로 만들고 캐시한다(원본 KText 그대로).
export const BOLD_FAMILY = 'LivefireGalmuri11Bold';   // assets/Galmuri11-Bold.woff2 (RangeScreen 이 불러온다)
export const KText = {
  cache: new Map(),
  fonts: {
    s: { css: `12px ${BOLD_FAMILY}, Galmuri11`, size: 12 },
    b: { css: `12px ${BOLD_FAMILY}, Galmuri11`, size: 12 },
    L: { css: '15px Galmuri14', size: 15, padTop: 3, thick: true },   // 큰 제목 (2배로 키워 씀)
    n: { css: '10px Galmuri9', size: 10 },                            // 좁은 칸용 작은 글꼴
  },

  _mask(str, font) {
    const key = 'mask|' + font + '|' + str;
    if (this.cache.has(key)) return this.cache.get(key);
    const f = this.fonts[font] || this.fonts.b;
    const S = 4;
    const bigCss = f.css.replace(/(\d+)px/, (m, n) => n * S + 'px');
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = f.css;
    const w = Math.max(1, Math.ceil(probe.measureText(str).width) + 2);
    const padTop = f.padTop || 1;
    const h = f.size + 3 + padTop;
    const big = document.createElement('canvas');
    big.width = w * S + S;
    big.height = h * S + S;
    const bg = big.getContext('2d', { willReadFrequently: true });
    bg.font = bigCss;
    bg.textBaseline = 'top';
    bg.fillStyle = '#fff';
    bg.fillText(str, S, S * padTop);
    const src = bg.getImageData(0, 0, big.width, big.height).data;
    const cover = (x0, y0) => {
      let sum = 0;
      for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) sum += src[(y * big.width + x) * 4 + 3];
      return sum / (S * S * 255);
    };
    // 글꼴 픽셀 격자와 가장 잘 맞는 위치(0~3) 찾기
    let best = [0, 0];
    let bestScore = -1;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        let sc = 0;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) sc += Math.abs(cover(px + x * S, py + y * S) - 0.5);
        if (sc > bestScore) {
          bestScore = sc;
          best = [px, py];
        }
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const on = (x, y) => x >= 0 && cover(best[0] + x * S, best[1] + y * S) >= 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (on(x, y) || (f.thick && on(x - 1, y))) {
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = img.data[o + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    if (this.cache.size > 1500) this.cache.clear();
    this.cache.set(key, c);
    return c;
  },

  _tint(mask, color) {
    const c = document.createElement('canvas');
    c.width = mask.width;
    c.height = mask.height;
    const g = c.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  },

  // 글씨 + (선택) 1px 외곽선 → 캔버스 하나로 캐시
  get(str, color, font = 'b', outline = null) {
    const key = [str, color, font, outline].join('|');
    if (this.cache.has(key)) return this.cache.get(key);
    const mask = this._mask(str, font);
    const pad = outline ? 1 : 0;
    const c = document.createElement('canvas');
    c.width = mask.width + pad * 2;
    c.height = mask.height + pad * 2;
    const g = c.getContext('2d');
    if (outline) {
      const o = this._tint(mask, outline);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) g.drawImage(o, pad + dx, pad + dy);
    }
    g.drawImage(this._tint(mask, color), pad, pad);
    this.cache.set(key, c);
    return c;
  },

  width(str, font = 'b') {
    return this._mask(String(str), font).width - 2;
  },

  // opts: { font, align, outline, scale }
  draw(ctx, str, x, y, color, opts = {}) {
    str = String(str);
    if (!str) return;
    const img = this.get(str, color, opts.font || 'b', opts.outline || null);
    const s = opts.scale || 1;
    const w = img.width * s;
    let dx = x;
    if (opts.align === 'center') dx = x - w / 2;
    else if (opts.align === 'right') dx = x - w;
    ctx.drawImage(img, Math.round(dx), Math.round(y), img.width * s, img.height * s);
  },

  clear() {
    this.cache.clear();
  },
};

// ---- 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬) ----
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
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

// 캐릭터 색의 진한 짝 (카드 그림자/테두리)
export const DARK_OF = { e: 'd', q: 'v', t: '8', 8: 'u', p: '4', 9: '8' };

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
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 3, y + 2, Math.max(0, w - 10), 1);
}

// 이름표: 캐릭터 색 카드 + 동그란 얼굴 아이콘 + 이름. p = { color, name, face }
export function drawNameCard(ctx, x, y, w, p) {
  drawCard(ctx, x, y, w, 17, p.color, DARK_OF[p.color] || '3');
  if (p.face) ctx.drawImage(p.face, x + 1, y);
  const room = w - 21;
  let name = p.name;
  const big = KText.width(name, 'b') <= room;
  if (!big) while (KText.width(name, 'n') > room && name.length > 1) name = name.slice(0, -1);
  KText.draw(ctx, name, x + 19 + room / 2, y + (big ? 2 : 3), C('1'), { align: 'center', font: big ? 'b' : 'n' });
}

// 9-slice 픽셀 테두리 패널
export function drawPanel(ctx, x, y, w, h, s = { out: '1', border: '3', shade: '2', fill: 'o' }) {
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
}

// 사격 등급 배지: 어두운 바탕 + 등급 색 테두리 + 등급 색 글자 (칸 폭에 맞춰 글꼴 줄임)
export function drawGradeBadge(ctx, cx, y, g, maxW) {
  let font = 'b';
  if (KText.width(g.name, font) + 10 > maxW) font = 'n';
  const tw = KText.width(g.name, font);
  const w = tw + 10;
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = C(g.color);
  ctx.fillRect(x, y, w, 15);
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 1, y + 1, w - 2, 13);
  KText.draw(ctx, g.name, cx, y + (font === 'b' ? 1 : 2), C(g.color), { align: 'center', font });
}

// ---- 캐릭터 PNG (원본 assets/characters) — 대기실에서 고른 동물 id 에 맞는 그림 ----
// color: 이름표 · 사로 꼬리표 색(원본 characters.js)
export const CHARACTER_COLORS = { bear: 'e', cat: 'q', duck: 't', tiger: '8', shiba: 'p' };
export const CHARACTER_IDS = ['shiba', 'tiger', 'duck', 'bear', 'cat'];

function characterUrls() {
  return {
    bear: new URL('../assets/bear-mini.png', import.meta.url).href,
    cat: new URL('../assets/cat-mini.png', import.meta.url).href,
    duck: new URL('../assets/duck-mini.png', import.meta.url).href,
    tiger: new URL('../assets/tiger-mini.png', import.meta.url).href,
    shiba: new URL('../assets/shiba-mini.png', import.meta.url).href,
  };
}

/** 절반 크기 캐릭터 그림을 불러온다 → { id: Image } (못 불러온 것은 빠진다) */
export function loadCharacterImages() {
  const urls = characterUrls();
  const out = {};
  return Promise.all(Object.entries(urls).map(([id, url]) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      out[id] = im;
      resolve();
    };
    im.onerror = () => {
      console.warn('[livefire] 캐릭터 그림을 불러오지 못함:', id);
      resolve();
    };
    im.src = url;
  }))).then(() => out);
}

// 이미지 → 캔버스 (못 불러왔으면 물음표 상자로 대체)
export function imageToCanvas(img, w = 12, h = 16) {
  const c = document.createElement('canvas');
  c.width = img ? img.width : w;
  c.height = img ? img.height : h;
  const g = c.getContext('2d');
  if (img) g.drawImage(img, 0, 0);
  else {
    g.fillStyle = PALETTE.i;
    g.fillRect(0, 0, c.width, c.height);
    BitmapFont.draw(g, '?', 5, 5, PALETTE.b);
  }
  return c;
}

// 단색 실루엣
function buildFlash(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// 동그란 얼굴 아이콘 (이름표용, 16x16 + 테두리)
export function buildFace(mini) {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.w;
  g.fillRect(0, 0, S, S);
  g.drawImage(mini, Math.round(S / 2 - mini.width / 2), 0);
  const mask = document.createElement('canvas');
  mask.width = S;
  mask.height = S;
  const mg = mask.getContext('2d');
  mg.fillStyle = '#000';
  const r = S / 2 - 0.5;
  for (let y = 0; y < S; y++) {
    const dy = y + 0.5 - S / 2;
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (half > 0) mg.fillRect(S / 2 - half, y, half * 2, 1);
  }
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-over';
  const out = document.createElement('canvas');
  out.width = S + 2;
  out.height = S + 2;
  const og = out.getContext('2d');
  const ring = buildFlash(c, PALETTE['1']);
  og.drawImage(ring, 0, 1);
  og.drawImage(ring, 2, 1);
  og.drawImage(ring, 1, 0);
  og.drawImage(ring, 1, 2);
  og.drawImage(c, 1, 1);
  return out;
}

// 엎드려 쏴 (옆모습): 캐릭터를 눕힘 — 머리가 오른쪽
export function buildProne(mini) {
  const c = document.createElement('canvas');
  c.width = mini.height;
  c.height = mini.width;
  const g = c.getContext('2d');
  g.translate(mini.height, 0);
  g.rotate(Math.PI / 2);
  g.drawImage(mini, 0, 0);
  return c;
}

// 문자열 배열 → 캔버스 (왕관)
export function buildCrown() {
  const rows = ['9.9.9', '99999', '98989'];
  const c = document.createElement('canvas');
  c.width = 5;
  c.height = 3;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!PALETTE[row[x]]) continue;
      g.fillStyle = PALETTE[row[x]];
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// ---- 조작키 키캡 ----
const KEY_TONES = {
  fwd: { body: '6', dark: '7', hi: '5' },
  plain: { body: 'j', dark: 'i', hi: 'k' },
};
const KEY_GLYPH = { '<': '←', '^': '↑', '>': '→', v: '↓' };

function buildKeycap(w, h, tone, key, pressed) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + 2;
  const g = c.getContext('2d');
  const px = (x, y, ww, hh, k) => {
    g.fillStyle = C(k);
    g.fillRect(x, y, ww, hh);
  };
  const dy = pressed ? 2 : 0;
  px(1, 2, w - 2, h, '1');
  px(1, h - 1, w - 2, 2, tone.dark);
  px(1, dy, w - 2, h, '1');
  px(0, dy + 1, w, h - 2, '1');
  px(1, dy + 1, w - 2, h - 2, pressed ? tone.hi : 'a');
  px(2, dy + 1, w - 4, 1, 'b');
  px(1, dy + h - 3, w - 2, 2, tone.body);
  const label = KEY_GLYPH[key] || key;
  const tw = KText.width(label, 'b');
  g.drawImage(KText.get(label, PALETTE['1'], 'b'), Math.round((w - tw) / 2) - 1, dy + 2);
  return c;
}

const KEYCAP_CACHE = new Map();
function getKeycap(key, toneName, pressed) {
  const id = [key, toneName, pressed].join('|');
  if (!KEYCAP_CACHE.has(id)) {
    const label = KEY_GLYPH[key] || key;
    const w = Math.max(15, KText.width(label, 'b') + 8);
    KEYCAP_CACHE.set(id, buildKeycap(w, 18, KEY_TONES[toneName] || KEY_TONES.plain, key, pressed));
  }
  return KEYCAP_CACHE.get(id);
}

// 조작키 묶음: 방향키 모양 (위 ↑ / 아래 ← ↓ →) + 발사 키(빨강, ↑ 왼쪽)
//  keys: { up, left, down, right, fire } 글자, inp: 눌림 상태 { up, left, down, right, fire }
export function drawKeyCluster(ctx, cx, y, keys, inp = {}, minX = -1e9, maxX = 1e9) {
  const cap = (k, tone, on) => getKeycap(k, tone, !!on);
  const l = cap(keys.left, 'plain', inp.left);
  const d = cap(keys.down, 'plain', inp.down);
  const r = cap(keys.right, 'plain', inp.right);
  const u = cap(keys.up, 'plain', inp.up);
  const f = cap(keys.fire, 'fwd', inp.fire);
  const bw = l.width + d.width + r.width + 2;
  let x = Math.round(cx - bw / 2);
  const fireLeft = x + l.width + 1 + Math.round((d.width - u.width) / 2) - f.width - 1;
  if (fireLeft < minX + 1) x += minX + 1 - fireLeft;
  if (x + bw > maxX - 1) x = Math.max(x - (x + bw - maxX + 1), x);
  const dx = x + l.width + 1;
  ctx.drawImage(l, x, y + 19);
  ctx.drawImage(d, dx, y + 19);
  ctx.drawImage(r, dx + d.width + 1, y + 19);
  const ux = dx + Math.round((d.width - u.width) / 2);
  ctx.drawImage(u, ux, y);
  ctx.drawImage(f, ux - f.width - 1, y);
}

/** 글꼴이 늦게 불러와졌거나 화면을 닫을 때: 만들어 둔 글자 · 무늬 · 키캡을 버린다 */
export function resetGfxCaches() {
  KText.clear();
  DITHER.cache.clear();
  KEYCAP_CACHE.clear();
}

// ---- 파티클 (모두 픽셀 단위 사각형) ----
export class ParticleSystem {
  constructor() {
    this.parts = [];
  }

  add(x, y, vx, vy, life, color, size = 1, gravity = 0) {
    if (this.parts.length > 900) return;
    this.parts.push({ x, y, vx, vy, life, max: life, color, size, gravity });
  }

  // 사방으로 터지는 불꽃
  burst(x, y, n, colors, speed = 1.5, life = 24, size = 1, gravity = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const c = colors[(Math.random() * colors.length) | 0];
      this.add(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), c, size, gravity);
    }
  }

  update() {
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life--;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
  }

  render(ctx) {
    for (const p of this.parts) {
      const s = p.life < p.max * 0.3 ? Math.max(1, p.size - 1) : p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
  }

  clear() {
    this.parts = [];
  }
}
