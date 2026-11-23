// =============================================================
// sprites.js — 캐릭터 픽셀 아트 원본 데이터 (16×32, 오른쪽을 바라봄)
//   - 모든 프레임은 "역할(role) 문자" 문자열 배열이다. 실제 색은 룩(LOOKS)마다 다름 (팔레트 스왑).
//   - 부위(머리/머리카락/몸통/다리/팔)를 작은 스탬프로 정의하고, 포즈 설명에 따라
//     레이어별로 합성 + 자동 1px 외곽선을 둘러 최종 16×32 프레임 문자열을 만든다.
//     (DOM 없이 순수 데이터만 다루므로 Node에서도 import 가능)
//
//   역할 문자:
//     .  투명            o  외곽선(#1a1c2c)
//     s  피부            S  피부 그늘
//     h  머리카락        H  머리카락 그늘
//     c  상의            C  상의 그늘
//     p  하의            P  하의 그늘
//     w  흰자/하이라이트  e  눈동자
//     m  입(밝은)        M  입(어두운)
//     f  신발            F  신발 그늘
//     x  액세서리(고름/머리끈/띠)   X  액세서리 그늘
//     q  물결(밝은 청록)  Q  물보라 하이라이트(흰색)
//     d  물방울/땀방울
//
//   앵커: 기본 프레임은 ax=6, ay=32 (발 중심이 땅에 닿는 점, 맨 아래 줄 y=31이 발바닥 외곽선)
// =============================================================
import { PAL } from '../palette.js';

export const FRAME_W = 16;
export const FRAME_H = 32;
export const ANCHOR_X = 6;
export const ANCHOR_Y = 32;
// wet 프레임의 수면선 행 (이 행부터 아래는 물속이라 투명)
export const WET_WATERLINE = 27;

// 애니메이션별 프레임 수 (계약서 기준)
export const ANIM_LENGTHS = {
  idle: 3,
  push: 4,
  charge: 2,
  feint: 3,
  hold: 2,
  stagger: 4,
  fallFwd: 5,
  fallBack: 5,
  wet: 2,
  win: 2,
};
// 넘어짐 회전 각도 (도)
export const FALL_ANGLES = [0, 20, 45, 70, 90];
// 런타임 회전으로 만드는 애니메이션 (원본 데이터는 tumble 한 장)
export const ROTATED_ANIMS = ['fallFwd', 'fallBack'];

// ---------------- 공통 색 ----------------
const BASE_COLORS = {
  o: PAL.ink,
  s: PAL.sand,
  S: PAL.orange,
  w: PAL.white,
  e: PAL.ink,
  m: PAL.red,
  M: PAL.plum,
  f: PAL.white,
  F: PAL.silver,
  p: PAL.navy,
  P: PAL.ink,
  q: PAL.cyan,
  Q: PAL.white,
  d: PAL.cyan,
};

function look(id, name, hairStyle, uiColor, roles, extras = []) {
  return { id, name, hairStyle, uiColor, extras, colors: { ...BASE_COLORS, ...roles } };
}

// ---------------- 룩 (팔레트 스왑) ----------------
export const LOOKS = {
  p1: look('p1', '한빛', 'spiky', PAL.red, {
    c: PAL.red, C: PAL.plum, h: PAL.charcoal, H: PAL.ink, x: PAL.sand, X: PAL.orange,
  }),
  p2: look('p2', '나래', 'bob', PAL.blue, {
    c: PAL.blue, C: PAL.navy, h: PAL.orange, H: PAL.red, x: PAL.sand, X: PAL.orange,
  }),
  p3: look('p3', '다온', 'ponytail', PAL.green, {
    c: PAL.green, C: PAL.teal, h: PAL.plum, H: PAL.ink, x: PAL.sand, X: PAL.orange,
  }),
  p4: look('p4', '보람', 'buzz', PAL.cyan, {
    c: PAL.cyan, C: PAL.sky, h: PAL.red, H: PAL.plum, x: PAL.blue, X: PAL.navy,
  }),
  p5: look('p5', '솔지', 'curly', PAL.orange, {
    c: PAL.orange, C: PAL.red, h: PAL.slate, H: PAL.charcoal, x: PAL.white, X: PAL.silver,
  }),
  champ: look('champ', '마을 챔피언', 'topknot', PAL.sand, {
    c: PAL.white, C: PAL.silver, h: PAL.navy, H: PAL.ink, x: PAL.red, X: PAL.plum,
    p: PAL.slate, P: PAL.charcoal,
  }, ['mustache', 'sash', 'headband']),
};

