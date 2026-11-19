// ============================================================
// sprites.js — 코드로 정의한 픽셀 아트 (2차원 문자 배열 + 역할 문자)
//
// 각 문자는 "역할"을 뜻하고, AssetLoader 가 역할 → 팔레트 색으로 바꿔 칠한다.
// 같은 그림을 플레이어 색만 바꿔 재사용하기 위해 역할 문자 방식을 쓴다.
//   '.' = 투명
// 나중에 실제 PNG 로 바꾸려면 AssetLoader.loadOverrides() 를 쓰면 된다.
// ============================================================

import { C } from './palette.js';

// ------------------------------------------------------------
// 공통: 부품을 겹쳐 한 장의 프레임으로 합치기
// parts: [{ rows, x=0, y=0, mirror=false, replace={} }]
// ------------------------------------------------------------
export function compose(w, h, parts) {
  const grid = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const part of parts) {
    const { rows, x = 0, y = 0, mirror = false, replace = {} } = part;
    rows.forEach((row, ry) => {
      const line = mirror ? mirrorRow(row) : row;
      for (let rx = 0; rx < line.length; rx++) {
        let ch = line[rx];
        if (ch === '.') continue;
        if (replace[ch]) ch = replace[ch];
        const gx = x + rx, gy = y + ry;
        if (gx >= 0 && gx < w && gy >= 0 && gy < h) grid[gy][gx] = ch;
      }
    });
  }
  return grid.map(r => r.join(''));
}

function mirrorRow(row) {
  return row.split('').reverse().join('');
}

// ============================================================
// 플레이어 (16×16, 뒷모습 기준 — 아이들은 술래 쪽(화면 위)으로 달린다)
// 역할: o 외곽선, H 머리카락, h 머리 하이라이트, S 피부, s 피부 그림자,
//       B 옷(플레이어 색), b 옷 그림자, P 바지, W 신발
// ============================================================
const P_HEAD_BACK = [
  '................',
  '.....oooooo.....',
  '....oHHHHHHo....',
  '...oHHhHHHHHo...',
  '...oHhHHHHHHo...',
  '...oHHHHHHHHo...',
  '..osHHHHHHHHso..',
  '...oHHHHHHHHo...',
  '....ooSSSSoo....',
];

const P_HEAD_FRONT = [
  '................',
  '.....oooooo.....',
  '....oHHHHHHo....',
  '...oHHhHHHHHo...',
  '...oHHHHHHHHo...',
  '...oHSHHHHSHo...',
  '..osSoSSSSoSso..',
  '...osSSooSSso...',
  '....ooSSSSoo....',
];

const P_TORSO_DOWN = [
  '..oBBBBBBBBBBo..',
  '..oBoBBBBBBoBo..',
  '..oSobBBBBboSo..',
  '...oobbbbbboo...',
];

const P_TORSO_RUN = [
  '..oBBBBBBBBBBo..',
  '..oSoBBBBBBoBo..',
  '...oobBBBBboSo..',
  '...oobbbbbboo...',
];

// "얼음!" 자세 — 팔을 양옆으로 뻗음
const P_TORSO_ARMS_OUT = [
  '.oSBBBBBBBBBBSo.',
  '..ooBBBBBBBBoo..',
  '...obBBBBBBbo...',
  '...oobbbbbboo...',
];

const P_LEGS_STAND = [
  '....oPPooPPo....',
  '....oPPooPPo....',
  '....oWWooWWo....',
];

const P_LEGS_RUN = [
  '....oPPooPPo....',
  '....oWWooPPo....',
  '.....oo.oWWo....',
];

const P_LEGS_SIT = [
  '..oPPPPPPPPPPo..',
  '..oWWooooooWWo..',
];

