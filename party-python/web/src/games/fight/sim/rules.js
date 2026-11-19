// =====================================================
// 한 경기 규칙 (시험용 진행기용) — 서버 server/party/games/fight/bout.py 와 같은 내용.
// 선수 규칙은 원본 Fighter(orig/fighter.js)를 그림 없이(headless) 그대로 쓴다.
// 화면 효과 · 소리는 사건(events)으로만 내보낸다.
// =====================================================
import { CONFIG } from '../config.js';
import { Fighter } from '../orig/fighter.js';

const NO_PARTICLES = { add() {}, burst() {}, text() {}, ring() {} };

function makeFighter(p, corner) {
  const f = new Fighter({ index: 0, def: { id: p.character || 'bear' }, name: p.name, color: '' }, corner);
  f.headless = true;
  f.playerId = p.id;
  return f;
}

export class BoutCore {
  /** red, blue: { id, name }. rng: 0 이상 1 미만 난수 함수 */
  constructor(red, blue, rng) {
    this.rng = rng;
    this.red = makeFighter(red, 'red');
    this.blue = makeFighter(blue, 'blue');
    this.particles = NO_PARTICLES;
    this.frame = 0;
    this.time = CONFIG.BOUT_TIME;
    this.state = 'intro';
    this.stateT = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.count = 0;
    this.winner = null;
    this.loser = null;
    this.byKO = false;
    this.done = false;
    this.events = [];
  }

  get frozen() {
    return this.state !== 'fight';
  }

  emit(ev) {
    this.events.push(ev);
  }

  popEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** ctrl: { left, right, skillHeld, down } */
  step(ctrlRed, ctrlBlue) {
    if (this.done) return;
    this.frame++;
    this.stateT++;
    if (this.frame === 1) this.emit({ type: 'cue', name: 'bell' });
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    if (this.slowmo > 0) {
      this.slowmo--;
      if (this.slowmo % 2 === 1) return;
    }
    const end = CONFIG.COUNT_START + CONFIG.COUNT_STEP * 10;
    if (this.state === 'intro') {
      if (this.stateT === 4 || this.stateT === 44) this.emit({ type: 'cue', name: 'call' });
      if (this.stateT === 110) this.emit({ type: 'cue', name: 'bell' });
      if (this.stateT === 128) this.emit({ type: 'cue', name: 'fight' });
      if (this.stateT >= CONFIG.INTRO_LEN) {
        this.setState('fight');
        this.emit({ type: 'start' });
      }
    } else if (this.state === 'fight') {
      this.time--;
      if (this.time > 0 && this.time <= 300 && this.time % 60 === 0) this.emit({ type: 'cue', name: 'countdown' });
      if (this.time === CONFIG.HURRY) this.emit({ type: 'hurry' });
      if (this.time <= 0) this.decide();
    } else if (this.state === 'ko') {
      const since = this.stateT - CONFIG.COUNT_START;
      const c = Math.floor(since / CONFIG.COUNT_STEP) + 1;
      if (since >= 0 && since % CONFIG.COUNT_STEP === 0 && c <= 10) {
        this.count = c;
        this.emit({ type: 'count', n: c });
      }
      if (this.stateT === end) this.emit({ type: 'cue', name: 'koBell' });
      if (this.stateT >= end + CONFIG.KO_TAIL) this.finish();
    } else if (this.state === 'decision') {
      if (this.stateT >= CONFIG.DECISION_LEN) this.finish();
    }
    this.red.update(this, ctrlRed, this.blue);
    this.blue.update(this, ctrlBlue, this.red);
    this.separate();
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.emit({ type: 'end', winner: this.winner.corner, byKO: this.byKO });
  }

  separate() {
    const min = CONFIG.FIGHTER.BODY_W * 2;
    const a = this.red;
    const b = this.blue;
    const d = b.x - a.x;
    if (Math.abs(d) < min) {
      const push = (min - Math.abs(d)) / 2;
      const s = d >= 0 ? 1 : -1;
      a.x -= s * push;
      b.x += s * push;
    }
  }