export const HAIR_STYLES = ['spiky', 'bob', 'ponytail', 'buzz', 'curly', 'topknot'];

// =============================================================
// 부위 스탬프
// =============================================================

// 머리(얼굴) — 9×10, 머리 원점 기준 (기본 위치 x=2, y=4)
//   눈은 열 4, 7 / 입은 열 6 / 귀는 열 2
export const FACES = {
  normal: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'ssSsesses',
    'ssSsesses',
    'sssSssssS',
    'ssssssMss',
    '.SSSSSSS.',
  ],
  // 호흡 중 살짝 눈을 내리깐 얼굴 (idle 변화용)
  calm: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'ssSssssss',
    'ssSsesses',
    'sssSssssS',
    'ssssssMss',
    '.SSSSSSS.',
  ],
  // 집중 (V자 눈썹 + 다문 입)
  focus: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssosssso',
    'ssSsossos',
    'ssSsesses',
    'sssSssssS',
    'sssssMMss',
    '.SSSSSSS.',
  ],
  // 기합! (입을 크게 벌림)
  shout: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssosssso',
    'ssSsossos',
    'ssSsesses',
    'sssSssssS',
    'sssssMMss',
    '.SSSSmmS.',
  ],
  // 이를 악물고 버팀 (실눈 + 이빨)
  strain: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'ssSoossoo',
    'ssSssssss',
    'sssSssssS',
    'ssssMwwMs',
    '.SSSSSSS.',
  ],
  // 깜짝 (동그란 눈 + 작은 o 입)
  surprised: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssweswes',
    'ssseesees',
    'sssSssssS',
    'ssssssMss',
    '.SSSSSmS.',
  ],
  // 휘청 (동그란 눈 + 물결 입)
  worried: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssweswes',
    'ssseesees',
    'sssSssssS',
    'sssssMsMs',
    '.SSSSSMS.',
  ],
  // 시치미 뚝 (- - 눈 + 휘파람 입) — 페인트 "아무것도 없지롱"
  oops: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'ssSssssss',
    'ssSeessee',
    'sssSssssS',
    'sssssssMs',
    '.SSSSSSS.',
  ],
  // 신남 (^ ^ 눈 + 활짝 웃는 입)
  happy: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'ssSesssss',
    'ssesesese',
    'sssSssssS',
    'sssssMMMs',
    '.SSSSSmS.',
  ],
  // 물에 빠짐 (동그란 눈 + 헐떡이는 입)
  gasp: [
    '.sssssss.',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssssssss',
    'sssweswes',
    'ssseesees',
    'sssSssssS',
    'sssssMMss',
    '.SSSSmmS.',
  ],
};

