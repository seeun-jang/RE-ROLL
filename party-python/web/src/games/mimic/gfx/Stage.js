// 고정 무대 배경 (카메라 스크롤 없음).
// 레이어: 뒷벽(16×16 타일 11줄 + 아래 4px 띠) → 조명·관객 실루엣 → 바닥 → 전경 커튼.
// 움직임은 BGM 박자(beat01)에 맞춘 1px뿐이고, 녹음 중에는 setPaused(true)로 멈춘다.
// 어둡게 하기·빛은 반투명 대신 체커보드/성긴 디더(팔레트 색 그대로)로만 표현한다.
import { PAL, C } from '../palette.js';
import { rect, dither } from '../engine/draw.js';
import { VW, VH } from '../config.js';

const TILE = 16;
const TILE_ROWS = 11;                 // 16×16 타일 11줄 = 176px
const WALL_ROWS = 8;                  // 위 8줄은 뒷벽(벽돌 6줄 + 징두리 판넬 2줄)
const WAINSCOT_Y = 6 * TILE;          // 96
const FLOOR_Y = WALL_ROWS * TILE;     // 128 (아래 3줄은 무대 바닥)
const BAND_Y = TILE_ROWS * TILE;      // 176 (아래 4px 단색 띠)

const TRUSS_Y = 12;                   // 조명 트러스
const LIGHT_XS = [72, 116, 160, 204, 248]; // 조명 위치(가운데 x)
const BULB_Y = 29;                    // 전구 줄
const BULB_X0 = 40;
const BULB_X1 = 280;
const BULB_STEP = 8;

// 스포트라이트 원뿔 모양 (씬이 아바타 발 위치를 맞출 때 STAGE.spotFloorY를 쓰면 된다)
const SPOT = { topY: 12, topHalf: 4, floorY: 158, floorHalf: 30, poolRy: 6 };

// 씬에서 배치 기준으로 쓸 수 있는 무대 좌표
export const STAGE = {
  floorY: FLOOR_Y,             // 무대 바닥 시작 y
  bandY: BAND_Y,               // 아래 띠 시작 y
  spotFloorY: SPOT.floorY,     // 스포트라이트 빛 웅덩이 중심 y (아바타 발 위치로 알맞음)
  curtainW: 30,                // 좌우 커튼이 가리는 최대 폭
  valanceH: 11,                // 위 장식 커튼 높이
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// 성긴 디더(12.5%: 4×4 칸에 2픽셀) 패턴. 빛줄기 안개 표현용. 캔버스 원점 기준 정렬.
const _hazeCache = new WeakMap();
function hazePattern(ctx, color) {
  let m = _hazeCache.get(ctx);
  if (!m) { m = new Map(); _hazeCache.set(ctx, m); }
  let p = m.get(color);
  if (!p) {
    const c = makeCanvas(4, 4);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 1, 1);
    g.fillRect(2, 2, 1, 1);
    p = ctx.createPattern(c, 'repeat');
    m.set(color, p);
  }
  return p;
}
function haze(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = hazePattern(ctx, color);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 정수 원(가로줄 단위)
function disc(g, cx, cy, r, color, clipBottom = VH) {
  for (let dy = -r; dy <= r; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= clipBottom) continue;
    const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
    rect(g, cx - hw, yy, hw * 2 + 1, 1, color);
  }
}
// 정수 타원(가로줄 단위)
function oval(g, cx, cy, rx, ry, color, clipBottom = VH) {
  for (let dy = -ry; dy <= ry; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= clipBottom) continue;
    const hw = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)) + 0.5);
    rect(g, cx - hw, yy, hw * 2 + 1, 1, color);
  }
}

// 왼쪽 커튼의 오른쪽 끝 x (이 값 미만이 커튼). 가운데(묶은 끈)에서 잘록하다.
function curtainEdge(y) {
  if (y < 100) return 28 - Math.floor(10 * Math.pow(y / 100, 1.6));
  if (y < 104) return 19;
  return 18 + Math.floor(12 * Math.pow((y - 104) / 75, 0.8));
}
// 커튼 주름 색 (주기 6px): 접힌 골 / 기본 / 빛 받는 면
const FOLD = [5, 7, 8, 8, 7, 7];
// 위 장식 커튼 주름 (주기 5px)
const VAL_FOLD = [7, 7, 8, 7, 5];

