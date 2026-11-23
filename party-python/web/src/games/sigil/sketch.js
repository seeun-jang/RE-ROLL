// =====================================================
// 종이 + 붓 + 채점 — 원본 js/sketch.js
//  - Paper: 120x120 양피지에 그린 선 (잉크 칸도 따로 기억 → 채점)
//  - scoreDrawing: 모양을 얼마나 덮었나(덮기) × 얼마나 안 벗어났나(깔끔)
// 실제 점수는 서버가 같은 계산으로 매긴다. 화면에서는 그리는 중 '마력 게이지'(예측)에만 쓴다.
// =====================================================
import { CONFIG } from './config.js';
import { prepareShape } from './shapes.js';

export class Paper {
  /** withCanvas = false 면 그림 없이 잉크 칸만 기억한다(시험용 진행기 · Node) */
  constructor(withCanvas = true) {
    const S = CONFIG.CANVAS;
    this.canvas = null;
    this.g = null;
    if (withCanvas && typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = S;
      this.canvas.height = S;
      this.g = this.canvas.getContext('2d');
    }
    this.ink = new Uint8Array(S * S);
    this.inkCount = 0;
    this.last = null;
  }

  // 붓 한 칸 찍기 (BRUSH x BRUSH 네모)
  dot(x, y, color) {
    const S = CONFIG.CANVAS;
    const b = CONFIG.BRUSH;
    if (this.g) {
      this.g.fillStyle = color;
      this.g.fillRect(x, y, b, b);
    }
    for (let dy = 0; dy < b; dy++) {
      for (let dx = 0; dx < b; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
        const i = Y * S + X;
        if (!this.ink[i]) {
          this.ink[i] = 1;
          this.inkCount++;
        }
      }
    }
  }

  // (x0,y0)→(x1,y1) 선 (정수 좌표, 안티앨리어싱 없음)
  line(x0, y0, x1, y1, color) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.dot(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // 붓 이어 그리기 (누르고 있는 동안 매 프레임 호출, 떼면 end)
  stroke(x, y, color) {
    if (this.last) this.line(this.last.x, this.last.y, x, y, color);
    else this.dot(Math.round(x), Math.round(y), color);
    this.last = { x, y };
  }

  end() {
    this.last = null;
  }

  /** 잉크 칸을 1칸 = 1비트로 묶어 base64 로 (서버가 갤러리용으로 보내는 것과 같은 형식) */
  bits() {
    const out = new Uint8Array((this.ink.length + 7) >> 3);
    for (let i = 0; i < this.ink.length; i++) if (this.ink[i]) out[i >> 3] |= 0x80 >> (i & 7);
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  }
}

/** base64 비트 묶음 → 잉크 칸 배열 (깨진 데이터면 빈 종이) */
export function bitsToInk(b64) {
  const S = CONFIG.CANVAS;
  const ink = new Uint8Array(S * S);
  try {
    const bin = atob(b64);
    for (let i = 0; i < ink.length && (i >> 3) < bin.length; i++) ink[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  } catch (e) { /* 빈 종이 */ }
  return ink;
}

/**
 * 잉크 칸 배열 → 종이(Paper). 서버가 보내 준 그림(갤러리 · 재접속)을 다시 그릴 때 쓴다.
 * 선 위(모양에서 NEAT_RADIUS 칸 이내)는 onColor, 벗어난 칸은 offColor.
 */
export function paperFromInk(ink, shape, onColor, offColor) {
  const S = CONFIG.CANVAS;
  const paper = new Paper();
  const dist = prepareShape(shape).dist;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    paper.ink[i] = 1;
    paper.inkCount++;
    if (paper.g) {
      paper.g.fillStyle = dist[i] <= CONFIG.SCORE.NEAT_RADIUS ? onColor : offColor;
      paper.g.fillRect(i % S, (i / S) | 0, 1, 1);
    }
  }
  return paper;
}

// 채점 → { accuracy(0~100), cover(0~1), neat(0~1) }
export function scoreDrawing(paper, shape) {
  const S = CONFIG.CANVAS;
  const R = CONFIG.SCORE;
  const { path, dist } = prepareShape(shape);
  if (!paper.inkCount) return { accuracy: 0, cover: 0, neat: 0 };
  // 덮기: 모양 선의 점마다 근처에 잉크가 있나
  let covered = 0;
  for (const [px, py] of path) {
    const x = Math.round(px);
    const y = Math.round(py);
    let hit = false;
    for (let dy = -R.COVER_RADIUS; dy <= R.COVER_RADIUS && !hit; dy++) {
      for (let dx = -R.COVER_RADIUS; dx <= R.COVER_RADIUS; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X >= 0 && Y >= 0 && X < S && Y < S && paper.ink[Y * S + X]) {
          hit = true;
          break;
        }
      }
    }
    if (hit) covered++;
  }
  // 깔끔: 잉크 칸 중 모양 선 가까이에 있는 비율
  let near = 0;
  for (let i = 0; i < S * S; i++) if (paper.ink[i] && dist[i] <= R.NEAT_RADIUS) near++;
  const cover = covered / path.length;
  const neat = near / paper.inkCount;
  return { accuracy: Math.round(100 * cover * (0.4 + 0.6 * neat)), cover, neat };
}

// 자동으로 그리는 손 (시험용 봇): 모양을 따라가며 손떨림
export class AutoDrawer {
  constructor(shape, skill, rng = Math.random) {
    this.path = prepareShape(shape).path;
    this.skill = skill;
    this.rng = rng;
    this.i = 0;
    this.wob = 0;
  }

  // 이번 프레임의 펜 위치 (null 이면 다 그림)
  next() {
    if (this.i >= this.path.length) return null;
    this.i += 2.2 + this.skill;
    const p = this.path[Math.min(this.path.length - 1, Math.floor(this.i))];
    this.wob += (this.rng() - 0.5) * (1 - this.skill) * 5;
    this.wob *= 0.93;
    return { x: p[0] + this.wob + (this.rng() - 0.5) * (1 - this.skill) * 3, y: p[1] + this.wob };
  }
}
