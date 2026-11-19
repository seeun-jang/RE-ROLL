// =============================================================
// Background — 마을 운동회 배경 (패럴랙스 3레이어)
//   하늘(×0.15): 디더 하늘 띠, 해(밤엔 달), 구름, 먼 산
//   관중석(×0.5): 천막, 계단식 관중석, 관중, 만국기, 가로등, 현수막
//   운동장(×1.0): 잔디 띠, 흙 운동장, 중앙선, 진흙 웅덩이, 진영 선 2개
//
// 정적인 그림은 모두 '팔레트 인덱스 버퍼'(Uint8Array, 255 = 투명)에 낮 색으로 한 번만 그린 뒤,
// 시간대별로 swapIndex() 로 인덱스를 바꿔 캔버스를 만든다 (시간대별 캐시).
// 움직이는 것(구름, 만국기, 관중, 별, 가로등 불빛)은 매 프레임 swapIndex 색으로 그린다.
// =============================================================
import { PALETTE, C, TEAM_COLORS, swapIndex } from '../palette.js';

// ---------- 레이어 공통 ----------
const PAD = 64;                 // 레이어 좌우 여유 px (camX ±40 에서도 빈 가장자리가 안 보이게)
const TRANSPARENT = 255;        // 인덱스 버퍼의 투명값
const PARALLAX_SKY = 0.15;      // 하늘 레이어 이동 비율
const PARALLAX_STANDS = 0.5;    // 관중석 레이어 이동 비율
const FLAG_LAYER_H = 64;        // 만국기 레이어 높이 (위쪽만 쓰므로 잘라서 메모리 절약)

// ---------- 하늘 ----------
const SKY_TOP_BAND_END = 12;    // 맨 위 진한 하늘(BLUE) 끝
const SKY_TOP_DITHER_END = 24;  // BLUE → SKY 디더 구간 끝
const SKY_LOW_DITHER_START = 44;// SKY → CYAN(지평선 띠) 디더 시작
const SKY_LOW_DITHER_END = 60;  // 지평선 띠 시작
const SUN_X = 256;              // 해 위치 (화면 기준 x)
const SUN_Y = 40;
const SUN_R = 8;
const CLOUD_COUNT = 5;
const STAR_COUNT = 46;

// ---------- 관중석 ----------
const TENT_W = 128;             // 천막 폭
const TENT_PERIOD = 152;        // 천막 간격 (사이 24px 은 하늘이 보임)
const TENT_ROOF_TOP = 54;
const TENT_ROOF_BOTTOM = 63;
const SEAT_FIRST_Y = 80;        // 맨 뒷줄 좌석 y
const SEAT_TIER_H = 8;          // 계단 한 칸 높이
const SEAT_TIERS = 4;
const CROWD_SPACING = 7;        // 관중 간격 (px)
const CROWD_EMPTY_RATE = 0.12;  // 빈자리 비율
const FENCE_Y = 106;            // 앞 울타리 윗변
const BUNTING_POLES = [18, 132, 316, 430]; // 만국기 기둥 (레이어 x)
const BUNTING_POLE_TOP = 28;
const BUNTING_FLAG_STEP = 7;    // 깃발 간격
const LAMP_XS = [78, 370];      // 가로등 (레이어 x)
const LAMP_HEAD_Y = 36;
const LAMP_GLOW_R = 10;         // 밤 불빛 디더 반경
const BANNER_W = 60;
const BANNER_Y = 65;
const BANNER_H = 10;

// ---------- 운동장 ----------
const GRASS_H = 6;              // 잔디 띠 높이 (지면 윗선 위로)
const TILE = 16;                // 운동장 타일 크기 (16×16)
const EDGE_TILE_TOP = 8;        // 가장자리 타일에서 지면 윗선 위쪽 행 수 (풀포기 2 + 잔디 6)
const EDGE_TILE_VARIANTS = 3;   // 잔디 가장자리 타일 변형 수
const DIRT_TILE_VARIANTS = 4;   // 흙 타일 변형 수
const PUDDLE_RX = 18;           // 진흙 웅덩이 가로 반경
const PUDDLE_RY = 4;            // 세로 반경 (원근감으로 납작하게)
const PEBBLE_COUNT = 70;
const TEAM_FLAG_POLE_H = 18;    // 진영 선 위 깃대 높이

// 운동장 흙 조명 보정 — swapIndex 다음에 운동장 레이어에만 추가로 적용하는 인덱스 교체 (낮 인덱스 기준).
// 공용 스왑표만 쓰면 노을엔 흙 질감(YELLOW/ORANGE)이 한 색으로 뭉개지고, 밤엔 흙이 밝은 노랑으로 남기 때문.
const FIELD_REMAP = {
  day: {},
  sunset: { [C.ORANGE]: C.RED, [C.RED]: C.PLUM },
  night: { [C.YELLOW]: C.SLATE, [C.ORANGE]: C.CHARCOAL, [C.RED]: C.CHARCOAL, [C.CHARCOAL]: C.INK },
};

// ---------- 연출 ----------
const FLAG_FLAP_RATE = 3;       // 만국기 펄럭임 (초당 프레임 교대 수, 흥분하면 더 빨라짐)
const EXCITE_SMOOTH = 3;        // 관중 흥분도 따라가는 속도 (1/s)
const NIGHT_DIM_LEVEL = 3;      // 밤에 관중석/운동장을 어둡게 하는 디더 밀도 (/16)

// Bayer 4×4 순서 디더 행렬 (0..15)
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];
const bayer = (x, y) => BAYER4[(y & 3) * 4 + (x & 3)];

// 한 단계 어두운 인덱스 (밤 디더용)
const DIM = [
  C.INK, C.INK, C.PLUM, C.RED, C.ORANGE, C.GREEN, C.TEAL, C.NAVY,
  C.INK, C.NAVY, C.BLUE, C.SKY, C.SILVER, C.SLATE, C.CHARCOAL, C.INK,
];