export class Stage {
  constructor() {
    this.paused = false;        // true면 박자 움직임 정지 (녹음 중)
    this.reduceMotion = false;  // true면 깜빡임·흔들림 없이 고정 (설정의 흔들림·깜빡임 끄기)
    this.beatCount = 0;         // 지나간 박자 수 (조명 교대 점멸용)
    this.bob = 0;               // 0/1: 박자 앞 절반에 1px 움직임
    this._lastBeat = 0;
    this._bg = null;            // 정적 레이어(뒷벽·바닥·띠·트러스) 미리 그린 캔버스
    this._aud = null;           // 관객 실루엣 [기본, 1px 움직임]
    this._fg = null;            // 전경 커튼 [기본, 1px 흔들림]
  }

  // 박자 위상(0~1)을 받아 1px 움직임 상태를 갱신
  update(dt, beat01 = 0) {
    if (this.paused) return;
    const b = Number.isFinite(beat01) ? Math.min(1, Math.max(0, beat01)) : 0;
    // 위상이 크게 줄었으면 다음 박자로 넘어간 것
    if (b + 0.5 < this._lastBeat) this.beatCount = (this.beatCount + 1) % 4096;
    this._lastBeat = b;
    // 음악이 멈추면 beat01=0 → 움직임 없음
    this.bob = b > 0 && b < 0.5 ? 1 : 0;
  }

  setPaused(b) {
    this.paused = !!b;
  }

  // opts: {dim:false, spotX:null, spotColor:C.spot, still:false}
  draw(ctx, opts = {}) {
    if (typeof document === 'undefined') return;
    this._ensure();
    const dim = !!opts.dim;
    const spotX = opts.spotX == null || !Number.isFinite(opts.spotX) ? null : Math.round(opts.spotX);
    const spotColor = opts.spotColor || C.spot;
    const still = !!opts.still || this.reduceMotion;
    const beat = still ? 0 : this.beatCount;
    const bob = still ? 0 : this.bob;

    ctx.drawImage(this._bg, 0, 0);
    this._drawBulbs(ctx, beat, still);
    this._drawLights(ctx, beat, still, dim);
    ctx.drawImage(this._aud[bob], 0, 0);
    ctx.drawImage(this._fg[bob], 0, 0);
    if (dim) this._drawDim(ctx, spotX);
    if (spotX != null) this._drawSpot(ctx, spotX, spotColor);
  }

  // ── 미리 그리기 ───────────────────────────────────────
  _ensure() {
    if (this._bg) return;
    this._bg = makeCanvas(VW, VH);
    this._paintBackground(this._bg.getContext('2d'));
    this._aud = [0, 1].map((b) => {
      const c = makeCanvas(VW, VH);
      this._paintAudience(c.getContext('2d'), b);
      return c;
    });
    this._fg = [0, 1].map((s) => {
      const c = makeCanvas(VW, VH);
      this._paintCurtains(c.getContext('2d'), s);
      return c;
    });
  }

