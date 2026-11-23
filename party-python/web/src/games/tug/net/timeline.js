// =============================================================
// 박자 격자와 피버 구간 — '라운드 시작 후 경과 시간'만으로 결정된다.
//
// 서버(server/party/games/tug/timeline.py)와 같은 공식이다. 양쪽이 따로 계산해도
// 같은 박자 격자가 나오도록, 프레임 단위 누적이 아니라 시간에 대한 공식으로 정의한다.
//
// 박자 규칙
// - 박 0 = 라운드 시작(START) 시각 0초. 음수 박(카운트다운)은 기본 템포 간격.
// - 박 k → k+1 간격은 '박 k-1 시각에 피버였으면 피버 템포, 아니면 기본 템포'.
// =============================================================

/** 경계값 비교용 여유(초) */
export const EPS = 1e-9;

export class FeverSchedule {
  constructor(config) {
    this.first = Number(config.FEVER_FIRST);
    const interval = Number(config.FEVER_INTERVAL);
    this.interval = interval > 0 ? interval : Infinity;
    this.duration = Number(config.FEVER_DURATION);
    this.warning = Number(config.FEVER_WARNING);
  }

  /** → { active, remaining, warning } */
  stateAt(t) {
    if (t < this.first - EPS) {
      return { active: false, remaining: 0, warning: (this.first - t) <= this.warning };
    }
    let start;
    if (this.interval === Infinity) {
      start = this.first;
    } else {
      const k = Math.floor((t - this.first + EPS) / this.interval);
      start = this.first + k * this.interval;
    }
    if (t < start + this.duration - EPS) {
      return { active: true, remaining: start + this.duration - t, warning: false };
    }
    const until = start + this.interval - t;
    return { active: false, remaining: 0, warning: until <= this.warning };
  }

  activeAt(t) {
    return this.stateAt(t).active;
  }
}

export class BeatTimeline {
  constructor(config, fever = null) {
    this.base = 60 / Number(config.BPM);
    this.fast = 60 / Number(config.FEVER_BPM);
    this.fever = fever || new FeverSchedule(config);
    this.times = [0];
  }

  /** 박 k → k+1 간격 */
  intervalAfter(k) {
    if (k < 1) return this.base;
    return this.fever.activeAt(this.timeOf(k - 1)) ? this.fast : this.base;
  }

  /** 박 k → k+1 구간이 피버 템포인가 */
  isFastAfter(k) {
    return k >= 1 && this.fever.activeAt(this.timeOf(k - 1));
  }

  _extendToIndex(k) {
    while (this.times.length <= k) {
      const last = this.times.length - 1;
      this.times.push(this.times[last] + this.intervalAfter(last));
    }
  }

  timeOf(k) {
    if (k < 0) return k * this.base;
    this._extendToIndex(k);
    return this.times[k];
  }

  /** 시각 t 이전(같음 포함)의 마지막 박 번호. 음수일 수 있다 */
  indexAt(t) {
    if (t < 0) return Math.floor(t / this.base);
    while (this.times[this.times.length - 1] <= t) this._extendToIndex(this.times.length);
    let k = this.times.length - 1;
    while (k > 0 && this.times[k] > t) k--;
    return k;
  }

  /** t 에 가장 가까운 박 → { index, time }. 같은 거리면 앞의 박 */
  nearest(t) {
    const k = this.indexAt(t);
    const t0 = this.timeOf(k);
    const t1 = this.timeOf(k + 1);
    if (Math.abs(t - t1) < Math.abs(t - t0)) return { index: k + 1, time: t1 };
    return { index: k, time: t0 };
  }
}

/** 판정 기록 보관 기간 (박 간격의 배수) */
const HISTORY_INTERVALS = 2;

/** Perfect / Good / Miss / 헛힘 판정 (서버 BeatJudge 와 같은 규칙) */
export class TimelineJudge {
  constructor(config, timeline) {
    this.config = config;
    this.timeline = timeline;
    this.records = new Map();
  }

  /** → { grade, offset, beatIndex } */
  judge(playerId, t) {
    const cfg = this.config;
    const tl = this.timeline;
    const near = tl.nearest(t);
    const beatIndex = near.index;
    const offset = t - near.time;
    const interval = tl.intervalAfter(tl.indexAt(t));

    let rec = this.records.get(playerId);
    if (!rec) {
      rec = { hitBeat: null, presses: [] };
      this.records.set(playerId, rec);
    }
    rec.presses.push(t);
    const keepFrom = t - interval * HISTORY_INTERVALS;
    rec.presses = rec.presses.filter((p) => p >= keepFrom);
    let recent = 0;
    for (const p of rec.presses) if (p <= t && t - p < interval) recent++;

    if (rec.hitBeat !== null && rec.hitBeat === beatIndex) return { grade: 'spam', offset, beatIndex };
    if (recent > cfg.SPAM_MAX_PRESSES_PER_BEAT) return { grade: 'spam', offset, beatIndex };
    const abs = Math.abs(offset);
    let grade;
    if (abs <= cfg.PERFECT_WINDOW) grade = 'perfect';
    else if (abs <= cfg.GOOD_WINDOW) grade = 'good';
    else grade = 'miss';
    if (grade === 'perfect' || grade === 'good') rec.hitBeat = beatIndex;
    return { grade, offset, beatIndex };
  }
}