// 만국기 색 순서
const BUNTING_COLORS = [C.RED, C.YELLOW, C.BLUE, C.LIME, C.WHITE, C.ORANGE, C.CYAN, C.GREEN, C.PLUM, C.SKY];
// 관중 셔츠 / 머리색
const SHIRT_COLORS = [C.RED, C.ORANGE, C.LIME, C.GREEN, C.CYAN, C.SKY, C.BLUE, C.WHITE, C.PLUM, C.YELLOW, C.TEAL];
const HAIR_COLORS = [C.INK, C.INK, C.PLUM, C.CHARCOAL, C.SLATE];
// 천막 줄무늬 색 (흰색과 번갈아)
const TENT_COLORS = [C.RED, C.SKY, C.GREEN];

// ---------- 순수 헬퍼 ----------

/** 결정적 해시 → [0,1) (배경이 매번 같은 모양이 되도록) */
function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 시드 고정 난수 생성기 (mulberry32) */
function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 팔레트 인덱스 버퍼 (255 = 투명) */
class IndexLayer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h).fill(TRANSPARENT);
  }
  set(x, y, i) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = i;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
    return this.data[y * this.w + x];
  }
  rect(x, y, w, h, i) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, i);
  }
}

/** 시간대별 인덱스 → HEX 표 */
function makeLut(tod) {
  const lut = new Array(16);
  for (let i = 0; i < 16; i++) lut[i] = PALETTE[swapIndex(i, tod)];
  return lut;
}

// =============================================================
// 정적 레이어 그리기 (모두 '낮' 색 인덱스로)
// =============================================================

/** 하늘: 디더 띠 + 해 */
function buildSky(w, h) {
  const L = new IndexLayer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c;
      if (y < SKY_TOP_BAND_END) c = C.BLUE;
      else if (y < SKY_TOP_DITHER_END) {
        const f = (y - SKY_TOP_BAND_END) / (SKY_TOP_DITHER_END - SKY_TOP_BAND_END);
        c = bayer(x, y) < f * 16 ? C.SKY : C.BLUE;
      } else if (y < SKY_LOW_DITHER_START) c = C.SKY;
      else if (y < SKY_LOW_DITHER_END) {
        const f = (y - SKY_LOW_DITHER_START) / (SKY_LOW_DITHER_END - SKY_LOW_DITHER_START);
        c = bayer(x, y) < f * 16 ? C.CYAN : C.SKY;
      } else c = C.CYAN;
      L.set(x, y, c);
    }
  }
  // 해 (밤에는 YELLOW 그대로 남아 달이 된다)
  const sx = PAD + SUN_X;
  const r2 = SUN_R * SUN_R + SUN_R * 0.8;
  for (let dy = -SUN_R - 3; dy <= SUN_R + 3; dy++) {
    for (let dx = -SUN_R - 3; dx <= SUN_R + 3; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) L.set(sx + dx, SUN_Y + dy, C.YELLOW);
      else {
        // 테두리 링 (노을엔 YELLOW 로 바뀌어 주황 하늘에서도 해가 보인다) + 바깥 후광 디더
        const d = Math.sqrt(d2);
        if (d <= SUN_R + 1.4) L.set(sx + dx, SUN_Y + dy, C.WHITE);
        else if (d <= SUN_R + 2.6 && ((dx + dy) & 1) === 0) L.set(sx + dx, SUN_Y + dy, C.WHITE);
      }
    }
  }
  // 하이라이트 (밤엔 SILVER 로 바뀌어 달 무늬처럼 보임)
  const hl = [[-4, -2], [-3, -3], [-2, -4], [-3, -2], [2, 2], [3, 1], [1, 4]];
  for (const [dx, dy] of hl) L.set(sx + dx, SUN_Y + dy, C.WHITE);
  return L;
}

/** 먼 산 (하늘 레이어와 같이 움직임) */
function buildHills(w, h) {
  const L = new IndexLayer(w, h);
  for (let x = 0; x < w; x++) {
    // 먼 산등성이 (TEAL)
    const far = 60 + Math.round(3 * Math.sin(x * 0.045) + 2 * Math.sin(x * 0.11 + 1.3));
    for (let y = far; y < h; y++) L.set(x, y, y === far ? C.GREEN : C.TEAL);
    // 가까운 언덕 (GREEN, 윗선 LIME, 아래는 TEAL 디더)
    const near = 68 + Math.round(4 * Math.sin(x * 0.03 + 2) + 2 * Math.sin(x * 0.09));
    for (let y = near; y < h; y++) {
      let c = C.GREEN;
      if (y === near) c = C.LIME;
      else if (y > near + 3 && bayer(x, y) < 4) c = C.TEAL;
      L.set(x, y, c);
    }
  }
  // 언덕 위 작은 나무들
  const rng = seededRng(7);
  for (let x = 6; x < w - 6; x += 9 + ((rng() * 14) | 0)) {
    const near = 68 + Math.round(4 * Math.sin(x * 0.03 + 2) + 2 * Math.sin(x * 0.09));
    const cy = near - 2;
    for (let dy = -3; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy * 1.3 > 10) continue;
        let c = C.GREEN;
        if (dy <= -2 && dx <= 0) c = C.LIME;
        else if (dy >= 1 || dx >= 2) c = C.TEAL;
        L.set(x + dx, cy + dy, c);
      }
    }
  }
  return L;
}

/** 천막들의 x 위치 (레이어 x) — 가운데 천막이 화면 중앙에 오게 */
function tentXs(w, centerLX) {
  const xs = [];
  let x0 = centerLX - (TENT_W >> 1);
  while (x0 - TENT_PERIOD > -TENT_W) x0 -= TENT_PERIOD;
  for (; x0 < w; x0 += TENT_PERIOD) xs.push(x0);
  return xs;
}

