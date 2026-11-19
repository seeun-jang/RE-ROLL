// =============================================================
// 캐릭터 동작 — 기본 그림(shared/animals.js) 한 장을 기울이고 옮겨서 동작을 만든다
//
// 동작마다 새 그림을 그리지 않으므로, 캐릭터 그림을 바꾸면 모든 동작이 함께 바뀐다.
//
// poseFrame(animal, anim, frame) → 문자 행 배열
//   - 발 가운데가 그림의 가로 한가운데, 발바닥이 맨 아래 행에 오도록 여백을 넣는다.
//   - 기본은 정면 그림 그대로다. 왼쪽 팀 기준(오른쪽을 향해 당김)이며, 오른쪽 팀은 게임이 좌우를 뒤집어 쓴다.
// =============================================================

/** 기울일 때 잘리지 않도록 두는 좌우 여백 (px) */
const SIDE_MARGIN = 8;
/** 점프할 때 쓸 위쪽 여백 (px) */
const TOP_MARGIN = 5;
/** 머리와 몸이 만나는 높이 (그림 높이에 대한 비율). 숨쉬기·움츠리기 때 이 줄을 접는다 */
const NECK_RATIO = 0.62;

/**
 * 동작별 자세. 값이 없으면 0.
 *  lean  기울기: 맨 윗줄이 옆으로 밀리는 px (음수 = 뒤로 젖힘, 양수 = 앞으로 쏠림)
 *  dx    전체 좌우 이동      dy   전체 위아래 이동 (음수 = 점프)
 *  sink  목 부분을 접어 머리를 내리는 px (숨쉬기·힘주기·움츠리기)
 *  lie   1 이면 앞으로 엎어져 누움
 */
const POSES = Object.freeze({
  idle: [{}, { sink: 1 }, { sink: 1 }, {}],
  pull: [{ lean: -2 }, { lean: -3 }, { lean: -5, sink: 1 }, { lean: -3 }],
  slip: [{ lean: 2, dx: 1 }, { lean: 4, dx: 2 }, { lean: 3, dx: 1 }],
  win: [{ sink: 2 }, { dy: -3 }, { dy: -5 }, { dy: -1 }],
  fall: [{ lean: 5, dx: 1 }, { lean: 9, dx: 2, sink: 2 }, { lie: 1 }],
});

/** 동작 이름 목록과 프레임 수 */
export const CHIBI_ANIMS = Object.freeze(Object.keys(POSES));
export function chibiFrameCount(anim) {
  return (POSES[anim] || POSES.idle).length;
}

/** 발 가운데가 가로 한가운데 오도록 좌우 여백을 맞춘 2차원 글자 배열 */
export function centeredGrid(animal) {
  const rows = animal.sprite;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // anchorX 는 x.5 일 수도 있다 → 2배 좌표로 계산
  const a2 = Math.round(animal.anchorX * 2) + 1;      // 발 가운데의 왼쪽 가장자리 기준 (2배)
  const half = Math.ceil(Math.max(a2, 2 * w - a2) / 2);
  const left = half - Math.floor(a2 / 2);
  const width = half * 2;
  return rows.map((r) => {
    const line = new Array(width).fill('.');
    for (let x = 0; x < r.length; x++) line[left + x] = r[x];
    return line;
  });
}

/** 목 부분의 행을 n 개 접는다 (머리가 n px 내려온다) */
export function sink(grid, n) {
  let g = grid;
  for (let i = 0; i < n && g.length > 4; i++) {
    const cut = Math.round(g.length * NECK_RATIO);
    g = [g[0].map(() => '.'), ...g.slice(0, cut), ...g.slice(cut + 1)];
  }
  return g;
}

/** 아래(발)를 고정하고 위로 갈수록 옆으로 민다 */
export function shear(grid, lean) {
  const h = grid.length;
  const w = grid[0].length;
  return grid.map((row, y) => {
    const shift = Math.round((lean * (h - 1 - y)) / Math.max(1, h - 1));
    const out = new Array(w).fill('.');
    for (let x = 0; x < w; x++) {
      const nx = x + shift;
      if (row[x] !== '.' && nx >= 0 && nx < w) out[nx] = row[x];
    }
    return out;
  });
}

/** 시계 방향으로 90도 돌린다 (머리가 오른쪽으로 가게 눕힘) */
function rotate(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const out = [];
  for (let x = 0; x < w; x++) {
    const row = [];
    for (let y = h - 1; y >= 0; y--) row.push(grid[y][x]);
    out.push(row);
  }
  return out;
}

/** 비어 있는 바깥 행·열을 잘라낸다 */
function trim(grid) {
  const used = (cells) => cells.some((c) => c !== '.');
  let y0 = 0, y1 = grid.length - 1;
  while (y0 < y1 && !used(grid[y0])) y0++;
  while (y1 > y0 && !used(grid[y1])) y1--;
  const g = grid.slice(y0, y1 + 1);
  let x0 = 0, x1 = g[0].length - 1;
  while (x0 < x1 && !used(g.map((r) => r[x0]))) x0++;
  while (x1 > x0 && !used(g.map((r) => r[x1]))) x1--;
  return g.map((r) => r.slice(x0, x1 + 1));
}

function build(animal, pose) {
  const base = centeredGrid(animal);
  if (pose.lie) {
    // 엎어짐: 눕힌 그림을 바닥에 붙이고 가로 가운데에 둔다
    const lying = trim(rotate(base));
    const pad = lying[0].length % 2;
    return lying.map((r) => (pad ? [...r, '.'] : r).join(''));
  }
  const width = base[0].length + SIDE_MARGIN * 2;
  const height = base.length + TOP_MARGIN;
  const dx = pose.dx || 0;
  const dy = pose.dy || 0;
  let body = sink(base, pose.sink || 0);
  // 캔버스에 놓기: 발바닥이 맨 아래(+dy), 가로는 가운데(+dx)
  let grid = Array.from({ length: height }, () => new Array(width).fill('.'));
  body.forEach((row, y) => {
    const ty = y + TOP_MARGIN + dy;
    if (ty < 0 || ty >= height) return;
    row.forEach((ch, x) => {
      const tx = x + SIDE_MARGIN + dx;
      if (ch !== '.' && tx >= 0 && tx < width) grid[ty][tx] = ch;
    });
  });
  if (pose.lean) {
    // 기울기는 발 높이를 축으로 한다 (점프 중이면 그만큼 위)
    const feet = height - 1 + Math.min(0, dy);
    grid = [...shear(grid.slice(0, feet + 1), pose.lean), ...grid.slice(feet + 1)];
  }
  return grid.map((r) => r.join(''));
}

const cache = new Map();

/** 캐릭터의 동작 한 프레임 (결과는 캐시된다) */
export function poseFrame(animal, anim, frame = 0) {
  const name = POSES[anim] ? anim : 'idle';
  const list = POSES[name];
  const f = Math.max(0, Math.min(list.length - 1, frame | 0));
  const key = `${animal.id}:${name}:${f}`;
  let rows = cache.get(key);
  if (!rows) {
    rows = build(animal, list[f]);
    cache.set(key, rows);
  }
  return rows;
}
