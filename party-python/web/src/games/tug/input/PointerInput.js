// =============================================================
// PointerInput — 마우스/터치(Pointer Events) → 320×180 논리 좌표
//
// - pointerdown/move/leave 는 캔버스에, pointerup/cancel 은 window 에도 건다
//   (캔버스 밖에서 손을 떼도 눌림 해제를 놓치지 않기 위해).
// - 이벤트는 큐에 모았다가 beginFrame() 에서 이번 스텝 값(clicked/downThisFrame)으로 옮긴다.
// - clicked = 이번 스텝에 pointerup 이 있었고, 그 짝인 pointerdown 이 캔버스 위에서 시작됐을 때.
// =============================================================

export class PointerInput {
  /**
   * @param {HTMLCanvasElement} canvas 화면 캔버스
   * @param {{ width: number, height: number }} size 논리 해상도
   */
  constructor(canvas, { width = 320, height = 180 } = {}) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;

    this.x = 0;               // 마지막 논리 좌표 (정수)
    this.y = 0;
    this.inside = false;      // 포인터가 캔버스 위에 있나
    this.isDown = false;      // 현재 눌림
    this.clicked = null;      // 이번 스텝 클릭 { x, y } | null
    this.downThisFrame = null; // 이번 스텝 pointerdown { x, y } | null

    this.activeId = null;     // 캔버스 위에서 시작된 눌림의 pointerId
    this.pendingClick = null; // 다음 beginFrame 에 반영될 클릭
    this.pendingDown = null;  // 다음 beginFrame 에 반영될 눌림
    this.disposed = false;

    // ---- 리스너 ----
    this._onDown = (e) => {
      if (e.isPrimary === false) return; // 멀티 터치는 첫 손가락만
      const p = this._toLogical(e);
      this.x = p.x; this.y = p.y; this.inside = p.inside;
      this.isDown = true;
      this.activeId = e.pointerId ?? 0;
      this.pendingDown = { x: p.x, y: p.y };
      // 터치 시 스크롤/줌 방지
      if (e.pointerType !== 'mouse' && typeof e.preventDefault === 'function') e.preventDefault();
    };
    this._onMove = (e) => {
      if (e.isPrimary === false) return;
      const p = this._toLogical(e);
      this.x = p.x; this.y = p.y; this.inside = p.inside;
    };
    this._onLeave = (e) => {
      if (e && e.isPrimary === false) return;
      this.inside = false;
    };
    this._onUp = (e) => {
      if (e.isPrimary === false) return;
      const id = e.pointerId ?? 0;
      const p = this._toLogical(e);
      this.x = p.x; this.y = p.y; this.inside = p.inside;
      // 짝이 되는 pointerdown 이 캔버스에서 시작된 경우에만 '클릭'으로 인정
      if (this.activeId !== null && this.activeId === id) {
        this.pendingClick = { x: p.x, y: p.y };
      }
      this.activeId = null;
      this.isDown = false;
    };
    this._onCancel = () => {
      // 시스템이 포인터를 가져가면 클릭 없이 눌림만 해제
      this.activeId = null;
      this.isDown = false;
    };

    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('pointerdown', this._onDown);
      canvas.addEventListener('pointermove', this._onMove);
      canvas.addEventListener('pointerleave', this._onLeave);
      if (canvas.style && !canvas.style.touchAction) canvas.style.touchAction = 'none';
    }
    this.win = typeof window !== 'undefined' ? window : null;
    if (this.win && typeof this.win.addEventListener === 'function') {
      this.win.addEventListener('pointerup', this._onUp);
      this.win.addEventListener('pointercancel', this._onCancel);
      this.win.addEventListener('blur', this._onCancel);
    }
  }

  /** 클라이언트 좌표 → 논리 좌표 (내림 + 범위 고정) */
  _toLogical(e) {
    const c = this.canvas;
    if (!c || typeof c.getBoundingClientRect !== 'function') return { x: this.x, y: this.y, inside: false };
    const r = c.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    const rx = e.clientX - r.left;
    const ry = e.clientY - r.top;
    const inside = rx >= 0 && ry >= 0 && rx < w && ry < h;
    let x = Math.floor((rx * this.width) / w);
    let y = Math.floor((ry * this.height) / h);
    x = Math.max(0, Math.min(this.width - 1, x));
    y = Math.max(0, Math.min(this.height - 1, y));
    return { x, y, inside };
  }

  /** 고정 스텝마다 호출: 큐에 쌓인 클릭/눌림을 이번 스텝 값으로 */
  beginFrame() {
    this.clicked = this.pendingClick;
    this.downThisFrame = this.pendingDown;
    this.pendingClick = null;
    this.pendingDown = null;
  }

  /** 리스너 해제. 여러 번 호출해도 안전 */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const c = this.canvas;
    if (c && typeof c.removeEventListener === 'function') {
      c.removeEventListener('pointerdown', this._onDown);
      c.removeEventListener('pointermove', this._onMove);
      c.removeEventListener('pointerleave', this._onLeave);
    }
    if (this.win && typeof this.win.removeEventListener === 'function') {
      this.win.removeEventListener('pointerup', this._onUp);
      this.win.removeEventListener('pointercancel', this._onCancel);
      this.win.removeEventListener('blur', this._onCancel);
    }
    this.isDown = false;
    this.clicked = null;
    this.downThisFrame = null;
  }
}