/** 관중석 뒤쪽: 천막 그늘, 난간, 계단 좌석, 천막 지붕 */
function buildStandsBack(w, h, centerLX) {
  const L = new IndexLayer(w, h);
  const tents = tentXs(w, centerLX);
  const railY = SEAT_FIRST_Y - 6;

  // 1) 천막 아래 그늘 벽 (SLATE/CHARCOAL 50% 디더)
  for (const x0 of tents) {
    for (let y = TENT_ROOF_BOTTOM + 5; y < SEAT_FIRST_Y; y++) {
      for (let x = x0 + 2; x < x0 + TENT_W - 2; x++) L.set(x, y, bayer(x, y) < 8 ? C.CHARCOAL : C.SLATE);
    }
  }
  // 2) 맨 뒤 난간
  for (let x = 0; x < w; x++) {
    L.set(x, railY, C.SILVER);
    if (x % 16 === 0) for (let y = railY + 1; y < SEAT_FIRST_Y; y++) L.set(x, y, C.SLATE);
  }
  // 3) 계단식 좌석
  for (let i = 0; i < SEAT_TIERS; i++) {
    const seatY = SEAT_FIRST_Y + i * SEAT_TIER_H;
    for (let x = 0; x < w; x++) {
      L.set(x, seatY, C.SILVER);       // 좌석 판 윗면
      L.set(x, seatY + 1, C.SLATE);    // 좌석 판 앞면
      for (let y = seatY + 2; y < seatY + SEAT_TIER_H; y++) {
        let c = bayer(x, y) < 5 ? C.CHARCOAL : C.SLATE; // 계단 앞면 질감
        if (x % 32 === 31) c = C.CHARCOAL;              // 받침 기둥
        L.set(x, y, c);
      }
    }
  }
  // 맨 아래 (운동장 레이어에 가려지지만 빈틈 없게)
  for (let y = SEAT_FIRST_Y + SEAT_TIERS * SEAT_TIER_H; y < h; y++) {
    for (let x = 0; x < w; x++) L.set(x, y, C.CHARCOAL);
  }
  // 4) 천막 지붕 + 처마 + 기둥 + 꼭대기 깃발
  tents.forEach((x0, ti) => {
    const col = TENT_COLORS[ti % TENT_COLORS.length];
    const stripe = (x) => ((((x - x0) >> 3) & 1) ? C.WHITE : col);
    // 지붕 (사다리꼴, 줄무늬)
    for (let y = TENT_ROOF_TOP; y <= TENT_ROOF_BOTTOM; y++) {
      const inset = Math.round((TENT_ROOF_BOTTOM - y) * 0.7);
      const xa = x0 + inset, xb = x0 + TENT_W - 1 - inset;
      for (let x = xa; x <= xb; x++) {
        const edge = y === TENT_ROOF_TOP || x === xa || x === xb;
        L.set(x, y, edge ? C.CHARCOAL : stripe(x));
      }
    }
    // 처마 경계선
    for (let x = x0; x < x0 + TENT_W; x++) L.set(x, TENT_ROOF_BOTTOM + 1, C.CHARCOAL);
    // 처마 (아래가 물결 모양)
    for (let y = TENT_ROOF_BOTTOM + 2; y <= TENT_ROOF_BOTTOM + 5; y++) {
      for (let x = x0; x < x0 + TENT_W; x++) {
        const m = (x - x0) & 7;
        if (y === TENT_ROOF_BOTTOM + 4 && (m === 0 || m === 7)) continue;
        if (y === TENT_ROOF_BOTTOM + 5 && (m < 2 || m > 5)) continue;
        L.set(x, y, stripe(x));
      }
    }
    // 기둥 2개
    for (const px of [x0 + 2, x0 + TENT_W - 4]) {
      for (let y = TENT_ROOF_BOTTOM + 2; y < h; y++) {
        L.set(px, y, C.SILVER);
        L.set(px + 1, y, C.SLATE);
      }
    }
    // 꼭대기 작은 깃발
    const fx = x0 + (TENT_W >> 1);
    for (let y = TENT_ROOF_TOP - 6; y < TENT_ROOF_TOP; y++) L.set(fx, y, C.SLATE);
    L.rect(fx + 1, TENT_ROOF_TOP - 6, 4, 2, col);
    L.set(fx + 1, TENT_ROOF_TOP - 4, col);
    L.set(fx + 2, TENT_ROOF_TOP - 4, col);
  });
  return { layer: L, tents };
}

/** 줄의 처짐 곡선 y (포물선) */
function stringY(x, xa, xb, ya, sag) {
  const t = (x - xa) / (xb - xa);
  return Math.round(ya + sag * 4 * t * (1 - t));
}

