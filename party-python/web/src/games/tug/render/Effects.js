// =============================================================
// Effects — 화면 흔들림, 히트 스톱, 플래시, 화면 전환
// 반투명 대신 Bayer 4×4 디더 패턴으로 '사라짐/덮임' 을 표현한다.
// =============================================================
import { PALETTE, C } from '../palette.js';

const INK = PALETTE[C.INK];

// Bayer 4×4 순서 디더 행렬 (0..15)
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

const FADE_CELL = 2;            // 픽셀 페이드의 디더 칸 크기 (px) — 굵은 픽셀 느낌
const WIPE_ROW = 2;             // 원형 와이프를 그리는 행 단위 (px) — 2px 계단 원
const COVER_BOOST = 1.12;       // 전환이 중간 지점보다 살짝 먼저 꽉 차도록 (onMid 때 확실히 가려져 있게)
const DEFAULT_FLASH_TIME = 0.2; // flash() 기본 지속 시간 (초)

export class Effects {
  constructor(config) {
    this.config = config;
    this.W = (config && config.WIDTH) | 0 || 320;
    this.H = (config && config.HEIGHT) | 0 || 180;
    this.shakeOffset = { x: 0, y: 0 };
    this._patterns = new Map(); // 디더 패턴 캐시 (인스턴스 소유)
    this._rng = Math.random;
    this.reset();
  }

  /** 모든 연출 초기화 (진행 중인 전환의 onMid 는 호출하지 않는다) */
  reset() {
    this._shakeAmp = 0;
    this._shakeDur = 0;
    this._shakeT = 0;
    this._hitstopT = 0;
    this._flashColor = null;
    this._flashDur = 0;
    this._flashT = 0;
    this._tr = null;
    this.shakeOffset.x = 0;
    this.shakeOffset.y = 0;
  }

  // ---------------------------------------------------------- 흔들림
  /** 화면 흔들림. 지금 남은 흔들림보다 세면 교체한다 */
  shake(intensity, duration) {
    if (!(intensity > 0) || !(duration > 0)) return;
    const remain = this._shakeT > 0 ? this._shakeAmp * (this._shakeT / this._shakeDur) : 0;
    if (intensity >= remain) {
      this._shakeAmp = intensity;
      this._shakeDur = duration;
      this._shakeT = duration;
    }
  }

  // ---------------------------------------------------------- 히트 스톱
  hitstop(duration) {
    if (duration > 0) this._hitstopT = Math.max(this._hitstopT, duration);
  }

  /** 히트 스톱 중인가 (시각 연출만 멈춤) */
  get frozen() {
    return this._hitstopT > 0;
  }

  // ---------------------------------------------------------- 플래시
  /** 화면 전체 번쩍임 — 디더 패턴이 점점 성기게 되며 사라진다 */
  flash(colorHex, duration = DEFAULT_FLASH_TIME) {
    if (!(duration > 0)) return;
    this._flashColor = colorHex || PALETTE[C.WHITE];
    this._flashDur = duration;
    this._flashT = duration;
  }

  // ---------------------------------------------------------- 화면 전환
  /**
   * 화면 전환: 덮기(전반부) → onMid() 정확히 1회 → 걷기(후반부)
   * @returns {boolean} 시작했으면 true (이미 전환 중이면 무시하고 false)
   */
  transition(type, onMid, duration) {
    if (this._tr) return false;
    const dur = duration === undefined ? ((this.config && this.config.TRANSITION_TIME) || 0.6) : duration;
    const kind = type === 'circleWipe' ? 'circleWipe' : 'pixelFade';
    if (!(dur > 0)) {
      // 시간 0 이면 즉시 전환
      if (typeof onMid === 'function') onMid();
      return true;
    }
    this._tr = { type: kind, onMid, dur, t: 0, midFired: false };
    return true;
  }

  get transitioning() {
    return this._tr !== null;
  }

  /** 현재 전환 덮임 정도 (0..1). 전환 없으면 0 */
  get coverage() {
    const tr = this._tr;
    if (!tr) return 0;
    const half = tr.dur / 2;
    let c;
    if (!tr.midFired) c = tr.t / half;
    else c = 1 - (tr.t - half) / half;
    c *= COVER_BOOST;
    return c < 0 ? 0 : c > 1 ? 1 : c;
  }

