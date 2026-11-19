// =============================================================
// Sim — 시험용(LocalSession 전용) 잭팟 탁구왕 진행기
//
// 실제 판정은 Python 서버(server/party/games/pingpong/)가 한다.
// 이 파일은 서버 없이 화면과 입력을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI(Gemini)는 없다 — 해설은 기본 대사 몇 줄만 나오고 총평(verdict)은 보내지 않는다.
// 시험용 봇은 원본의 CPU 선수(js/ai.js)를 옮긴 것이다. 실제 게임에는 CPU 선수가 없다.
// =============================================================
import { LOGIC_FPS, mergeConfig } from './config.js';
import { Duel } from './rules.js';

const CASTER = '해설자';

/** 시험용 기본 대사 (서버 game.py 의 SAY_CANNED 중 일부) */
const SAY_CANNED = {
  start: ['자, 탁구대 앞에 섰습니다!', '잭팟 탁구왕, 서브 준비!'],
  rally: ['랠리가 끝날 줄 모릅니다!', '주고받고, 또 주고받고!'],
  smash: ['{name}, 벼락같은 스매시!', '{name}의 스매시가 꽂혔습니다!'],
  drop: ['{name}, 살짝 떨어뜨렸습니다!', '{name}의 절묘한 드롭샷!'],
  miss: ['아, {name} 아쉬운 실수!', '{name}, 힘이 너무 들어갔네요!'],
  deuce: ['듀스! 이제 두 점 차 승부!', '2대2, 승부는 원점입니다!'],
  matchpoint: ['{name}, 매치포인트!', '{name}, 한 점만 더!'],
  comeback: ['{name}, 뒤집었습니다!', '{name}의 짜릿한 역전!'],
  win: ['게임 셋! {name} 승리!', '{name}, 탁구왕에 한 걸음 더!'],
};

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

/** 공통 결과 형식 — 서버 rank_results 와 같다 (점수 내림차순, 동점은 같은 순위) */
function rankResults(rows) {
  const out = rows.map((r, i) => ({ ...r, rank: 0, isWinner: false, _i: i }));
  out.sort((a, b) => b.score - a.score || a._i - b._i);
  out.forEach((r, i) => {
    r.rank = i > 0 && r.score === out[i - 1].score ? out[i - 1].rank : i + 1;
  });
  const top = out.length ? out[0].score : 0;
  for (const r of out) {
    r.isWinner = r.score === top;
    delete r._i;
  }
  return out;
}