/** 관중석 앞쪽: 가로등, 울타리, 만국기 기둥·줄, 현수막. 깃발 위치 목록도 돌려준다 */
function buildStandsFront(w, h, centerLX) {
  const L = new IndexLayer(w, h);
  const flags = [];

  // 1) 가로등 기둥 + 머리
  for (const lx of LAMP_XS) {
    for (let y = LAMP_HEAD_Y + 5; y < h; y++) {
      L.set(lx, y, C.SLATE);
      L.set(lx + 1, y, C.CHARCOAL);
    }
    L.rect(lx - 1, FENCE_Y + 3, 4, h - FENCE_Y - 3, C.CHARCOAL); // 받침
    L.rect(lx - 1, LAMP_HEAD_Y, 4, 1, C.SLATE);                 // 갓 윗부분
    L.rect(lx - 2, LAMP_HEAD_Y + 1, 6, 2, C.CHARCOAL);          // 갓
    L.rect(lx - 1, LAMP_HEAD_Y + 3, 4, 1, C.SILVER);            // 전구 (낮엔 꺼짐)
    L.rect(lx, LAMP_HEAD_Y + 4, 2, 1, C.CHARCOAL);              // 목
  }

  // 2) 울타리 (흰 나무 울타리)
  for (let x = 0; x < w; x++) {
    L.set(x, FENCE_Y + 1, C.WHITE);
    L.set(x, FENCE_Y + 2, C.SILVER);
    L.set(x, FENCE_Y + 4, C.WHITE);
    L.set(x, FENCE_Y + 5, C.SILVER);
    if (x % 6 === 0) {
      for (let y = FENCE_Y; y < h; y++) L.set(x, y, C.WHITE);
      for (let y = FENCE_Y + 1; y < h; y++) L.set(x + 1, y, C.SILVER);
    }
  }

  // 3) 만국기 기둥 + 줄 (구간마다 줄 2가닥)
  for (const px of BUNTING_POLES) {
    for (let y = BUNTING_POLE_TOP; y < h; y++) {
      L.set(px, y, C.SILVER);
      L.set(px + 1, y, C.SLATE);
    }
    L.rect(px, BUNTING_POLE_TOP - 2, 2, 2, C.YELLOW); // 꼭대기 공
  }
  let colorK = 0;
  for (let i = 0; i + 1 < BUNTING_POLES.length; i++) {
    const xa = BUNTING_POLES[i] + 1;
    const xb = BUNTING_POLES[i + 1];
    const span = xb - xa;
    const strings = [
      { ya: BUNTING_POLE_TOP + 2, sag: Math.round(span * 0.07) },
      { ya: BUNTING_POLE_TOP + 8, sag: Math.round(span * 0.1) },
    ];
    strings.forEach((s, si) => {
      let prev = null;
      for (let x = xa + 1; x < xb; x++) {
        const y = stringY(x, xa, xb, s.ya, s.sag);
        // 끊김 없이 이어지도록 세로 빈칸 메우기
        if (prev !== null && Math.abs(y - prev) > 1) {
          const step = y > prev ? 1 : -1;
          for (let yy = prev + step; yy !== y; yy += step) L.set(x, yy, C.SLATE);
        }
        L.set(x, y, C.SLATE);
        prev = y;
        // 깃발 매다는 위치
        const off = x - xa - 3 - si * 3;
        if (off >= 0 && off % BUNTING_FLAG_STEP === 0 && x + 5 < xb) {
          flags.push({ x, y: y + 1, c: BUNTING_COLORS[colorK++ % BUNTING_COLORS.length] });
        }
      }
    });
  }

  // 4) 현수막 (가운데 천막 처마에 매달림) — 줄다리기 문양
  const bx = centerLX - (BANNER_W >> 1);
  const by = BANNER_Y;
  L.rect(bx, by, BANNER_W, BANNER_H, C.CHARCOAL);              // 외곽선
  L.rect(bx + 1, by + 1, BANNER_W - 2, BANNER_H - 2, C.WHITE); // 천
  for (let x = bx + 1; x < bx + BANNER_W - 1; x++) {
    const left = x < centerLX;
    L.set(x, by + 1, left ? C.RED : C.BLUE);                    // 위 테두리
    L.set(x, by + BANNER_H - 2, left ? C.RED : C.BLUE);         // 아래 테두리
    if (((x - bx) & 3) === 0) L.set(x, by + BANNER_H - 1, C.SILVER); // 아래 술 장식
  }
  const ry = by + 4;
  for (let x = centerLX - 22; x < centerLX + 22; x++) {
    // 꼬인 밧줄 무늬
    const tw = (x >> 1) & 1;
    L.set(x, ry, tw ? C.ORANGE : C.PLUM);
    L.set(x, ry + 1, tw ? C.PLUM : C.ORANGE);
  }
  // 가운데 리본
  for (let y = by + 2; y <= by + 7; y++) {
    L.set(centerLX - 1, y, C.ORANGE);
    L.set(centerLX, y, C.YELLOW);
    L.set(centerLX + 1, y, C.ORANGE);
  }
  // 양 끝 삼각형 (왼쪽 빨강, 오른쪽 파랑)
  const tri = [1, 2, 3, 2, 1];
  tri.forEach((wdt, k) => {
    for (let j = 0; j < wdt; j++) {
      L.set(centerLX - 24 - j, by + 2 + k, C.RED);
      L.set(centerLX + 23 + j, by + 2 + k, C.BLUE);
    }
  });
  // 양 끝 작은 별 장식 (십자)
  for (const sx of [centerLX - 28, centerLX + 27]) {
    const sy = by + 4;
    L.set(sx, sy, C.ORANGE);
    L.set(sx - 1, sy, C.YELLOW);
    L.set(sx + 1, sy, C.YELLOW);
    L.set(sx, sy - 1, C.YELLOW);
    L.set(sx, sy + 1, C.YELLOW);
  }
  return { layer: L, flags };
}

/** 만국기 2프레임 인덱스 버퍼 (펄럭임) */
function buildFlagLayers(w, flags) {
  const frames = [new IndexLayer(w, FLAG_LAYER_H), new IndexLayer(w, FLAG_LAYER_H)];
  flags.forEach((f, i) => {
    for (let fr = 0; fr < 2; fr++) {
      const L = frames[fr];
      // 이웃 깃발끼리 반대 프레임 → 물결처럼 펄럭임
      const pose = (fr + i) & 1;
      const x = f.x, y = f.y;
      if (pose === 0) {
        // 똑바로 늘어진 삼각형
        for (let j = 0; j < 5; j++) L.set(x + j, y, f.c);
        for (let j = 1; j < 4; j++) L.set(x + j, y + 1, f.c);
        L.set(x + 2, y + 2, f.c);
      } else {
        // 바람에 끝이 옆으로 날린 삼각형
        for (let j = 0; j < 5; j++) L.set(x + j, y, f.c);
        for (let j = 2; j < 5; j++) L.set(x + j, y + 1, f.c);
        L.set(x + 4, y + 2, f.c);
      }
    }
  });
  return frames;
}

/**
 * 흙 픽셀 하나 (타일 안 좌표 lx, ly / 지면 윗선에서 dy 행 아래 / 변형 v).
 * 잔디 바로 아래 3행은 그림자 디더, 그 아래는 2×2 얼룩 + 갈퀴 자국.
 */
function dirtPixel(lx, ly, dy, v) {
  if (dy === 0) return bayer(lx, ly) < 12 ? C.ORANGE : C.YELLOW;   // 잔디 아래 그림자 디더
  if (dy === 1) return bayer(lx, ly) < 6 ? C.ORANGE : C.YELLOW;
  if (dy === 2) return bayer(lx, ly) < 2 ? C.ORANGE : C.YELLOW;
  let c = C.YELLOW;
  // 2×2 칸 단위 얼룩 + 디더 얼룩 (타일 안 좌표 + 변형 시드 → 타일마다 같은 무늬를 재사용)
  const n = hash2(lx >> 1, ly >> 1, 5 + v * 17);
  if (n < 0.08) c = C.ORANGE;
  else if (n < 0.16 && bayer(lx, ly) < 8) c = C.ORANGE;
  // 가로 결 (갈퀴 자국) — 타일 높이(16)를 나누는 8행 간격이라 타일 경계에서 결이 끊기지 않는다
  if ((ly & 7) === 3 && (lx & 1) && hash2(lx >> 2, ly, 9 + v) < 0.5) c = C.ORANGE;
  return c;
}

