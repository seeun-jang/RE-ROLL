// ============================================================
// 에셋 로더 — 문자 그리드 스프라이트를 캔버스로 "굽는다".
// 게임 코드는 이 클래스의 frames()/frame() 만 사용하므로
// 나중에 PNG로 교체해도 다른 코드는 바뀌지 않는다.
// ============================================================
import { SPRITES } from '../data/sprites.js';
import { IMAGE_OVERRIDES } from './manifest.js';
import { C } from '../data/palette.js';
import { ANIMALS, ANIMAL_ORDER } from '../../../shared/animals.js';
import { centeredGrid, sink, shear, poseFrame } from '../../../shared/chibi.js';

// ---- 참가자 캐릭터(동물) 동작: 기본 그림 한 장을 움츠리고(sink) 기울여(lean) 만든다 ----
const ANIMAL_SIDE = 8;  // 기울일 때 잘리지 않게 두는 좌우 여백
const ANIMAL_TOP = 6;   // 뛰어오를 때 쓸 위쪽 여백
/** lean: 맨 윗줄이 앞으로(+) 밀리는 px, sink: 움츠림, dy: 위로 뜀(음수) */
const ANIMAL_POSES = {
  idle: [{}, { sink: 1 }],
  charge: [{ sink: 1, lean: -1 }, { sink: 2, lean: -2 }],
  cast: [{ lean: -2, sink: 1 }, { lean: 4 }, { lean: 3 }, { lean: 1 }],
  hit: [{ lean: -4 }, { lean: -3 }, { lean: -1 }],
  win: [{ sink: 1 }, { dy: -3 }, { dy: -5 }, { dy: -2 }],
};

function animalPose(base, pose) {
  const width = base[0].length + ANIMAL_SIDE * 2;
  const height = base.length + ANIMAL_TOP;
  const body = sink(base, pose.sink || 0);
  const dy = pose.dy || 0;
  let grid = Array.from({ length: height }, () => new Array(width).fill('.'));
  body.forEach((row, y) => {
    const ty = y + ANIMAL_TOP + dy;
    if (ty < 0 || ty >= height) return;
    row.forEach((ch, x) => {
      if (ch !== '.') grid[ty][x + ANIMAL_SIDE] = ch;
    });
  });
  if (pose.lean) {
    const feet = height - 1 + Math.min(0, dy);
    grid = [...shear(grid.slice(0, feet + 1), pose.lean), ...grid.slice(feet + 1)];
  }
  return grid;
}

function bakeAnimal(grid, palette) {
  const c = makeCanvas(grid[0].length, grid.length);
  const ctx = c.getContext('2d');
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const color = palette[grid[y][x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const RESERVED = { '.': null, '#': C.white }; // 투명 / 피격 플래시

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 그리드 + 범례 → 캔버스 (1글자 = 1픽셀) */
function bakeGrid(grid, legend, w, h, id) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = grid[y] || '';
    if (row.length !== w) console.warn(`[assets] ${id}: ${y}행 길이 ${row.length} ≠ ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x] || '.';
      const color = ch in RESERVED ? RESERVED[ch] : legend[ch];
      if (color === undefined) {
        console.warn(`[assets] ${id}: 범례에 없는 문자 '${ch}'`);
        continue;
      }
      if (color === null) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function flipCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

export class Assets {
  constructor() {
    this.store = new Map(); // key → canvas[]
    this.meta = new Map();  // spriteId → {w,h}
  }

  _key(id, anim, variant, flip) {
    return `${id}|${variant || ''}|${anim}|${flip ? 1 : 0}`;
  }

  /** 모든 스프라이트를 굽는다 (이미지 오버라이드가 있으면 그것을 우선) */
  async load() {
    for (const [id, def] of Object.entries(SPRITES)) {
      this.meta.set(id, { w: def.w, h: def.h });
      const variants = [null, ...Object.keys(def.variants || {})];
      for (const variant of variants) {
        const legend = variant ? { ...def.legend, ...def.variants[variant] } : def.legend;
        for (const [anim, grids] of Object.entries(def.anims)) {
          const frames = grids.map((g) => bakeGrid(g, legend, def.w, def.h, `${id}.${anim}`));
          this.store.set(this._key(id, anim, variant, false), frames);
          this.store.set(this._key(id, anim, variant, true), frames.map(flipCanvas));
        }
      }
    }
    this._loadAnimals();
    await this._applyOverrides();
    return this;
  }

  /** 동물 캐릭터를 'animal_<id>' 스프라이트로 등록한다 (오른쪽을 보는 쪽 기준. flip = 왼쪽을 보는 쪽) */
  _loadAnimals() {
    for (const id of ANIMAL_ORDER) {
      const animal = ANIMALS[id];
      const base = centeredGrid(animal);
      const sid = `animal_${id}`;
      this.meta.set(sid, { w: base[0].length + ANIMAL_SIDE * 2, h: base.length + ANIMAL_TOP });
      const put = (anim, frames) => {
        this.store.set(this._key(sid, anim, null, false), frames);
        this.store.set(this._key(sid, anim, null, true), frames.map(flipCanvas));
      };
      for (const [anim, poses] of Object.entries(ANIMAL_POSES)) {
        put(anim, poses.map((p) => bakeAnimal(animalPose(base, p), animal.palette)));
      }
      // 쓰러짐: 공용 동작(chibi)의 '넘어짐'을 그대로 쓴다 (마지막 프레임 = 엎어짐)
      put('lose', [0, 1, 2].map((f) => bakeAnimal(poseFrame(animal, 'fall', f).map((r) => [...r]), animal.palette)));
    }
  }

  async _applyOverrides() {
    for (const [id, ov] of Object.entries(IMAGE_OVERRIDES)) {
      try {
        const img = await loadImage(ov.src);
        this.meta.set(id, { w: ov.frameW, h: ov.frameH });
        for (const [anim, indices] of Object.entries(ov.anims)) {
          const frames = indices.map((i) => {
            const c = makeCanvas(ov.frameW, ov.frameH);
            c.getContext('2d').drawImage(img, i * ov.frameW, 0, ov.frameW, ov.frameH, 0, 0, ov.frameW, ov.frameH);
            return c;
          });
          this.store.set(this._key(id, anim, null, false), frames);
          this.store.set(this._key(id, anim, null, true), frames.map(flipCanvas));
        }
      } catch (err) {
        console.warn('[assets] 오버라이드 실패, 코드 아트 사용:', err.message);
      }
    }
  }

  /** 애니메이션 프레임 배열 */
  frames(id, anim = 'default', { variant = null, flip = false } = {}) {
    return (
      this.store.get(this._key(id, anim, variant, flip)) ||
      this.store.get(this._key(id, 'idle', variant, flip)) ||
      this.store.get(this._key(id, 'default', null, flip)) ||
      []
    );
  }

  /** 시간(초) 기준 현재 프레임 */
  frameAt(id, anim, time, { variant = null, flip = false, fps = 10, loop = true } = {}) {
    const f = this.frames(id, anim, { variant, flip });
    if (!f.length) return null;
    let i = Math.floor(time * fps);
    i = loop ? i % f.length : Math.min(i, f.length - 1);
    return f[i];
  }

  size(id) {
    return this.meta.get(id) || { w: 0, h: 0 };
  }
}
