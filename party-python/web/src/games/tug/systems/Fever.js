// =============================================================
// Fever — 피버 타임 스케줄
// 구간: FEVER_FIRST + k × FEVER_INTERVAL 부터 FEVER_DURATION 동안 (k = 0,1,2…)
// =============================================================

export class Fever {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this._state = this._stateAt(0);
  }

  /** 경과 시간 t 에서의 피버 상태 계산 */
  _stateAt(t) {
    const c = this.config;
    const first = c.FEVER_FIRST;
    const interval = c.FEVER_INTERVAL > 0 ? c.FEVER_INTERVAL : Infinity;
    const dur = c.FEVER_DURATION;
    if (t < first) {
      // 첫 피버 전: 예고만
      const until = first - t;
      return { active: false, remaining: 0, warning: until <= c.FEVER_WARNING };
    }
    const k = interval === Infinity ? 0 : Math.floor((t - first) / interval);
    const start = first + k * (interval === Infinity ? 0 : interval);
    if (t < start + dur) {
      return { active: true, remaining: start + dur - t, warning: false };
    }
    // 피버 사이 구간: 다음 시작까지 남은 시간으로 예고
    const nextStart = start + interval;
    const until = nextStart - t;
    return { active: false, remaining: 0, warning: until <= c.FEVER_WARNING };
  }

  /** 경과 시간 진행. 이번 스텝에 시작했으면 'start', 끝났으면 'end', 아니면 null */
  update(dt) {
    const was = this._state.active;
    this.elapsed += dt;
    this._state = this._stateAt(this.elapsed);
    if (!was && this._state.active) return 'start';
    if (was && !this._state.active) return 'end';
    return null;
  }

  get active() { return this._state.active; }
  get warning() { return !this._state.active && this._state.warning; }
  get remaining() { return this._state.active ? this._state.remaining : 0; }
  get powerMult() { return this._state.active ? this.config.FEVER_POWER_MULT : 1; }
  get scoreMult() { return this._state.active ? this.config.FEVER_SCORE_MULT : 1; }
}
