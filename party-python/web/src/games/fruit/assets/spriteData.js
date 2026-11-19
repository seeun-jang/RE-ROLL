// ============================================================
//  스프라이트 정의 — 전부 코드로 그린 도트 (2차원 배열 + 팔레트 인덱스)
//  각 항목: { w, h, frames: [grid, ...] }
//  ※ 실제 이미지로 교체하려면 AssetLoader.js 의 IMAGE_OVERRIDES 사용
// ============================================================
import {
  T, makeGrid, parseRows, overlay, blobShape, addOutline, polygonMask,
  shineFrame, swapColors, outerGlow, cloneGrid,
} from './pixelBuild.js';

const sprite = (frames) => ({ w: frames[0][0].length, h: frames[0].length, frames });

// 과일 대기 애니메이션: 기본 + 반짝 (2프레임)
const idle2 = (grid, light, hi) => sprite([grid, shineFrame(grid, light, hi)]);

// ---------- 사과 ----------
function apple() {
  const g = blobShape(16, 16, [
    { cx: 6, cy: 9.8, rx: 5.6, ry: 5.7 },
    { cx: 10, cy: 9.8, rx: 5.6, ry: 5.7 },
  ], { ramp: [1, 2, 3, 12], outline: 0 });
  overlay(g, [
    '..777.',
    '.f6657',
    '.f777.',
    '.f....',
    '.f....',
  ], 7, 0);
  return idle2(g, 3, 12);
}

// ---------- 오렌지 ----------
function orange() {
  const g = blobShape(16, 16, [{ cx: 8, cy: 9.2, rx: 6.8, ry: 6.6 }], {
    ramp: [2, 3, 4, 12],
    outline: 0,
    // 껍질의 오톨도톨한 질감 — 밝은 면에 기본색 점을 찍음
    tint: (x, y, lv) => (lv === 2 && (x + y * 2) % 4 === 0 ? 3 : undefined),
  });
  overlay(g, [
    'f.77',
    'f665',
    '.77.',
  ], 7, 0);
  return idle2(g, 4, 12);
}

// ---------- 레몬 ----------
function lemon() {
  const g = blobShape(18, 14, [
    { cx: 9, cy: 7.5, rx: 7, ry: 5.4 },
    { cx: 1.9, cy: 7.5, rx: 1.7, ry: 1.3 },
    { cx: 16.1, cy: 7.5, rx: 1.7, ry: 1.3 },
  ], {
    ramp: [3, 4, 4, 12],
    outline: 0,
    // 밝은 면은 디더링(체크무늬)으로 부드럽게 — 그라데이션 금지 규칙
    tint: (x, y, lv) => (lv === 2 && (x + y) % 2 === 0 ? 12 : undefined),
  });
  return idle2(g, 4, 12);
}

// ---------- 블루베리 송이 ----------
function berry() {
  const g = blobShape(16, 16, [
    { cx: 4.5, cy: 7, rx: 3, ry: 3 },
    { cx: 8, cy: 5.5, rx: 3, ry: 3 },
    { cx: 11.5, cy: 7, rx: 3, ry: 3 },
    { cx: 6.2, cy: 10.2, rx: 3, ry: 3 },
    { cx: 9.8, cy: 10.2, rx: 3, ry: 3 },
    { cx: 8, cy: 12.8, rx: 2.8, ry: 2.8 },
  ], { ramp: [8, 9, 10, 11], outline: 0 });
  overlay(g, [
    '6.6',
    '.6.',
    '...',
    '.8.',
  ], 7, 0);
  return idle2(g, 10, 11);
}

// ---------- 수박 (큰 과일) ----------
function melon() {
  const stripe = { 0: 7, 1: 7, 2: 6, 3: 12 };
  const g = blobShape(22, 16, [{ cx: 11, cy: 8.5, rx: 10.4, ry: 7.2 }], {
    ramp: [7, 6, 5, 12],
    outline: 0,
    // 둥글게 휘는 줄무늬
    tint: (x, y, lv, nx, ny) => {
      const s = nx / Math.sqrt(Math.max(0.08, 1 - ny * ny));
      return Math.floor((s + 1) * 3.5) % 2 === 1 ? stripe[lv] : undefined;
    },
  });
  return idle2(g, 5, 12);
}

