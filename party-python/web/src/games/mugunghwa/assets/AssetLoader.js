// ============================================================
// AssetLoader.js — 에셋 로딩 계층
//
// 지금은 sprites.js 의 문자 배열을 캔버스로 "구워서" 쓴다.
// 나중에 실제 이미지로 바꾸려면 loadOverrides({ 'tree': 'img/tree.png', ... })
// 처럼 같은 이름으로 이미지를 등록하면 된다. 게임 코드는 get(name) 만 쓰므로
// 다른 코드는 바꿀 필요가 없다.
// ============================================================

import {
  buildPlayerFrames, playerRoleColors, PLAYER_GREY_ROLES,
  buildTaggerFrames, TAGGER_ROLES, TAGGER_GLARE_ROLES,
  buildTree, TREE_ROLES,
  EYE_OPEN, EYE_CLOSED, EYE_ROLES, CROWN, CROWN_ROLES,
  NINE_SLICE, BOX_STYLES,
} from './sprites.js';

import { ANIMALS } from '../../../shared/animals.js';
import { centeredGrid, sink, shear } from '../../../shared/chibi.js';

// ---- 참가자 캐릭터(동물) ----
// 도망자는 술래 쪽(화면 위쪽)을 보고 달리므로 '뒷모습'이 필요하다.
// 뒷모습은 기본 그림에서 머리 안쪽(얼굴)을 털 색으로 덮어 만든다(윤곽과 옷은 그대로).
const ANIMAL_SIDE = 4;   // 기울일 때 잘리지 않게 두는 좌우 여백
const ANIMAL_TOP = 4;    // 뛰어오를 때 쓸 위쪽 여백
const HEAD_RATIO = 0.62; // 그림 높이에서 머리가 차지하는 비율

function backView(grid) {
  const h = grid.length, w = grid[0].length;
  const headRows = Math.round(h * HEAD_RATIO);
  const count = {};
  for (let y = 0; y < headRows; y++) for (const ch of grid[y]) if (ch !== '.' && ch !== 'a') count[ch] = (count[ch] || 0) + 1;
  const fur = Object.keys(count).sort((p, q) => count[q] - count[p])[0];
  if (!fur) return grid;
  const filled = (x, y) => y >= 0 && y < h && x >= 0 && x < w && grid[y][x] !== '.';
  return grid.map((row, y) => row.map((ch, x) => {
    if (y >= headRows || ch === '.') return ch;
    const inside = filled(x - 1, y) && filled(x + 1, y) && filled(x, y - 1) && filled(x, y + 1);
    return inside ? fur : ch; // 윤곽선은 남기고 안쪽(눈·코·입·무늬)만 덮는다
  }));
}

