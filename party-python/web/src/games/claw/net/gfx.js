// =============================================================
// 그리기 도구 — 원본 js/font.js · ui.js · hud.js · sprites.js 에서 인형뽑기가 쓰는 것만 ES 모듈로 옮겼다.
//   BitmapFont  3x5 숫자/영문          KText  한글 픽셀 글씨(Galmuri)
//   drawCard · drawPanel · drawNameCard · DITHER · 키캡 · 얼굴 아이콘 · 픽셀 직선/원
// 브라우저 객체(document, Image, FontFace)는 함수 안에서만 만진다(import 만으로는 아무 일도 없다).
// =============================================================
import { C, CHAR_COLOR, PALETTE } from './palette.js';

// ---- 3x5 비트맵 폰트 (숫자/영문 HUD 용) — 항상 픽셀이 딱 떨어짐 ----
const BITMAP_GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001111001111', 4: '101101111001001', 5: '111100111001111',
  6: '111100111101111', 7: '111001001010010', 8: '111101111101111',
  9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011',
  D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111',
  J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101101111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '!': '010010010000010', '?': '110001010000010', ':': '000010000010000',
  '.': '000000000000010', '-': '000000111000000', '+': '000010111010000',
  '/': '001001010100100', '%': '101001010100101', ',': '000000000010100',
  '<': '001010100010001', '>': '100010001010100', "'": '010010000000000',
  '^': '010111010010010', // 위 화살표 (키 표시용)
};

export const BitmapFont = {
  measure(str, scale = 1) {
    const s = String(str);
    return Math.max(0, s.length * 4 * scale - scale);
  },

  // align: left | center | right
  draw(ctx, str, x, y, color, opts = {}) {
    const scale = opts.scale || 1;
    const s = String(str).toUpperCase();
    const w = this.measure(s, scale);
    let px = x;
    if (opts.align === 'center') px = x - w / 2;
    else if (opts.align === 'right') px = x - w;
    px = Math.round(px);
    const py = Math.round(y);
    if (opts.shadow) this._raw(ctx, s, px, py + scale, opts.shadow, scale);
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        this._raw(ctx, s, px + dx * scale, py + dy * scale, opts.outline, scale);
      }
    }
    this._raw(ctx, s, px, py, color, scale);
  },

  _raw(ctx, s, x, y, color, scale) {
    ctx.fillStyle = color;
    for (let i = 0; i < s.length; i++) {
      const g = BITMAP_GLYPHS[s[i]];
      if (g) {
        for (let p = 0; p < 15; p++) {
          if (g[p] === '1') ctx.fillRect(x + (p % 3) * scale, y + ((p / 3) | 0) * scale, scale, scale);
        }
      }
      x += 4 * scale;
    }
  },
};