// 머리 모양 오버레이 — 머리 원점 기준 (ox, oy) 위치에 덮어 그림 ('.'는 그대로 둠)
export const HAIR = {
  // 한빛: 삐죽삐죽
  spiky: {
    ox: 0, oy: -3,
    rows: [
      '..h..h.h..',
      '.hh.hh.hh.',
      'hhhhhhhhh.',
      'hhhhhhhhhh',
      'hhhhhhhhh.',
      'hhHhhHhhH.',
      'hhh.hH.h..',
      'hh........',
      'hH........',
      'h.........',
    ],
  },
  // 나래: 단발
  bob: {
    ox: 0, oy: -2,
    rows: [
      '.hhhhhhh.',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'hhhHHHHHH',
      'hhhh.....',
      'hhhh.....',
      'hhhH.....',
      'hhHH.....',
      'HHH......',
    ],
  },
  // 다온: 포니테일 (머리끈 x + 뒤로 늘어진 꼬리)
  ponytail: {
    ox: 0, oy: -3,
    rows: [
      'hh.......',
      'hxhhhhh..',
      'hXhhhhhhh',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'hhhhhHhhh',
      'hhh.hhH.h',
      'hh.......',
      'hH.......',
      'hH.......',
      'hH.......',
      'hH.......',
      'hH.......',
      '.H.......',
    ],
  },
  // 보람: 까까머리
  buzz: {
    ox: 0, oy: -1,
    rows: [
      '.hhhhhhh.',
      'hhhhhhhhh',
      'hhhhhhhhh',
      'HhhhhhH..',
      'hhh......',
      'hh.......',
    ],
  },
  // 솔지: 곱슬 뽀글
  curly: {
    ox: 0, oy: -3,
    rows: [
      '.hh.hh.hh.',
      'hhhhhhhhhh',
      'hhHhhhHhhh',
      'hhhhHhhhHh',
      'hhhhhhhhh.',
      'hHhhHhhHh.',
      'hhh.hh.h..',
      'hHh.......',
      'hhH.......',
      'Hhh.......',
      'hh........',
    ],
  },
  // 챔피언: 상투 + (headband 추가 장식)
  topknot: {
    ox: 0, oy: -3,
    rows: [
      '...hhh...',
      '...xXx...',
      '.hhhhhhh.',
      'hhhhhhhhh',
      'hHhhhhhhh',
      'hhhhhhhh.',
      'hhh......',
      'hh.......',
      'h........',
    ],
  },
};

// 챔피언 전용 장식 (머리 원점 기준)
const HEADBAND = { ox: 0, oy: 2, rows: ['xxxxxxxxx', 'XX.......', 'X........'] };
const MUSTACHE = { ox: 5, oy: 7, rows: ['hhhh', 'h..h'] };

// 몸통(저고리) — 7×7, 기본 위치 x=3, y=15 (동정 w, 고름 x)
const TORSO = [
  '.ccwwc.',
  'Ccccwcc',
  'Ccccxcc',
  'CcccxXc',
  'CccccXc',
  'Ccccccc',
  'CCCCCCC',
];
// 챔피언의 빨간 띠 (몸통 원점 기준) + 등 뒤로 늘어진 띠 끝
const SASH = { ox: -1, oy: 5, rows: ['.xxxxxxx', 'XXxxxxxx', 'XX......', '.X......'] };

// 다리(바지 + 대님 + 고무신) — 포즈별. y는 첫 행의 절대 y.
const LEGS = {
  // 기본 서기: 발은 x 3..9
  stand: {
    x: 3, y: 22,
    rows: [
      'ppppppp',
      'ppppppp',
      'PpppPpp',
      'PppPPpp',
      'Ppp.Ppp',
      '.PP..pp',
      '.xx..xx',
      'FFF.fff',
      'FFF.ffff',
    ],
  },
  // 무릎 굽혀 낮게 버팀 (상체 2px 내려감)
  bent: {
    x: 2, y: 24,
    rows: [
      '.ppppppp.',
      'pppppPppp',
      'pPp...ppp',
      'PP.....pp',
      'xx.....xx',
      'FFF...fff',
      'FFF...ffff',
    ],
  },
  // 차지: 뒷다리에 체중을 싣고 앞다리를 내밀어 웅크림 (상체 2px 내려감)
  coil: {
    x: 2, y: 24,
    rows: [
      '.ppppppp.',
      'Ppppppppp',
      'PPp...ppp',
      'PP.....pp',
      'xx.....xx',
      'FFF....ff',
      'FFF....fff',
    ],
  },
  // 휘청 A: 앞발이 살짝 들림
  wobbleA: {
    x: 3, y: 22,
    rows: [
      'ppppppp',
      'ppppppp',
      'PpppPpp',
      'PppPPpp',
      'Ppp.ppp.',
      '.PP..ppf',
      '.xx..xff',
      'FFF.....',
      'FFF.....',
    ],
  },
  // 휘청 B: 뒷발이 살짝 들림
  wobbleB: {
    x: 3, y: 22,
    rows: [
      'ppppppp',
      'ppppppp',
      'PpppPpp',
      'PPpPPpp',
      '.PPPPpp',
      'FPP..pp',
      'FF...xx',
      '.....fff',
      '.....ffff',
    ],
  },
  // 넘어짐 기본 자세: 두 발을 모으고 발끝이 들림
  tumble: {
    x: 3, y: 22,
    rows: [
      'ppppppp',
      'ppppppp',
      'PpppPpp',
      'PppPPpp',
      '.PpPPp.',
      '.PPppp.',
      '.xxxxx.',
      'FFFffff',
      'FFFfff.',
    ],
  },
};

