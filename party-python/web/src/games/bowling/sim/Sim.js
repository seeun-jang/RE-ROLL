// =============================================================
// Sim — 시험용(LocalSession 전용) 잭팟 볼링 진행기
//
// 실제 판정은 Python 서버(server/party/games/bowling/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 가 없으므로 해설(say)은 기본 대사만, 총평(verdict)은 보내지 않는다.
// =============================================================
import {
  aimAngle, aimPhase0, frameState, isSplit, mergeConfig, powerAt, runningScore, simulateThrow, throwSeed,
} from './rules.js';

const CASTER = '해설자';
const SAY_CANNED = {
  start: ['잭팟 볼링, 지금 시작합니다!'],
  strike: ['{name} 스트라이크!'],
  double: ['{name} 더블! 두 번 연속입니다!'],
  turkey: ['{name} 터키! 아무도 못 말립니다!'],
  spare: ['{name} 깔끔한 스페어!'],
  split: ['{name} 스플릿! 어렵게 남았네요!'],
  gutter: ['{name} 거터! 아깝습니다!'],
  jackpot: ['{name} 잭팟 핀 명중! 보너스!'],
  lead: ['{name} 선두로 올라섭니다!'],
  last: ['이제 마지막 프레임입니다!'],
};
const SAY_ORDER = ['turkey', 'double', 'strike', 'lead', 'jackpot', 'spare', 'split', 'gutter'];
const ALL_UP = () => [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export class Sim {
  static id = 'bowling';

  static tickHz = 20;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.cfg = mergeConfig(options && options.config);
    this.R = this.cfg.RULES;
    this.F = this.cfg.FLOW;
    this.T = this.cfg.THROW;
    this.N = this.cfg.FRAMES;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    this.seed = Math.floor(rng() * 2147483648);
    this.golds = [];
    for (let f = 0; f < this.N; f++) {
      const row = [];
      for (let k = 0; k < (f === this.N - 1 ? 3 : 1); k++) row.push(this._randomGold());
      this.golds.push(row);
    }
    this.P = {};
    for (const id of this.ids) {
      this.P[id] = {
        rolls: [], bonus: 0, strikes: 0, spares: 0, streak: 0, bestStreak: 0, gutters: 0, splits: 0, jackpots: 0,
        n: 0, up: ALL_UP(), gold: this.golds[0][0], rack: 0, x: 0,
        aimAt: 0, deadline: 0, doneAt: 0, done: false, away: false,
      };
    }
    this.phase = 'idle';
    this.startAt = 0;
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this._finalAt = 0;
    this._lastStateAt = -1;
    this._says = [];
    this._lastSayAt = -99;
    this._leader = null;
    this._lastFrameSaid = false;
    this._outbox = [];
  }

  _randomGold() {
    return this.rng() < this.cfg.JACKPOT_CHANCE ? Math.floor(this.rng() * 10) : -1;
  }

  clientOptions() {
    return {
      frames: this.N, seed: this.seed, golds: this.golds,
      intro: this.R.INTRO_TIME, throwLimit: this.R.THROW_LIMIT, jackpotBonus: this.cfg.JACKPOT_BONUS,
    };
  }

  start(now) {
    this.startAt = now + this.R.INTRO_TIME;
    this.phase = 'intro';
    for (const id of this.ids) this._openTurn(this.P[id], this.startAt);
    this._queueSay('start', '', now + 0.5, 5);
    this._emit(now, true);
  }

  _openTurn(st, at) {
    st.aimAt = at;
    st.deadline = at + this.R.THROW_LIMIT;
  }

  tick(now) {
    const before = this.phase;
    if (this.phase === 'intro' && now >= this.startAt) this.phase = 'play';
    if (this.phase === 'play') {
      for (const id of this.ids) {
        const st = this.P[id];
        if (st.done) continue;
        const limit = st.away ? st.aimAt + this.R.AWAY_LIMIT : st.deadline + this.R.GRACE;
        if (now >= limit) this._autoThrow(id, now);
      }
      if (this.ids.every((id) => this.P[id].done && now >= this.P[id].doneAt)) {
        this.finalResults = this.buildResults();
        this.phase = 'final';
        this._finalAt = now;
      }
    }
    if (this.phase === 'final' && now >= this._finalAt + this.R.FINAL_TIME) this.phase = 'done';
    this._flushSays(now);
    this._emit(now, this.phase !== before);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    const st = this.P[playerId];
    if (!st || !data || typeof data !== 'object' || data.k !== 'throw') return;
    if (this.phase !== 'play' || st.done) return;
    if (data.n !== st.n || now < st.aimAt - this.R.EARLY) return;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    let x = num(data.x);
    let angle = num(data.angle);
    let power = num(data.power);
    if (x === null || angle === null || power === null || !Array.isArray(data.spin)) return;
    x = Math.max(-this.T.START_RANGE, Math.min(this.T.START_RANGE, x));
    angle = Math.max(-this.T.AIM_MAX, Math.min(this.T.AIM_MAX, angle));
    power = Math.max(0, Math.min(1, power));
    const spin = data.spin.slice(0, this.R.MAX_SPIN_FRAMES).map((v) => (v === -1 || v === 1 ? v : 0));
    this._throw(playerId, x, angle, power, spin, now, false, spin.length);
  }

  _autoThrow(id, now) {
    const st = this.P[id];
    const frames = Math.max(0, Math.floor((now - st.aimAt) * this.F.FPS));
    const angle = Math.round(aimAngle(this.cfg, aimPhase0(this.seed, st.n), frames) * 10000) / 10000;
    const power = Math.round(powerAt(this.cfg, frames) * 1000) / 1000;
    this._throw(id, st.x, angle, power, [], now, true, 0);
  }

  /** 투구 하나를 판정한다: 핀 물리 → 프레임 점수 → 다음 핀 배치 → 결과 사건 */
  _throw(id, x, angle, power, spin, now, auto, rolled) {
    const st = this.P[id];
    const n = st.n;
    const sum = (a) => a.reduce((p, q) => p + q, 0);
    const frameBefore = frameState(st.rolls, this.N).frame;
    const fresh = sum(st.up) === 10;
    const res = simulateThrow(this.cfg, st.up, st.gold, x, angle, power, spin, throwSeed(this.seed, n));
    const { up, knocked } = res;
    st.rolls.push(knocked);
    st.n = n + 1;
    st.x = x;

    let kind = null;
    if (fresh && knocked === 10) {
      kind = 'strike';
      st.strikes++;
      st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
    } else if (!fresh && sum(up) === 0) {
      kind = 'spare';
      st.spares++;
    } else if (knocked === 0 && res.gutter) {
      kind = 'gutter';
      st.gutters++;
    } else if (fresh && isSplit(this.cfg, up)) {
      kind = 'split';
      st.splits++;
    }
    if (fresh && knocked !== 10) st.streak = 0;
    if (res.goldHit) {
      st.bonus += this.cfg.JACKPOT_BONUS;
      st.jackpots++;
    }

    const fs = frameState(st.rolls, this.N);
    let next = null;
    if (fs.done) st.done = true;
    else {
      if (fs.frame > frameBefore) {
        st.rack = 0;
        next = { reset: true, up: ALL_UP(), gold: this.golds[fs.frame][0] };
      } else if (sum(up) === 0) {
        st.rack++;
        next = { reset: true, up: ALL_UP(), gold: this.golds[fs.frame][Math.min(st.rack, 2)] };
      } else next = { reset: false, up: [...up], gold: st.gold };
      st.up = [...next.up];
      st.gold = next.gold;
    }

    const show = kind ? this.F.SHOW_ANIM : res.goldHit ? this.F.SHOW_JACKPOT : this.F.SHOW_PLAIN;
    const countAt = now + Math.max(0, res.frames - rolled) / this.F.FPS;
    if (st.done) st.doneAt = countAt + show / this.F.FPS;
    else this._openTurn(st, countAt + (show + this.F.SWEEP_TIME) / this.F.FPS);

    this._outbox.push([id, 'event', {
      type: 'roll', n, auto, x, angle, power, spin, knocked, up, gutter: res.gutter, kind, streak: st.streak,
      jackpot: res.goldHit, rolls: [...st.rolls], bonus: st.bonus, strikes: st.strikes, spares: st.spares,
      done: st.done, next, aimAt: st.aimAt, deadline: st.deadline,
    }]);

    const said = new Set();
    if (kind === 'strike') said.add(st.streak >= 3 ? 'turkey' : st.streak === 2 ? 'double' : 'strike');
    else if (kind) said.add(kind);
    if (res.goldHit) said.add('jackpot');
    if (this._leadChanged(id)) said.add('lead');
    const first = SAY_ORDER.find((k) => said.has(k));
    if (first) this._queueSay(first, this.names[id], countAt);
    if (!this._lastFrameSaid && !st.done && fs.frame === this.N - 1) {
      this._lastFrameSaid = true;
      this._queueSay('last', '', st.aimAt, 5);
    }
  }

  total(id) {
    return runningScore(this.P[id].rolls, this.N) + this.P[id].bonus;
  }

  _leadChanged(id) {
    const totals = this.ids.map((p) => this.total(p));
    const top = Math.max(...totals);
    const leaders = this.ids.filter((p, i) => totals[i] === top);
    if (top <= 0 || leaders.length !== 1 || leaders[0] === this._leader) return false;
    const changed = this._leader !== null && leaders[0] === id;
    this._leader = leaders[0];
    return changed;
  }

  _queueSay(kind, name, at, ttl = 1) {
    this._says.push({ kind, name, at, ttl });
  }

  _flushSays(now) {
    const keep = [];
    for (const s of this._says) {
      if (now < s.at) keep.push(s);
      else if (now > s.at + s.ttl) continue;      // 너무 늦었으면 말하지 않는다
      else if (now - this._lastSayAt >= this.R.SAY_GAP) {
        const pool = SAY_CANNED[s.kind] || [];
        if (pool.length) {
          const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', s.name);
          this._lastSayAt = now;
          this._outbox.push([null, 'event', { type: 'say', text, source: 'canned', who: CASTER, kind: s.kind }]);
        }
      } else keep.push(s);
    }
    this._says = keep;
  }

  /** 순위: 합계(볼링 + 잭팟) → 스트라이크 수 → 스페어 수. 셋 다 같으면 공동 순위 */
  buildResults() {
    const rows = this.ids.map((id, order) => {
      const st = this.P[id];
      const bowling = runningScore(st.rolls, this.N);
      return {
        playerId: id, name: this.names[id], score: bowling + st.bonus, rank: 0, isWinner: false,
        stats: {
          bowling, bonus: st.bonus, strikes: st.strikes, spares: st.spares,
          bestStreak: st.bestStreak, gutters: st.gutters, splits: st.splits, rolls: [...st.rolls],
        },
        order,
      };
    });
    const same = (a, b) => a.score === b.score && a.stats.strikes === b.stats.strikes && a.stats.spares === b.stats.spares;
    rows.sort((a, b) => b.score - a.score || b.stats.strikes - a.stats.strikes || b.stats.spares - a.stats.spares || a.order - b.order);
    rows.forEach((r, i) => {
      r.rank = i > 0 && same(r, rows[i - 1]) ? rows[i - 1].rank : i + 1;
      r.isWinner = r.rank === 1;
      delete r.order;
    });
    return rows;
  }

  snapshot(now) {
    const players = {};
    for (const id of this.ids) {
      const st = this.P[id];
      players[id] = { rolls: [...st.rolls], bonus: st.bonus, total: this.total(id), strikes: st.strikes, spares: st.spares, done: st.done };
    }
    return {
      phase: this.phase, now, startAt: this.startAt, frames: this.N, players,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
      verdict: null,
    };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    const st = this.P[id];
    if (st) {
      snap.me = { n: st.n, up: [...st.up], gold: st.gold, x: st.x, aimAt: st.aimAt, deadline: st.deadline, done: st.done };
    }
    return snap;
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    if (force || now - this._lastStateAt >= 1 / this.R.STATE_HZ - 1e-9) {
      this._lastStateAt = now;
      for (const id of this.ids) this._outbox.push([id, 'state', this.stateFor(id, now)]);
    }
  }
}

