// =============================================================
// PalmSim — 시험용(LocalSession 전용) 손바닥 밀치기 진행기
//
// 실제 판정은 Python 서버(server/party/games/palm/)가 한다.
// 이 파일은 서버 없이 화면과 입력을 확인할 때만 쓰며, 서버와 같은 형식의 메시지를 만든다.
// 경기 계산은 새로 만들지 않고 원본 게임의 로직(game/Match.js, Fighter.js, Combat.js)을 그대로 쓴다.
// 서버와 결과가 같은지는 server/tests/test_palm_parity.py 가 같은 입력으로 비교한다.
// =============================================================
import { CONFIG, mergeConfig } from '../config.js';
import { Match } from '../game/Match.js';

const LOGIC_FPS = 60;

/** 서버 config.py 에만 있는 값(장면 시간)의 시험용 기본값 */
const SIM_FLOW = Object.freeze({ ROUNDS_FOR_TWO: 3, INTRO_TIME: 4.0, END_HOLD: 2.5, RESULT_TIME: 5.0, FINAL_TIME: 9.0 });

/** 서버로 보내는(판정에 쓰는) 설정 묶음 */
const LOGIC_SECTIONS = ['MATCH', 'BALANCE', 'ACTION', 'IMPACT', 'JUICE', 'SCORE'];

/** 라운드별 대진표 — 서버 make_schedule 과 같은 방식 */
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

export class PalmSim {
  static id = 'palm';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    const over = (options && options.config) || {};
    this.cfg = mergeConfig(mergeConfig(CONFIG, { FLOW: SIM_FLOW }), over);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.names = new Map(this.players.map((p) => [p.id, p.name]));
    this.ids = this.players.map((p) => p.id);
    this.schedule = makeSchedule(this.ids, rng, this.cfg.FLOW.ROUNDS_FOR_TWO | 0);
    this.standings = {};
    for (const id of this.ids) this.standings[id] = { wins: 0, draws: 0, losses: 0, score: 0, matches: 0 };
    this.phase = 'idle';
    this.round = 0;
    this.duels = [];
    this.countdownAt = 0;
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.results = [];
    this.finished = false;
    this.held = {};
    this.edges = {};
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  // ----- 공통 규격 (서버 MiniGame 과 같은 모양) -----
  clientOptions() {
    const config = {};
    for (const k of LOGIC_SECTIONS) config[k] = this.cfg[k];
    config.FLOW = this.cfg.FLOW;
    return { config, rounds: this.schedule.length };
  }