// 손 스탬프 (왼쪽 위 기준)
const HANDS = {
  palm: ['ss', 'ss', 'Ss'], // 앞으로 세운 손바닥 (손가락 위)
  palmFar: ['SS', 'SS', 'SS'], // 뒤쪽 팔의 손바닥 (그늘색)
  palmTall: ['ss', 'ss', 'ss', 'Ss'], // 크게 뻗은 손바닥
  palmTallFar: ['SS', 'SS', 'SS', 'SS'],
  fist: ['ss', 'SS'],
  fistFar: ['SS', 'SS'],
  blob: ['ss', 'sS'],
  blobFar: ['SS', 'SS'],
};

// =============================================================
// 포즈 정의
//   bdx/bdy : 몸통(+팔)의 이동, hdx/hdy : 머리의 추가 이동
//   far/near: 팔. pts = 소매 굵기 2px 선을 잇는 점들(브러시 왼쪽 위), hand = [x, y, 손 종류]
//   (팔 좌표는 이동 전 기준 — bdx/bdy가 더해진다)
//   fx: 추가 장식 [{ x, y, rows }] (땀방울 등, 절대 좌표)
// =============================================================
const SWEAT = ['d', 'd'];

export const POSES = {
  // ---- 대기: 손바닥을 가슴 앞에 세움 (숨쉬기 3프레임) ----
  //   앞손 손바닥 x 10..11 (+외곽선 12), 뒷손 손바닥은 한 칸 앞·두 칸 위로 살짝 보임 (외곽선 13)
  idle0: {
    face: 'normal', legs: 'stand',
    far: { pts: [[7, 15], [9, 15]], hand: [11, 13, 'palmTallFar'] },
    near: { pts: [[5, 16], [8, 17]], hand: [10, 15, 'palmTall'] },
  },
  idle1: {
    face: 'normal', legs: 'stand', hdy: 1,
    far: { pts: [[7, 16], [9, 16]], hand: [11, 14, 'palmTallFar'] },
    near: { pts: [[5, 17], [8, 18]], hand: [10, 16, 'palmTall'] },
  },
  idle2: {
    face: 'calm', legs: 'stand', hdy: 1,
    far: { pts: [[7, 15], [9, 15]], hand: [11, 13, 'palmTallFar'] },
    near: { pts: [[5, 16], [8, 17]], hand: [10, 15, 'palmTall'] },
  },

  // ---- 밀기 ----
  // [0] 팔을 뒤로 당김: 팔꿈치가 등 뒤로 튀어나오고 손바닥은 가슴 옆
  push0: {
    face: 'focus', legs: 'stand', bdx: -1,
    far: { pts: [[7, 15], [4, 17], [6, 15]], hand: [7, 12, 'palmTallFar'] },
    near: { pts: [[5, 16], [2, 19], [4, 17]], hand: [6, 15, 'palmTall'] },
  },
  // [1] 뻗는 중
  push1: {
    face: 'focus', legs: 'stand',
    far: { pts: [[7, 15], [10, 14]], hand: [12, 12, 'palmTallFar'] },
    near: { pts: [[5, 16], [9, 16]], hand: [11, 14, 'palmTall'] },
  },
  // [2] 완전히 뻗음: 앞손 손바닥 x 13..14 (앞끝 외곽선 x 15), 뒷손은 그 위·뒤로 겹쳐 보임
  push2: {
    face: 'shout', legs: 'stand', bdx: 1,
    far: { pts: [[6, 15], [9, 13]], hand: [11, 11, 'palmTallFar'] },
    near: { pts: [[4, 16], [10, 16]], hand: [12, 14, 'palmTall'] },
  },
  // [3] 회수
  push3: {
    face: 'focus', legs: 'stand',
    far: { pts: [[7, 15], [9, 16]], hand: [11, 14, 'palmTallFar'] },
    near: { pts: [[5, 16], [8, 18]], hand: [10, 16, 'palmTall'] },
  },

  // ---- 차지: 깊게 웅크리고 몸을 뒤로 젖힘, 팔꿈치를 등 뒤로 한껏 당김 ----
  charge0: {
    face: 'focus', legs: 'coil', bdx: -1, bdy: 2,
    far: { pts: [[6, 15], [4, 17]], hand: [3, 14, 'palmTallFar'] },
    near: { pts: [[5, 16], [3, 18]], hand: [2, 17, 'palmTall'] },
    fx: [{ x: 0, y: 14, rows: ['Q'] }, { x: 4, y: 24, rows: ['q'] }],
  },
  charge1: {
    face: 'strain', legs: 'coil', bdx: -1, bdy: 2, hdy: 1,
    far: { pts: [[6, 16], [4, 18]], hand: [3, 15, 'palmTallFar'] },
    near: { pts: [[5, 17], [3, 19]], hand: [2, 18, 'palmTall'] },
    fx: [{ x: 1, y: 13, rows: ['q'] }, { x: 0, y: 25, rows: ['Q'] }],
  },

  // ---- 페인트: 손을 쏙 빼서 얼굴 앞으로 번쩍 ("아무것도 없지롱") ----
  feint0: {
    face: 'focus', legs: 'stand',
    far: { pts: [[7, 15], [9, 14]], hand: [10, 11, 'palmTallFar'] },
    near: { pts: [[5, 16], [7, 16]], hand: [9, 13, 'palmTall'] },
  },
  feint1: {
    face: 'oops', legs: 'stand', bdx: -1,
    far: { pts: [[7, 15], [10, 13], [11, 10]], hand: [13, 6, 'palmTallFar'] },
    near: { pts: [[5, 16], [8, 17], [10, 13]], hand: [12, 8, 'palmTall'] },
    fx: [{ x: 1, y: 5, rows: SWEAT }],
  },
  feint2: {
    face: 'normal', legs: 'stand',
    far: { pts: [[7, 15], [9, 14]], hand: [11, 12, 'palmTallFar'] },
    near: { pts: [[5, 16], [8, 16]], hand: [10, 14, 'palmTall'] },
  },

  // ---- 버티기: 무릎 굽히고 팔을 쭉 펴서 손바닥을 단단히 앞으로 ----
  hold0: {
    face: 'strain', legs: 'bent', bdy: 2,
    far: { pts: [[7, 15], [10, 13]], hand: [12, 12, 'palmTallFar'] },
    near: { pts: [[4, 16], [9, 15]], hand: [11, 14, 'palmTall'] },
  },
  hold1: {
    face: 'strain', legs: 'bent', bdy: 2, hdy: 1,
    far: { pts: [[7, 15], [10, 13]], hand: [12, 12, 'palmTallFar'] },
    near: { pts: [[4, 16], [9, 15]], hand: [11, 14, 'palmTall'] },
    fx: [{ x: 1, y: 7, rows: SWEAT }],
  },

  // ---- 휘청: 팔을 풍차처럼 허우적 (4프레임) ----
  stagger0: {
    face: 'worried', legs: 'wobbleA', bdx: -1,
    far: { pts: [[7, 15], [9, 11]], hand: [10, 8, 'blobFar'] },
    near: { pts: [[5, 16], [2, 19]], hand: [2, 20, 'blob'] },
    fx: [{ x: 13, y: 5, rows: SWEAT }],
  },
  stagger1: {
    face: 'worried', legs: 'stand',
    far: { pts: [[6, 15], [10, 17]], hand: [12, 18, 'blobFar'] },
    near: { pts: [[5, 16], [3, 11]], hand: [2, 8, 'blob'] },
  },
  stagger2: {
    face: 'worried', legs: 'wobbleB', bdx: 1,
    far: { pts: [[6, 15], [3, 18]], hand: [1, 19, 'blobFar'] },
    near: { pts: [[5, 16], [9, 12]], hand: [11, 9, 'blob'] },
    fx: [{ x: 0, y: 5, rows: SWEAT }],
  },
  stagger3: {
    face: 'worried', legs: 'stand',
    far: { pts: [[6, 15], [3, 11]], hand: [2, 8, 'blobFar'] },
    near: { pts: [[5, 16], [9, 19]], hand: [11, 20, 'blob'] },
  },

  // ---- 승리: 만세 (번갈아) ----
  win0: {
    face: 'happy', legs: 'stand',
    far: { pts: [[7, 15], [9, 11], [10, 7]], hand: [10, 3, 'palmTallFar'] },
    near: { pts: [[4, 15], [3, 12], [2, 9]], hand: [1, 5, 'palmTall'] },
  },
  win1: {
    face: 'happy', legs: 'stand', hdy: 1,
    far: { pts: [[7, 16], [10, 13], [12, 10]], hand: [12, 6, 'palmTallFar'] },
    near: { pts: [[4, 16], [3, 13], [3, 10]], hand: [3, 7, 'palmTall'] },
  },

  // ---- 넘어짐 기본 자세 (런타임 회전 원본): 두 팔 번쩍 + 깜짝 놀란 얼굴 ----
  tumble: {
    face: 'surprised', legs: 'tumble',
    far: { pts: [[7, 15], [10, 11], [11, 8]], hand: [11, 4, 'palmTallFar'] },
    near: { pts: [[4, 15], [2, 12], [1, 9]], hand: [1, 5, 'palmTall'] },
  },
};

