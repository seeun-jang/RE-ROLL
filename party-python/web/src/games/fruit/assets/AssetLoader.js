// ============================================================
//  에셋 로더 — 코드로 그린 스프라이트를 캔버스로 굽는다.
//  실제 이미지로 바꾸고 싶으면 IMAGE_OVERRIDES 에 URL 만 넣으면 된다.
//  (게임 코드는 assets.get('apple').frames[0] 처럼 이름으로만 접근)
// ============================================================
import { PALETTE } from './palette.js';
import { buildSpriteData } from './spriteData.js';

// 예) apple: ['./images/apple_0.png', './images/apple_1.png']
export const IMAGE_OVERRIDES = {};

function gridToCanvas(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = grid[y][x];
      if (idx < 0) continue;
      ctx.fillStyle = PALETTE[idx];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = url;
  });
}

export class Assets {
  constructor(sprites) {
    this.sprites = sprites;
    this._urls = new Map();
  }

  get(name) {
    const s = this.sprites[name];
    if (!s) throw new Error(`스프라이트 없음: ${name}`);
    return s;
  }

  // 애니메이션 시간 t(초)와 fps로 현재 프레임 캔버스 선택
  frame(name, t = 0, fps = 10) {
    const s = this.get(name);
    return s.frames[Math.floor(t * fps) % s.frames.length];
  }

  // React UI(이미지 태그, CSS)에서 쓰도록 데이터 URL로 변환 (캐시)
  url(name, frame = 0) {
    const key = `${name}:${frame}`;
    if (!this._urls.has(key)) this._urls.set(key, this.get(name).frames[frame].toDataURL());
    return this._urls.get(key);
  }
}

export async function loadAssets() {
  const data = buildSpriteData();
  const sprites = {};
  for (const [name, def] of Object.entries(data)) {
    const override = IMAGE_OVERRIDES[name];
    if (override) {
      const frames = await Promise.all(override.map(loadImage));
      sprites[name] = { w: frames[0].width, h: frames[0].height, frames };
    } else {
      sprites[name] = { w: def.w, h: def.h, frames: def.frames.map(gridToCanvas) };
    }
  }
  return new Assets(sprites);
}