/** 16×16 타일 → 인덱스 배열 (255 = 투명). pixel(lx, ly) 가 팔레트 인덱스를 돌려준다 */
function makeTile(pixel) {
  const t = new Uint8Array(TILE * TILE);
  for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) t[ly * TILE + lx] = pixel(lx, ly);
  return t;
}

/**
 * 운동장 타일 세트 (16×16, 팔레트 인덱스).
 * - edge[v]: 지면 윗선에 걸치는 줄 — 위 8행은 풀포기·잔디(위쪽 빈칸은 투명), 아래 8행은 흙
 * - dirt[v]: 흙만
 */
function buildFieldTiles() {
  const edge = [];
  for (let v = 0; v < EDGE_TILE_VARIANTS; v++) {
    edge.push(makeTile((lx, ly) => {
      const groundRow = EDGE_TILE_TOP;            // 이 행부터 흙
      const grassRow = groundRow - GRASS_H;        // 잔디 띠 윗선
      if (ly >= groundRow) return dirtPixel(lx, ly, ly - groundRow, v);
      // 잔디: 윗선에 풀포기 1~2px 솟음
      const r = hash2(lx, 7 + v, 11);
      const tuft = r < 0.18 ? 2 : r < 0.45 ? 1 : 0;
      const top = grassRow - tuft;
      if (ly < top) return TRANSPARENT;
      if (ly === top) return C.LIME;
      if (ly === groundRow - 1 || (ly === groundRow - 2 && bayer(lx, ly) < 8)) return C.TEAL;
      if (hash2(lx, ly, 3 + v * 5) < 0.12) return C.LIME;
      return C.GREEN;
    }));
  }
  const dirt = [];
  for (let v = 0; v < DIRT_TILE_VARIANTS; v++) {
    dirt.push(makeTile((lx, ly) => dirtPixel(lx, ly, TILE, v)));
  }
  return { edge, dirt };
}

/** 타일 하나를 레이어의 (x0, y0) 에 찍는다 (투명 픽셀은 건너뜀) */
function stampTile(L, tile, x0, y0) {
  for (let ly = 0; ly < TILE; ly++) {
    for (let lx = 0; lx < TILE; lx++) {
      const c = tile[ly * TILE + lx];
      if (c !== TRANSPARENT) L.set(x0 + lx, y0 + ly, c);
    }
  }
}

/**
 * 운동장: 16×16 타일 격자(잔디 가장자리 줄 + 흙 줄) 위에
 * 조약돌·중앙 점선·진흙 웅덩이를 덧그린다.
 */
function buildField(w, h, centerLX, groundTop, puddleY) {
  const L = new IndexLayer(w, h);
  const tiles = buildFieldTiles();
  // 타일 격자: 첫 줄(가장자리 타일)이 지면 윗선에 걸치도록 y 원점을 잡는다
  const gridTop = groundTop - EDGE_TILE_TOP;
  const cols = Math.ceil(w / TILE);
  for (let ty = 0; gridTop + ty * TILE < h; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      // 결정적 변형 선택 (같은 무늬가 줄지어 반복되지 않게)
      const set = ty === 0 ? tiles.edge : tiles.dirt;
      const v = Math.floor(hash2(tx, ty, 13) * set.length) % set.length;
      stampTile(L, set[v], tx * TILE, gridTop + ty * TILE);
    }
  }
  // 조약돌 (RED 점 + 위에 WHITE 반짝)
  const rng = seededRng(42);
  for (let k = 0; k < PEBBLE_COUNT; k++) {
    const x = (rng() * w) | 0;
    const y = groundTop + 4 + ((rng() * (h - groundTop - 5)) | 0);
    L.set(x, y, C.RED);
    if (rng() < 0.5) L.set(x + 1, y, C.ORANGE);
    L.set(x, y - 1, C.WHITE);
  }
  // 흰 중앙 점선 (2px 폭)
  for (let y = groundTop + 1; y < h; y++) {
    if ((y - groundTop - 1) % 7 < 4) {
      L.set(centerLX - 1, y, C.WHITE);
      L.set(centerLX, y, C.WHITE);
    }
  }
  // 진흙 웅덩이 (불규칙한 덩어리)
  const colNoise = (dx) => hash2((dx + 64) >> 2, 3, 77) - 0.5; // 4px 단위 울퉁불퉁
  for (let dy = -PUDDLE_RY - 3; dy <= PUDDLE_RY + 3; dy++) {
    for (let dx = -PUDDLE_RX - 5; dx <= PUDDLE_RX + 5; dx++) {
      const e = ((dx * dx) / (PUDDLE_RX * PUDDLE_RX) + (dy * dy) / (PUDDLE_RY * PUDDLE_RY)) * (1 + colNoise(dx) * 0.45);
      const x = centerLX + dx, y = puddleY + dy;
      if (e <= 0.7) L.set(x, y, C.CHARCOAL);                             // 진흙 속
      else if (e <= 1) L.set(x, y, C.PLUM);                               // 젖은 가장자리
      else if (e <= 1.6 && bayer(x, y) < 8) L.set(x, y, C.ORANGE);        // 젖은 흙 디더
    }
  }
  // 물기 하이라이트 + 튄 진흙
  L.set(centerLX - 9, puddleY - 1, C.WHITE);
  L.set(centerLX - 8, puddleY - 1, C.WHITE);
  L.set(centerLX - 6, puddleY - 1, C.SILVER);
  L.set(centerLX + 6, puddleY + 1, C.SILVER);
  L.set(centerLX + 7, puddleY + 1, C.WHITE);
  L.set(centerLX - 2, puddleY - 2, C.PLUM);
  const splats = [[-24, -1], [-23, -1], [22, 2], [25, 0], [-20, 3], [19, -3], [20, -3], [-27, 2]];
  for (const [dx, dy] of splats) L.set(centerLX + dx, puddleY + dy, C.PLUM);
  return L;
}