// 애니메이션 → 포즈 이름 목록 (fall/wet 제외)
export const ANIM_POSES = {
  idle: ['idle0', 'idle1', 'idle2'],
  push: ['push0', 'push1', 'push2', 'push3'],
  charge: ['charge0', 'charge1'],
  feint: ['feint0', 'feint1', 'feint2'],
  hold: ['hold0', 'hold1'],
  stagger: ['stagger0', 'stagger1', 'stagger2', 'stagger3'],
  win: ['win0', 'win1'],
};

// =============================================================
// 합성 도구 (순수 함수)
// =============================================================
const OUT = '#'; // 자동 외곽선 임시 표시

function blank(w = FRAME_W, h = FRAME_H) {
  const g = [];
  for (let y = 0; y < h; y++) g.push(new Array(w).fill('.'));
  return g;
}

function put(g, x, y, ch) {
  if (ch === '.' || ch === ' ') return;
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  g[y][x] = ch;
}

function stamp(g, rows, x, y) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) put(g, x + c, y + r, row[c]);
  }
}

// 2×2 브러시로 두 점 사이를 잇는 선 (브레젠험)
function brushLine(g, x0, y0, x1, y1, ch) {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    put(g, x, y, ch);
    put(g, x + 1, y, ch);
    put(g, x, y + 1, ch);
    put(g, x + 1, y + 1, ch);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// 레이어 둘레에 1px 외곽선(상하좌우 이웃)을 표시한다
function addOutline(layer) {
  const h = layer.length;
  const w = layer[0].length;
  const marks = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (layer[y][x] !== '.') continue;
      const n =
        (y > 0 && layer[y - 1][x] !== '.' && layer[y - 1][x] !== OUT) ||
        (y < h - 1 && layer[y + 1][x] !== '.' && layer[y + 1][x] !== OUT) ||
        (x > 0 && layer[y][x - 1] !== '.' && layer[y][x - 1] !== OUT) ||
        (x < w - 1 && layer[y][x + 1] !== '.' && layer[y][x + 1] !== OUT);
      if (n) marks.push([x, y]);
    }
  }
  for (const [x, y] of marks) layer[y][x] = OUT;
  return layer;
}