// ---------- 폭탄 ----------
function bomb() {
  const g = blobShape(16, 16, [{ cx: 7.5, cy: 9.6, rx: 6.4, ry: 6.4 }], { ramp: [0, 15, 14, 13], outline: 0 });
  overlay(g, [
    '...3',
    '..3.',
    '.3..',
    '0d0.',
    '0e0.',
  ], 9, 0);
  // 흰색 X 표시로 "위험"을 바로 알아보게
  overlay(g, [
    'c...c',
    '.c.c.',
    '..c..',
    '.c.c.',
    'c...c',
  ], 5, 8);
  // 프레임 2: 외곽선이 빨갛게 깜빡임
  const blink = cloneGrid(g);
  const outline = addOutline(cloneGrid(g).map((r) => r.map((c) => (c === T ? T : 99))), 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (outline[y][x] === 2 && y > 3) blink[y][x] = 2;
  return sprite([g, blink]);
}

// ---------- 폭탄 심지 불꽃 (3프레임) ----------
function spark() {
  return sprite([
    parseRows(['..4..', '.434.', '43c34', '.434.', '..4..']),
    parseRows(['.....', '..4..', '.4c4.', '..4..', '.....']),
    parseRows(['4...4', '.3.3.', '..c..', '.3.3.', '4...4']),
  ]);
}

// 아이템 공통: 1px 발광 테두리 + 모서리를 도는 반짝이 (4프레임)
function itemFrames(base, glowA, glowB) {
  const corners = [[2, 2], [15, 2], [15, 15], [2, 15]];
  return sprite(corners.map(([cx, cy], i) => {
    const f = outerGlow(base, i % 2 === 0 ? glowA : glowB);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (f[cy + dy][cx + dx] === T) f[cy + dy][cx + dx] = 12;
    }
    return f;
  }));
}

// ---------- 점수 더블: 황금 별과일 ----------
function star() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 7.6 : 3.7;
    pts.push([9 + Math.cos(a) * r, 9.6 + Math.sin(a) * r]);
  }
  const mask = polygonMask(18, 18, pts);
  const g = makeGrid(18, 18);
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 18; x++) {
      if (!mask[y][x]) continue;
      const nx = (x + 0.5 - 9) / 7.6;
      const ny = (y + 0.5 - 9.6) / 7.6;
      const l = -0.62 * nx - 0.72 * ny;
      g[y][x] = l > 0.45 ? 12 : l > 0.05 ? 4 : l < -0.45 ? 3 : 4;
      if (l > 0.05 && l <= 0.45 && (x + y) % 2 === 0) g[y][x] = 12; // 디더 하이라이트
    }
  }
  addOutline(g, 1);
  return itemFrames(g, 4, 12);
}

// ---------- 과일 세배: 무지개 프리즘 베리 ----------
function prism() {
  const bands = [2, 3, 4, 6, 10, 9];
  const darker = { 2: 1, 3: 2, 4: 3, 6: 7, 10: 9, 9: 8 };
  const g = blobShape(18, 18, [{ cx: 9, cy: 10, rx: 7.2, ry: 7 }], {
    ramp: [0, 0, 0, 12],
    outline: 0,
    tint: (x, y, lv, nx, ny) => {
      const b = bands[Math.max(0, Math.min(5, Math.floor((nx * 0.7 + ny * 0.7 + 1) * 3)))];
      if (lv === 3) return 12;
      if (lv === 0) return darker[b];
      return b;
    },
  });
  overlay(g, [
    '.6.6.',
    '.565.',
    '..6..',
  ], 7, 1);
  return itemFrames(g, 11, 12);
}

