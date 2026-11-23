// =============================================================
// BeatJudge — 박자 시계 + Perfect / Good / Miss / 헛힘(spam) 판정
//
// - 박 index 0 이 time=0. 박 시각은 '현재 템포 구간의 시작점 + n × interval' 로 계산해
//   부동소수 누적 오차 없이 정확하게 유지한다.
// - setBpm() 은 예약만 하고, 다음 박 경계를 넘는 순간 적용한다.
//   (이미 정해진 다음 박 시각은 바뀌지 않는다 → 음악 예약과 어긋나지 않음)
// =============================================================

/** 판정 기록 보관 기간 (interval 배수) — 오래된 누름 시각은 버린다 */
const PRESS_HISTORY_INTERVALS = 2;

export class BeatJudge {
  constructor(config) {
    this.config = config;
    this.reset(config.BPM);
  }

  /** 시계 초기화: time=0 에 박 0, 다음 박(1)은 time=interval. 판정 기록 초기화 */
  reset(bpm = this.config.BPM) {
    this.bpm = bpm > 0 ? bpm : this.config.BPM;
    this.interval = 60 / this.bpm;
    this.time = 0;
    this.pendingBpm = null;
    // 현재 템포 구간의 기준점 (구간 시작 박 index 와 그 시각)
    this.segIndex = 0;
    this.segTime = 0;
    this.prevBeatIndex = -1;
    this.prevBeatTime = -this.interval;
    this.lastBeatIndex = 0;
    this.lastBeatTime = 0;
    this.nextBeatIndex = 1;
    this.nextBeatTime = this.interval;
    // 플레이어별 판정 기록: { hitBeat: number|null, presses: number[] }
    this.records = new Map();
  }

  /**
   * 박 index 를 새 박 0 (time=0) 으로 다시 번호 매긴다. 템포·박 위상·예약 템포는 그대로, 판정 기록은 초기화.
   * 장면이 바뀌어도 박자 시계를 끊지 않고 이어받을 때 쓴다 (카운트다운 → 플레이).
   * index 는 현재 템포 구간 안의 박이어야 한다 (index >= 구간 시작 박).
   */
  rebase(index) {
    const k = Math.max(this.segIndex, index | 0);
    const shift = this.segTime + (k - this.segIndex) * this.interval; // 박 k 의 시각
    this.time -= shift;
    this.segIndex -= k;
    this.segTime -= shift;
    this.prevBeatIndex -= k;
    this.prevBeatTime -= shift;
    this.lastBeatIndex -= k;
    this.lastBeatTime -= shift;
    this.nextBeatIndex -= k;
    this.nextBeatTime -= shift;
    this.records = new Map();
  }

  /** 다음 박 경계에서 bpm 변경 (예약) */
  setBpm(bpm) {
    if (!(bpm > 0)) return;
    if (bpm === this.bpm) {
      this.pendingBpm = null; // 이미 같은 템포면 예약 취소
      return;
    }
    this.pendingBpm = bpm;
  }

  /** 시계 진행. 이번 스텝에 지난 박 index 배열 반환 */
  update(dt) {
    this.time += dt;
    const passed = [];
    // 큰 dt 에도 여러 박을 정확히 넘기도록 반복
    while (this.time >= this.nextBeatTime) {
      const k = this.nextBeatIndex;
      this.prevBeatIndex = this.lastBeatIndex;
      this.prevBeatTime = this.lastBeatTime;
      this.lastBeatIndex = k;
      this.lastBeatTime = this.nextBeatTime;
      // 박 경계: 예약된 템포 적용 → 이 박을 새 구간의 기준점으로
      if (this.pendingBpm !== null) {
        this.bpm = this.pendingBpm;
        this.interval = 60 / this.bpm;
        this.pendingBpm = null;
        this.segIndex = k;
        this.segTime = this.lastBeatTime;
      }
      this.nextBeatIndex = k + 1;
      this.nextBeatTime = this.segTime + (this.nextBeatIndex - this.segIndex) * this.interval;
      passed.push(k);
    }
    return passed;
  }

  /** (time - lastBeatTime) / interval, 0..1 */
  get phase() {
    const span = this.nextBeatTime - this.lastBeatTime;
    if (!(span > 0)) return 0;
    const p = (this.time - this.lastBeatTime) / span;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  timeToNextBeat() {
    return this.nextBeatTime - this.time;
  }

  _record(playerId) {
    let r = this.records.get(playerId);
    if (!r) {
      r = { hitBeat: null, presses: [] };
      this.records.set(playerId, r);
    }
    return r;
  }

  /**
   * 판정. t 는 박자 시계 기준 초.
   * → { grade, offset, beatIndex }
   */
  judge(playerId, t = this.time) {
    const cfg = this.config;
    // 가장 가까운 박 찾기 (직전·현재·다음 박 중) — 입력 시각이 박 경계 직전일 수도 있으므로 직전 박도 본다
    let beatIndex = this.lastBeatIndex;
    let beatTime = this.lastBeatTime;
    let best = Math.abs(t - this.lastBeatTime);
    const dNext = Math.abs(t - this.nextBeatTime);
    if (dNext < best) { best = dNext; beatIndex = this.nextBeatIndex; beatTime = this.nextBeatTime; }
    if (this.prevBeatIndex >= 0) {
      const dPrev = Math.abs(t - this.prevBeatTime);
      if (dPrev < best) { best = dPrev; beatIndex = this.prevBeatIndex; beatTime = this.prevBeatTime; }
    }
    const offset = t - beatTime;

    // 누름 기록 갱신: 최근 1 interval 안 누름 횟수(이번 포함) 세기
    const rec = this._record(playerId);
    rec.presses.push(t);
    const keepFrom = t - this.interval * PRESS_HISTORY_INTERVALS;
    while (rec.presses.length && rec.presses[0] < keepFrom) rec.presses.shift();
    let recent = 0;
    for (const p of rec.presses) if (p <= t && t - p < this.interval) recent++;

    // 1) 헛힘 판정이 먼저
    if (rec.hitBeat !== null && rec.hitBeat === beatIndex) {
      return { grade: 'spam', offset, beatIndex }; // 같은 박에 이미 perfect/good 받음
    }
    if (recent > cfg.SPAM_MAX_PRESSES_PER_BEAT) {
      return { grade: 'spam', offset, beatIndex }; // 과도한 연타
    }
    // 2) 타이밍 창
    const abs = Math.abs(offset);
    let grade;
    if (abs <= cfg.PERFECT_WINDOW) grade = 'perfect';
    else if (abs <= cfg.GOOD_WINDOW) grade = 'good';
    else grade = 'miss';
    if (grade === 'perfect' || grade === 'good') rec.hitBeat = beatIndex;
    return { grade, offset, beatIndex };
  }

  /** 해당 플레이어 판정 기록 삭제 */
  clearPlayer(playerId) {
    this.records.delete(playerId);
  }
}