/** 인덱스 버퍼 → 시간대 색 캔버스 (dim 이면 밤 어둡기 디더) */
function layerToCanvas(doc, L, tod, dim, remap = null) {
  const canvas = doc.createElement('canvas');
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(L.w, L.h);
  const d = img.data;
  const rgb = [];
  const rgbDim = [];
  for (let i = 0; i < 16; i++) {
    const s = remap && Object.prototype.hasOwnProperty.call(remap, i) ? remap[i] : swapIndex(i, tod);
    rgb[i] = hexToRgb(PALETTE[s]);
    rgbDim[i] = hexToRgb(PALETTE[DIM[s]]);
  }
  const src = L.data;
  for (let y = 0; y < L.h; y++) {
    for (let x = 0; x < L.w; x++) {
      const p = y * L.w + x;
      const idx = src[p];
      if (idx === TRANSPARENT) continue;
      const c = dim && bayer(x, y) < NIGHT_DIM_LEVEL ? rgbDim[idx] : rgb[idx];
      const o = p * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// =============================================================

export class Background {
  constructor(config) {
    this.config = config;
    const lay = (config && config.LAYOUT) || {};
    this.W = (config && config.WIDTH) || 320;
    this.H = (config && config.HEIGHT) || 180;
    this.centerX = lay.CENTER_X ?? 160;
    this.groundY = lay.GROUND_Y ?? 132;
    this.winDistance = (config && config.WIN_DISTANCE) ?? 48;
    this.groundTop = this.groundY - 14;      // 지면 윗선 ≈ 118
    this.puddleY = this.groundY + 3;          // 웅덩이 중심 y
    this.LW = this.W + PAD * 2;               // 레이어 폭
    this.centerLX = PAD + this.centerX;       // 레이어 좌표의 화면 중앙

    // ---- 정적 인덱스 버퍼 (낮 색) — 한 번만 만든다 ----
    this._idx = {
      sky: buildSky(this.LW, this.H),
      hills: buildHills(this.LW, this.H),
    };
    const back = buildStandsBack(this.LW, this.H, this.centerLX);
    this._idx.standsBack = back.layer;
    const front = buildStandsFront(this.LW, this.H, this.centerLX);
    this._idx.standsFront = front.layer;
    this._idx.flags = buildFlagLayers(this.LW, front.flags);
    this._idx.field = buildField(this.LW, this.H, this.centerLX, this.groundTop, this.puddleY);

    // ---- 움직이는 요소 데이터 ----
    this._clouds = this._makeClouds();
    this._stars = this._makeStars();
    this._crowd = this._makeCrowd(back.tents);
    this._lampGlow = this._makeLampGlow();

    // ---- 상태 ----
    this._cache = new Map();      // tod → { sky, hills, standsBack, standsFront, flags[2], field }
    this.timeOfDay = 'day';
    this._lut = makeLut('day');
    this._excite = 0;
    this._exciteTarget = 0;
    this._time = 0;
    this._flapT = 0;
    this._flagFrame = 0;
    this._glowFrame = 0;
  }

  /** 관중 흥분도 (0..1) */
  get excitement() {
    return this._exciteTarget;
  }

  setExcitement(v) {
    const n = Number(v);
    this._exciteTarget = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  /** 시간대 변경 — 레이어 캔버스를 팔레트 스왑해 만든다 (캐시) */
  setTimeOfDay(tod) {
    const t = tod === 'sunset' || tod === 'night' ? tod : 'day';
    this.timeOfDay = t;
    this._lut = makeLut(t);
    this._ensureLayers(t);
  }

  /** 해당 시간대 캔버스가 없으면 만든다. DOM 이 없으면(Node) null */
  _ensureLayers(tod) {
    if (this._cache.has(tod)) return this._cache.get(tod);
    if (typeof document === 'undefined') return null;
    const doc = document;
    const night = tod === 'night';
    const I = this._idx;
    const layers = {
      sky: layerToCanvas(doc, I.sky, tod, false),
      hills: layerToCanvas(doc, I.hills, tod, false),
      standsBack: layerToCanvas(doc, I.standsBack, tod, night),
      standsFront: layerToCanvas(doc, I.standsFront, tod, false),
      flags: [layerToCanvas(doc, I.flags[0], tod, false), layerToCanvas(doc, I.flags[1], tod, false)],
      field: layerToCanvas(doc, I.field, tod, false, FIELD_REMAP[tod]),
    };
    // 진영 선은 팔레트 스왑 '후'에 고정 팀 색으로 그린다 (팀 색은 절대 바뀌지 않음)
    this._drawTeamLines(layers.field.getContext('2d'));
    this._cache.set(tod, layers);
    return layers;
  }

  /** 운동장 캔버스에 빨강/파랑 진영 선 + 작은 깃발 */
  _drawTeamLines(ctx) {
    const top = this.groundTop;
    for (const side of ['left', 'right']) {
      const dir = side === 'left' ? -1 : 1;
      const lx = this.centerLX + dir * this.winDistance;
      const col = TEAM_COLORS[side];
      // 2px 폭 선 (lx-1, lx)
      ctx.fillStyle = col.main;
      ctx.fillRect(lx - 1, top + 1, 2, this.H - top - 1);
      // 선 위쪽 끝 + 바깥쪽 1px 그림자 (비슷한 색 흙 위에서도 선이 또렷하게)
      ctx.fillStyle = col.shade;
      ctx.fillRect(lx - 1, top + 1, 2, 1);
      ctx.fillRect(side === 'left' ? lx - 2 : lx + 1, top + 1, 1, this.H - top - 1);
      // 깃대 (선 바깥쪽 열)
      const poleX = side === 'left' ? lx - 1 : lx;
      const poleTop = top + 1 - TEAM_FLAG_POLE_H;
      ctx.fillStyle = PALETTE[C.WHITE];
      ctx.fillRect(poleX, poleTop, 1, TEAM_FLAG_POLE_H);
      ctx.fillStyle = PALETTE[C.INK];
      ctx.fillRect(poleX, poleTop - 1, 1, 1);
      // 작은 깃발 (자기 진영 쪽으로 펄럭)
      const fw = 7, fh = 5;
      const fx = side === 'left' ? poleX - fw : poleX + 1;
      ctx.fillStyle = PALETTE[C.INK];                    // 외곽선 (어떤 배경에서도 보이게)
      ctx.fillRect(fx - 1, poleTop - 1, fw + 2, fh + 2);
      ctx.fillStyle = col.main;
      ctx.fillRect(fx, poleTop, fw, fh);
      ctx.fillStyle = col.light;
      ctx.fillRect(side === 'left' ? fx + 2 : fx + 1, poleTop, fw - 3, 1);
      ctx.fillStyle = col.shade;
      ctx.fillRect(fx, poleTop + fh - 1, fw, 1);
      // 깃발 끝 V 홈 (바깥쪽 끝)
      const tipX = side === 'left' ? fx - 1 : fx + fw - 1;
      ctx.clearRect(tipX, poleTop + 1, 2, fh - 2);
      ctx.fillStyle = PALETTE[C.INK];
      ctx.fillRect(side === 'left' ? tipX + 1 : tipX, poleTop + 1, 1, fh - 2);
    }
  }

  // ---------------------------------------------------------- 움직이는 요소 생성

  _makeClouds() {
    const rng = seededRng(101);
    const shapes = [
      [[4, 5, 4], [10, 3, 5], [16, 5, 4]],
      [[4, 4, 4], [9, 2, 4], [14, 4, 3]],
      [[5, 5, 5], [12, 3, 6], [19, 4, 5], [25, 5, 4]],
    ];
    const clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const puffs = shapes[i % shapes.length];
      clouds.push({
        x: (i / CLOUD_COUNT) * this.LW + rng() * 30,
        y: 26 + ((rng() * 22) | 0),
        speed: 2 + rng() * 4,
        ...this._cloudSpans(puffs),
      });
    }
    return clouds;
  }

  /** 구름 모양 → 가로 구간 목록 { dx, dy, w, c } (매 프레임 fillRect 로 그림) */
  _cloudSpans(puffs) {
    let maxX = 0, baseY = 0;
    for (const [px, py, r] of puffs) {
      maxX = Math.max(maxX, px + r + 1);
      baseY = Math.max(baseY, py + r - 1);
    }
    const spans = [];
    for (let y = 0; y <= baseY; y++) {
      let run = null;
      for (let x = 0; x <= maxX; x++) {
        let inside = false;
        for (const [px, py, r] of puffs) {
          const dx = x - px, dy = y - py;
          if (dx * dx + dy * dy <= r * r + r * 0.5) { inside = true; break; }
        }
        const c = inside ? (y >= baseY - 1 ? C.SILVER : C.WHITE) : -1;
        if (run && run.c === c) run.w++;
        else {
          if (run && run.c >= 0) spans.push(run);
          run = { dx: x, dy: y, w: 1, c };
        }
      }
      if (run && run.c >= 0) spans.push(run);
    }
    return { spans, w: maxX + 1 };
  }

  _makeStars() {
    const rng = seededRng(202);
    const stars = [];
    const sunLX = PAD + SUN_X;
    while (stars.length < STAR_COUNT) {
      const x = (rng() * this.LW) | 0;
      const y = 2 + ((rng() * 52) | 0);
      const dx = x - sunLX, dy = y - SUN_Y;
      if (dx * dx + dy * dy < 15 * 15) continue; // 달 근처는 비움
      stars.push({
        x, y,
        phase: rng() * Math.PI * 2,
        speed: 1.5 + rng() * 3,
        big: rng() < 0.25,
        yellow: rng() < 0.2,
      });
    }
    return stars;
  }

  _makeCrowd(tents) {
    const rng = seededRng(303);
    // 천막 기둥 자리는 비운다
    const blocked = [];
    for (const x0 of tents) {
      blocked.push([x0 - 4, x0 + 5], [x0 + TENT_W - 9, x0 + TENT_W]);
    }
    const crowd = [];
    for (let tier = 0; tier < SEAT_TIERS; tier++) {
      const seatY = SEAT_FIRST_Y + tier * SEAT_TIER_H;
      for (let x = 2 + (tier & 1) * 3; x < this.LW - 6; x += CROWD_SPACING) {
        const px = x + ((rng() * 2) | 0);
        if (blocked.some(([a, b]) => px + 6 >= a && px - 1 <= b)) continue;
        if (rng() < CROWD_EMPTY_RATE) continue;
        crowd.push({
          x: px,
          seatY,
          shirt: SHIRT_COLORS[(rng() * SHIRT_COLORS.length) | 0],
          hair: HAIR_COLORS[(rng() * HAIR_COLORS.length) | 0],
          phase: rng() * Math.PI * 2,
          speed: 0.8 + rng() * 0.5,
          k: rng(),                        // 흥분 참여 순서 (작을수록 먼저 들썩)
          flag: rng() < 0.15 ? BUNTING_COLORS[(rng() * BUNTING_COLORS.length) | 0] : -1,
        });
      }
    }
    return crowd;
  }

  /** 가로등 불빛 디더 픽셀 (2프레임: 기본/살짝 작게) */
  _makeLampGlow() {
    const frames = [[], []];
    for (let fr = 0; fr < 2; fr++) {
      const R = LAMP_GLOW_R - fr;
      for (const lx of LAMP_XS) {
        const cx = lx + 0.5;
        const cy = LAMP_HEAD_Y + 4;
        for (let y = cy - R; y <= cy + R; y++) {
          for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
            // 갓·기둥 위에는 찍지 않음
            if (y >= LAMP_HEAD_Y - 1 && y <= LAMP_HEAD_Y + 4 && x >= lx - 2 && x <= lx + 3) continue;
            if (y > LAMP_HEAD_Y + 4 && (x === lx || x === lx + 1)) continue;
            const dx = x + 0.5 - cx, dy = (y - cy) * 1.15;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > R) continue;
            const level = d < R * 0.4 ? 7 : d < R * 0.7 ? 4 : 2;
            if (bayer(x, y) < level) frames[fr].push(x, y);
          }
        }
      }
    }
    return frames;
  }

  // ---------------------------------------------------------- 진행

  update(dt) {
    this._time += dt;
    // 흥분도는 부드럽게 따라감
    this._excite += (this._exciteTarget - this._excite) * Math.min(1, dt * EXCITE_SMOOTH);
    // 구름 이동 (레이어 폭 안에서 순환)
    for (const c of this._clouds) {
      c.x += c.speed * dt;
      if (c.x > this.LW) c.x -= this.LW + c.w;
    }
    // 만국기 펄럭임 (흥분하면 빨라짐)
    this._flapT += dt * (FLAG_FLAP_RATE + this._excite * 5);
    this._flagFrame = Math.floor(this._flapT) & 1;
    // 가로등 불빛 미세한 깜빡임 (가끔 한 프레임 작아짐)
    const tick = Math.floor(this._time * 6);
    this._glowFrame = hash2(tick, 1, 9) < 0.15 ? 1 : 0;
  }

  // ---------------------------------------------------------- 그리기

  render(g, camX = 0) {
    const tod = this.timeOfDay;
    const L = this._ensureLayers(tod);
    if (!L) return;
    const cam = Math.round(camX) | 0;
    const skyX = -PAD - Math.round(cam * PARALLAX_SKY);
    const standX = -PAD - Math.round(cam * PARALLAX_STANDS);
    const fieldX = -PAD - cam;
    const night = tod === 'night';

    // 1) 하늘 (+별 +구름) → 먼 산
    g.drawImage(L.sky, skyX, 0);
    if (night) this._drawStars(g, skyX);
    this._drawClouds(g, skyX);
    g.drawImage(L.hills, skyX, 0);

    // 2) 관중석: 뒤 구조물 → 관중 → 앞 구조물 → 만국기 → 밤 불빛
    g.drawImage(L.standsBack, standX, 0);
    this._drawCrowd(g, standX);
    g.drawImage(L.standsFront, standX, 0);
    g.drawImage(L.flags[this._flagFrame], standX, 0);
    if (night) this._drawLamps(g, standX);

    // 3) 운동장 (월드 정렬: 월드 x → 화면 x - camX)
    g.drawImage(L.field, fieldX, 0);
  }

  _drawStars(g, ox) {
    const lut = this._lut;
    const core = lut[C.WHITE];
    const arm = lut[C.SILVER];
    const yellow = lut[C.YELLOW];
    const t = this._time;
    for (const s of this._stars) {
      const sx = ox + s.x;
      if (sx < -2 || sx > this.W + 2) continue;
      const v = Math.sin(t * s.speed + s.phase);
      if (v < -0.35) continue; // 잠깐 꺼짐 → 반짝반짝
      g.fillStyle = s.yellow ? yellow : core;
      g.fillRect(sx, s.y, 1, 1);
      if (s.big && v > 0.7) {
        g.fillStyle = arm;
        g.fillRect(sx - 1, s.y, 1, 1);
        g.fillRect(sx + 1, s.y, 1, 1);
        g.fillRect(sx, s.y - 1, 1, 1);
        g.fillRect(sx, s.y + 1, 1, 1);
      }
    }
  }

  _drawClouds(g, ox) {
    const lut = this._lut;
    for (const c of this._clouds) {
      const cx = ox + Math.round(c.x);
      if (cx > this.W || cx + c.w < 0) continue;
      for (const s of c.spans) {
        g.fillStyle = lut[s.c];
        g.fillRect(cx + s.dx, c.y + s.dy, s.w, 1);
      }
    }
  }

  _drawCrowd(g, ox) {
    const lut = this._lut;
    const skin = lut[C.YELLOW];
    const e = this._excite;
    const t = this._time;
    const W = this.W;
    for (const s of this._crowd) {
      const sx = ox + s.x;
      if (sx < -8 || sx > W + 2) continue;
      // 들썩임: 흥분도가 높을수록 더 많은 사람이, 더 빠르고 높게
      let bob = 0;
      let arms = false;
      if (s.k < 0.12 + 0.88 * e) {
        const v = Math.sin(t * (3 + 8 * e) * s.speed + s.phase);
        if (v > 0.15) {
          bob = e > 0.6 && v > 0.7 ? 2 : 1;
          arms = e > 0.35;
        }
      } else if (Math.sin(t * 1.2 * s.speed + s.phase) > 0.93) {
        bob = 1; // 평소엔 가끔 꿈틀
      }
      const top = s.seatY - 4 - bob; // 몸통 윗변
      // 몸통 (일어서면 아래로 늘어나 좌석에 닿게)
      g.fillStyle = lut[s.shirt];
      g.fillRect(sx, top, 5, 4 + bob);
      // 얼굴 + 머리카락
      g.fillStyle = skin;
      g.fillRect(sx + 1, top - 2, 3, 2);
      if (arms) {
        // 만세 팔
        g.fillRect(sx - 1, top - 3, 1, 3);
        g.fillRect(sx + 5, top - 3, 1, 3);
        if (s.flag >= 0) {
          // 손에 든 작은 깃발
          g.fillStyle = lut[C.SLATE];
          g.fillRect(sx + 5, top - 6, 1, 3);
          g.fillStyle = lut[s.flag];
          g.fillRect(sx + 6, top - 6, 3, 2);
        }
      }
      g.fillStyle = lut[s.hair];
      g.fillRect(sx + 1, top - 3, 3, 1);
    }
  }

  _drawLamps(g, ox) {
    // 밤: 전구 켜짐 + 주변 디더 불빛 (YELLOW 는 스왑되지 않는 불빛 색)
    const yellow = this._lut[C.YELLOW];
    const white = this._lut[C.WHITE];
    g.fillStyle = yellow;
    const pts = this._lampGlow[this._glowFrame];
    for (let i = 0; i < pts.length; i += 2) {
      const x = ox + pts[i];
      if (x < 0 || x >= this.W) continue;
      g.fillRect(x, pts[i + 1], 1, 1);
    }
    for (const lx of LAMP_XS) {
      const x = ox + lx;
      if (x < -4 || x > this.W + 4) continue;
      g.fillStyle = yellow;
      g.fillRect(x - 1, LAMP_HEAD_Y + 3, 4, 1);
      g.fillStyle = white;
      g.fillRect(x, LAMP_HEAD_Y + 3, 1, 1);
    }
  }
}