  // 뒷벽(벽돌 타일 + 징두리 판넬) + 전구 줄 받침 + 트러스·조명 몸체 + 바닥 타일 + 아래 띠
  _paintBackground(g) {
    // 벽돌 타일 (16×16, 6줄)
    for (let ty = 0; ty < WAINSCOT_Y / TILE; ty++) {
      for (let tx = 0; tx < VW / TILE; tx++) this._brickTile(g, tx * TILE, ty * TILE, tx, ty);
    }
    // 징두리 판넬 (2줄 = 32px)
    rect(g, 0, WAINSCOT_Y, VW, 32, PAL[23]);
    rect(g, 0, WAINSCOT_Y, VW, 1, PAL[22]);
    rect(g, 0, WAINSCOT_Y + 1, VW, 1, PAL[21]);
    rect(g, 0, WAINSCOT_Y + 2, VW, 1, PAL[25]);
    for (let px = 0; px < VW; px += 32) {
      // 안으로 들어간 판넬: 위·왼쪽은 그림자, 아래·오른쪽은 하이라이트
      const x0 = px + 4, y0 = WAINSCOT_Y + 6, w = 24, h = 18;
      rect(g, x0, y0, w, 1, PAL[25]);
      rect(g, x0, y0, 1, h, PAL[25]);
      rect(g, x0, y0 + h - 1, w, 1, PAL[22]);
      rect(g, x0 + w - 1, y0, 1, h, PAL[22]);
      dither(g, x0 + 1, y0 + 1, w - 2, h - 2, PAL[24], 0);
    }
    rect(g, 0, FLOOR_Y - 3, VW, 1, PAL[25]);  // 걸레받이
    rect(g, 0, FLOOR_Y - 2, VW, 2, PAL[6]);

    // 전구 줄 받침
    rect(g, BULB_X0 - 4, BULB_Y - 3, BULB_X1 - BULB_X0 + 10, 1, PAL[22]);
    rect(g, BULB_X0 - 4, BULB_Y - 2, BULB_X1 - BULB_X0 + 10, 6, PAL[25]);
    rect(g, BULB_X0 - 4, BULB_Y + 4, BULB_X1 - BULB_X0 + 10, 1, PAL[23]);
    for (let bx = BULB_X0; bx <= BULB_X1; bx += BULB_STEP) rect(g, bx, BULB_Y, 2, 2, PAL[6]);

    // 트러스 (가로 막대 + 격자)
    rect(g, 20, TRUSS_Y, VW - 40, 1, PAL[21]);
    rect(g, 20, TRUSS_Y + 1, VW - 40, 2, PAL[23]);
    rect(g, 20, TRUSS_Y + 3, VW - 40, 1, PAL[25]);
    for (let x = 22; x < VW - 22; x += 4) {
      rect(g, x, TRUSS_Y + 1, 1, 1, PAL[22]);
      rect(g, x + 2, TRUSS_Y + 2, 1, 1, PAL[22]);
    }
    // 조명 몸체
    for (const lx of LIGHT_XS) {
      rect(g, lx - 1, TRUSS_Y + 4, 3, 1, PAL[25]);           // 걸이
      rect(g, lx - 4, TRUSS_Y + 5, 9, 7, PAL[25]);           // 외곽선
      rect(g, lx - 3, TRUSS_Y + 6, 7, 5, PAL[23]);           // 몸통
      rect(g, lx - 3, TRUSS_Y + 6, 7, 1, PAL[22]);           // 위 하이라이트
      rect(g, lx + 2, TRUSS_Y + 7, 1, 4, PAL[24]);           // 오른쪽 그림자
      rect(g, lx - 2, TRUSS_Y + 11, 5, 1, PAL[6]);           // 렌즈(꺼짐)
    }

    // 바닥 타일 (3줄): 나무 판자 8px 간격, 이음매 엇갈림
    rect(g, 0, FLOOR_Y, VW, BAND_Y - FLOOR_Y, PAL[5]);
    for (let py = FLOOR_Y, row = 0; py < BAND_Y; py += 8, row++) {
      rect(g, 0, py, VW, 1, PAL[6]);                         // 판자 사이 골
      dither(g, 0, py + 1, VW, 1, PAL[4], row & 1);          // 판자 윗면 결
      const off = (row % 2) * 20 + (row % 3) * 7;
      for (let jx = off; jx < VW; jx += 40) rect(g, jx, py + 1, 1, 7, PAL[6]); // 이음매
    }
    // 무대 앞쪽 가장자리 (한 줄 어둡게) + 아래 4px 단색 띠
    rect(g, 0, BAND_Y - 1, VW, 1, PAL[6]);
    rect(g, 0, BAND_Y, VW, VH - BAND_Y, C.floorDark);
  }