// 플레이어 애니메이션 프레임 정의 (역할 문자 배열)
export function buildPlayerFrames() {
  const f = (parts) => compose(16, 16, parts);
  const head = (y, front = false) => ({ rows: front ? P_HEAD_FRONT : P_HEAD_BACK, y });
  return {
    // 대기 2프레임 (숨쉬기)
    idle: [
      f([head(0), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(1), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
    ],
    // 달리기 4프레임
    run: [
      f([head(0), { rows: P_TORSO_RUN, y: 9 }, { rows: P_LEGS_RUN, y: 13 }]),
      f([head(1), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(0), { rows: P_TORSO_RUN, y: 9, mirror: true }, { rows: P_LEGS_RUN, y: 13, mirror: true }]),
      f([head(1), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
    ],
    // 정지(얼음) 2프레임 — 한 발 들고 버티기 / 내리기
    freeze: [
      f([head(0), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_RUN, y: 13 }]),
      f([head(0), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
    ],
    // 탈락 4프레임 — 깜짝 → (회색) → 주저앉기
    out: [
      f([head(0), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(0), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(1), { rows: P_TORSO_DOWN, y: 10 }, { rows: P_LEGS_SIT, y: 14 }]),
      f([head(3), { rows: P_TORSO_DOWN, y: 11 }, { rows: P_LEGS_SIT, y: 14 }]),
    ],
    // 도착 환호 2프레임 (앞모습)
    cheer: [
      f([head(0, true), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(0, true), { rows: P_TORSO_ARMS_OUT, y: 9 }, { rows: P_LEGS_RUN, y: 13 }]),
    ],
    // 앞모습 대기 (준비/결과 화면)
    front: [
      f([head(0, true), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
      f([head(1, true), { rows: P_TORSO_DOWN, y: 9 }, { rows: P_LEGS_STAND, y: 13 }]),
    ],
  };
}

// 플레이어 역할 → 색 (B/b 는 플레이어마다 주입)
export function playerRoleColors(color, shade) {
  return {
    o: C.ink, H: C.dark, h: C.slate, S: C.yellow, s: C.orange,
    B: color, b: shade, P: C.navy, W: C.white,
  };
}

// 탈락 시 회색 버전
export const PLAYER_GREY_ROLES = {
  o: C.ink, H: C.dark, h: C.slate, S: C.silver, s: C.slate,
  B: C.slate, b: C.dark, P: C.dark, W: C.silver,
};

// ============================================================
// 술래 (16×32) — 초록 모자를 쓴 동네 아이 (오리지널 디자인)
// 역할: C 모자, G 모자 하이라이트, c 모자 띠, H 머리, S 피부, s 피부 그림자,
//       E 눈, r 볼터치, T 셔츠, t 셔츠 그림자, F 가슴의 꽃 무늬,
//       K 반바지, k 반바지 그림자, W 양말, N 신발
// ============================================================
const CAP_TOP = [
  '.....oooooo.....',
  '....oCCCCCCo....',
  '...oCGCCCCCCo...',
  '..oCCCCCCCCCCo..',
];

const T_HEAD_BACK = [
  ...CAP_TOP,
  '..occccccccccco.',
  '..oHHHHHHHHHHo..',
  '..oHHhHHHHHHHo..',
  '.osHHHHHHHHHHso.',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '...oHHHHHHHHo...',
  '....ooSSSSoo....',
];

const T_HEAD_FRONT = [
  ...CAP_TOP,
  '.oCCCCCCCCCCCCo.',
  '..oHHHHHHHHHHo..',
  '..oSHSSSSSSHSo..',
  '.osSESSSSSSESso.',
  '..oSSSSSSSSSSo..',
  '..orSSSSSSSSro..',
  '...oSSSooSSSo...',
  '....ooSSSSoo....',
];

const T_HEAD_SIDE = [
  ...CAP_TOP,
  '..occccccccccCCo',
  '..oHHHHHHSSSSo..',
  '..oHHHHHSSSSSo..',
  '.osHHHHHSSSESo..',
  '..oHHHHHSSSSSo..',
  '..oHHHHHSSSSro..',
  '...oHHHHSSSoo...',
  '....ooSSSSoo....',
];

// 나무에 얼굴을 대고 외치는 자세 (팔을 들어 눈을 가림)
const T_TORSO_CHANT = [
  '.oSSoTTTTTToSSo.',
  '.oTToTTTTTToTTo.',
  '..ooTTTTTTTToo..',
  '...oTTTTTTTTo...',
  '...oTTTTTTTTo...',
  '...otTTTTTTto...',
  '...ottttttttto..',
  '...oKKKKKKKKo...',
  '...oKKKkkKKKo...',
  '...oKKKooKKKo...',
];

const T_TORSO_DOWN = [
  '...oTTTTTTTTo...',
  '..oTTTTTTTTTTo..',
  '.oToTTTTTTTToTo.',
  '.oToTTTFTTTToTo.',
  '.oToTTFFFTTToTo.',
  '.oSotTTFTTTtoSo.',
  '..oottttttttoo..',
  '...oKKKKKKKKo...',
  '...oKKKkkKKKo...',
  '...oKKKooKKKo...',
];

const T_LEGS = [
  '....oSSooSSo....',
  '....oSSooSSo....',
  '....osSoosSo....',
  '....oWWooWWo....',
  '....oWWooWWo....',
  '...oNNNooNNNo...',
  '...oNNNooNNNo...',
  '...oooo..oooo...',
];

export function buildTaggerFrames() {
  const f = (parts) => compose(16, 32, parts);
  const backTorso = { rows: T_TORSO_DOWN, y: 14, replace: { F: 'T' } }; // 등에는 꽃무늬 없음
  const frontTorso = { rows: T_TORSO_DOWN, y: 14 };
  const chantTorso = { rows: T_TORSO_CHANT, y: 14 };
  const legs = { rows: T_LEGS, y: 24 };
  const back = f([{ rows: T_HEAD_BACK, y: 2 }, backTorso, legs]);
  const side = f([{ rows: T_HEAD_SIDE, y: 2 }, backTorso, legs]);
  const front = f([{ rows: T_HEAD_FRONT, y: 2 }, frontTorso, legs]);
  return {
    // 뒤돌아 외치기 2프레임
    chant: [
      f([{ rows: T_HEAD_BACK, y: 2 }, chantTorso, legs]),
      f([{ rows: T_HEAD_BACK, y: 3 }, chantTorso, legs]),
    ],
    // 돌아보기 3프레임 (뒤 → 옆 → 앞)
    turn: [back, side, front],
    // 노려보기 (눈이 번쩍)
    glare: [f([{ rows: T_HEAD_FRONT, y: 2 }, frontTorso, legs])],
    // 페이크 2프레임 — 고개만 움찔 → 어깨 너머로 힐끔
    fake: [
      f([{ rows: T_HEAD_BACK, x: 1, y: 2 }, chantTorso, legs]),
      f([{ rows: T_HEAD_SIDE, y: 2 }, chantTorso, legs]),
    ],
    // 앞모습 대기 2프레임
    idle: [front, f([{ rows: T_HEAD_FRONT, y: 3 }, frontTorso, legs])],
  };
}

export const TAGGER_ROLES = {
  o: C.ink, C: C.green, G: C.lime, c: C.teal, H: C.dark, h: C.slate,
  S: C.yellow, s: C.orange, E: C.ink, r: C.orange,
  T: C.white, t: C.silver, F: C.red, K: C.blue, k: C.navy, W: C.white, N: C.red,
};
export const TAGGER_GLARE_ROLES = { ...TAGGER_ROLES, E: C.white };

// ============================================================
// 무궁화 나무 (32×64) — 시드 고정 절차적 생성 → 매번 같은 그림
// 역할: o 외곽선, L/M/D 잎(밝음/중간/어두움), R 꽃잎, P 꽃술,
//       K 줄기, k 줄기 그림자, Q 줄기 하이라이트
// ============================================================
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function bayer(x, y) {
  return BAYER4[y & 3][x & 3] / 16;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTree() {
  const W = 32, H = 64;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const rnd = mulberry32(1004);

  // 1) 줄기 (아래로 갈수록 뿌리가 퍼짐)
  for (let y = 30; y < H - 1; y++) {
    let hw = 3;
    if (y >= 57) hw += Math.floor((y - 56) / 2);
    for (let x = 16 - hw; x < 16 + hw; x++) {
      let ch = 'K';
      if (x >= 16 + hw - 2) ch = 'k';             // 오른쪽 그림자
      else if (x === 16 - hw + 1 && y % 5 !== 0) ch = 'Q'; // 왼쪽 하이라이트
      if (ch === 'K' && rnd() < 0.12) ch = 'k';   // 나무껍질 무늬
      g[y][x] = ch;
    }
  }
  // 곁가지
  for (let i = 0; i < 6; i++) {
    g[33 - i][13 - i] = 'K';
    g[32 - i][19 + i] = 'k';
  }

  // 2) 수관(잎) — 원 여러 개를 겹치고, 왼쪽 위 빛 기준으로 디더링 명암
  const blobs = [[16, 15, 12], [9, 22, 7], [23, 22, 7], [16, 26, 9], [9, 12, 6], [23, 12, 6], [16, 8, 6]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = null;
      for (const [cx, cy, r] of blobs) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r && (!best || d / r < best.k)) best = { dx, dy, r, k: d / r };
      }
      if (!best) continue;
      let v = (-best.dx * 0.7 - best.dy * 0.8) / best.r; // -1(어두움) ~ 1(밝음)
      if (y > 26) v -= 0.35;                              // 아래쪽은 그늘
      v += (bayer(x, y) - 0.5) * 0.45;                    // 디더링
      g[y][x] = v > 0.35 ? 'L' : v > -0.3 ? 'M' : 'D';
    }
  }

  // 3) 무궁화 꽃 (십자 모양)
  let placed = 0;
  for (let tries = 0; tries < 200 && placed < 11; tries++) {
    const x = 3 + Math.floor(rnd() * 26);
    const y = 3 + Math.floor(rnd() * 28);
    const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    if (!around.every(([ax, ay]) => 'LMD'.includes(g[y + ay][x + ax]))) continue;
    around.forEach(([ax, ay], i) => { g[y + ay][x + ax] = i === 0 ? 'P' : 'R'; });
    placed++;
  }

  // 4) 외곽선 — 채워진 칸과 맞닿은 빈칸을 외곽선으로
  const filled = (x, y) => x >= 0 && x < W && y >= 0 && y < H && g[y][x] !== '.' && g[y][x] !== 'o';
  const out = g.map(r => r.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out[y][x] = 'o';
    }
  }
  return out.map(r => r.join(''));
}

export const TREE_ROLES = {
  o: C.ink, L: C.lime, M: C.green, D: C.teal, R: C.red, P: C.plum,
  K: C.plum, k: C.dark, Q: C.red,
};

// ============================================================
// 아이콘 / UI
// ============================================================
// 술래 눈 아이콘 (11×7)
export const EYE_OPEN = [
  '...ooooo...',
  '.ooWWWWWoo.',
  'oWWWoooWWWo',
  'oWWWoroWWWo',
  'oWWWoooWWWo',
  '.ooWWWWWoo.',
  '...ooooo...',
];
export const EYE_CLOSED = [
  '...........',
  '...........',
  '.W.......W.',
  '..WWWWWWW..',
  '.W..W.W..W.',
  '...........',
  '...........',
];
export const EYE_ROLES = { o: C.ink, W: C.white, r: C.red };

// 왕관 (9×6) — 우승자 표시
export const CROWN = [
  '.o..o..o.',
  'oYooYooYo',
  'oYYYYYYYo',
  'oYrYYYrYo',
  'oYYYYYYYo',
  'ooooooooo',
];
export const CROWN_ROLES = { o: C.ink, Y: C.yellow, r: C.red };

// 9-slice 테두리 원본 (12×12, 모서리 4px)
// o 외곽선, L 밝은 테두리, D 안쪽 테두리, F 채움, S 아래 그림자
export const NINE_SLICE = [
  '.oooooooooo.',
  'oLLLLLLLLLLo',
  'oLDDDDDDDDLo',
  'oLDFFFFFFDLo',
  'oLDFFFFFFDLo',
  'oLDFFFFFFDLo',
  'oLDFFFFFFDLo',
  'oLDFFFFFFDLo',
  'oLDFFFFFFDLo',
  'oLDDDDDDDDLo',
  'oSSSSSSSSSSo',
  '.oooooooooo.',
];

// 상자 스타일별 색
export const BOX_STYLES = {
  panel: { o: C.ink, L: C.silver, D: C.slate, F: C.dark, S: C.navy },
  paper: { o: C.ink, L: C.white, D: C.silver, F: C.white, S: C.slate },
  alert: { o: C.ink, L: C.orange, D: C.red, F: C.plum, S: C.ink },
  button: { o: C.ink, L: C.yellow, D: C.orange, F: C.yellow, S: C.red },
  buttonHot: { o: C.ink, L: C.white, D: C.yellow, F: C.white, S: C.orange },
  gold: { o: C.ink, L: C.yellow, D: C.orange, F: C.navy, S: C.ink },
  ghost: { o: C.ink, L: C.slate, D: C.dark, F: C.navy, S: C.ink },
};