// 레이어를 대상 위에 합성 (외곽선 표시는 'o'로)
//   inner: 외곽선이 이미 칠해진 상의 픽셀 위에 올 때 쓸 문자 (없으면 'o')
const CLOTH = new Set(['c', 'C', 'x', 'X', 'w']);
function composite(dst, layer, inner = null) {
  for (let y = 0; y < dst.length; y++) {
    for (let x = 0; x < dst[0].length; x++) {
      const ch = layer[y][x];
      if (ch === '.') continue;
      if (ch === OUT) dst[y][x] = inner && CLOTH.has(dst[y][x]) ? inner : 'o';
      else dst[y][x] = ch;
    }
  }
}

function toRows(g) {
  return g.map((r) => r.join(''));
}

function drawArm(arm, ox, oy, sleeve) {
  const L = blank();
  const pts = arm.pts.map(([x, y]) => [x + ox, y + oy]);
  for (let i = 0; i < pts.length - 1; i++) {
    brushLine(L, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], sleeve);
  }
  if (pts.length === 1) brushLine(L, pts[0][0], pts[0][1], pts[0][0], pts[0][1], sleeve);
  if (arm.hand) {
    const [hx, hy, kind] = arm.hand;
    stamp(L, HANDS[kind], hx + ox, hy + oy);
  }
  return addOutline(L);
}

