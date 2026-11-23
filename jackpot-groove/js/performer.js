// =====================================================
// 연주자 (플레이어 1명): 판정 · 콤보 · 점수
//  - 키 이벤트의 실제 시각으로 판정 (화면 프레임과 무관)
//  - 롱노트: 머리 판정 + 끝까지 누르고 있으면 꼬리 PERFECT, 일찍 떼면 꼬리 MISS
// =====================================================
const JUDGE_ORDER = ['perfect', 'great', 'good', 'miss'];

class Performer {
  // laneCodes: [[레인0 키들], [레인1 키들], [레인2 키들]]
  constructor(index, laneCodes, chart, opts = {}) {
    this.index = index;
    this.def = CHARACTERS[index];
    this.name = this.def.name;
    this.color = C(this.def.color);
    this.spr = SPR.players[index];
    this.laneCodes = laneCodes;
    this.bot = !!opts.bot; // 자동 연주 (테스트·데모용)
    this.botSkill = opts.botSkill === undefined ? 1 : opts.botSkill; // 1 = 완벽
    this.notes = chart.map((n) => ({ ...n, head: null, tail: null, holding: false }));
    this.lanes = [0, 1, 2].map((l) => this.notes.filter((n) => n.lane === l));
    this.ptr = [0, 0, 0]; // 레인별 아직 안 친 첫 노트
    this.total = chartJudgeCount(chart);
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.weight = 0;
    this.judged = 0;
    this.keyDown = [false, false, false];
    this.pressT = [0, 0, 0];   // 눌린 순간 반짝임 (프레임)
    this.hitT = [0, 0, 0];     // 노트를 맞힌 순간 빛기둥 (프레임)
    this.hitKind = ['perfect', 'perfect', 'perfect'];
    this.last = null;          // 최근 판정 { kind, early(빠름/느림), age }
    this.fever = false;
    this.listeners = {};
  }

  on(name, fn) {
    this.listeners[name] = fn;
  }

  emit(name, ...args) {
    if (this.listeners[name]) this.listeners[name](...args);
  }

  laneOf(code) {
    for (let l = 0; l < 3; l++) if (this.laneCodes[l].includes(code)) return l;
    return -1;
  }

  get score() {
    const C1 = CONFIG.SCORE_MAX - CONFIG.SCORE_COMBO_PART;
    return Math.round((C1 * this.weight + CONFIG.SCORE_COMBO_PART * this.maxCombo) / Math.max(1, this.total));
  }

  get grade() {
    return gradeOf(this.score);
  }

  // 지금까지 친 것만으로 예상한 등급 (연주 중 표시용)
  get liveGrade() {
    if (this.judged === 0) return null;
    const C1 = CONFIG.SCORE_MAX - CONFIG.SCORE_COMBO_PART;
    return gradeOf(Math.round((C1 * this.weight + CONFIG.SCORE_COMBO_PART * this.maxCombo) / this.judged));
  }

  get fullCombo() {
    return this.counts.miss === 0 && this.judged === this.total;
  }

  get allPerfect() {
    return this.counts.perfect === this.total;
  }

  // 판정 기록
  record(kind, lane, isTail = false, delta = 0) {
    this.counts[kind]++;
    this.judged++;
    this.weight += CONFIG.JUDGE_WEIGHT[kind];
    if (kind === 'miss') {
      if (this.combo >= 10) this.emit('break', this.combo);
      this.combo = 0;
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.hitT[lane] = 12;
      this.hitKind[lane] = kind;
    }
    const wasFever = this.fever;
    this.fever = this.combo >= CONFIG.FEVER_COMBO;
    if (this.fever && !wasFever) this.emit('fever');
    this.last = { kind, early: kind !== 'perfect' && kind !== 'miss' && !isTail ? (delta < 0 ? 'early' : 'late') : null, age: 0 };
    this.emit('judge', kind, lane, isTail);
  }

