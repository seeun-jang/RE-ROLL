// =============================================================
// 그래픽 에셋 — 원본 js/sprites.js · js/characters.js
//  - 캐릭터: 원본 도트 그림 PNG (assets/characters/*.png). 대기실에서 고른 동물 id 와 파일 이름이 같다.
//  - 라켓·공·탁구대·키캡: 코드로 직접 그린 도트
// =============================================================
import { C, PALETTE } from './palette.js';
import { BitmapFont, KText } from './text.js';

/** 동물 id → 이름표 색(팔레트 키). 원본 CHARACTERS 의 색 그대로 */
export const CHARACTER_COLORS = { bear: 'e', cat: 'q', duck: 't', tiger: '8', shiba: 'p' };
const ORDER = ['shiba', 'tiger', 'duck', 'bear', 'cat'];

/** 캐릭터 PNG 주소 (Vite 가 찾을 수 있게 하나씩 적는다) */
function characterUrls() {
  return {
    bear: new URL('../assets/characters/bear.png', import.meta.url).href,
    cat: new URL('../assets/characters/cat.png', import.meta.url).href,
    duck: new URL('../assets/characters/duck.png', import.meta.url).href,
    tiger: new URL('../assets/characters/tiger.png', import.meta.url).href,
    shiba: new URL('../assets/characters/shiba.png', import.meta.url).href,
  };
}

let spritePromise = null;

/** 캐릭터 그림을 불러와 스프라이트 묶음을 만든다 → { players: {동물 id: {frames, portrait}}, crown } */
export function loadSprites() {
  if (spritePromise) return spritePromise;
  const urls = characterUrls();
  spritePromise = Promise.all(
    Object.entries(urls).map(
      ([name, src]) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve([name, im]);
          im.onerror = () => {
            console.warn('[pingpong] 캐릭터 이미지를 불러오지 못함:', name);
            resolve([name, null]);
          };
          im.src = src;
        })
    )
  ).then((list) => {
    const players = {};
    for (const [name, im] of list) {
      const base = imageToCanvas(im);
      players[name] = { frames: [base, buildBreath(base)], portrait: buildPortrait(base) };
    }
    return { players, crown: buildSprite(ART.crown) };
  });
  return spritePromise;
}

/** 참가자의 동물 id (모르는 값이면 들어온 순서대로) */
export function characterOf(player) {
  return CHARACTER_COLORS[player.character] ? player.character : ORDER[(player.index || 0) % ORDER.length];
}

// 이미지 → 캔버스 (못 불러왔으면 물음표 상자로 대체)
function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img ? img.width : 24;
  c.height = img ? img.height : 32;
  const g = c.getContext('2d');
  if (img) g.drawImage(img, 0, 0);
  else {
    g.fillStyle = PALETTE.i;
    g.fillRect(0, 0, c.width, c.height);
    BitmapFont.draw(g, '?', 11, 13, PALETTE.b);
  }
  return c;
}

// 대기 모션 2번째 프레임: 윗몸을 1px 눌러서 숨 쉬는 느낌
function buildBreath(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  const cut = Math.floor(src.height * 0.55);
  g.drawImage(src, 0, cut, src.width, src.height - cut, 0, cut, src.width, src.height - cut);
  g.drawImage(src, 0, 0, src.width, cut, 0, 1, src.width, cut);
  return c;
}

// 좁은 곳(결과표 등)에 쓰는 상반신
function buildPortrait(src, h = 22) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = Math.min(h, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

const ART = {
  crown: [
    '9.9.9',
    '99999',
    '98989',
  ],
};

// 문자열 배열 → 캔버스
function buildSprite(rows) {
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

// ---- 조작키 키캡 ----
// 밝은 크림색 키 위에 진한 굵은 글씨. tone: 키 아래 테두리 색 (뒤 = 파랑, 치기 = 금색, 앞 = 빨강)
const KEY_TONES = {
  back: { body: 'g', dark: 'f', hi: 'h' },
  strike: { body: '9', dark: '8', hi: 't' },
  fwd: { body: '6', dark: '7', hi: '5' },
  plain: { body: 'j', dark: 'i', hi: 'k' },
};
const KEY_GLYPH = { '<': '←', '^': '↑', '>': '→' };

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
  // 글자
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

// 발 위치(아래 가운데)를 기준으로 서 있게 그리기
export function drawStanding(ctx, img, cx, by, squash = 0) {
  const h = img.height + squash;
  const w = img.width - squash;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(by - h), w, h);
}

// 얼굴 작은 칩 (16x16): 캐릭터 그림 머리 부분을 잘라서 + 색 테두리
export function drawFaceChip(ctx, spr, x, y, color) {
  const src = spr.portrait;
  const S = 14;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, S + 2, S + 2);
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 1, y + 1, S, S);
  ctx.drawImage(src, Math.round((src.width - S) / 2), Math.max(0, src.height - S - 1), S, S, x + 1, y + 1, S, S);
}