// 머리 레이어 (얼굴 + 머리카락 + 장식) — 원점 (hx, hy)
function drawHead(faceName, hairStyle, extras, hx, hy) {
  const L = blank();
  stamp(L, FACES[faceName] || FACES.normal, hx, hy);
  const hair = HAIR[hairStyle] || HAIR.spiky;
  stamp(L, hair.rows, hx + hair.ox, hy + hair.oy);
  if (extras.includes('headband')) stamp(L, HEADBAND.rows, hx + HEADBAND.ox, hy + HEADBAND.oy);
  if (extras.includes('mustache')) stamp(L, MUSTACHE.rows, hx + MUSTACHE.ox, hy + MUSTACHE.oy);
  return addOutline(L);
}

/**
 * 포즈 하나를 16×32 역할 문자 프레임으로 합성
 * @param {object} pose POSES 항목
 * @param {string} hairStyle
 * @param {string[]} extras ['mustache','sash','headband']
 * @returns {string[]} 32개의 16글자 문자열
 */
export function composePose(pose, hairStyle = 'spiky', extras = []) {
  const bdx = pose.bdx || 0;
  const bdy = pose.bdy || 0;
  const hdx = pose.hdx || 0;
  const hdy = pose.hdy || 0;
  const out = blank();

  // 1) 뒤쪽 팔 (몸 뒤에 가려짐)
  if (pose.far) composite(out, drawArm(pose.far, bdx, bdy, 'C'));

  // 2) 다리
  const legs = LEGS[pose.legs] || LEGS.stand;
  const legL = blank();
  stamp(legL, legs.rows, legs.x, legs.y);
  composite(out, addOutline(legL));

  // 3) 몸통 (+챔피언 띠)
  const tx = 3 + bdx;
  const ty = 15 + bdy;
  const torso = blank();
  stamp(torso, TORSO, tx, ty);
  // 웅크린 자세에서는 몸통과 다리 사이 틈을 바지로 메움
  if (legs.y > ty + TORSO.length) {
    for (let y = ty + TORSO.length; y < legs.y; y++) stamp(torso, ['ppppppp'], tx, y);
  }
  if (extras.includes('sash')) stamp(torso, SASH.rows, tx + SASH.ox, ty + SASH.oy);
  composite(out, addOutline(torso));

  // 4) 머리
  composite(out, drawHead(pose.face, hairStyle, extras, 2 + bdx + hdx, 4 + bdy + hdy));

  // 5) 앞쪽 팔 (몸 위에 그림)
  if (pose.near) composite(out, drawArm(pose.near, bdx, bdy, 'c'), 'C');

  // 6) 장식 (땀방울 등)
  if (pose.fx) {
    for (const fx of pose.fx) {
      const L = blank();
      stamp(L, fx.rows, fx.x, fx.y);
      composite(out, L);
    }
  }
  return toRows(out);
}