/**
 * 시험용 봇 (원본 BowlBot 의 조준 방식): 핀 10개면 포켓(1번 핀 살짝 옆)을, 남은 핀이 있으면 그 가운데를 노린다.
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "throw" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const bots = new Map(botIds.map((id) => [id, { skill: 0.15 + rng() * 0.75, n: -1, at: 0 }]));
  return (sim, now) => {
    if (sim.phase !== 'play') return [];
    const out = [];
    const L = sim.cfg.LANE;
    for (const [id, bot] of bots) {
      const st = sim.P[id];
      if (!st || st.done || now < st.aimAt) continue;
      if (bot.n !== st.n) {
        bot.n = st.n;
        bot.at = st.aimAt + 1.5 + rng() * 2.5;     // 사람처럼 잠깐 조준
      }
      if (now < bot.at) continue;
      const s = bot.skill;
      const up = [];
      st.up.forEach((v, i) => { if (v) up.push(i); });
      const spots = up.map((i) => ({ row: i < 1 ? 0 : i < 3 ? 1 : i < 6 ? 2 : 3, i }));
      let target;
      if (up.length === 10) target = (rng() < 0.5 ? -1 : 1) * 2.2;
      else {
        // 남은 핀들의 가로 위치 평균
        const xs = spots.map(({ row, i }) => (i - [0, 1, 3, 6][row] - row / 2) * L.PIN_GAP_X);
        target = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      }
      target += (rng() - 0.5) * (1 - s) * 14;
      let startX = Math.max(-12, Math.min(12, (rng() - 0.5) * 16));
      const maxA = sim.T.AIM_MAX * 0.85;
      let ang = (target - startX) / L.HEAD_Y;
      if (Math.abs(ang) > maxA) {
        startX = target - Math.sign(ang) * maxA * L.HEAD_Y;
        ang = (target - startX) / L.HEAD_Y;
      }
      const round = (v, k) => Math.round(v * k) / k;
      out.push({
        playerId: id,
        data: { k: 'throw', n: st.n, x: round(startX, 100), angle: round(ang, 10000), power: round(0.6 + rng() * 0.35, 1000), spin: [] },
      });
      bot.n = -2;      // 같은 투구를 두 번 보내지 않게
    }
    return out;
  };
}
