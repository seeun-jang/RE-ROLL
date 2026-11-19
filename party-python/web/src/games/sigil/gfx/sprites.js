// =====================================================
// 그래픽 에셋 — 원본 js/sprites.js · js/characters.js · js/backdrop.js
//  - 캐릭터: 원본 도트 그림 PNG (assets/characters/*.png). 대기실에서 고른 동물 id 와 파일 이름이 같다.
//  - 얼굴 아이콘은 절반 크기 PNG(<이름>-mini.png)로 만듦
//  - 왕관: 문자열 픽셀 아트 (1글자 = 1픽셀, '.' = 투명)
// 그림을 불러오지 못하면 물음표 상자로 대신한다.
// =====================================================
import { CONFIG } from '../config.js';
import { C, PALETTE } from '../palette.js';
import { BitmapFont, DITHER } from './ui.js';

// 동물 id → 이름표 색 (원본 characters.js 의 color)
export const CHARACTER_COLORS = { bear: 'e', cat: 'q', duck: 't', tiger: '8', shiba: 'p' };
const ORDER = ['shiba', 'tiger', 'duck', 'bear', 'cat'];

/** 그림 주소 (Vite 가 찾을 수 있게 파일 이름을 하나씩 적는다) */
function characterUrls() {
  return {
    bear: new URL('../assets/characters/bear.png', import.meta.url).href,
    cat: new URL('../assets/characters/cat.png', import.meta.url).href,
    duck: new URL('../assets/characters/duck.png', import.meta.url).href,
    tiger: new URL('../assets/characters/tiger.png', import.meta.url).href,
    shiba: new URL('../assets/characters/shiba.png', import.meta.url).href,
    'bear-mini': new URL('../assets/characters/bear-mini.png', import.meta.url).href,
    'cat-mini': new URL('../assets/characters/cat-mini.png', import.meta.url).href,
    'duck-mini': new URL('../assets/characters/duck-mini.png', import.meta.url).href,
    'tiger-mini': new URL('../assets/characters/tiger-mini.png', import.meta.url).href,
    'shiba-mini': new URL('../assets/characters/shiba-mini.png', import.meta.url).href,
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => {
      console.warn('[sigil] 캐릭터 이미지를 불러오지 못함:', src);
      resolve(null);
    };
    im.src = src;
  });
}

// 이미지 → 캔버스 (못 불러왔으면 물음표 상자로 대체)
function imageToCanvas(img, w = 24, h = 32) {
  const c = document.createElement('canvas');
  c.width = img ? img.width : w;
  c.height = img ? img.height : h;
  const g = c.getContext('2d');
  if (img) g.drawImage(img, 0, 0);
  else {
    g.fillStyle = PALETTE.i;
    g.fillRect(0, 0, c.width, c.height);
    BitmapFont.draw(g, '?', c.width / 2, c.height / 2 - 3, PALETTE.b, { align: 'center' });
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
//  픽셀을 읽지 않고 그리기만 해서 만듦
function buildFace(mini) {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.w;
  g.fillRect(0, 0, S, S);
  g.drawImage(mini, Math.round(S / 2 - mini.width / 2), 0);
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

const CROWN = ['9.9.9', '99999', '98989'];

/** 참가자의 동물 id (모르는 값이면 참가 순서대로) */
export function characterOf(player, i = 0) {
  return CHARACTER_COLORS[player.character] ? player.character : ORDER[(player.index ?? i) % ORDER.length];
}

/**
 * 스프라이트 만들기 → { chars: { 동물 id: { frames: [기본, 숨쉬기], face } }, crown }
 * ids: 이 판에 나오는 동물 id 목록
 */
export async function loadSprites(ids) {
  const urls = characterUrls();
  const chars = {};
  await Promise.all([...new Set(ids)].map(async (id) => {
    const [img, mini] = await Promise.all([loadImage(urls[id]), loadImage(urls[`${id}-mini`])]);
    const base = imageToCanvas(img, 24, 32);
    chars[id] = { frames: [base, buildBreath(base)], face: buildFace(imageToCanvas(mini, 12, 16)) };
  }));
  return { chars, crown: buildSprite(CROWN) };
}

// 발 위치(아래 가운데)를 기준으로 서 있게 그리기
export function drawStanding(ctx, img, cx, by) {
  ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(by - img.height));
}

// ---- 배경: 마법사 성 서재 (벽돌 + 천천히 흐르는 별가루 패럴랙스) ----
export function drawBackdrop(ctx, frame) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HEIGHT;
  ctx.fillStyle = C('2');
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) {
    for (let x = (y / 8) % 2 ? -8 : 0; x < W; x += 16) {
      ctx.fillStyle = C('1');
      ctx.fillRect(x, y, 16, 1);
      ctx.fillRect(x, y, 1, 8);
      ctx.fillStyle = C('3');
      ctx.fillRect(x + 1, y + 1, 14, 1);
    }
  }
  ctx.fillStyle = DITHER.get(ctx, 'o', 8);
  ctx.fillRect(0, 0, W, H);
  // 별가루 (패럴랙스: 느린 것 / 빠른 것)
  for (let i = 0; i < 24; i++) {
    const speed = i % 2 ? 0.15 : 0.35;
    const x = (i * 53 + frame * speed) % (W + 10) - 5;
    const y = (i * 37) % H;
    ctx.fillStyle = C(i % 3 ? '8' : 't');
    if ((frame + i * 9) % 50 < 40) ctx.fillRect(Math.round(x), y, 1, 1);
  }
}

// ---- 마법진 모양별로 튀어나오는 아이콘 ----
export const SPELL_ICON = { 고리: 'moon', 삼각: 'star', 다이아: 'gem', 별: 'star', 번개: 'bolt', 왕관: 'gem', 하트: 'heart', 소용돌이: 'swirl', 물고기: 'coin' };
const SPELL_ART = {
  star: ['..1..', '.111.', '11111', '.111.', '1...1'],
  heart: ['11.11', '11111', '11111', '.111.', '..1..'],
  moon: ['.111.', '11...', '11...', '11...', '.111.'],
  gem: ['.111.', '11111', '.111.', '..1..', '.....'],
  bolt: ['...11', '..11.', '.111.', '.11..', '11...'],
  swirl: ['11111', '1...1', '1.1.1', '1.111', '1....'],
  coin: ['.111.', '1.1.1', '11.11', '1.1.1', '.111.'],
};
export function drawSpellIcon(ctx, x, y, icon, color, blink) {
  if (blink) return;
  const art = SPELL_ART[icon] || SPELL_ART.star;
  const ox = Math.round(x) - 2;
  const oy = Math.round(y) - 2;
  ctx.fillStyle = C('1');
  for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 5; c2++) if (art[r][c2] === '1') ctx.fillRect(ox + c2 - 1, oy + r - 1, 3, 3);
  ctx.fillStyle = C(color);
  for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 5; c2++) if (art[r][c2] === '1') ctx.fillRect(ox + c2, oy + r, 1, 1);
}
