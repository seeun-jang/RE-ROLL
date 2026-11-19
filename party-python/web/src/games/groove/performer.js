// =====================================================
// 연주자 (플레이어 1명): 판정 · 콤보 · 점수   — 원본 js/performer.js
//  - 키를 누른 "시각"으로 판정한다 (화면 프레임과 무관)
//  - 롱노트: 머리 판정 + 끝까지 누르고 있으면 꼬리 PERFECT, 일찍 떼면 꼬리 MISS
//
// 실제 판정은 서버(server/party/games/groove/performer.py — 이 파일을 Python 으로 옮긴 것)가 한다.
// 브라우저는 같은 계산으로 내 입력의 결과를 "미리" 보여 주고(예측), 시험용 진행기(sim/)도 이 파일을 쓴다.
// 그림(스프라이트) · 소리와는 상관없는 순수 계산이라 Node 에서도 돈다.
// =====================================================
import { CONFIG, gradeOf } from './config.js';
import { chartJudgeCount } from './chart.js';

export const JUDGE_ORDER = ['perfect', 'great', 'good', 'miss'];

/** 점수 공식 (정수 계산): (900000 × 판정 비율 합 + 100000 × 최대 콤보) ÷ 판정 개수, 반올림 */
export function scoreOf(counts, maxCombo, total) {
  const W = CONFIG.JUDGE_WEIGHT100;
  const w100 = counts.perfect * W.perfect + counts.great * W.great + counts.good * W.good;
  const part = (CONFIG.SCORE_MAX - CONFIG.SCORE_COMBO_PART) / 100;
  return Math.floor((part * w100 + CONFIG.SCORE_COMBO_PART * maxCombo) / Math.max(1, total) + 0.5);
}

export class Performer {
  // chart: buildChart() 가 만든 노트 목록. opts: { def: { color }, spr, name } — 그림용(없어도 된다)
  constructor(chart, opts = {}) {
    this.def = opts.def || { color: '9' };
    this.name = opts.name || '';
    this.spr = opts.spr || null;
    this.notes = chart.map((n) => ({ ...n, head: null, tail: null, holding: false }));
    this.lanes = [0, 1, 2].map((l) => this.notes.filter((n) => n.lane === l));
    this.ptr = [0, 0, 0]; // 레인별 아직 안 친 첫 노트
    this.total = chartJudgeCount(chart);
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.judged = 0;
    this.keyDown = [false, false, false];
    this.holdNote = [null, null, null];
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

  get score() {
    return scoreOf(this.counts, this.maxCombo, this.total);
  }

  get grade() {
    return gradeOf(this.score);
  }

  // 지금까지 친 것만으로 예상한 등급 (연주 중 표시용)
  get liveGrade() {
    if (this.judged === 0) return null;
    return gradeOf(scoreOf(this.counts, this.maxCombo, this.judged));
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
        this.holdNote[lane] = n;
      }
    } else {
      this.keyDown[lane] = false;
      const n = this.holdNote[lane];
      if (n && n.holding) {
        n.holding = false;
        this.holdNote[lane] = null;
        // 끝나기 전에 너무 일찍 떼면 꼬리 MISS
        n.tail = t >= n.endTime - CONFIG.JUDGE.holdEndGrace ? 'perfect' : 'miss';
        this.record(n.tail, lane, true);
      }
    }
  }

  // 시각 t 까지 진행: 지나간 노트는 MISS, 끝까지 누른 롱노트는 성공  (원본 update 의 판정 부분)
  sweep(t) {
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
      const h = this.holdNote[l];
      if (h && h.holding && t >= h.endTime) {
        h.holding = false;
        this.holdNote[l] = null;
        h.tail = 'perfect';
        this.record('perfect', l, true);
      }
    }
  }

  // 매 프레임(화면 쪽): 판정 진행 + 반짝임 타이머
  update(t) {
    this.sweep(t);
    for (let l = 0; l < 3; l++) {
      if (this.pressT[l] > 0) this.pressT[l]--;
      if (this.hitT[l] > 0) this.hitT[l]--;
    }
    if (this.last) this.last.age++;
  }

  // 아직 판정 안 끝난 노트가 있나
  get finished() {
    return this.judged >= this.total;
  }

  // 결과 요약
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

  // 다시 접속했을 때: 서버가 알려 준 진행 상황으로 맞춘다 (dump 는 아래 dump() 와 같은 모양)
  restore(d) {
    if (!d || !Array.isArray(d.ptr)) return;
    for (let l = 0; l < 3; l++) {
      const list = this.lanes[l];
      this.ptr[l] = Math.max(0, Math.min(list.length, d.ptr[l] | 0));
      for (let i = 0; i < this.ptr[l]; i++) {
        // 이미 지나간 노트는 "친 것" 으로 두어 화면에 다시 그리지 않는다 (세부 판정은 counts 에 있다)
        list[i].head = list[i].head || 'good';
        if (list[i].endTime !== null) list[i].tail = list[i].tail || 'perfect';
        list[i].holding = false;
      }
      this.holdNote[l] = null;
    }
    (d.hold || []).forEach((id, l) => {
      const n = id === null || id === undefined ? null : this.notes.find((x) => x.id === id);
      if (n && l < 3) {
        n.tail = null;
        n.holding = true;
        this.holdNote[l] = n;
      }
    });
    for (const k of JUDGE_ORDER) this.counts[k] = d[k] | 0;
    this.combo = d.combo | 0;
    this.maxCombo = d.maxCombo | 0;
    this.judged = d.judged | 0;
    this.fever = this.combo >= CONFIG.FEVER_COMBO;
  }

  dump() {
    return {
      ptr: [...this.ptr], hold: this.holdNote.map((n) => (n ? n.id : null)),
      ...this.counts, combo: this.combo, maxCombo: this.maxCombo, judged: this.judged,
    };
  }
}