// ---- 한글 픽셀 폰트 (Galmuri) ----
// 캔버스 글씨는 기본적으로 흐릿하게 그려지므로
// 알파값을 0 또는 255로 잘라서 '딱 떨어지는 픽셀'로 만든 뒤 캐시함
// 굵은 글씨(ClawGalmuri11)는 이 게임의 assets/fonts 에서, 나머지는 페이지(fonts.css)가 불러온 Galmuri 를 쓴다.
export const KText = {
  cache: new Map(),
  fonts: {
    // 잘 보이도록 모든 글씨를 굵은 12px 로 (얇은 1px 획은 작은 화면에서 흐려 보임)
    s: { css: 'bold 12px ClawGalmuri11, Galmuri11, monospace', size: 12 },
    m: { css: 'bold 12px ClawGalmuri11, Galmuri11, monospace', size: 12 },
    b: { css: 'bold 12px ClawGalmuri11, Galmuri11, monospace', size: 12 },
    // 큰 제목 (2배로 키워 쓰는 글씨) — 획이 촘촘한 글자도 안 뭉개지는 15px 글꼴
    // thick: 세로획을 1px 두껍게
    L: { css: '15px Galmuri14, monospace', size: 15, padTop: 3, thick: true },
    // 좁은 칸에 긴 이름을 넣을 때 쓰는 작은 글꼴
    n: { css: '10px Galmuri9, monospace', size: 10 },
  },

  // 글자 모양(마스크) 만들기
  // 브라우저·OS마다 글씨 안티앨리어싱이 달라서 12px 로 바로 그리면 획이 촘촘한 글자가 뭉개짐
  // → 4배 크기로 그린 뒤 4x4 칸마다 절반 이상 칠해졌는지로 원래 픽셀을 되살림 (어느 PC에서나 같은 모양)
  _mask(str, font) {
    const key = 'mask|' + font + '|' + str;
    if (this.cache.has(key)) return this.cache.get(key);
    const f = this.fonts[font];
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
  get(str, color, font = 'm', outline = null) {
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

  width(str, font = 'm') {
    return this._mask(str, font).width - 2;
  },

  draw(ctx, str, x, y, color, opts = {}) {
    if (!str) return;
    const img = this.get(str, color, opts.font || 'm', opts.outline || null);
    const s = opts.scale || 1;
    const w = img.width * s;
    let dx = x;
    if (opts.align === 'center') dx = x - w / 2;
    else if (opts.align === 'right') dx = x - w;
    ctx.drawImage(img, Math.round(dx), Math.round(y), img.width * s, img.height * s);
  },

  // 칸 너비(maxW)에 맞게 여러 줄로 나눔 (해설 자막용)
  wrap(str, font, maxW, maxLines = 2) {
    const lines = [];
    let cur = '';
    for (const ch of String(str)) {
      if (this.width(cur + ch, font) > maxW && cur) {
        lines.push(cur.trimEnd());
        cur = ch === ' ' ? '' : ch;
        if (lines.length === maxLines) return lines;
      } else cur += ch;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
  },

  // 너비에 맞게 뒤를 자름 (긴 이름)
  fit(str, font, maxW) {
    let s = String(str);
    while (s.length > 1 && this.width(s, font) > maxW) s = s.slice(0, -1);
    return s;
  },

  clear() {
    this.cache.clear();
  },
};

// ---- 9-slice 픽셀 테두리 패널 ----
const PANEL_STYLES = {
  default: { out: '1', border: '9', shade: '8', fill: '2' },
  dark: { out: '1', border: '3', shade: '2', fill: 'o' },
  red: { out: '1', border: '9', shade: '8', fill: '7' },
};

export function drawPanel(ctx, x, y, w, h, style = 'default') {
  const s = PANEL_STYLES[style] || PANEL_STYLES.default;
  x = Math.round(x);
  y = Math.round(y);
  // 바깥 외곽선 (모서리는 깎아서 둥글게)
  ctx.fillStyle = C(s.out);
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  // 금 테두리
  ctx.fillStyle = C(s.border);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // 안쪽 그림자 (아래/오른쪽)
  ctx.fillStyle = C(s.shade);
  ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
  ctx.fillRect(x + w - 3, y + 2, 1, h - 4);
  // 내부
  ctx.fillStyle = C(s.fill);
  ctx.fillRect(x + 2, y + 2, w - 5, h - 5);
  // 모서리 리벳
  if (w > 20 && h > 14) {
    ctx.fillStyle = C('a');
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillRect(x + w - 4, y + 2, 1, 1);
  }
}

// ---- 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬) ----
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
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
const DARK_OF = { e: 'd', q: 'v', t: '8', 8: 'u', p: '4', 9: '8' };

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

// 이름표: c = { color(팔레트 키), name, face(얼굴 아이콘 캔버스), place(등수 또는 null) }
export function drawNameCard(ctx, x, y, w, c, frame = 0, crown = null) {
  const done = c.place != null;
  const col = done ? '9' : c.color;
  drawCard(ctx, x, y, w, 17, col, DARK_OF[col] || '3');
  if (c.face) ctx.drawImage(c.face, x + 1, y);
  // 이름이 칸보다 길면 작은 글꼴로 (얼굴 아이콘 오른쪽 공간에 맞춤)
  const room = w - 21;
  const big = KText.width(c.name, 'b') <= room;
  const name = big ? c.name : KText.fit(c.name, 'n', room);
  KText.draw(ctx, name, x + 19 + room / 2, y + (big ? 2 : 3), C('1'), { align: 'center', font: big ? 'b' : 'n' });
  if (done) {
    // 왕관 + 등수 리본
    if (crown) ctx.drawImage(crown, x + 6, y - 3);
    const tag = `${c.place}등`;
    const tw = KText.width(tag, 's') + 6;
    const tx = x + w - tw;
    const bob = Math.round(Math.abs(Math.sin(frame / 10)));
    // 이름 아래로 늘어진 리본 (이름을 가리지 않게)
    drawCard(ctx, tx, y + 15 - bob, tw, 14, '6', '7');
    KText.draw(ctx, tag, tx + tw / 2, y + 15 - bob, C('a'), { align: 'center', font: 's' });
  }
}

// ---- 작은 소품: 문자열 픽셀 아트 (1글자 = 1픽셀, '.' = 투명) ----
const ART = {
  crown: [
    '9.9.9',
    '99999',
    '98989',
  ],
};

export function buildSprite(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || !PALETTE[ch]) continue;
      g.fillStyle = PALETTE[ch];
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

export function buildCrown() {
  return buildSprite(ART.crown);
}

// 단색 실루엣
function buildFlash(src, color = '#ffffff') {
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

// ---- 동그란 얼굴 아이콘 (이름표용, 16x16 + 테두리) ----
//  mini: 절반 크기 캐릭터 그림(없으면 물음표 상자)
export function buildFace(mini) {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.w;
  g.fillRect(0, 0, S, S);
  if (mini) g.drawImage(mini, Math.round(S / 2 - mini.width / 2), 0);
  else BitmapFont.draw(g, '?', 7, 5, PALETTE.i);
  // 픽셀 동그라미 모양만 남기기 (안티앨리어싱 없이 한 줄씩)
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
  // 테두리
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

// ---- 캐릭터 그림(절반 크기 PNG) · 굵은 글꼴 불러오기 ----
function miniUrls() {
  return {
    bear: new URL('../assets/characters/bear-mini.png', import.meta.url).href,
    cat: new URL('../assets/characters/cat-mini.png', import.meta.url).href,
    duck: new URL('../assets/characters/duck-mini.png', import.meta.url).href,
    tiger: new URL('../assets/characters/tiger-mini.png', import.meta.url).href,
    shiba: new URL('../assets/characters/shiba-mini.png', import.meta.url).href,
  };
}

/** 동물 id → 절반 크기 그림(Image). 못 불러온 것은 빠진다 */
export function loadMiniImages() {
  const urls = miniUrls();
  const out = {};
  return Promise.all(
    Object.keys(urls).map(
      (name) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => {
            out[name] = im;
            resolve();
          };
          im.onerror = () => {
            console.warn('[claw] 캐릭터 이미지를 불러오지 못함:', name);
            resolve();
          };
          im.src = urls[name];
        })
    )
  ).then(() => out);
}

/** 굵은 Galmuri11 을 불러와 등록한다 → 등록한 FontFace (destroy 때 지운다). 실패하면 null */
export async function loadBoldFont() {
  if (typeof FontFace === 'undefined' || !document.fonts) return null;
  try {
    const url = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
    const face = new FontFace('ClawGalmuri11', `url("${url}") format("woff2")`, { weight: 'bold' });
    await face.load();
    document.fonts.add(face);
    return face;
  } catch (e) {
    console.warn('[claw] 굵은 글꼴 로딩 실패, 기본 글꼴 사용', e);
    return null;
  }
}

export function charColor(character) {
  return CHAR_COLOR[character] || 'h';
}

// ---- 조작키 키캡 ----
// 밝은 크림색 키 위에 진한 굵은 글씨 (어두운 배경에서도 또렷하게)
const KEY_TONES = {
  strike: { body: '9', dark: '8', hi: 't' },
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
  // 키 두께 (아래쪽)
  px(1, 2, w - 2, h, '1');
  px(1, h - 1, w - 2, 2, tone.dark);
  // 키 윗면
  px(1, dy, w - 2, h, '1');
  px(0, dy + 1, w, h - 2, '1');
  px(1, dy + 1, w - 2, h - 2, pressed ? tone.hi : 'a');
  px(2, dy + 1, w - 4, 1, 'b');
  px(1, dy + h - 3, w - 2, 2, tone.body);
  // 글자 (맨 윗줄이 테두리에 가려지지 않게 1px 아래부터)
  const label = KEY_GLYPH[key] || key;
  const tw = KText.width(label, 'b');
  g.drawImage(KText.get(label, PALETTE['1'], 'b'), Math.round((w - tw) / 2) - 1, dy + 2);
  return c;
}

// 키캡은 글자마다 달라서 필요할 때 만들어 캐시 (너비는 글자 길이에 맞춤)
const KEYCAP_CACHE = new Map();
export function getKeycap(key, toneName, pressed) {
  const id = [key, toneName, pressed].join('|');
  if (!KEYCAP_CACHE.has(id)) {
    const label = KEY_GLYPH[key] || key;
    const w = Math.max(15, KText.width(label, 'b') + 8);
    KEYCAP_CACHE.set(id, buildKeycap(w, 18, KEY_TONES[toneName] || KEY_TONES.plain, key, pressed));
  }
  return KEYCAP_CACHE.get(id);
}

/** 글꼴이 바뀌었을 때(늦게 도착) 글씨 · 키캡 캐시를 비운다 */
export function clearTextCaches() {
  KText.clear();
  KEYCAP_CACHE.clear();
}

// 픽셀 직선 — 정수 좌표로 한 칸씩 찍음
export function drawPixelLine(ctx, x0, y0, x1, y1, color, thick = 1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0, y0, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// 점선 원 (정수 좌표, 안티앨리어싱 없음)
export function drawPixelRing(ctx, cx, cy, r, color, step = 1) {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.floor(r * 3));
  for (let i = 0; i < n; i += step) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}