  // 벽돌 타일 하나: 줄눈(어두운 남보라) + 벽돌 윗면 하이라이트, 몇 개는 디더로 어둡게
  _brickTile(g, ox, oy, tx, ty) {
    rect(g, ox, oy, TILE, TILE, C.wall);
    rect(g, ox, oy, TILE, 1, C.wallDark);
    rect(g, ox, oy + 8, TILE, 1, C.wallDark);
    rect(g, ox, oy + 1, 1, 7, C.wallDark);
    rect(g, ox + 8, oy + 9, 1, 7, C.wallDark);
    rect(g, ox + 1, oy + 1, 6, 1, PAL[23]);
    rect(g, ox + 9, oy + 9, 6, 1, PAL[23]);
    const h = (tx * 7 + ty * 13) % 5;
    if (h === 0) dither(g, ox + 1, oy + 2, 7, 6, C.wallDark, 0);
    else if (h === 3) dither(g, ox + 9, oy + 10, 7, 6, C.wallDark, 1);
  }

  // 관객 실루엣 (화면 아래 앞줄 머리들). b=1이면 엇갈린 머리들이 1px 위로.
  _paintAudience(g, b) {
    const col = C.bgDeep;
    for (let i = 0; i < 14; i++) {
      const cx = 14 + i * 23 + ((i * 7) % 5);
      const r = 6 + (i % 3 === 0 ? 1 : 0);
      const up = (i + b) % 2 === 0 ? 1 : 0;
      const cy = 171 + (i % 2) - up;
      oval(g, cx, VH + 2, 11, 7, col);          // 어깨
      disc(g, cx, cy, r, col);                  // 머리
      if (i % 5 === 2) {
        // 응원봉을 든 관객: 팔 + 빛나는 끝 (박자마다 1px 흔들림)
        const ax = cx + 9 + (b ? 1 : 0);
        rect(g, ax, 160, 2, 12, col);
        rect(g, ax, 157, 2, 3, PAL[11]);
        rect(g, ax, 156, 2, 1, PAL[19]);
      }
    }
  }

  // 좌우 커튼 + 위 장식 커튼. s=1이면 묶은 끈 아래 자락이 1px 흔들림.
  _paintCurtains(g, s) {
    for (let y = 0; y < VH; y++) {
      const sway = y >= 104 ? s : 0;
      const e = curtainEdge(y) + sway;
      for (let x = 0; x < e; x++) {
        let idx;
        if (x === e - 1) idx = 25;            // 외곽선
        else if (x === e - 2) idx = 5;        // 가장자리 그림자
        else idx = FOLD[(x + sway) % FOLD.length];
        rect(g, x, y, 1, 1, PAL[idx]);
        rect(g, VW - 1 - x, y, 1, 1, PAL[idx]);
      }
    }
    // 커튼 묶은 끈 + 술
    const tieRows = [11, 10, 10, 9];
    for (let i = 0; i < 4; i++) {
      const e = curtainEdge(100 + i) + 1;
      rect(g, 0, 100 + i, e, 1, PAL[tieRows[i]]);
      rect(g, VW - e, 100 + i, e, 1, PAL[tieRows[i]]);
      rect(g, e, 100 + i, 1, 1, PAL[25]);
      rect(g, VW - 1 - e, 100 + i, 1, 1, PAL[25]);
    }
    const tx = curtainEdge(102) - 1 + s;
    rect(g, tx - 1, 104, 4, 6, PAL[25]);
    rect(g, tx, 104, 2, 5, PAL[10]);
    rect(g, VW - tx - 3, 104, 4, 6, PAL[25]);
    rect(g, VW - tx - 2, 104, 2, 5, PAL[10]);

    // 위 장식 커튼: 반원 물결 끝단 + 금색 술 장식
    for (let x = 0; x < VW; x++) {
      const b = 7 + Math.round(3 * Math.sin((Math.PI * (x % 20)) / 20));
      rect(g, x, 0, 1, 1, PAL[25]);
      rect(g, x, 1, 1, b - 1, PAL[VAL_FOLD[x % VAL_FOLD.length]]);
      rect(g, x, b, 1, 1, PAL[10]);
      rect(g, x, b + 1, 1, 1, PAL[25]);
    }
  }

