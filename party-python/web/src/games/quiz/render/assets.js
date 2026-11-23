// =============================================================
// 에셋 — 코드로 그린 픽셀 아트를 캔버스로 굽는다.
// 참가자 캐릭터는 공용 동물 그림(shared/animals.js)을 쓴다.
// =============================================================
import { ANIMALS, ANIMAL_ORDER } from '../../../shared/animals.js';
import { centeredGrid, sink } from '../../../shared/chibi.js';
import { PALETTE } from './palette.js';
import { CROWD_HEAD, HOST_FRAMES, ICONS, NINE_SLICE } from './sprites.js';

/** 스프라이트 문자열 → 캔버스 (swap: 팔레트 번호 바꾸기) */
export function bake(rows, { swap = null } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === undefined) continue;
      let idx = parseInt(ch, 16);
      if (swap && swap[idx] !== undefined) idx = swap[idx];
      ctx.fillStyle = PALETTE[idx];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

/** 동물 그림(글자 격자 + 그 동물의 색표) → 캔버스 */
function bakeAnimal(grid, palette) {
  const cv = document.createElement('canvas');
  cv.width = grid[0].length;
  cv.height = grid.length;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const color = palette[grid[y][x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

class AssetStore {
  constructor() {
    this.images = new Map();
    this.urls = new Map(); // DOM(<img>, CSS)용 data URL
    this.loaded = false;
  }

  get(name) {
    const img = this.images.get(name);
    if (!img) throw new Error(`없는 에셋: ${name}`);
    return img;
  }

  url(name) {
    if (!this.urls.has(name)) this.urls.set(name, this.get(name).toDataURL());
    return this.urls.get(name);
  }

  load() {
    if (this.loaded) return;
    // 참가자: 동물마다 자세 4장 (기본 / 숨쉬기 / 움츠림 2단계)
    for (const id of ANIMAL_ORDER) {
      const animal = ANIMALS[id];
      const base = centeredGrid(animal);
      [0, 1, 2, 3].forEach((n) => this.images.set(`animal.${id}.${n}`, bakeAnimal(sink(base, n), animal.palette)));
    }
    for (const [k, rows] of Object.entries(HOST_FRAMES)) this.images.set(`host.${k}`, bake(rows));
    for (const [k, rows] of Object.entries(ICONS)) this.images.set(`icon.${k}`, bake(rows));
    for (const [k, rows] of Object.entries(NINE_SLICE)) this.images.set(`nine.${k}`, bake(rows));
    this.images.set('crowd.0', bake(CROWD_HEAD));
    this.images.set('crowd.1', bake(CROWD_HEAD, { swap: { 15: 14 } }));
    this.images.set('crowd.2', bake(CROWD_HEAD, { swap: { 15: 8 } }));
    this.loaded = true;
  }
}

export const assets = new AssetStore();
