// =============================================================
// KendoSim — 시험용(LocalSession 전용) 검도 리그전 진행기
//
// 실제 판정은 Python 서버(server/party/games/kendo/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 입력에 같은 결과를 낸다(테스트가 비교한다).
// =============================================================
import { mergeConfig } from './config.js';
import { DuelCore } from './DuelCore.js';

const LOGIC_FPS = 60;
const PRESS_KEYS = ['men', 'kote', 'do', 'block', 'kiai'];

export function makeSchedule(ids, rng, roundsForTwo) {
  const order = ids.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length === 2) {
    const [a, b] = order;
    return Array.from({ length: roundsForTwo }, (_, r) => ({ matches: [r % 2 === 0 ? [a, b] : [b, a]], resting: [] }));
  }
  let seats = order.length % 2 ? [...order, null] : order.slice();
  const m = seats.length;
  const out = [];
  for (let r = 0; r < m - 1; r++) {
    const matches = [];
    const resting = [];
    for (let i = 0; i < m / 2; i++) {
      const x = seats[i];
      const y = seats[m - 1 - i];
      if (x === null || y === null) resting.push(y === null ? x : y);
      else matches.push((r + i) % 2 === 0 ? [x, y] : [y, x]);
    }
    out.push({ matches, resting });
    seats = [seats[0], seats[m - 1], ...seats.slice(1, m - 1)];
  }
  return out;
}

