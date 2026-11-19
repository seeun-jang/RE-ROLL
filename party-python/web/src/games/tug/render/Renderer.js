// =============================================================
// Renderer — 320×180 버퍼 캔버스에 모든 것을 그린 뒤,
// 화면 캔버스에 '정수배'로만 확대해서 내보낸다 (nearest-neighbor).
// =============================================================
import { PALETTE, C } from '../palette.js';

const INK = PALETTE[C.INK];
// 부모가 캔버스 크기에 맞춰 줄어드는(shrink-wrap) 경우를 감지하는 여유 (px)
const SHRINK_WRAP_SLACK = 4;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} displayCanvas 화면에 보이는 캔버스
   * @param {object} config mergeConfig() 결과
   */
  constructor(displayCanvas, config) {
    this.config = config;
    this.W = config.WIDTH | 0;
    this.H = config.HEIGHT | 0;
    this.canvas = displayCanvas;
    this.scale = 1;

    // 버퍼 캔버스 (논리 해상도 그대로)
    const doc = displayCanvas.ownerDocument || document;
    this.buffer = doc.createElement('canvas');
    this.buffer.width = this.W;
    this.buffer.height = this.H;
    this.g = this.buffer.getContext('2d');
    this.g.imageSmoothingEnabled = false;

    // 화면 캔버스 컨텍스트
    this.ctx = displayCanvas.getContext('2d');

    // CSS 확대 시에도 흐려지지 않게: crisp-edges 를 먼저 넣고 pixelated 로 덮는다
    // (지원하지 않는 값은 브라우저가 무시하므로 마지막으로 유효한 값이 남는다)
    const st = displayCanvas.style;
    if (st) {
      st.imageRendering = '-moz-crisp-edges';
      st.imageRendering = 'crisp-edges';
      st.imageRendering = 'pixelated';
    }

    this.resize();
  }

  /** 설정/부모 크기에 맞는 정수 배율 계산 */
  _computeScale() {
    const s = this.config.SCALE;
    if (s !== 'auto') {
      const n = Math.floor(Number(s));
      return Number.isFinite(n) && n >= 1 ? n : 1;
    }
    // 'auto': 부모 요소 크기 안에 들어가는 최대 정수배
    const canvas = this.canvas;
    const win = (canvas.ownerDocument && canvas.ownerDocument.defaultView) || null;
    const parent = canvas.parentElement;
    let availW = parent ? parent.clientWidth : 0;
    let availH = parent ? parent.clientHeight : 0;
    // clientWidth/Height 는 padding 을 포함하므로 빼서 '실제로 캔버스가 놓일 수 있는 크기'를 구한다
    // (빼지 않으면 캔버스가 내용 영역보다 커져 레이아웃이 넘치거나 CSS 가 비정수배로 줄인다)
    const pad = this._parentPadding(parent, win);
    availW = Math.max(0, availW - pad.x);
    availH = Math.max(0, availH - pad.y);
    if (win) {
      // 부모 크기를 모르거나, 부모가 캔버스 높이에 맞춰 줄어든 상태면 창 크기를 쓴다
      const curH = canvas.offsetHeight || 0;
      if (!availW) availW = win.innerWidth;
      if (!availH || availH <= curH + SHRINK_WRAP_SLACK) availH = win.innerHeight;
      availW = Math.min(availW, Math.max(0, win.innerWidth - pad.x));
      availH = Math.min(availH, Math.max(0, win.innerHeight - pad.y));
    }
    const k = Math.floor(Math.min(availW / this.W, availH / this.H));
    return Number.isFinite(k) && k >= 1 ? k : 1;
  }

  /** 부모 요소의 좌우·상하 padding 합 (px). 계산할 수 없으면 0 */
  _parentPadding(parent, win) {
    const out = { x: 0, y: 0 };
    if (!parent || !win || typeof win.getComputedStyle !== 'function') return out;
    try {
      const cs = win.getComputedStyle(parent);
      const px = (v) => parseFloat(v) || 0;
      out.x = px(cs.paddingLeft) + px(cs.paddingRight);
      out.y = px(cs.paddingTop) + px(cs.paddingBottom);
    } catch (e) {
      // 계산 실패 → padding 없음으로 취급
    }
    return out;
  }

  /** 배율 재계산 + 화면 캔버스 크기 갱신 (창 크기 변경 시 Game 이 호출) */
  resize() {
    const scale = this._computeScale();
    const cw = this.W * scale;
    const ch = this.H * scale;
    const canvas = this.canvas;
    // 크기가 바뀔 때만 다시 설정 (width 대입은 캔버스 내용을 지운다)
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    if (canvas.style) {
      // 표시 크기도 정확히 정수배 px 로 고정한다 → CSS 가 비정수배로 늘이거나 줄여 픽셀 폭이 들쭉날쭉해지는 일이 없다.
      // (화면 크기에 맞추는 일은 SCALE 'auto' 가 정수배 단위로 한다. 창 크기가 바뀌면 Game 이 resize() 를 다시 부른다)
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      canvas.style.maxWidth = 'none';
    }
    this.scale = scale;
    // 캔버스 크기 변경 시 컨텍스트 상태가 초기화되므로 다시 끈다
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.g.imageSmoothingEnabled = false;
    return scale;
  }

  /** 프레임 시작: 버퍼를 INK 로 지우고 그리기 상태를 기본값으로 */
  begin() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = false;
    g.fillStyle = INK;
    g.fillRect(0, 0, this.W, this.H);
  }

  /**
   * 버퍼 → 화면. offset 은 논리 px 정수 (화면 흔들림).
   * 편의상 { x, y } 객체(fx.shakeOffset)를 그대로 넘겨도 된다.
   */
  present(offsetX = 0, offsetY = 0) {
    let ox = offsetX;
    let oy = offsetY;
    if (ox && typeof ox === 'object') {
      oy = ox.y;
      ox = ox.x;
    }
    ox = Math.round(Number(ox) || 0);
    oy = Math.round(Number(oy) || 0);

    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    // 흔들림으로 드러나는 빈 가장자리는 INK
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // 정수 배율 + 정수 오프셋(×scale) 으로만 그린다
    ctx.drawImage(this.buffer, 0, 0, this.W, this.H, ox * s, oy * s, this.W * s, this.H * s);
  }

  /** 정리 (버퍼 메모리 해제) */
  dispose() {
    if (this.buffer) {
      this.buffer.width = 0;
      this.buffer.height = 0;
    }
  }
}
