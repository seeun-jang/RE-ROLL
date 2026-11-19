// =============================================================
// NetBeat — 서버 시계에 맞춰 도는 박자 시계 (멀티플레이용)
//
// 원본 BeatJudge 와 같은 모양(time, lastBeatIndex, nextBeatTime, update() …)이라
// 장면·HUD·음악 예약 코드는 그대로 쓴다. 다른 점은 시간을 프레임마다 더하지 않고
// '서버 시각 - 기준 시각'으로 직접 계산한다는 것이다 → 탭이 잠깐 멈춰도 다른 참가자와 어긋나지 않는다.
//
// 세 가지 쓰임
//   reset(bpm)                 메뉴 음악용. 지금 시각을 0 으로, 일정한 템포
//   syncTo(serverTime)         카운트다운용. 0 을 서버가 정한 시각에 맞춤(템포는 그대로)
//   enterRound(startAt, grid)  플레이용. 0 = 라운드 시작 시각, 박자 격자는 피버 템포가 반영된 BeatTimeline
// =============================================================

/** 일정한 템포의 박자 격자 (BeatTimeline 과 같은 메서드) */
class ConstGrid {
  constructor(interval) {
    this.interval = interval;
  }
  timeOf(k) { return k * this.interval; }
  indexAt(t) { return Math.floor(t / this.interval + 1e-9); }
  intervalAfter() { return this.interval; }
}

/** 한 번의 update 에서 돌려줄 '지난 박' 최대 개수 (탭 복귀 등으로 한꺼번에 많이 지났을 때) */
const MAX_PASSED = 8;

export class NetBeat {
  constructor(config, net) {
    this.config = config;
    this.net = net;
    this.records = new Map();
    this.reset(config.BPM);
  }

  /** 지금을 0 으로 하는 일정 템포 시계 */
  reset(bpm = this.config.BPM) {
    const b = bpm > 0 ? bpm : this.config.BPM;
    this.grid = new ConstGrid(60 / b);
    this.origin = this.net.now();
    this._place(0);
  }

  /** 시계의 0 을 서버 시각 serverTime 에 맞춘다 (지난 박은 알리지 않고 현재 위치만 갱신) */
  syncTo(serverTime) {
    if (!Number.isFinite(serverTime)) return;
    this.origin = serverTime;
    this._place(Math.max(0, this.net.now() - this.origin));
  }

  /** 라운드 시작 시각과 박자 격자를 받아 플레이용 시계로 바꾼다 */
  enterRound(startAt, grid) {
    this.grid = grid;
    this.origin = startAt;
    this._place(Math.max(0, this.net.now() - this.origin));
  }

  /** 시각 t 에 맞춰 박 번호·시각을 계산해 넣는다 */
  _place(t) {
    const grid = this.grid;
    this.time = t;
    const k = grid.indexAt(t);
    this.lastBeatIndex = k;
    this.lastBeatTime = grid.timeOf(k);
    this.nextBeatIndex = k + 1;
    this.nextBeatTime = grid.timeOf(k + 1);
    this.prevBeatIndex = k - 1;
    this.prevBeatTime = grid.timeOf(k - 1);
    this.interval = this.nextBeatTime - this.lastBeatTime;
    this.bpm = 60 / this.interval;
    // 다음 박부터 간격이 달라지면 그 템포를 알려준다 (원본의 '예약된 템포'와 같은 뜻)
    const after = grid.intervalAfter(k + 1);
    this.pendingBpm = Math.abs(after - this.interval) > 1e-9 ? 60 / after : null;
  }

  /** 서버 시각에 맞춰 진행. dt 는 쓰지 않는다. → 이번에 지난 박 번호들 */
  update() {
    const old = this.lastBeatIndex;
    // 시계 보정으로 시간이 살짝 뒤로 가는 일이 없게 한다
    const t = Math.max(this.time, this.net.now() - this.origin);
    this._place(t);
    const passed = [];
    const from = Math.max(old + 1, this.lastBeatIndex - MAX_PASSED + 1);
    for (let k = from; k <= this.lastBeatIndex; k++) passed.push(k);
    return passed;
  }

  /** 템포는 격자가 정하므로 아무것도 하지 않는다 (원본 장면 코드와의 호환용) */
  setBpm() {}

  get phase() {
    const span = this.nextBeatTime - this.lastBeatTime;
    if (!(span > 0)) return 0;
    const p = (this.time - this.lastBeatTime) / span;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  timeToNextBeat() {
    return this.nextBeatTime - this.time;
  }

  clearPlayer(playerId) {
    this.records.delete(playerId);
  }
}
