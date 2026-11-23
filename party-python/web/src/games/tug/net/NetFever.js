// =============================================================
// NetFever — 서버 시계 기준 피버 상태 (멀티플레이용)
// 원본 Fever 와 같은 모양(update → 'start'|'end'|null, active, warning, remaining …)이지만
// 경과 시간을 더하지 않고 '서버 시각 - 라운드 시작 시각'으로 계산한다.
// =============================================================
import { FeverSchedule } from './timeline.js';

export class NetFever {
  constructor(config, net) {
    this.config = config;
    this.net = net;
    this.schedule = new FeverSchedule(config);
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this._state = this.schedule.stateAt(0);
  }

  /** 라운드 경과 시간(초). 플레이 전이면 0 */
  _roundTime() {
    const s = this.net.snap;
    if (!s || !Number.isFinite(s.startAt)) return 0;
    return Math.max(0, this.net.now() - s.startAt);
  }

  /** dt 는 쓰지 않는다. 이번에 시작했으면 'start', 끝났으면 'end', 아니면 null */
  update() {
    const was = this._state.active;
    this.elapsed = Math.max(this.elapsed, this._roundTime());
    this._state = this.schedule.stateAt(this.elapsed);
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