export class Sim {
  static id = 'pingpong';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig((options && options.config) || {});
    this.F = this.cfg.FLOW;
    this.rng = rng;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.names = new Map(this.players.map((p) => [p.id, p.name]));
    this.ids = this.players.map((p) => p.id);
    this.schedule = makeSchedule(this.ids, rng, Math.max(1, this.F.ROUNDS_FOR_TWO | 0));
    this.standings = {};
    for (const id of this.ids) this.standings[id] = { wins: 0, losses: 0, scored: 0, conceded: 0, matches: 0, bestRally: 0 };
    this.phase = 'idle';
    this.round = 0;
    this.duels = [];
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this.held = {};
    this.pressed = {};
    for (const id of this.ids) {
      this.held[id] = 0;
      this.pressed[id] = false;
    }
    this._sayAt = new Map();
    this._trail = [];
    this._rallySaid = [];
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  clientOptions() {
    const C = this.cfg;
    return { rounds: this.schedule.length, gamePoints: C.GAME_POINTS, deuceCap: C.DEUCE_CAP, matchIntro: C.MATCH_INTRO, caster: CASTER };
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _event(data) {
    this._outbox.push([null, 'event', data]);
  }

  start(now) {
    this._beginRound(1, now);
    this._emit(now, true);
  }

  _beginRound(roundNo, at) {
    this.round = roundNo;
    const plan = this.schedule[roundNo - 1];
    this.duels = plan.matches.map(([a, b]) => new Duel(this.cfg, { id: a, name: this.names.get(a) }, { id: b, name: this.names.get(b) }, this.rng));
    for (const id of this.ids) {
      this.held[id] = 0;
      this.pressed[id] = false;
    }
    this.startAt = at + this.F.INTRO_TIME;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this._sayAt = new Map();
    this._trail = this.duels.map(() => [0, 0]);
    this._rallySaid = this.duels.map(() => false);
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
      if (this.phase === 'intro') {
        if (now < this.startAt) return;
        this.phase = 'fight';
        this._say(null, 'start', this.startAt, '', true);
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
      const t = this.startAt + this.simFrame / LOGIC_FPS;
      this.duels.forEach((d, index) => {
        const a = d.left.playerId;
        const b = d.right.playerId;
        if (d.step(this._inputFor(a), this._inputFor(b))) {
          this.pressed[a] = false;
          this.pressed[b] = false;
        }
        for (const ev of d.popEvents()) {
          this._event({ ...ev, match: index });
          this._commentate(index, d, ev, t);
        }
      });
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
    return { back: !!(h & 1), fwd: !!(h & 2), hit: !!(h & 4), hitPressed: this.pressed[id] };
  }

  // ---- 해설 (기본 대사만) ----
  _say(match, kind, t, name = '', force = false) {
    const last = this._sayAt.get(match);
    if (!force && last !== undefined && t - last < this.F.SAY_GAP) return;
    const pool = SAY_CANNED[kind] || [];
    if (!pool.length) return;
    const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', name);
    this._sayAt.set(match, t);
    this._event({ type: 'say', text, source: 'canned', who: CASTER, kind, match });
  }

  _commentate(index, d, ev, t) {
    if (ev.type === 'serve') this._rallySaid[index] = false;
    else if (ev.type === 'hit' && ev.rally >= this.F.LONG_RALLY && !this._rallySaid[index]) {
      this._rallySaid[index] = true;
      this._say(index, 'rally', t);
    } else if (ev.type === 'end') this._say(index, 'win', t, d.fighters[ev.winner].name, true);
    else if (ev.type === 'point') {
      const side = ev.side;
      const scorer = d.fighters[side];
      const other = d.fighters[1 - side];
      const trail = this._trail[index];
      const before = scorer.pts - 1 - other.pts;
      trail[1 - side] = Math.max(trail[1 - side], scorer.pts - other.pts);
      if (d.winner) return;
      if (trail[side] >= 2 && before <= 0 && scorer.pts - other.pts > 0) {
        trail[side] = 0;
        this._say(index, 'comeback', t, scorer.name);
      } else if (d.isDeuce) this._say(index, 'deuce', t);
      else if (d.matchPointSide !== null) this._say(index, 'matchpoint', t, d.fighters[d.matchPointSide].name);
      else if (ev.reason === 'smash') this._say(index, 'smash', t, scorer.name);
      else if (['net', 'out', 'serveFault', 'ownCourt'].includes(ev.reason)) this._say(index, 'miss', t, other.name);
      else if (ev.shot === 'drop' && ev.hitter === side) this._say(index, 'drop', t, scorer.name);
    }
  }

  // ---- 결과 ----
  _endRound() {
    this.roundResults = [];
    for (const d of this.duels) {
      const winner = d.winner || (d.left.pts >= d.right.pts ? d.left : d.right);
      for (const f of d.fighters) {
        const o = f === d.left ? d.right : d.left;
        const st = this.standings[f.playerId];
        st.matches++;
        st.scored += f.pts;
        st.conceded += o.pts;
        st.bestRally = Math.max(st.bestRally, d.bestRally);
        if (f === winner) st.wins++;
        else st.losses++;
      }
      this.roundResults.push({ a: d.left.playerId, b: d.right.playerId, winner: winner.playerId, pts: [d.left.pts, d.right.pts], bestRally: d.bestRally });
    }
    this.phase = 'result';
    this.phaseUntil = this.startAt + this.simFrame / LOGIC_FPS + this.F.RESULT_TIME;
  }

  _score(st) {
    const S = this.cfg.SCORE;
    return Math.max(0, st.matches * S.BASE + st.wins * S.WIN + (st.scored - st.conceded) * S.DIFF);
  }

  _buildResults() {
    return rankResults(this.ids.map((id) => {
      const st = this.standings[id];
      return {
        playerId: id, name: this.names.get(id), score: this._score(st),
        stats: { wins: st.wins, losses: st.losses, scored: st.scored, conceded: st.conceded, matches: st.matches, bestRally: st.bestRally },
      };
    }));
  }

  // ---- 입력 ----
  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || data.k !== 'in' || !(playerId in this.held)) return;
    this._advance(now);
    if (this.phase !== 'fight') return;
    if (Number.isInteger(data.held)) this.held[playerId] = data.held & 7;
    if (Array.isArray(data.press) && data.press.slice(0, 4).includes('hit')) this.pressed[playerId] = true;
  }

