// =============================================================
// Loop — requestAnimationFrame 기반 고정 스텝 루프
//
// - 실제 경과 시간을 누적기(accumulator)에 쌓고, step(기본 1/60초) 단위로 update 를 호출한다.
// - 한 rAF 에서 최대 maxSteps 번만 update 하고, 그래도 남는 누적은 버린다
//   (탭이 오래 숨겨졌다 돌아왔을 때 수백 스텝을 몰아서 처리하는 '죽음의 나선' 방지).
// - render(alpha) 는 rAF 마다 1번. alpha = 남은 누적 / step (0..1, 보간용 — 픽셀 게임이라 보통 무시).
// =============================================================

/** rAF 사이 간격이 이보다 길면(초) 한 프레임 정도만 진행한 것으로 본다 (탭 복귀·디버거 정지 대비) */
const MAX_FRAME_DELTA = 0.25;

export class Loop {
  /**
   * @param {{ step?: number, maxSteps?: number, update: (dt:number)=>void, render: (alpha:number)=>void }} opts
   */
  constructor({ step = 1 / 60, maxSteps = 5, update, render } = {}) {
    this.step = step > 0 ? step : 1 / 60;
    this.maxSteps = Math.max(1, maxSteps | 0);
    this.update = typeof update === 'function' ? update : () => {};
    this.render = typeof render === 'function' ? render : () => {};
    this.running = false;
    this._acc = 0;
    this._last = null;
    this._rafId = 0;
    // rAF 콜백 (인스턴스마다 따로 바인딩)
    this._frame = (now) => this._tick(now);
  }

  /** 루프 시작 (이미 돌고 있으면 무시) */
  start() {
    if (this.running) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') throw new Error('Loop: requestAnimationFrame 이 없는 환경입니다');
    this.running = true;
    this._acc = 0;
    this._last = null;
    this._rafId = raf(this._frame);
  }

  /** 루프 정지. 이후 update/render 콜백은 오지 않는다 */
  stop() {
    if (!this.running) return;
    this.running = false;
    const caf = globalThis.cancelAnimationFrame;
    if (typeof caf === 'function' && this._rafId) caf(this._rafId);
    this._rafId = 0;
    this._last = null;
    this._acc = 0;
  }

  /** rAF 1회 처리 */
  _tick(now) {
    if (!this.running) return;
    // 다음 프레임을 먼저 예약한다 → update 에서 예외가 나도 루프가 죽지 않는다
    this._rafId = globalThis.requestAnimationFrame(this._frame);

    const t = typeof now === 'number' ? now : globalThis.performance?.now?.() ?? Date.now();
    if (this._last === null) this._last = t;
    let delta = (t - this._last) / 1000;
    this._last = t;
    if (!(delta > 0)) delta = 0;
    if (delta > MAX_FRAME_DELTA) delta = this.step;
    this._acc += delta;

    // 고정 스텝 update (최대 maxSteps 번)
    let steps = 0;
    while (this._acc >= this.step && steps < this.maxSteps) {
      this.update(this.step);
      this._acc -= this.step;
      steps++;
      if (!this.running) return; // update 안에서 stop() 된 경우
    }
    // 따라잡지 못한 누적은 버린다
    if (this._acc >= this.step) this._acc = 0;

    this.render(this._acc / this.step);
  }
}