  // ---------------------------------------------------------- 진행
  /** 히트스톱 타이머·흔들림·플래시·전환 진행 (히트스톱 중에도 진행) */
  update(dt) {
    // 히트 스톱
    if (this._hitstopT > 0) this._hitstopT = Math.max(0, this._hitstopT - dt);

    // 흔들림: 남은 시간 비율만큼 진폭 감소, 매 스텝 정수 랜덤 오프셋
    if (this._shakeT > 0) {
      this._shakeT = Math.max(0, this._shakeT - dt);
      const amp = this._shakeAmp * (this._shakeT / this._shakeDur);
      if (amp > 0.01) {
        this.shakeOffset.x = Math.round((this._rng() * 2 - 1) * amp);
        this.shakeOffset.y = Math.round((this._rng() * 2 - 1) * amp);
      } else {
        this.shakeOffset.x = 0;
        this.shakeOffset.y = 0;
      }
    } else {
      this.shakeOffset.x = 0;
      this.shakeOffset.y = 0;
    }

    // 플래시
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt);
      if (this._flashT === 0) this._flashColor = null;
    }

    // 전환: 중간 지점에서 onMid 를 정확히 1회 호출
    const tr = this._tr;
    if (tr) {
      tr.t += dt;
      if (!tr.midFired && tr.t >= tr.dur / 2) {
        tr.midFired = true;
        // 중간 지점에 '정확히' 맞춘다 (화면이 꽉 덮인 상태에서 장면 교체)
        tr.t = tr.dur / 2;
        if (typeof tr.onMid === 'function') tr.onMid();
        // onMid 안에서 reset() 이 불렸을 수 있다
        if (this._tr !== tr) return;
      } else if (tr.midFired && tr.t >= tr.dur) {
        this._tr = null;
      }
    }
  }

  // ---------------------------------------------------------- 그리기
  /** 플래시 + 전환 오버레이 (모든 그리기의 맨 마지막) */
  render(g) {
    // 1) 플래시: 남은 시간 비율 → 디더 단계 (16 = 꽉 참)
    if (this._flashColor && this._flashT > 0) {
      const level = Math.ceil((this._flashT / this._flashDur) * 16);
      this._fillDither(g, this._flashColor, level, 1);
    }

    // 2) 전환
    const tr = this._tr;
    if (tr) {
      const c = this.coverage;
      if (tr.type === 'circleWipe') this._renderCircleWipe(g, c);
      else this._fillDither(g, INK, Math.round(c * 16), FADE_CELL);
    }
  }

  /** 화면 전체를 Bayer 디더(level/16 밀도)로 칠한다 */
  _fillDither(g, color, level, cell) {
    if (level <= 0) return;
    if (level >= 16) {
      g.fillStyle = color;
      g.fillRect(0, 0, this.W, this.H);
      return;
    }
    const pattern = this._getPattern(g, color, level, cell);
    if (pattern) {
      g.fillStyle = pattern;
      g.fillRect(0, 0, this.W, this.H);
      return;
    }
    // 패턴을 못 만드는 환경: 칸 단위로 직접 찍는다 (느리지만 동일한 결과)
    g.fillStyle = color;
    const cols = Math.ceil(this.W / cell);
    const rows = Math.ceil(this.H / cell);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (BAYER4[(cy & 3) * 4 + (cx & 3)] < level) g.fillRect(cx * cell, cy * cell, cell, cell);
      }
    }
  }

  /** (색, 단계, 칸크기) 별 반복 패턴 캐시 */
  _getPattern(g, color, level, cell) {
    const key = `${color}|${level}|${cell}`;
    if (this._patterns.has(key)) return this._patterns.get(key);
    let pattern = null;
    const doc = (g.canvas && g.canvas.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (doc && typeof g.createPattern === 'function') {
      const size = 4 * cell;
      const tile = doc.createElement('canvas');
      tile.width = size;
      tile.height = size;
      const tg = tile.getContext('2d');
      tg.fillStyle = color;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          if (BAYER4[y * 4 + x] < level) tg.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      pattern = g.createPattern(tile, 'repeat');
    }
    this._patterns.set(key, pattern);
    return pattern;
  }

  /** 원형 와이프: 원 바깥을 INK 로. 2px 행마다 fillRect 구간으로 그린다 */
  _renderCircleWipe(g, coverage) {
    const W = this.W, H = this.H;
    g.fillStyle = INK;
    if (coverage >= 1) {
      g.fillRect(0, 0, W, H);
      return;
    }
    if (coverage <= 0) return;
    const cx = W >> 1;
    const cy = H >> 1;
    const rMax = Math.ceil(Math.sqrt(cx * cx + cy * cy)) + WIPE_ROW;
    const r = Math.round((1 - coverage) * rMax);
    if (r <= 0) {
      g.fillRect(0, 0, W, H);
      return;
    }
    const r2 = r * r;
    for (let y = 0; y < H; y += WIPE_ROW) {
      const h = Math.min(WIPE_ROW, H - y);
      const dy = y + h / 2 - cy;
      const rem = r2 - dy * dy;
      if (rem <= 0) {
        g.fillRect(0, y, W, h);
        continue;
      }
      // 반폭을 2px 격자에 맞춰 계단형 픽셀 원으로
      const half = Math.floor(Math.sqrt(rem) / WIPE_ROW) * WIPE_ROW;
      const left = cx - half;
      const right = cx + half;
      if (left > 0) g.fillRect(0, y, left, h);
      if (right < W) g.fillRect(right, y, W - right, h);
    }
  }
}