  snapshot(now) {
    const plan = this.round ? this.schedule[this.round - 1] : { matches: [], resting: [] };
    const standings = {};
    for (const id of this.ids) standings[id] = { ...this.standings[id], score: this._score(this.standings[id]) };
    return {
      phase: this.phase, round: this.round, rounds: this.schedule.length, now,
      startAt: this.startAt, simFrame: this.simFrame,
      matches: plan.matches.map(([a, b]) => ({ a, b })),
      resting: plan.resting.slice(),
      duels: this.duels.map((d) => d.snapshot()),
      standings,
      roundResults: this.phase === 'result' ? this.roundResults : null,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
      verdict: null,
    };
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

// =============================================================
// 시험용 봇 — 원본 CPU 선수(js/ai.js PaddleAI)를 옮긴 것.
//  공이 내 쪽으로 오면 어디서 칠지 미리 계산해 그 자리로 가고, 공이 라켓에 올 즈음 휘두른다.
//  level 0~1: 높을수록 빠르고 정확하다. 사람처럼 "누르고 있는 키"만 내놓는다.
// =============================================================
class BotBrain {
  constructor(level, rng) {
    this.level = level;
    this.rng = rng;
    this.plan = null;      // { x(설 자리), hitTick(칠 때의 공 시각), shot }
    this.planFor = null;   // 어떤 타구에 대한 계획인지
    this.serveWait = 0;
    this.tapUntil = -1;    // 톡 치는 중이면 뗄 시각(경기 프레임)
  }

  /** → 누르고 있을 키 비트 (1 후진, 2 전진, 4 치기) */
  control(me, duel) {
    const ball = duel.ball;
    const L = this.level;
    const P = duel.cfg.PLAYER;
    let held = 0;
    const moveTo = (x) => {
      const d = x - me.x;
      if (Math.abs(d) > 2) held |= d * me.facing > 0 ? 2 : 1;
    };
    if (duel.frozen) return 0;
    if (duel.frame < this.tapUntil) held |= 4;

    // 서브: 잠깐 뜸 들이고 톡
    if (ball.state === 'held') {
      if (duel.server === me && duel.state === 'serve') {
        if (++this.serveWait > 20 + this.rng() * 15) {
          this.serveWait = 0;
          this.tapUntil = duel.frame + 2;
          held |= 4;
        }
      }
      moveTo(me.homeX);
      return held;
    }

    // 서브가 아직 서버 쪽 코트에 튀기 전이면 기다림 (튄 뒤에 방향이 정해짐)
    const incoming = ball.state === 'flight' && ball.lastHitter !== me.side && !ball.netHit && ball.serveStage !== 1;
    if (!incoming) {
      this.plan = null;
      moveTo(me.homeX);
      return held;
    }

    // 새 타구면 어디서 칠지 계산 (공을 복제해서 미리 굴려 봄)
    const key = `${ball.lastHitter}:${duel.rally}:${ball.serveStage}`;
    if (this.planFor !== key) {
      this.planFor = key;
      this.plan = this.predict(me, ball);
      if (this.plan) {
        const plan = this.plan;
        // 실력이 낮을수록 위치·타이밍이 어긋남
        plan.x += (this.rng() - 0.5) * (1 - L) * 22;
        plan.hitTick += Math.round((this.rng() - 0.5) * (1 - L) * 8);
        const r = this.rng();
        if (ball.chance && r < 0.3 + L * 0.6) plan.shot = 'smash';
        else if (r < 0.12 + L * 0.1) plan.shot = 'drop';
        else if (r < 0.22 + L * 0.05) plan.shot = 'lob';
        else plan.shot = 'drive';
        // 랠리가 길어질수록 실수할 확률이 올라감
        const tired = Math.min(0.45, duel.rally * 0.022);
        if (this.rng() < 0.05 + (1 - L) * 0.12 + tired) {
          plan.x += (this.rng() < 0.5 ? -1 : 1) * (24 + this.rng() * 10);
          plan.hitTick += this.rng() < 0.5 ? -6 : 6;
        }
        plan.tapped = false;
      }
    }
    const plan = this.plan;
    if (!plan) return held;
    const left = plan.hitTick - ball.ticks;   // 칠 때까지 남은 프레임
    moveTo(plan.x);
    if (plan.shot === 'smash') {
      // 스매시: 미리 꾹 눌러 모았다가 칠 때 떼기
      if (left <= P.CHARGE_TIME + 5 && left > 2) held |= 4;
    } else if (!plan.tapped && left <= 4) {
      plan.tapped = true;
      this.tapUntil = duel.frame + 2;
      held |= 4;
    }
    if (left <= 6) {
      if (plan.shot === 'drop') held = (held & ~1) | 2;
      if (plan.shot === 'lob') held = (held & ~2) | 1;
    }
    return held;
  }

  /** 공이 내 코트에 한 번 튄 뒤 라켓이 닿는 곳 중 치기 좋은 지점 */
  predict(me, ball) {
    const sim = ball.clone();
    const P = me.cfg.PLAYER;
    const top = me.cfg.FLOOR_Y - P.REACH_TOP + 4;
    const low = me.cfg.FLOOR_Y - P.REACH_LOW - 4;
    let bounced = sim.bounces;
    let last = null;
    for (let f = 1; f < 240; f++) {
      const ev = sim.step();
      for (const e of ev) if (e.type === 'bounce' && e.side === me.side) bounced++;
      if (ev.some((e) => e.type === 'floor' || e.type === 'out' || e.type === 'net')) break;
      if (bounced < 1 || sim.y < top || sim.y > low) continue;
      // 설 수 있는 곳에서 라켓이 닿는지 (탁구대에 바짝 붙어서 뻗는 것도 포함)
      const x = Math.max(me.minX, Math.min(me.maxX, sim.x - me.facing * 9));
      if (Math.abs(x + me.facing * 9 - sim.x) > P.REACH_X - 4) continue;
      const cand = { x, hitTick: sim.ticks };
      if (sim.vy > -0.5) return cand;
      last = cand;
    }
    return last;
  }
}

/**
 * 시험용 봇 만들기.
 * @returns {(sim: Sim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const brains = new Map(botIds.map((id, i) => [id, new BotBrain(0.45 + (i % 3) * 0.2, rng)]));
  const sent = new Map();
  let round = 0;
  return (sim) => {
    if (sim.round !== round) {
      round = sim.round;
      sent.clear();
    }
    if (sim.phase !== 'fight') return [];
    const out = [];
    for (const id of botIds) {
      const duel = sim.duels.find((d) => d.left.playerId === id || d.right.playerId === id);
      if (!duel) continue;
      const me = duel.left.playerId === id ? duel.left : duel.right;
      const held = brains.get(id).control(me, duel);
      const before = sent.get(id) || 0;
      if (held !== before) {
        sent.set(id, held);
        const data = { k: 'in', held };
        if (held & 4 && !(before & 4)) data.press = ['hit'];
        out.push({ playerId: id, data });
      }
    }
    return out;
  };
}