export class KendoSim {
  static id = 'kendo';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.cfg = mergeConfig(options && options.config);
    this.F = this.cfg.FLOW;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    this.schedule = makeSchedule(this.ids, rng, Math.trunc(this.F.ROUNDS_FOR_TWO));
    this.standings = {};
    this.held = {};
    this.pressed = {};
    for (const id of this.ids) {
      this.standings[id] = { wins: 0, losses: 0, ippons: 0, lost: 0, matches: 0 };
      this.held[id] = 0;
      this.pressed[id] = new Set();
    }
    this.phase = 'idle';
    this.round = 0;
    this.duels = [];
    this.practiceUntil = 0;
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.finalResults = [];
    this.results = [];
    this.finished = false;
    this._lastPhase = null;
    this._lastStateAt = -1;
    this._outbox = [];
  }

  clientOptions() {
    return {
      rounds: this.schedule.length, practice: this.F.PRACTICE_TIME,
      timeSec: this.cfg.MATCH.TIME_SEC, toWin: this.cfg.MATCH.POINTS_TO_WIN,
    };
  }

  start(now) {
    this.phase = 'practice';
    this.practiceUntil = now + this.F.PRACTICE_TIME;
    this._emit(now, true);
  }

  _beginRound(roundNo, at) {
    this.round = roundNo;
    const plan = this.schedule[roundNo - 1];
    this.duels = plan.matches.map(([a, b]) => new DuelCore(this.cfg, { id: a, name: this.names[a] }, { id: b, name: this.names[b] }, this.rng));
    for (const id of this.ids) {
      this.held[id] = 0;
      this.pressed[id] = new Set();
    }
    this.startAt = at + this.F.INTRO_TIME;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.phase = 'intro';
  }

  tick(now) {
    this._advance(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  _advance(now) {
    for (let i = 0; i < 6; i++) {
      if (this.phase === 'practice') {
        if (now < this.practiceUntil) return;
        this._beginRound(1, this.practiceUntil);
      } else if (this.phase === 'intro') {
        if (now < this.startAt) return;
        this.phase = 'fight';
        for (const d of this.duels) d.start();
      } else if (this.phase === 'fight') {
        this._simulate(now);
        if (this.phase === 'fight') return;
      } else if (this.phase === 'result') {
        if (now < this.phaseUntil) return;
        if (this.round < this.schedule.length) this._beginRound(this.round + 1, this.phaseUntil);
        else {
          this.finalResults = this._buildResults();
          this.phase = 'final';
          this.phaseUntil += this.F.FINAL_TIME;
        }
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
      } else return;
    }
  }

  _simulate(now) {
    const target = Math.floor((now - this.startAt) * LOGIC_FPS + 1e-6);
    const holdFrames = Math.floor(this.F.END_HOLD * LOGIC_FPS + 0.5);
    while (this.simFrame < target) {
      this.duels.forEach((d, index) => {
        d.step(this._inputFor(d.red.playerId), this._inputFor(d.white.playerId));
        for (const ev of d.popEvents()) this._outbox.push([null, 'event', { ...ev, match: index }]);
      });
      for (const id of this.ids) this.pressed[id] = new Set();
      this.simFrame++;
      if (this.allOverFrame === null && this.duels.every((d) => d.over)) this.allOverFrame = this.simFrame;
      if (this.allOverFrame !== null && this.simFrame >= this.allOverFrame + holdFrames) {
        this._endRound();
        return;
      }
    }
  }

  _inputFor(id) {
    const h = this.held[id];
    return { left: !!(h & 1), right: !!(h & 2), kiai: !!(h & 4), block: !!(h & 8), pressed: this.pressed[id] };
  }

  _endRound() {
    this.roundResults = [];
    for (const d of this.duels) {
      const winnerSide = d.rules.winner;
      for (const [side, f] of [['red', d.red], ['white', d.white]]) {
        const st = this.standings[f.playerId];
        st.matches++;
        st.ippons += d.rules.points[side].length;
        st.lost += d.rules.points[side === 'red' ? 'white' : 'red'].length;
        if (side === winnerSide) st.wins++;
        else st.losses++;
      }
      this.roundResults.push({
        red: d.red.playerId, white: d.white.playerId, winner: (winnerSide === 'red' ? d.red : d.white).playerId,
        decidedBy: d.rules.decidedBy, points: { red: [...d.rules.points.red], white: [...d.rules.points.white] },
      });
    }
    this.phase = 'result';
    this.phaseUntil = this.startAt + this.simFrame / LOGIC_FPS + this.F.RESULT_TIME;
  }

  _score(st) {
    return st.wins * this.F.WIN_SCORE + st.ippons * this.F.IPPON_SCORE;
  }

  _buildResults() {
    const rows = this.players.map((p, order) => {
      const st = this.standings[p.id];
      return {
        playerId: p.id, name: p.name, score: this._score(st), rank: 0, isWinner: false,
        stats: { wins: st.wins, losses: st.losses, ippons: st.ippons, matches: st.matches }, order,
      };
    });
    rows.sort((a, b) => b.score - a.score || a.order - b.order);
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
    });
    const top = rows.length ? rows[0].score : 0;
    for (const r of rows) {
      r.isWinner = r.score === top;
      delete r.order;
    }
    return rows;
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || data.k !== 'in' || !(playerId in this.held)) return;
    this._advance(now);
    if (this.phase !== 'fight') return;
    if (Number.isInteger(data.held)) this.held[playerId] = data.held & 15;
    if (Array.isArray(data.press)) {
      for (const key of data.press.slice(0, 8)) if (PRESS_KEYS.includes(key)) this.pressed[playerId].add(key);
    }
  }

  stateFor(_id, now) {
    return this.snapshot(now);
  }

  snapshot(now) {
    const plan = this.round ? this.schedule[this.round - 1] : { matches: [], resting: [] };
    const standings = {};
    for (const id of this.ids) standings[id] = { ...this.standings[id], score: this._score(this.standings[id]) };
    return {
      phase: this.phase, round: this.round, rounds: this.schedule.length, now,
      practiceUntil: this.practiceUntil, startAt: this.startAt,
      matches: plan.matches.map(([a, b]) => ({ red: a, white: b })),
      resting: [...plan.resting],
      duels: this.duels.map((d) => d.snapshot()),
      standings,
      roundResults: this.phase === 'result' ? this.roundResults : null,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
    };
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'fight';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 간격을 맞추며 기합을 모으다가 가끔 치고, 상대가 치러 들어오면 가끔 막는다.
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "in" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const plans = new Map();
  let round = 0;
  return (sim) => {
    if (sim.round !== round) {
      round = sim.round;
      plans.clear();
    }
    if (sim.phase !== 'fight') return [];
    const out = [];
    for (const id of botIds) {
      const duel = sim.duels.find((d) => d.red.playerId === id || d.white.playerId === id);
      if (!duel || duel.over || duel.flow.name !== 'play') continue;
      const me = duel.red.playerId === id ? duel.red : duel.white;
      const opp = duel.opponent(me);
      let plan = plans.get(id);
      if (!plan) {
        plan = { next: 40 + Math.floor(rng() * 40), blockUntil: 0, sent: -1, want: 30 + rng() * 8 };
        plans.set(id, plan);
      }
      const t = sim.simFrame;
      const dist = Math.abs(me.x - opp.x);
      const fwd = me.facing > 0 ? 2 : 1;
      const back = me.facing > 0 ? 1 : 2;
      let held = 4;                                    // 기합은 늘 모은다
      if (dist > plan.want + 3) held |= fwd;
      else if (dist < plan.want - 6) held |= back;
      const press = [];
      if (opp.state === 'strike' && opp.strike && opp.strike.t < opp.strike.startup && t >= plan.blockUntil && rng() < 0.06) {
        plan.blockUntil = t + 20;
        press.push('block');
      }
      if (t < plan.blockUntil) held |= 8;
      if (t >= plan.next && me.canAct && dist < 44) {
        press.push(['men', 'kote', 'do', 'men'][Math.floor(rng() * 4)]);
        plan.next = t + 50 + Math.floor(rng() * 70);
        plan.want = 28 + rng() * 10;
      }
      if (held !== plan.sent || press.length) {
        plan.sent = held;
        out.push({ playerId: id, data: { k: 'in', held, press } });
      }
    }
    return out;
  };
}