  // ── 매 프레임 그리는 동적 요소 ─────────────────────────
  // 전구 줄: 박자마다 홀짝 전구가 번갈아 켜짐
  _drawBulbs(ctx, beat, still) {
    let k = 0;
    for (let bx = BULB_X0; bx <= BULB_X1; bx += BULB_STEP, k++) {
      const on = still ? k % 2 === 0 : (k + beat) % 2 === 0;
      if (on) {
        rect(ctx, bx, BULB_Y, 2, 2, PAL[11]);
        rect(ctx, bx, BULB_Y, 1, 1, PAL[19]);
      }
    }
  }

  // 트러스 조명 렌즈 + (어둡게 하지 않을 때) 짧은 빛줄기
  _drawLights(ctx, beat, still, dim) {
    LIGHT_XS.forEach((lx, i) => {
      const on = still ? true : (i + beat) % 2 === 0;
      if (!on) return;
      const ly = TRUSS_Y + 11;
      rect(ctx, lx - 2, ly, 5, 1, PAL[11]);
      rect(ctx, lx - 1, ly, 3, 1, PAL[19]);
      if (dim) return;
      for (let y = ly + 1; y < ly + 18; y++) {
        const hw = 2 + Math.floor((y - ly) / 3);
        haze(ctx, lx - hw, y, hw * 2 + 1, 1, PAL[11]);
      }
    });
  }

  // 스포트라이트가 비추는 가로 구간 [x0, x1] (없으면 null)
  _spotSpan(y, sx) {
    if (y >= SPOT.topY && y <= SPOT.floorY) {
      const t = (y - SPOT.topY) / (SPOT.floorY - SPOT.topY);
      const hw = Math.round(SPOT.topHalf + (SPOT.floorHalf - SPOT.topHalf) * t);
      return [sx - hw, sx + hw];
    }
    const dy = y - SPOT.floorY;
    if (dy > 0 && dy <= SPOT.poolRy) {
      const hw = Math.floor(SPOT.floorHalf * Math.sqrt(1 - (dy * dy) / (SPOT.poolRy * SPOT.poolRy)) + 0.5);
      return [sx - hw, sx + hw];
    }
    return null;
  }

  // 한 단계 어둡게: 가장 어두운 색 체커보드를 덮되, 스포트라이트 구간은 남긴다
  _drawDim(ctx, spotX) {
    if (spotX == null) {
      dither(ctx, 0, 0, VW, VH, C.bgDeep, 0);
      return;
    }
    for (let y = 0; y < VH; y++) {
      const sp = this._spotSpan(y, spotX);
      if (!sp) { dither(ctx, 0, y, VW, 1, C.bgDeep, 0); continue; }
      const [x0, x1] = sp;
      if (x0 > 0) dither(ctx, 0, y, Math.min(VW, x0), 1, C.bgDeep, 0);
      if (x1 < VW - 1) dither(ctx, Math.max(0, x1 + 1), y, VW - Math.max(0, x1 + 1), 1, C.bgDeep, 0);
    }
  }

  // 스포트라이트: 성긴 디더 원뿔 + 점선 가장자리 + 바닥 빛 웅덩이(체커보드)
  _drawSpot(ctx, sx, color) {
    for (let y = SPOT.topY; y <= SPOT.floorY; y++) {
      const [x0, x1] = this._spotSpan(y, sx);
      haze(ctx, x0 + 1, y, x1 - x0 - 1, 1, color);
      if (y % 2 === 0) {
        rect(ctx, x0, y, 1, 1, color);
        rect(ctx, x1, y, 1, 1, color);
      }
    }
    for (let dy = -SPOT.poolRy; dy <= SPOT.poolRy; dy++) {
      const hw = Math.floor(SPOT.floorHalf * Math.sqrt(1 - (dy * dy) / (SPOT.poolRy * SPOT.poolRy)) + 0.5);
      dither(ctx, sx - hw, SPOT.floorY + dy, hw * 2 + 1, 1, color, 1);
    }
  }
}