// ---------- UI: 하트 (체력) ----------
const HEART = [
  '.000.000.',
  '0cc202220',
  '0c2222220',
  '022222220',
  '.0222220.',
  '..02220..',
  '...020...',
  '....0....',
];
function heart() {
  return sprite([parseRows(HEART)]);
}
function heartEmpty() {
  return sprite([swapColors(parseRows(HEART), { 2: 15, 12: 14 })]);
}

// ---------- 칼끝 커서 ----------
function bladeTip() {
  return sprite([parseRows(['..b..', '.bcb.', 'bcccb', '.bcb.', '..b..'])]);
}

// ---------- 모션 인식 손 커서 (활성/비활성) ----------
function handRing(color) {
  const g = makeGrid(11, 11);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - 5, y - 5);
      if (Math.abs(d - 4.2) < 0.7) g[y][x] = color;
    }
  }
  g[5][5] = 12;
  return addOutlineOuter(g, 0);
}
// 바깥쪽에만 어두운 테두리를 두르는 링 (배경 위에서도 잘 보이게)
function addOutlineOuter(g, color) {
  return outerGlow(g, color);
}
function handActive() { return sprite([handRing(4)]); }
function handIdle() { return sprite([handRing(13)]); }

// ---------- 배경 타일: 잔디 16×16 ----------
const GRASS = [
  '....5.......5...',
  '...565.....565..',
  '.5.656.5..56565.',
  '565666565.666656',
  '6666666666666666',
  '6666766666667666',
  '6676667666766676',
  '6767676767676767',
  '7676767676767676',
  '7777777777777777',
  '7777787777777877',
  '7787777777877777',
  '7777777777777777',
  '8787878787878787',
  '7878787878787878',
  '8888888888888888',
];
function grass() {
  return sprite([parseRows(GRASS)]);
}
function grassFlower() {
  const g = parseRows(GRASS);
  overlay(g, ['.c.', 'c4c', '.c.'], 2, 2);
  overlay(g, ['.4.', '424', '.4.'], 10, 3);
  return sprite([g]);
}

// ---------- 배경: 나무 ----------
function tree() {
  const g = blobShape(16, 16, [
    { cx: 8, cy: 6.5, rx: 6.6, ry: 5.6 },
    { cx: 4.5, cy: 9, rx: 3.6, ry: 3 },
    { cx: 11.5, cy: 9, rx: 3.6, ry: 3 },
  ], { ramp: [7, 6, 5, 5], outline: 8 });
  overlay(g, ['11', '11', '11', '11'], 7, 12);
  return sprite([g]);
}

// ---------- UI: 9-slice 패널 / 버튼 (8×8, 테두리 3px) ----------
const BOX = [
  '.000000.',
  '0dddddd0',
  '0dffffe0',
  '0dffffe0',
  '0dffffe0',
  '0dffffe0',
  '0eeeeee0',
  '.000000.',
];
const BUTTON = [
  '.000000.',
  '04444440',
  '04333320',
  '04333320',
  '04333320',
  '02222220',
  '02222220',
  '.000000.',
];
const BUTTON_DOWN = [
  '.000000.',
  '01111110',
  '02333330',
  '02333330',
  '02333330',
  '02333330',
  '03333330',
  '.000000.',
];
const BLUE = { 4: 11, 3: 10, 2: 9, 1: 8 };

export function buildSpriteData() {
  return {
    apple: apple(),
    orange: orange(),
    lemon: lemon(),
    berry: berry(),
    melon: melon(),
    bomb: bomb(),
    spark: spark(),
    star: star(),
    prism: prism(),
    heart: heart(),
    heartEmpty: heartEmpty(),
    bladeTip: bladeTip(),
    handActive: handActive(),
    handIdle: handIdle(),
    grass: grass(),
    grassFlower: grassFlower(),
    tree: tree(),
    uiBox: sprite([parseRows(BOX)]),
    uiButton: sprite([parseRows(BUTTON)]),
    uiButtonDown: sprite([parseRows(BUTTON_DOWN)]),
    uiButtonBlue: sprite([swapColors(parseRows(BUTTON), BLUE)]),
    uiButtonBlueDown: sprite([swapColors(parseRows(BUTTON_DOWN), BLUE)]),
  };
}
