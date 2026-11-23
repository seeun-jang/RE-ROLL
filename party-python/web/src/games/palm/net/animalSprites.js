// =============================================================
// 동물 캐릭터의 손바닥 밀치기 동작 세트
//
// 원본 SpriteFactory 의 createFighterSprites 와 같은 모양(SpriteSet)을 돌려주므로
// FighterRenderer 는 그대로 쓴다. 동작은 기본 그림(shared/animals.js) 한 장을
// 기울이고(shear) 움츠리고(sink) 옮기고 돌려서 만든다.
//
//   프레임 = { canvas, w, h, ax, ay }   ax, ay = 캔버스 안에서 발 가운데가 땅에 닿는 점
//   right = 오른쪽을 향해 싸우는 쪽(왼쪽 자리), left = 좌우 반전
// =============================================================
import { ANIMALS } from '../../../shared/animals.js';
import { centeredGrid, sink, shear } from '../../../shared/chibi.js';
import { spriteToCanvas, rotSpriteRows } from '../assets/SpriteFactory.js';

const MARGIN = 8;                              // 기울일 때 잘리지 않게 두는 좌우 여백
const FALL_ANGLES = [0, 20, 45, 70, 90];       // 넘어질 때 회전 각도
const FALL_BOX = { w: 88, h: 60, ax: 44, ay: 46 }; // 회전한 그림을 담는 칸
const WET_ROWS = 13;                           // 물에 빠졌을 때 수면 위로 보이는 머리 높이

/** 자세 목록. lean 기울기(+앞), sink 움츠림, dx 앞으로 나감, dy 위로 뜀(음수) */
const POSES = Object.freeze({
  idle: [{}, { sink: 1 }, { sink: 1 }],
  push: [{ lean: -2 }, { lean: 2, dx: 1 }, { lean: 4, dx: 3 }, { lean: 1, dx: 1 }],
  charge: [{ lean: -3, sink: 1 }, { lean: -4, sink: 2 }],
  feint: [{ lean: -2 }, { lean: -5, dx: -2 }, { lean: -1 }],
  hold: [{ sink: 2 }, { sink: 3 }],
  stagger: [{ lean: -4 }, { lean: 3 }, { lean: -2 }, { lean: 4 }],
  win: [{ dy: -2 }, { dy: -5 }],
});

function mirrorCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

const mirrorFrame = (f) => ({ canvas: mirrorCanvas(f.canvas), w: f.w, h: f.h, ax: f.w - f.ax, ay: f.ay });

/** 좌우 여백을 넣은 글자 배열 */
function padded(grid) {
  const pad = new Array(MARGIN).fill('.');
  return grid.map((r) => [...pad, ...r, ...pad]);
}

const cache = new Map();

/**
 * 동물 하나의 전체 동작 세트 (캐시)
 * @param {string} animalId 'shiba' | 'tiger' | 'duck' | 'bear' | 'cat'
 */
export function createAnimalSprites(animalId) {
  const animal = ANIMALS[animalId] || ANIMALS.shiba;
  if (cache.has(animal.id)) return cache.get(animal.id);
  const colors = animal.palette;
  const base = centeredGrid(animal);          // 발 가운데 = 가로 한가운데
  const h = base.length;
  const frame = (grid, ax, ay) => {
    const canvas = spriteToCanvas(grid.map((r) => r.join('')), colors);
    return { canvas, w: canvas.width, h: canvas.height, ax, ay };
  };

  const right = {};
  for (const [anim, list] of Object.entries(POSES)) {
    right[anim] = list.map((p) => {
      let g = padded(sink(base, p.sink || 0));
      if (p.lean) g = shear(g, p.lean);
      // 발 위치는 그대로 두고 그림만 옮긴다: 앞으로(dx) 나가면 기준점이 그만큼 뒤로
      return frame(g, g[0].length / 2 - (p.dx || 0), h - (p.dy || 0));
    });
  }

  // 물에 빠짐: 머리만 수면 위로. 두 프레임이 1px 좌우로 흔들린다
  const head = padded(base.slice(0, WET_ROWS));
  right.wet = [0, 1].map((i) => frame(head, head[0].length / 2 - i, WET_ROWS));

  // 넘어짐: 발을 축으로 회전 (앞으로 = 시계 방향)
  const rows = base.map((r) => r.join(''));
  const fall = (sign) => FALL_ANGLES.map((deg) => {
    const r = rotSpriteRows(rows, sign * deg, {
      pivotX: rows[0].length / 2, pivotY: h,
      outW: FALL_BOX.w, outH: FALL_BOX.h, outAx: FALL_BOX.ax, outAy: FALL_BOX.ay,
    });
    const canvas = spriteToCanvas(r.rows, colors);
    return { canvas, w: canvas.width, h: canvas.height, ax: r.ax, ay: r.ay };
  });
  right.fallFwd = fall(1);
  right.fallBack = fall(-1);

  const left = {};
  for (const anim of Object.keys(right)) left[anim] = right[anim].map(mirrorFrame);

  const set = { w: base[0].length, h, right, left };
  cache.set(animal.id, set);
  return set;
}