  start(now) {
    this._beginRound(1, now);
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) this.finished = true;
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || data.k !== 'in' || !this.held[playerId]) return;
    this._advance(now);
    if (this.phase !== 'fight') return;
    const held = this.held[playerId];
    held.lean = data.lean === -1 || data.lean === 1 ? data.lean : 0;
    const push = !!data.push;
    if (push && !held.push) this.edges[playerId].push = true;
    held.push = push;
    held.hold = !!data.hold;
    if (data.feint === true) this.edges[playerId].feint = true;
  }

  stateFor(_playerId, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  // ----- 진행 -----
  _beginRound(round, now) {
    this.round = round;
    const plan = this.schedule[round - 1];
    const seed = (this.cfg.MATCH.SEED | 0) + round * 101;
    const cfg = { ...this.cfg, MATCH: { ...this.cfg.MATCH, SEED: seed } };
    this.duels = plan.matches.map(([a, b]) => {
      const match = new Match({ cfg, playerName: this.names.get(a), playerLook: 'p1', cpuName: this.names.get(b), cpuLook: 'p2' });
      return { match, a, b, hitstopPending: 0 };
    });
    for (const id of this.ids) {
      this.held[id] = { lean: 0, push: false, hold: false };
      this.edges[id] = { feint: false, push: false };
    }
    this.countdownAt = now + this.cfg.FLOW.INTRO_TIME;
    this.startAt = this.countdownAt + this.cfg.MATCH.COUNTDOWN;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.phase = 'intro';
  }

  _advance(now) {
    const F = this.cfg.FLOW;
    for (let i = 0; i < 6; i++) {
      if (this.phase === 'intro') {
        if (now < this.countdownAt) return;
        this.phase = 'countdown';
      } else if (this.phase === 'countdown') {
        if (now < this.startAt) return;
        this.phase = 'fight';
        for (const d of this.duels) d.match.start();
      } else if (this.phase === 'fight') {
        this._simulate(now);
        if (this.phase === 'fight') return;
      } else if (this.phase === 'result') {
        if (now < this.phaseUntil) return;
        if (this.round < this.schedule.length) {
          this._beginRound(this.round + 1, this.phaseUntil);
        } else {
          this.results = this._buildResults();
          this.phase = 'final';
          this.phaseUntil += F.FINAL_TIME;
        }
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
      } else {
        return;
      }
    }
  }

  _inputFor(id) {
    const held = this.held[id];
    const edge = this.edges[id];
    return { lean: held.lean, pushDown: held.push || edge.push, feintPressed: edge.feint, holdDown: held.hold };
  }

  _simulate(now) {
    const target = Math.floor((now - this.startAt) * LOGIC_FPS + 1e-6);
    const holdFrames = Math.round(this.cfg.FLOW.END_HOLD * LOGIC_FPS);
    const J = this.cfg.JUICE;
    while (this.simFrame < target) {
      this.duels.forEach((d, index) => {
        const m = d.match;
        m.update(1, this._inputFor(d.a), this._inputFor(d.b));
        let stop = 0;
        for (const e of m.drainEvents()) {
          // 맞은 순간 멈춤 (원본에서는 화면이 정하던 값. 서버와 같은 규칙)
          if (e.type === 'hit') stop = Math.max(stop, e.charged ? J.HITSTOP_CHARGE : J.HITSTOP_PUSH);
          else if (e.type === 'clash') stop = Math.max(stop, J.HITSTOP_CLASH);
          else if (e.type === 'whiff' || e.type === 'feintHold') stop = Math.max(stop, J.HITSTOP_WHIFF);
          else if (e.type === 'blocked') stop = Math.max(stop, J.HITSTOP_HOLD);
          this._outbox.push([null, 'event', this._eventOut(e, d, index)]);
        }
        if (stop) m.hitstop = Math.max(m.hitstop, stop);
      });
      for (const id of this.ids) {
        this.edges[id].feint = false;
        this.edges[id].push = false;
      }
      this.simFrame++;
      if (this.allOverFrame === null && this.duels.every((d) => d.match.over)) this.allOverFrame = this.simFrame;
      if (this.allOverFrame !== null && this.simFrame >= this.allOverFrame + holdFrames) {
        this._endRound();
        return;
      }
    }
  }

  /** 원본 사건(선수 객체가 들어 있음) → 서버와 같은 형식(자리 이름 'a' | 'b') */
  _eventOut(e, d, index) {
    const m = d.match;
    const key = (f) => (f === m.player ? 'a' : 'b');
    const side = (w) => (w === 'player' ? 'a' : w === 'cpu' ? 'b' : 'draw');
    const out = { type: e.type, match: index };
    for (const field of ['who', 'attacker', 'defender', 'feinter', 'holder', 'a', 'b']) {
      if (e[field]) out[field] = key(e[field]);
    }
    for (const field of ['charged', 'power', 'kind', 'dir']) {
      if (e[field] !== undefined) out[field] = e[field];
    }
    if (e.type === 'timeUp') out.winner = side(e.winner);
    if (e.type === 'matchEnd') out.result = this._resultOut(m);
    return out;
  }

  _resultOut(m) {
    const r = m.result;
    if (!r) return null;
    const winner = r.winner === 'player' ? 'a' : r.winner === 'cpu' ? 'b' : 'draw';
    return { winner, reason: r.reason, timeLeft: r.timeLeft, stability: { a: r.playerStability, b: r.cpuStability } };
  }

  /** 점수 — 서버 Duel.score_of 와 같은 공식 */
  _scoreOf(m, key) {
    const S = this.cfg.SCORE;
    const f = key === 'a' ? m.player : m.cpu;
    const res = this._resultOut(m) || { winner: 'draw', reason: 'time', timeLeft: 0, stability: { a: 0, b: 0 } };
    const won = res.winner === key;
    const stability = Math.floor(res.stability[key] + 0.5);
    const timeLeft = Math.floor(res.timeLeft);
    const feints = Math.min(f.stats.cleanFeints, S.FEINT_MAX_COUNT);
    const timeCounts = won && (!S.TIME_ONLY_ON_KO || res.reason === 'ko');
    const breakdown = [
      { key: 'win', label: '승리 보너스', count: won ? 1 : 0, points: won ? S.WIN_BONUS : 0 },
      { key: 'balance', label: '남은 균형', count: stability, points: stability * S.BALANCE_POINT },
      { key: 'feint', label: '페인트 성공', count: feints, points: feints * S.FEINT_POINT },
      { key: 'hold', label: '버티기 성공', count: f.stats.holdsSucceeded, points: f.stats.holdsSucceeded * S.HOLD_POINT },
      { key: 'push', label: '밀기 명중', count: f.stats.pushesLanded, points: f.stats.pushesLanded * S.PUSH_POINT },
      { key: 'time', label: '남은 시간', count: timeCounts ? timeLeft : 0, points: timeCounts ? timeLeft * S.TIME_POINT : 0 },
    ];
    return { total: breakdown.reduce((sum, b) => sum + b.points, 0), breakdown };
  }

  _endRound() {
    this.roundResults = this.duels.map((d) => {
      const res = this._resultOut(d.match) || { winner: 'draw', reason: 'time' };
      const scores = {};
      for (const [key, id] of [['a', d.a], ['b', d.b]]) {
        const sc = this._scoreOf(d.match, key);
        scores[id] = sc;
        const st = this.standings[id];
        st.matches += 1;
        st.score += sc.total;
        if (res.winner === 'draw') st.draws += 1;
        else if (res.winner === key) st.wins += 1;
        else st.losses += 1;
      }
      const winner = res.winner === 'draw' ? null : res.winner === 'a' ? d.a : d.b;
      return { a: d.a, b: d.b, winner, reason: res.reason, scores };
    });
    this.phase = 'result';
    this.phaseUntil = this.startAt + this.simFrame / LOGIC_FPS + this.cfg.FLOW.RESULT_TIME;
  }

  _buildResults() {
    const rows = this.players.map((p, order) => {
      const st = this.standings[p.id];
      return {
        playerId: p.id, name: p.name, score: st.score, rank: 0, isWinner: false,
        stats: { wins: st.wins, draws: st.draws, losses: st.losses, matches: st.matches }, order,
      };
    });
    rows.sort((x, y) => y.stats.wins - x.stats.wins || y.score - x.score || x.order - y.order);
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      r.rank = prev && prev.stats.wins === r.stats.wins && prev.score === r.score ? prev.rank : i + 1;
    });
    for (const r of rows) {
      r.isWinner = r.rank === 1;
      delete r.order;
    }
    return rows;
  }

  _fighterOut(f, id) {
    return {
      id, b: f.body.b, v: f.body.v, state: f.state, stateFrame: f.stateFrame, charge: f.charge, charged: !!f.charged,
      stamina: f.stamina, fallen: f.fallen, fallDir: f.fallDir, fallT: f.fallT, won: f.won, frozen: f.frozen,
      flash: f.flash, squash: f.squash, lean: f.leanInput, cleanFeints: f.stats.cleanFeints,
    };
  }

  snapshot(now) {
    const plan = this.round ? this.schedule[this.round - 1] : { matches: [], resting: [] };
    const standings = {};
    for (const id of this.ids) standings[id] = { ...this.standings[id] };
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.schedule.length,
      now,
      countdownAt: this.countdownAt,
      startAt: this.startAt,
      matches: plan.matches.map(([a, b]) => ({ a, b })),
      resting: [...plan.resting],
      duels: this.duels.map((d) => ({
        frame: d.match.frame, hitstop: d.match.hitstop, running: d.match.running, over: d.match.over,
        result: this._resultOut(d.match), timeLeft: d.match.timeLeft, wobble: d.match.wobble,
        a: this._fighterOut(d.match.player, d.a), b: this._fighterOut(d.match.cpu, d.b),
      })),
      standings,
      roundResults: this.phase === 'result' ? this.roundResults : null,
      results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
    };
  }

  _emit(now, force = false) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'countdown' || this.phase === 'fight';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 가끔 밀고, 버티고, 손을 빼고, 기울면 가운데로 돌아온다.
 * @returns {(sim: PalmSim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const plans = new Map(); // botId → { until(프레임), push, hold, next(프레임) }
  let round = 0;
  return (sim) => {
    if (sim.round !== round) {
      round = sim.round;
      plans.clear();
    }
    if (sim.phase !== 'fight') return [];
    const out = [];
    for (const id of botIds) {
      const duel = sim.duels.find((d) => d.a === id || d.b === id);
      if (!duel || duel.match.over) continue;
      const f = duel.a === id ? duel.match.player : duel.match.cpu;
      let plan = plans.get(id);
      if (!plan) {
        plan = { until: 0, push: false, hold: false, next: 30 + Math.floor(rng() * 40), sent: '' };
        plans.set(id, plan);
      }
      const t = sim.simFrame;
      let feint = false;
      if (t >= plan.until) {
        plan.push = false;
        plan.hold = false;
      }
      if (t >= plan.next) {
        const r = rng();
        if (r < 0.5) { plan.push = true; plan.until = t + 3; }                         // 툭 밀기
        else if (r < 0.65) { plan.push = true; plan.until = t + 25 + Math.floor(rng() * 30); } // 차지
        else if (r < 0.85) { plan.hold = true; plan.until = t + 30; }                  // 버티기
        else feint = true;                                                             // 손빼기
        plan.next = t + 40 + Math.floor(rng() * 50);
      }
      const b = f.body.b;
      const lean = b > 15 ? -1 : b < -15 ? 1 : 0;
      const key = `${lean}|${plan.push}|${plan.hold}`;
      if (key !== plan.sent || feint) {
        plan.sent = key;
        const data = { k: 'in', lean, push: plan.push, hold: plan.hold };
        if (feint) data.feint = true;
        out.push({ playerId: id, data });
      }
    }
    return out;
  };
}