  // 키 누름/뗌 처리 (t = 곡 시간)
  input(lane, t, down) {
    if (down) {
      this.keyDown[lane] = true;
      this.pressT[lane] = 8;
      const J = CONFIG.JUDGE;
      const list = this.lanes[lane];
      const n = list[this.ptr[lane]];
      if (!n || Math.abs(t - n.time) > J.good) {
        this.emit('tap', lane);
        return;
      }
      const d = t - n.time;
      const ad = Math.abs(d);
      const kind = ad <= J.perfect ? 'perfect' : ad <= J.great ? 'great' : 'good';
      n.head = kind;
      this.ptr[lane]++;
      this.record(kind, lane, false, d);
      if (n.endTime !== null) {
        n.holding = true;
        this.holdNote = this.holdNote || [];
        this.holdNote[lane] = n;
      }
    } else {
      this.keyDown[lane] = false;
      const n = this.holdNote && this.holdNote[lane];
      if (n && n.holding) {
        n.holding = false;
        this.holdNote[lane] = null;
        // 끝나기 전에 너무 일찍 떼면 꼬리 MISS
        n.tail = t >= n.endTime - CONFIG.JUDGE.holdEndGrace ? 'perfect' : 'miss';
        this.record(n.tail, lane, true);
      }
    }
  }

  // 매 프레임: 지나간 노트는 MISS, 끝까지 누른 롱노트는 성공
  update(t) {
    if (this.bot) this.autoPlay(t);
    const J = CONFIG.JUDGE;
    for (let l = 0; l < 3; l++) {
      const list = this.lanes[l];
      while (this.ptr[l] < list.length && t - list[this.ptr[l]].time > J.good) {
        const n = list[this.ptr[l]];
        n.head = 'miss';
        this.ptr[l]++;
        this.record('miss', l);
        if (n.endTime !== null) {
          n.tail = 'miss';
          this.record('miss', l, true);
        }
      }
      const h = this.holdNote && this.holdNote[l];
      if (h && h.holding && t >= h.endTime) {
        h.holding = false;
        this.holdNote[l] = null;
        h.tail = 'perfect';
        this.record('perfect', l, true);
      }
      if (this.pressT[l] > 0) this.pressT[l]--;
      if (this.hitT[l] > 0) this.hitT[l]--;
    }
    if (this.last) this.last.age++;
  }

  // 자동 연주: 노트 시각이 되면 정확히 누르고, 롱노트는 끝까지 누름
  //  실력(botSkill)이 낮을수록 타이밍이 흔들리고 가끔 놓치거나 롱노트를 일찍 뗌
  autoPlay(t) {
    const miss = (1 - this.botSkill) * 0.12;
    const jitter = (1 - this.botSkill) * 0.13;
    for (let l = 0; l < 3; l++) {
      const n = this.lanes[l][this.ptr[l]];
      const h = this.holdNote && this.holdNote[l];
      if (h && h.holding) {
        if (h._early === undefined) h._early = Math.random() < miss ? h.time + (h.endTime - h.time) * 0.5 : null;
        if (h._early !== null && t >= h._early) this.input(l, t, false);
        continue;
      }
      if (this.keyDown[l] && !h) this.input(l, t, false);
      if (!n) continue;
      if (n._off === undefined) {
        n._skip = Math.random() < miss;
        n._off = (Math.random() + Math.random() - 1) * jitter;
      }
      if (!n._skip && t >= n.time + n._off) this.input(l, n.time + n._off, true);
    }
  }

  // 아직 판정 안 끝난 노트가 있나
  get finished() {
    return this.judged >= this.total;
  }

  // 결과 요약 (결과 화면 / API 용)
  summary() {
    return {
      score: this.score,
      grade: this.grade.grade,
      maxCombo: this.maxCombo,
      ...this.counts,
      fullCombo: this.fullCombo,
      allPerfect: this.allPerfect,
    };
  }
}

function gradeOf(score) {
  return CONFIG.GRADES.find((g) => score >= g.min);
}
