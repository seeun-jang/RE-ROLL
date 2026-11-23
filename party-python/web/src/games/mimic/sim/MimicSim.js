// =============================================================
// MimicSim — 시험용(LocalSession 전용) 소리 따라하기 진행기
//
// 실제 진행·채점은 Python 서버(server/party/games/mimic/)가 한다.
// 이 파일은 서버 없이 화면 흐름(듣기 → 차례 → 녹음 → 공개)을 확인할 때만 쓴다.
// 채점 모델이 없으므로 점수는 임의 값이다(소리가 났으면 40~95점, 조용하면 0점). 화면에도 그렇게 표시된다.
// =============================================================

const SOUNDS = [
  { id: 'beep', name: '삐-', difficulty: 'easy', icon: 'speaker', duration: 1.2, file: 'beep.wav' },
  { id: 'dingdong', name: '띵동', difficulty: 'easy', icon: 'bell', duration: 1.65, file: 'dingdong.wav' },
  { id: 'hum_up', name: '올라가는 음', difficulty: 'easy', icon: 'note', duration: 2.0, file: 'hum_up.wav' },
  { id: 'meow', name: '야옹', difficulty: 'normal', icon: 'cat', duration: 1.1, file: 'meow.wav' },
  { id: 'cuckoo', name: '뻐꾸기', difficulty: 'normal', icon: 'bird', duration: 1.46, file: 'cuckoo.wav' },
  { id: 'whistle_up', name: '상승 휘파람', difficulty: 'normal', icon: 'whistle', duration: 1.2, file: 'whistle_up.wav' },
  { id: 'siren', name: '사이렌', difficulty: 'hard', icon: 'siren', duration: 2.6, file: 'siren.wav' },
  { id: 'melody', name: '멜로디', difficulty: 'hard', icon: 'note', duration: 1.99, file: 'melody.wav' },
  { id: 'rhythm', name: '빰빰빠바밤', difficulty: 'hard', icon: 'drum', duration: 1.62, file: 'rhythm.wav' },
];
const FLOW = {
  INTRO_TIME: 4.0, ROUND_LEAD: 1.5, LISTEN_REPEATS: 2, LISTEN_GAP: 0.8, LISTEN_TAIL: 0.6, TURN_INTRO: 1.6, CUE_TAIL: 0.5,
  COUNT_BEEPS: 3, BEEP_INTERVAL: 0.7, SCORE_MIN: 0.8, SCORE_TIMEOUT: 8.0, REVEAL_TIME: 2.8, ROUND_END: 3.0, FINAL_TIME: 9.0,
};
const GRADES = [['S', 90], ['A', 75], ['B', 60], ['C', 0]];
const REC_EXTRA = 1.5;
const gradeOf = (score) => (GRADES.find(([, lo]) => score >= lo) || ['C'])[0];

export class MimicSim {
  static id = 'mimic';

  static tickHz = 20;

  constructor(players, _options = {}, rng = Math.random) {
    this.rng = rng;
    this.players = players.map((p) => ({ id: p.id, name: p.name, bot: !!p.bot }));
    this.ids = this.players.map((p) => p.id);
    const order = this.ids.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.baseOrder = order;
    this.sounds = ['easy', 'normal', 'hard'].map((d) => {
      const pool = SOUNDS.filter((s) => s.difficulty === d);
      return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    });
    this.rounds = this.sounds.length;
    this.scores = {};
    for (const id of this.ids) this.scores[id] = new Array(this.rounds).fill(null);
    this.phase = 'idle';
    this.since = 0;
    this.until = 0;
    this.round = 0;
    this.turn = -1;
    this.order = [];
    this.last = null;
    this.results = [];
    this.finished = false;
    this.audio = null;      // { pcm, rate } — 지금 차례인 사람이 보낸 녹음
    this.pending = null;
    this.botIds = new Set();
    this._outbox = [];
    this._dirty = true;
    this._lastStateAt = -1;
  }

  get sound() {
    return this.sounds[this.round - 1] || null;
  }

  get current() {
    return this.order[this.turn] || null;
  }

  clientOptions() {
    return { rounds: this.rounds, order: [...this.baseOrder], recExtra: REC_EXTRA, flow: { ...FLOW }, grades: GRADES, sounds: SOUNDS };
  }

