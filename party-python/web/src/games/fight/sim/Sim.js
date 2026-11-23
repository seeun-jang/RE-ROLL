// =====================================================
// 시험용 진행기 (LocalSession 전용) — 서버 game.py 와 같은 모양의 메시지를 만든다.
// 실제 판정은 서버가 한다. 여기에는 AI 가 없어서 해설은 기본 대사 몇 줄만 나오고 총평은 없다.
// =====================================================
import { CONFIG } from '../config.js';
import { BoutCore, makeSchedule, rankResults } from './rules.js';

const FPS = 60;
const CASTER = '해설자';
// 기본 대사 (서버 SAY_CANNED 의 일부)
const CANNED = {
  start: ['땡! 경기 시작합니다!', '자, 주먹을 올리세요!'],
  big_hit: ['{name}의 강펀치 작렬!', '묵직하다! {name}!'],
  slip: ['{name} 슥! 카운터 찬스!'],
  counter: ['{name}의 카운터! 피해 2배!'],
  guard_break: ['{name}, 가드를 부쉈다!'],
  comeback: ['{name} 역전입니다!'],
  hurry: ['남은 시간 10초!', '시간이 없다! 몰아쳐라!'],
  ko: ['{name}의 KO 승리!', '쓰러졌다! {name} 승!'],
  decision: ['판정! {name} 승리!'],
};
const ALWAYS = ['start', 'ko', 'decision'];
const PRESS_BITS = { left: 1, right: 2, punch: 4, guard: 8 };

export class Sim {
  static tickHz = 30;

  constructor(players, options, rng = Math.random) {
    this.players = players.map((p) => ({ ...p }));
    this.rng = rng;
    this.flow = { ...CONFIG.FLOW, ...((options && options.flow) || {}) };
    this.ids = this.players.map((p) => p.id);
    this.byId = Object.fromEntries(this.players.map((p) => [p.id, p]));
    this.schedule = makeSchedule(this.ids, rng, this.flow.ROUNDS_FOR_TWO);
    this.standings = {};
    for (const id of this.ids) this.standings[id] = { wins: 0, losses: 0, kos: 0, hpLeft: 0, damage: 0, hits: 0, matches: 0 };
    this.phase = 'idle';
    this.round = 0;
    this.bouts = [];
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.finalResults = [];
    this.held = {};
    this.pressed = {};
    this.lastSay = {};
    this.trailing = {};
    this.finished = false;
    this.results = [];
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  clientOptions() {
    return { config: CONFIG, rounds: this.schedule.length };
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  sendState(data) {
    this._outbox.push([null, 'state', data]);
  }

  sendEvent(data) {
    this._outbox.push([null, 'event', data]);
  }

  start(now) {
    this.beginRound(1, now);
    this.emitState(now, true);
  }

  beginRound(n, now) {
    this.round = n;
    const plan = this.schedule[n - 1];
    this.bouts = plan.matches.map(([a, b]) => new BoutCore(this.byId[a], this.byId[b], this.rng));
    for (const id of this.ids) {
      this.held[id] = 0;
      this.pressed[id] = 0;
    }
    this.startAt = now + this.flow.INTRO_TIME;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.lastSay = {};
    this.trailing = {};
    this.phase = 'intro';
  }

  tick(now) {
    this.advance(now);
    this.emitState(now, false);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  advance(now) {
    for (let guard = 0; guard < 6; guard++) {
      if (this.phase === 'intro') {
        if (now < this.startAt) return;
        this.phase = 'fight';
      } else if (this.phase === 'fight') {
        this.simulate(now);
        if (this.phase === 'fight') return;
      } else if (this.phase === 'result') {
        if (now < this.phaseUntil) return;
        if (this.round < this.schedule.length) this.beginRound(this.round + 1, this.phaseUntil);
        else {
          this.finalResults = this.buildResults();
          this.phase = 'final';
          this.phaseUntil += this.flow.FINAL_TIME;
        }
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
      } else return;
    }
  }

  simulate(now) {
    const target = Math.floor((now - this.startAt) * FPS + 1e-6);
    const hold = Math.floor(this.flow.END_HOLD * FPS + 0.5);
    while (this.simFrame < target) {
      this.bouts.forEach((b, index) => {
        b.step(this.ctrl(b.red.playerId), this.ctrl(b.blue.playerId));
        for (const ev of b.popEvents()) {
          this.sendEvent({ ...ev, match: index });
          this.comment(index, b, ev);
        }
      });
      for (const id of this.ids) this.pressed[id] = 0;
      this.simFrame++;
      if (this.allOverFrame === null && this.bouts.every((b) => b.done)) this.allOverFrame = this.simFrame;
      if (this.allOverFrame !== null && this.simFrame >= this.allOverFrame + hold) {
        this.endRound();
        return;
      }
    }
  }

  ctrl(id) {
    const bits = this.held[id] | this.pressed[id];
    return { left: !!(bits & 1), right: !!(bits & 2), skillHeld: !!(bits & 4), down: !!(bits & 8) };
  }

  // 해설(기본 대사만)
  comment(index, b, ev) {
    let kind = null;
    let name = '';
    if (ev.type === 'start') kind = 'start';
    else if (ev.type === 'hurry') kind = 'hurry';
    else if (ev.type === 'ko') { kind = 'ko'; name = b.winner.name; }
    else if (ev.type === 'decision') { kind = 'decision'; name = b.winner.name; }
    else if (ev.type === 'hit' && !ev.ko) {
      const att = ev.side === 'red' ? b.red : b.blue;
      name = att.name;
      if (ev.slip) { kind = 'slip'; name = (att === b.red ? b.blue : b.red).name; }
      else if (this.isComeback(index, b)) kind = 'comeback';
      else if (ev.counter) kind = 'counter';
      else if (ev.broken) kind = 'guard_break';
      else if (ev.kind === 'power' && !ev.blocked) kind = 'big_hit';
    }
    if (!kind) return;
    const last = this.lastSay[index];
    if (!ALWAYS.includes(kind) && last !== undefined && this.simFrame - last < this.flow.SAY_GAP * FPS) return;
    const pool = CANNED[kind];
    const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', name);
    this.lastSay[index] = this.simFrame;
    this.sendEvent({ type: 'say', text, source: 'canned', who: CASTER, kind, match: index });
  }

  isComeback(index, b) {
    const diff = b.red.hp - b.blue.hp;
    const t = this.trailing[index];
    if ((t === 'red' && diff > 0) || (t === 'blue' && diff < 0)) {
      this.trailing[index] = null;
      return true;
    }
    if (diff <= -15) this.trailing[index] = 'red';
    else if (diff >= 15) this.trailing[index] = 'blue';
    return false;
  }

  endRound() {
    this.roundResults = this.bouts.map((b) => {
      for (const f of [b.red, b.blue]) {
        const st = this.standings[f.playerId];
        st.matches++;
        st.damage += f.damageDealt;
        st.hits += f.hits;
      }
      const sw = this.standings[b.winner.playerId];
      sw.wins++;
      sw.hpLeft += b.winner.hp;
      if (b.byKO) sw.kos++;
      this.standings[b.loser.playerId].losses++;
      return {
        red: b.red.playerId, blue: b.blue.playerId, winner: b.winner.playerId, byKO: b.byKO,
        hp: { red: b.red.hp, blue: b.blue.hp }, hits: { red: b.red.hits, blue: b.blue.hits },
      };
    });
    this.phase = 'result';
    this.phaseUntil = this.startAt + this.simFrame / FPS + this.flow.RESULT_TIME;
  }

  score(st) {
    const S = CONFIG.SCORE;
    return st.wins * S.WIN + st.kos * S.KO_BONUS + st.hpLeft * S.HP_BONUS;
  }

  buildResults() {
    return rankResults(this.ids.map((id) => ({
      playerId: id, name: this.byId[id].name, score: this.score(this.standings[id]), stats: { ...this.standings[id] },
    })));
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || data.k !== 'in' || !(playerId in this.held)) return;
    this.advance(now);
    if (this.phase !== 'fight') return;
    if (Number.isInteger(data.held)) this.held[playerId] = data.held & 15;
    if (Array.isArray(data.press)) {
      for (const key of data.press.slice(0, 8)) if (PRESS_BITS[key]) this.pressed[playerId] |= PRESS_BITS[key];
    }
  }

  snapshot(now) {
    const plan = this.round ? this.schedule[this.round - 1] : { matches: [], resting: [] };
    const standings = {};
    for (const id of this.ids) standings[id] = { ...this.standings[id], score: this.score(this.standings[id]) };
    return {
      phase: this.phase, round: this.round, rounds: this.schedule.length, now,
      startAt: this.startAt,
      matches: plan.matches.map(([red, blue]) => ({ red, blue })),
      resting: [...plan.resting],
      bouts: this.bouts.map((b) => b.snapshot()),
      standings,
      roundResults: this.phase === 'result' ? this.roundResults : null,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
      verdict: null,
    };
  }

  emitState(now, force) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'fight';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this.sendState(this.snapshot(now));
    }
  }
}