  resolveHit(att, def, kind) {
    const P = CONFIG.PUNCH[kind];
    const res = def.takeHit(att, kind, this);
    const ev = {
      type: 'hit', side: att.corner, kind, dmg: res.dmg, blocked: !!res.blocked, slip: !!res.slip,
      counter: !!res.counter, broken: !!res.broken, x: Math.round(def.x * 100) / 100, dir: att.facing, ko: false,
    };
    if (res.slip) {
      this.hitstop = 6;
      this.emit(ev);
      return;
    }
    this.hitstop = res.blocked ? 3 : P.hitstop + (res.counter ? 8 : 0);
    if (def.hp <= 0) {
      ev.ko = true;
      this.emit(ev);
      this.knockout(att, def);
    } else this.emit(ev);
  }

  knockout(att, def) {
    def.setState('ko');
    def.vx = att.facing * 3;
    att.setState('win');
    this.winner = att;
    this.loser = def;
    this.byKO = true;
    this.slowmo = 60;
    this.hitstop = 14;
    this.setState('ko');
    this.count = 0;
    this.emit({ type: 'ko', winner: att.corner });
  }

  decide() {
    const a = this.red;
    const b = this.blue;
    let w;
    if (a.hp !== b.hp) w = a.hp > b.hp ? a : b;
    else if (a.hits !== b.hits) w = a.hits > b.hits ? a : b;
    else w = this.rng() < 0.5 ? a : b;
    this.winner = w;
    this.loser = w === a ? b : a;
    this.byKO = false;
    w.setState('win');
    this.setState('decision');
    this.emit({ type: 'decision', winner: w.corner });
  }

  snapshot() {
    const one = (f) => ({
      x: Math.round(f.x * 100) / 100, vx: Math.round(f.vx * 1000) / 1000, hp: f.hp, facing: f.facing,
      state: f.state, t: f.t,
      punch: f.punch && f.state === 'punch' ? [f.punch.kind, f.punch.t] : null,
      chargeT: f.chargeT, flash: f.flash || 0, squash: f.squash || 0,
      blockShake: f.blockShake || 0, slipT: f.slipT || 0, counterT: f.counterT || 0,
      hits: f.hits, damage: f.damageDealt,
    });
    return {
      frame: this.frame, state: this.state, stateT: this.stateT, time: this.time,
      hitstop: this.hitstop, slowmo: this.slowmo, count: this.count,
      winner: this.winner ? this.winner.corner : null, byKO: this.byKO, done: this.done,
      red: one(this.red), blue: one(this.blue),
    };
  }
}

/** 라운드별 대진표 — 서버 make_schedule 과 같다 */
export function makeSchedule(ids, rng, roundsForTwo) {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length === 2) {
    const [a, b] = order;
    return Array.from({ length: roundsForTwo }, (_, r) => ({ matches: [r % 2 === 0 ? [a, b] : [b, a]], resting: [] }));
  }
  let seats = order.length % 2 ? [...order, null] : order;
  const m = seats.length;
  const out = [];
  for (let r = 0; r < m - 1; r++) {
    const matches = [];
    const resting = [];
    for (let i = 0; i < m / 2; i++) {
      const x = seats[i];
      const y = seats[m - 1 - i];
      if (x === null || y === null) resting.push(x === null ? y : x);
      else matches.push((r + i) % 2 === 0 ? [x, y] : [y, x]);
    }
    out.push({ matches, resting });
    seats = [seats[0], seats[m - 1], ...seats.slice(1, m - 1)];
  }
  return out;
}

/** 공통 결과 형식(점수 내림차순, 동점은 같은 순위) — 서버 rank_results 와 같다 */
export function rankResults(rows) {
  const out = rows.map((r, i) => ({ playerId: r.playerId, name: r.name, score: r.score, rank: 0, isWinner: false, stats: r.stats || {}, _i: i }));
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