  start(now) {
    this._set('intro', now, FLOW.INTRO_TIME);
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) this.finished = true;
  }

  stateFor(_id, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _set(phase, at, duration) {
    this.phase = phase;
    this.since = at;
    this.until = at + duration;
    this._dirty = true;
  }

  _advance(now) {
    for (let i = 0; i < 12; i++) {
      const ph = this.phase;
      if (ph === 'scoring') {
        if (!this._advanceScoring(now)) return;
        continue;
      }
      if (ph === 'idle' || ph === 'done' || now < this.until) return;
      const at = this.until;
      if (ph === 'intro') this._beginRound(1, at);
      else if (ph === 'listen') this._beginTurn(0, at);
      else if (ph === 'turn') this._set('cue', at, this.sound.duration + FLOW.CUE_TAIL);
      else if (ph === 'cue') this._set('count', at, FLOW.COUNT_BEEPS * FLOW.BEEP_INTERVAL);
      else if (ph === 'count') {
        this.audio = null;
        this.pending = null;
        this._set('record', at, this.sound.duration + REC_EXTRA);
      } else if (ph === 'record') this._set('scoring', at, FLOW.SCORE_TIMEOUT);
      else if (ph === 'reveal') {
        if (this.turn + 1 < this.order.length) this._beginTurn(this.turn + 1, at);
        else this._set('roundEnd', at, FLOW.ROUND_END);
      } else if (ph === 'roundEnd') {
        if (this.round < this.rounds) this._beginRound(this.round + 1, at);
        else {
          this.results = this.buildResults();
          this._set('final', at, FLOW.FINAL_TIME);
        }
      } else if (ph === 'final') {
        this.phase = 'done';
        this._dirty = true;
      } else return;
    }
  }

  _beginRound(round, at) {
    this.round = round;
    const n = this.baseOrder.length;
    const shift = (round - 1) % n;
    this.order = [...this.baseOrder.slice(shift), ...this.baseOrder.slice(0, shift)];
    this.turn = -1;
    this.last = null;
    const dur = this.sound.duration;
    this._set('listen', at, FLOW.ROUND_LEAD + FLOW.LISTEN_REPEATS * dur + (FLOW.LISTEN_REPEATS - 1) * FLOW.LISTEN_GAP + FLOW.LISTEN_TAIL);
  }

  _beginTurn(turn, at) {
    this.turn = turn;
    this.last = null;
    this._set('turn', at, FLOW.TURN_INTRO);
  }

  _advanceScoring(now) {
    if (!this.pending) {
      if (this.botIds.has(this.current)) {
        // 봇: 소리 없이 임의 점수
        this.pending = { score: 30 + Math.floor(this.rng() * 66), valid: true };
      } else if (this.audio) {
        // 사람: 소리가 났는지만 본다(채점 모델이 없다)
        const pcm = this.audio.pcm;
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
        const rms = Math.sqrt(sum / Math.max(1, pcm.length)) / 32768;
        this.pending = rms > 0.01 ? { score: 40 + Math.floor(this.rng() * 56), valid: true } : { score: 0, valid: false, reason: 'silent' };
      } else if (now >= this.until) {
        this.pending = { score: 0, valid: false, reason: 'noAudio' };
      }
    }
    if (!this.pending || now < this.since + FLOW.SCORE_MIN) return false;
    const id = this.current;
    const r = this.pending;
    const entry = { score: r.score, valid: r.valid, grade: r.valid ? gradeOf(r.score) : '-' };
    this.scores[id][this.round - 1] = entry;
    this.last = { playerId: id, ...entry, reason: r.reason ?? null, similarity: null };
    const event = { type: 'reveal', playerId: id, round: this.round, ...entry, reason: r.reason ?? null };
    let play = 0;
    if (this.audio && entry.valid) {
      event.pcm = this.audio.base64;
      event.rate = this.audio.rate;
      play = this.audio.pcm.length / this.audio.rate;
    }
    this.audio = null;
    this._outbox.push([null, 'event', event]);
    this._set('reveal', now, play + FLOW.REVEAL_TIME);
    return true;
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || !this.ids.includes(playerId)) return;
    this._advance(now);
    if (playerId !== this.current || (this.phase !== 'record' && this.phase !== 'scoring') || this.pending) return;
    if (data.k === 'nomic') {
      if (!this.audio) {
        this.pending = { score: 0, valid: false, reason: 'noMic' };
        if (this.phase === 'record') this._set('scoring', now, FLOW.SCORE_TIMEOUT);
      }
      return;
    }
    if (data.k !== 'audio' || this.audio || typeof data.pcm !== 'string') return;
    try {
      const bin = atob(data.pcm);
      const pcm = new Int16Array(bin.length >> 1);
      for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
      this.audio = { pcm, rate: data.rate || 16000, base64: data.pcm };
    } catch (e) { /* 깨진 데이터는 무시 */ }
  }

  buildResults() {
    const rows = this.players.map((p, order) => {
      const rounds = this.scores[p.id].map((e) => (e ? e.score : 0));
      return {
        playerId: p.id, name: p.name, score: rounds.reduce((a, b) => a + b, 0), rank: 0, isWinner: false,
        stats: { rounds, best: Math.max(0, ...rounds) }, order,
      };
    });
    rows.sort((x, y) => y.score - x.score || x.order - y.order);
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
    });
    for (const r of rows) {
      r.isWinner = r.rank === 1;
      delete r.order;
    }
    return rows;
  }

  snapshot(now) {
    const s = this.sound;
    const totals = {};
    const scores = {};
    for (const id of this.ids) {
      scores[id] = [...this.scores[id]];
      totals[id] = this.scores[id].reduce((a, e) => a + (e ? e.score : 0), 0);
    }
    return {
      phase: this.phase, now, since: this.since, until: this.until, round: this.round, rounds: this.rounds,
      sound: s ? { id: s.id, name: s.name, difficulty: s.difficulty, icon: s.icon, duration: s.duration } : null,
      order: [...this.order], turn: this.turn, current: this.current, scores, totals, last: this.last,
      scorer: 'sim', results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
    };
  }

  _emit(now, force = false) {
    if (force || this._dirty || now - this._lastStateAt >= 1.0) {
      this._dirty = false;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/** 시험용 봇: 아무 입력도 하지 않는다. 진행기가 봇 차례에 임의 점수를 준다. */
export function createBots(botIds) {
  let told = false;
  return (sim) => {
    if (!told) {
      told = true;
      for (const id of botIds) sim.botIds.add(id);
    }
    return [];
  };
}