// ---- 물에 빠짐: 머리 + 한 팔만 수면 위 (2프레임) ----
function composeWet(frameIndex, hairStyle, extras) {
  const WL = WET_WATERLINE;
  const out = blank();
  const hx = 2;
  const hy = WL - 11; // 턱이 수면 바로 위
  // 허우적대는 팔 (프레임마다 손 위치가 바뀜)
  const arm = frameIndex === 0
    ? { pts: [[8, WL + 1], [10, WL - 6], [11, WL - 11]], hand: [11, WL - 15, 'palmTall'] }
    : { pts: [[8, WL + 1], [11, WL - 5], [13, WL - 9]], hand: [13, WL - 13, 'blob'] };
  // 어깨 일부 (수면 바로 아래에서 잘림)
  const torso = blank();
  stamp(torso, TORSO, 3, WL - 1);
  composite(out, addOutline(torso));
  composite(out, drawHead('gasp', hairStyle, extras, hx, hy + (frameIndex === 0 ? 0 : 1)));
  composite(out, drawArm(arm, 0, 0, 'c'));
  // 수면 아래는 투명하게 자름
  for (let y = WL; y < FRAME_H; y++) out[y].fill('.');
  // 목 주변 물결 (수면 바로 위 한 줄)
  const ripple = frameIndex === 0
    ? ['.qQq.......qqQ..', 'qq...........qqq']
    : ['..qqQ.....Qqq...', '.qq.........qq.q'];
  stamp(out, [ripple[0]], 0, WL - 2);
  // 아래 줄은 투명한 곳만 물결로 채움
  const line = ripple[1];
  for (let x = 0; x < FRAME_W; x++) {
    if (line[x] !== '.' && out[WL - 1][x] === '.') out[WL - 1][x] = line[x];
  }
  // 튀는 물방울
  if (frameIndex === 0) {
    put(out, 1, WL - 6, 'd');
    put(out, 14, WL - 4, 'd');
  } else {
    put(out, 0, WL - 4, 'd');
    put(out, 15, WL - 8, 'd');
    put(out, 9, WL - 16, 'd');
  }
  return toRows(out);
}

/**
 * 룩 하나의 원본 프레임 (오른쪽을 바라봄)
 * @returns {{ [anim: string]: string[][], tumble: string[] }}
 *   anim → 프레임 배열(각 프레임은 32줄 문자열). fallFwd/fallBack은 포함하지 않음 (tumble을 회전).
 */
export function buildLookFrames(lookId) {
  const lk = LOOKS[lookId] || LOOKS.p1;
  const out = {};
  for (const anim of Object.keys(ANIM_POSES)) {
    out[anim] = ANIM_POSES[anim].map((name) => composePose(POSES[name], lk.hairStyle, lk.extras));
  }
  out.wet = [0, 1].map((i) => composeWet(i, lk.hairStyle, lk.extras));
  out.tumble = composePose(POSES.tumble, lk.hairStyle, lk.extras);
  return out;
}

// 모든 룩의 원본 프레임 데이터 (모듈 로드 시 1회 계산 — 순수 데이터)
export const FRAMES = {};
for (const id of Object.keys(LOOKS)) FRAMES[id] = buildLookFrames(id);
