// =====================================================
// 캐릭터 그림: 원본 assets/characters 의 동물 PNG (곰 · 고양이 · 오리 · 호랑이 · 시바)
//  - 대기실에서 고른 동물 id 와 파일 이름이 같다
//  - 이름표에 쓰는 동그란 얼굴 아이콘은 절반 크기 PNG(<이름>-mini.png)로 만든다
// 원본 js/sprites.js 에서 이 게임이 쓰는 부분만 옮겼다.
// =====================================================
import { PALETTE } from './palette.js';
import { BitmapFont } from './text.js';

/** 그림 파일 주소 (Vite 가 찾을 수 있게 파일 이름을 그대로 적는다) */
function miniUrls() {
  return {
    bear: new URL('../assets/characters/bear-mini.png', import.meta.url).href,
    cat: new URL('../assets/characters/cat-mini.png', import.meta.url).href,
    duck: new URL('../assets/characters/duck-mini.png', import.meta.url).href,
    shiba: new URL('../assets/characters/shiba-mini.png', import.meta.url).href,
    tiger: new URL('../assets/characters/tiger-mini.png', import.meta.url).href,
  };
}

/** 굵은 글꼴 파일 주소 */
export function boldFontUrl() {
  return new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
}

/** 얼굴 아이콘용 그림을 불러온다 → { 동물 id: Image | null } (실패해도 게임은 진행) */
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
            console.warn('[hanomano] 캐릭터 이미지를 불러오지 못함:', name);
            out[name] = null;
            resolve();
          };
          im.src = urls[name];
        })
    )
  ).then(() => out);
}

// 이미지 → 캔버스 (못 불러왔으면 물음표 상자로 대체)
function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img ? img.width : 12;
  c.height = img ? img.height : 16;
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

// ---- 동그란 얼굴 아이콘 (이름표용, 16x16 + 테두리) ----
//  픽셀을 읽지 않고 그리기만 해서 만듦
export function buildFace(img) {
  const mini = imageToCanvas(img);
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

// 왕관 (문자열 픽셀 아트: 1글자 = 1픽셀)
const CROWN = ['9.9.9', '99999', '98989'];
let crown = null;
export function crownSprite() {
  if (crown) return crown;
  const c = document.createElement('canvas');
  c.width = 5;
  c.height = 3;
  const g = c.getContext('2d');
  CROWN.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!PALETTE[row[x]]) continue;
      g.fillStyle = PALETTE[row[x]];
      g.fillRect(x, y, 1, 1);
    }
  });
  crown = c;
  return c;
}