function animalFrame(base, palette, { sinkBy = 0, lean = 0, dy = 0, grey = false } = {}) {
  const width = base[0].length + ANIMAL_SIDE * 2;
  const height = base.length + ANIMAL_TOP;
  const body = sink(base, sinkBy);
  let grid = Array.from({ length: height }, () => new Array(width).fill('.'));
  body.forEach((row, y) => {
    const ty = y + ANIMAL_TOP + dy;
    if (ty < 0 || ty >= height) return;
    row.forEach((ch, x) => {
      if (ch !== '.') grid[ty][x + ANIMAL_SIDE] = ch;
    });
  });
  if (lean) grid = shear(grid, lean);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = palette[grid[y][x]];
      if (!color) continue;
      if (grey) {
        const n = parseInt(color.slice(1), 16);
        const v = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11);
        const g = Math.round(60 + v * 0.55).toString(16).padStart(2, '0');
        color = `#${g}${g}${g}`;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

// 문자 배열 + 역할 색표 → 캔버스
export function gridToCanvas(rows, roles) {
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
      ctx.fillStyle = roles[ch] || '#ff00ff'; // 정의 안 된 역할은 눈에 띄게 자홍색
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

export class AssetLoader {
  constructor() {
    this.images = new Map();      // 이름 → 캔버스/이미지
    this.playerCache = new Map(); // 플레이어 색 → 프레임 묶음
    this.animalCache = new Map(); // 동물 id → 프레임 묶음
    this.playerFrames = buildPlayerFrames();
  }

  // 코드로 그린 기본 에셋 굽기
  build() {
    const tf = buildTaggerFrames();
    for (const [anim, frames] of Object.entries(tf)) {
      const roles = anim === 'glare' ? TAGGER_GLARE_ROLES : TAGGER_ROLES;
      frames.forEach((rows, i) => this.images.set(`tagger.${anim}.${i}`, gridToCanvas(rows, roles)));
    }
    this.images.set('tree', gridToCanvas(buildTree(), TREE_ROLES));
    this.images.set('icon.eyeOpen', gridToCanvas(EYE_OPEN, EYE_ROLES));
    this.images.set('icon.eyeClosed', gridToCanvas(EYE_CLOSED, EYE_ROLES));
    this.images.set('icon.crown', gridToCanvas(CROWN, CROWN_ROLES));
    for (const [name, roles] of Object.entries(BOX_STYLES)) {
      this.images.set(`box.${name}`, gridToCanvas(NINE_SLICE, roles));
    }
    return this;
  }

  get(name) {
    return this.images.get(name);
  }

  // 술래 프레임 묶음: { chant:[...], turn:[...], ... }
  getTaggerFrames() {
    const out = {};
    for (const key of this.images.keys()) {
      const m = key.match(/^tagger\.(\w+)\.(\d+)$/);
      if (!m) continue;
      (out[m[1]] ||= [])[Number(m[2])] = this.images.get(key);
    }
    return out;
  }

  /**
   * 동물 캐릭터 프레임 묶음.
   *  도망자용: idle / run / freeze (뒷모습), out (탈락 — 돌아보며 주저앉음), cheer (앞모습)
   *  술래용:   back (뒤돌아 외침), front (돌아봄)
   */
  getAnimalFrames(animalId) {
    const animal = ANIMALS[animalId] || ANIMALS.shiba;
    if (this.animalCache.has(animal.id)) return this.animalCache.get(animal.id);
    const front = centeredGrid(animal);
    const back = backView(front);
    const P = animal.palette;
    const f = (grid, opt) => animalFrame(grid, P, opt);
    const set = {
      idle: [f(back), f(back, { sinkBy: 1 })],
      run: [f(back, { dy: -1, lean: 1 }), f(back), f(back, { dy: -1, lean: -1 }), f(back)],
      freeze: [f(back, { sinkBy: 1 }), f(back, { sinkBy: 1, lean: 1 })],
      out: [f(front, { dy: -2 }), f(front, { grey: true }), f(front, { grey: true, sinkBy: 2 }), f(front, { grey: true, sinkBy: 4 })],
      cheer: [f(front), f(front, { dy: -2 })],
      back: [f(back), f(back, { sinkBy: 1 })],
      front: [f(front), f(front, { sinkBy: 1 })],
    };
    this.animalCache.set(animal.id, set);
    return set;
  }

  // 플레이어 색마다 프레임을 한 번만 구워서 캐시
  getPlayerFrames(color, shade) {
    const key = `${color}/${shade}`;
    if (this.playerCache.has(key)) return this.playerCache.get(key);
    const roles = playerRoleColors(color, shade);
    const set = {};
    for (const [anim, frames] of Object.entries(this.playerFrames)) {
      set[anim] = frames.map((rows, i) => {
        // 탈락 애니메이션은 2번째 프레임부터 회색으로
        const r = anim === 'out' && i > 0 ? PLAYER_GREY_ROLES : roles;
        return this.images.get(`player.${anim}.${i}`) || gridToCanvas(rows, r);
      });
    }
    this.playerCache.set(key, set);
    return set;
  }

  // 실제 이미지로 교체 (선택 사항). 실패해도 코드로 그린 에셋을 그대로 쓴다.
  async loadOverrides(manifest = {}) {
    const jobs = Object.entries(manifest).map(([name, url]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images.set(name, img); resolve(true); };
      img.onerror = () => { console.warn('[AssetLoader] 이미지 로드 실패, 기본 에셋 사용:', url); resolve(false); };
      img.src = url;
    }));
    await Promise.all(jobs);
    this.playerCache.clear();
    return this;
  }
}
