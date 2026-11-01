// =====================================================
// 마법진 모양 (60x60 기준 좌표로 적고, 실제 종이(120x120)에는 2배로 그림)
//  - 첫 점이 출발점, 처음 두 점 방향이 펜의 처음 방향
//  - 라운드마다 난이도 묶음(tier)에서 하나를 뽑음 (seed 가 같으면 같은 모양)
// =====================================================
function arcPts(cx, cy, rx, ry, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

// color: 이름 글씨 색 (어두운 배경용) / gc: 양피지 위 안내선 색 / tier: easy·mid·hard
const SHAPES = [
  { name: '달빛 고리', short: '고리', color: 'h', gc: 'g', tier: 'easy', pts: arcPts(30, 30, 20, 20, -Math.PI / 2, Math.PI * 1.5, 48) },
  { name: '삼각 마법진', short: '삼각', color: 'e', gc: 'd', tier: 'easy', pts: [[30, 8], [52, 48], [8, 48], [30, 8]] },
  { name: '다이아 마법진', short: '다이아', color: 'q', gc: '3', tier: 'easy', pts: [[30, 6], [52, 30], [30, 54], [8, 30], [30, 6]] },
  // 별 (다섯 꼭짓점 한 붓 그리기)
  { name: '잭팟 별', short: '별', color: '9', gc: '8', tier: 'mid', pts: [[30, 6], [44, 52], [6, 22], [54, 22], [16, 52], [30, 6]] },
  { name: '번개 볼트', short: '번개', color: '8', gc: 'r', tier: 'mid', pts: [[38, 4], [16, 32], [29, 32], [22, 56], [46, 24], [33, 24], [44, 4], [38, 4]] },
  { name: '마법 왕관', short: '왕관', color: 't', gc: 'u', tier: 'mid', pts: [[8, 48], [8, 14], [19, 32], [30, 8], [41, 32], [52, 14], [52, 48], [8, 48]] },
  // 하트: 위 가운데 → 오른쪽 볼록 → 아래 끝 → 왼쪽 볼록 → 위 가운데
  {
    name: '사랑의 하트', short: '하트', color: 'p', gc: '4', tier: 'hard',
    pts: [...arcPts(41, 20, 11, 10, Math.PI, Math.PI * 2.2, 14), [30, 52], ...arcPts(19, 20, 11, 10, Math.PI * 0.8, Math.PI * 2, 14)],
  },
  // 소용돌이: 바깥에서 안으로 2바퀴 조금 넘게
  {
    name: '소용돌이', short: '소용돌이', color: 'h', gc: 'f', tier: 'hard',
    pts: Array.from({ length: 91 }, (_, i) => {
      const k = i / 90;
      const a = -Math.PI / 2 + k * Math.PI * 4.5;
      const r = 24 - k * 20;
      return [30 + Math.cos(a) * r, 30 + Math.sin(a) * r];
    }),
  },
  // 물고기: 코 → 등 → 꼬리 → 배 → 코
  {
    name: '황금 물고기', short: '물고기', color: '8', gc: 'l', tier: 'hard',
    pts: [...arcPts(26, 30, 18, 13, Math.PI, Math.PI * 2, 20), [54, 18], [54, 42], ...arcPts(26, 30, 18, 13, 0, Math.PI, 20)],
  },
];

// 같은 seed → 같은 순서 (개인 화면끼리 같은 문제로 비교하려고)
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 오늘 날짜로 seed (개인 화면 기본값: 같은 날 모두 같은 마법진·저주)
function dateSeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// 라운드 계획: [{ shape(SHAPES 번호), twist, mult }]
function planRounds(seed) {
  const rng = makeRng(seed);
  return CONFIG.ROUNDS.map((r) => {
    const pool = SHAPES.map((s, i) => i).filter((i) => SHAPES[i].tier === r.tier);
    return {
      shape: pool[Math.floor(rng() * pool.length)],
      twist: r.twists[Math.floor(rng() * r.twists.length)],
      mult: r.mult,
    };
  });
}

// 모양을 1px 간격의 점들로 (채점·CPU 길찾기용)
function samplePath(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 모양 정보 미리 계산: 점 목록, 거리 지도(각 칸이 모양 선에서 몇 칸 떨어졌나)
function prepareShape(shape) {
  if (shape.prepared) return shape.prepared;
  const S = CONFIG.CANVAS;
  const K = S / 60;
  const pts = shape.pts.map(([x, y]) => [x * K, y * K]);
  const path = samplePath(pts);
  const dist = new Uint8Array(S * S).fill(255);
  const queue = [];
  for (const [x, y] of path) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= S || iy >= S) continue;
    if (dist[iy * S + ix] !== 0) {
      dist[iy * S + ix] = 0;
      queue.push(iy * S + ix);
    }
  }
  // 넓이 우선으로 거리 퍼뜨리기 (8방향)
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % S;
    const y = (i / S) | 0;
    const d = dist[i];
    if (d >= 20) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const j = ny * S + nx;
        if (dist[j] > d + 1) {
          dist[j] = d + 1;
          queue.push(j);
        }
      }
    }
  }
  shape.prepared = { path, dist, start: { x: pts[0][0], y: pts[0][1] } };
  return shape.prepared;
}

// 흐릿한 안내선 그림 (점선, 모양 색)
const GUIDE_CACHE = new Map();
function guideImage(shape) {
  if (GUIDE_CACHE.has(shape)) return GUIDE_CACHE.get(shape);
  const S = CONFIG.CANVAS;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const path = prepareShape(shape).path;
  g.fillStyle = PALETTE[shape.gc];
  path.forEach(([x, y], i) => {
    if (i % 4 < 3) g.fillRect(Math.round(x), Math.round(y), 1, 1);
  });
  // 출발점 표시
  const s0 = prepareShape(shape).start;
  g.fillStyle = PALETTE['6'];
  g.fillRect(Math.round(s0.x) - 2, Math.round(s0.y) - 2, 5, 5);
  g.fillStyle = PALETTE.w;
  g.fillRect(Math.round(s0.x) - 1, Math.round(s0.y) - 1, 3, 3);
  GUIDE_CACHE.set(shape, c);
  return c;
}

// 미리보기 (60x60, 끊김 없는 실선 + 외곽선) — 슬롯머신 · 타이틀에서 모양이 한눈에 보이게
const PREVIEW_CACHE = new Map();
function previewImage(shape) {
  if (PREVIEW_CACHE.has(shape)) return PREVIEW_CACHE.get(shape);
  const c = document.createElement('canvas');
  c.width = 60;
  c.height = 60;
  const g = c.getContext('2d');
  const path = prepareShape(shape).path;
  const k = 60 / CONFIG.CANVAS;
  g.fillStyle = PALETTE['1'];
  for (const [x, y] of path) g.fillRect(Math.round(x * k) - 1, Math.round(y * k) - 1, 3, 3);
  g.fillStyle = PALETTE[shape.color];
  for (const [x, y] of path) g.fillRect(Math.round(x * k), Math.round(y * k), 1, 1);
  PREVIEW_CACHE.set(shape, c);
  return c;
}