/** 시험용 봇: 다가가서 잽 · 가끔 강펀치 · 가끔 가드. (sim, t) → [{ playerId, data }] */
export function createBots(botIds, rng = Math.random) {
  const plans = new Map();
  return (sim) => {
    if (sim.phase !== 'fight') {
      plans.clear();
      return [];
    }
    const out = [];
    for (const id of botIds) {
      const b = sim.bouts.find((x) => x.red.playerId === id || x.blue.playerId === id);
      if (!b || b.state !== 'fight') continue;
      const me = b.red.playerId === id ? b.red : b.blue;
      const opp = me === b.red ? b.blue : b.red;
      let p = plans.get(id);
      if (!p) {
        p = { punchUntil: 0, guardUntil: 0, next: 20 + Math.floor(rng() * 40), sent: -1 };
        plans.set(id, p);
      }
      const t = b.frame;
      const dist = Math.abs(opp.x - me.x);
      if (t >= p.next && dist < 50) {
        const r = rng();
        if (r < 0.55) p.punchUntil = t + 3;                               // 잽
        else if (r < 0.8) p.punchUntil = t + 24 + Math.floor(rng() * 10); // 강펀치
        else p.guardUntil = t + 30;                                       // 가드
        p.next = t + 25 + Math.floor(rng() * 50);
      }
      let bits = 0;
      if (dist > 44) bits |= me.facing === 1 ? 2 : 1; // 상대 쪽으로 걷기
      if (t < p.punchUntil) bits |= 4;
      if (t < p.guardUntil) bits |= 8;
      if (bits !== p.sent) {
        const press = bits & 4 && !(p.sent & 4) ? ['punch'] : [];
        p.sent = bits;
        out.push({ playerId: id, data: { k: 'in', held: bits, press } });
      }
    }
    return out;
  };
}
