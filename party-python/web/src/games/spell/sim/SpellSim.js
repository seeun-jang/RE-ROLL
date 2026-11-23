// =============================================================
// SpellSim — 시험용(LocalSession 전용) 주문 게임 진행기
//
// 실제 판정은 Python 서버(server/party/games/spell/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 형식의 메시지를 만든다.
// 규칙은 서버의 duel.py / game.py 를 그대로 옮긴 것이고, 같은 입력에 같은 결과가 나오는지
// server/tests/test_spell_parity.py 가 비교한다. 서버가 없으므로 음성 인식은 되지 않는다(숫자키만).
// =============================================================
import { SPELL_BY_ID } from '../data/spells.js';
import { beats } from '../data/elements.js';
import { makeSchedule } from '../../palm/sim/PalmSim.js';

const LOGIC_FPS = 60;
const DT = 1 / LOGIC_FPS;
const jround = (x) => Math.floor(x + 0.5);

/** 서버 config.py 의 DEFAULT_CONFIG 와 같은 값 */
export const SIM_CONFIG = Object.freeze({
  LAYOUT: { GROUND_Y: 118, LEFT_X: 64, RIGHT_X: 256 },
  PLAYER: { MAX_HP: 100, MAX_MANA: 100, MANA_REGEN: 6 },
  POWER: { FIXED: 0.5, MULT: 1.0 },
  ELEMENT: { ICE_SHIELD_VS_FIRE: 1.5 },
  COMBO: { WINDOW: 2.2, STEP_BONUS: 0.1, MAX_BONUS: 0.3 },
  BATTLE: { TIME_LIMIT: 60, COUNTDOWN: 3.0, HITSTOP_BASE: 2, HITSTOP_POWER: 6, CLASH_KEEP: 0.7, END_HITSTOP: 12 },
  FLOW: { ROUNDS_FOR_TWO: 3, INTRO_TIME: 5.0, END_HOLD: 2.5, RESULT_TIME: 5.0, FINAL_TIME: 9.0 },
});

function mergeConfig(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = { ...base[k], ...((over && over[k]) || {}) };
  return out;
}

class Mage {
  constructor(key, id, cfg) {
    const L = cfg.LAYOUT, P = cfg.PLAYER;
    this.key = key;
    this.id = id;
    this.x = key === 'a' ? L.LEFT_X : L.RIGHT_X;
    this.y = L.GROUND_Y;
    this.facing = key === 'a' ? 1 : -1;
    this.maxHp = P.MAX_HP;
    this.hp = P.MAX_HP;
    this.maxMana = P.MAX_MANA;
    this.mana = P.MAX_MANA;
    this.manaRegen = P.MANA_REGEN;
    this.shield = null;
    this.cooldowns = {};
    this.combo = { count: 0, last: null, timer: 0 };
    this.maxCombo = 0;
    this.stats = { casts: 0, fails: 0, damageDealt: 0, damageTaken: 0, counters: 0, blocks: 0 };
  }

  get castX() {
    return this.x + this.facing * 9;
  }

  get castY() {
    return this.y - 20;
  }

  get centerY() {
    return this.y - 15;
  }

  update(dt) {
    if (this.hp > 0) this.mana = Math.min(this.maxMana, Math.max(0, this.mana + this.manaRegen * dt));
    if (this.shield) {
      this.shield.time -= dt;
      if (this.shield.time <= 0 || this.shield.hp <= 0) this.shield = null;
    }
    for (const id in this.cooldowns) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }
    const c = this.combo;
    if (c.timer > 0) {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.count = 0;
        c.last = null;
      }
    }
  }

  snapshot() {
    const s = this.shield;
    const cd = {};
    for (const id in this.cooldowns) if (this.cooldowns[id] > 0) cd[id] = this.cooldowns[id];
    return {
      id: this.id, hp: this.hp, mana: this.mana,
      shield: s ? { hp: s.hp, max: s.max, time: s.time } : null,
      cd, combo: this.combo.count, comboTimer: Math.max(0, this.combo.timer),
    };
  }
}

export class Duel {
  constructor(cfg, aId, bId, emit) {
    this.cfg = cfg;
    this.a = new Mage('a', aId, cfg);
    this.b = new Mage('b', bId, cfg);
    this.emit = emit || (() => {});
    this.projectiles = [];
    this.strikes = [];
    this.nextId = 1;
    this.state = 'ready';
    this.time = 0;
    this.timeLimit = cfg.BATTLE.TIME_LIMIT;
    this.timeLeft = this.timeLimit;
    this.hitstop = 0;
    this.frame = 0;
    this.result = null;
  }

  mage(key) {
    return key === 'a' ? this.a : this.b;
  }

  other(key) {
    return key === 'a' ? this.b : this.a;
  }

  keyOf(id) {
    return id === this.a.id ? 'a' : id === this.b.id ? 'b' : null;
  }

  get fighting() {
    return this.state === 'fight';
  }

  get over() {
    return this.state === 'over';
  }

  start() {
    if (this.state === 'ready') this.state = 'fight';
  }

  _hitStop(power) {
    const B = this.cfg.BATTLE;
    this.hitstop = Math.max(this.hitstop, jround(B.HITSTOP_BASE + B.HITSTOP_POWER * power));
  }

  cast(key, spellId, source = 'key') {
    const spell = SPELL_BY_ID[spellId];
    const m = this.mage(key);
    if (!this.fighting) return { ok: false, reason: 'notready' };
    let reason = null;
    if (!spell) reason = 'unknown';
    else if ((m.cooldowns[spellId] || 0) > 0) reason = 'cooldown';
    else if (m.mana < spell.mana) reason = 'mana';
    if (reason) {
      m.stats.fails++;
      this.emit({ type: 'castFail', who: key, spell: spell ? spellId : null, reason });
      return { ok: false, reason };
    }
    const C = this.cfg.COMBO;
    m.mana -= spell.mana;
    m.cooldowns[spellId] = spell.cooldown;
    const c = m.combo;
    if (c.timer > 0 && c.last && c.last !== spell.element) c.count += 1;
    else c.count = 1;
    c.last = spell.element;
    c.timer = C.WINDOW;
    m.maxCombo = Math.max(m.maxCombo, c.count);
    const bonus = c.count >= 2 ? Math.min(C.MAX_BONUS, (c.count - 1) * C.STEP_BONUS) : 0;
    const power = this.cfg.POWER.FIXED;
    const tierMult = this.cfg.POWER.MULT;
    const mult = tierMult * (1 + (spell.damage ? bonus : 0));
    m.stats.casts++;

    const event = { type: 'cast', who: key, spell: spellId, element: spell.element, kind: spell.type, combo: c.count, source };
    if (spell.type === 'projectile') {
      const proj = {
        id: this.nextId++, owner: key, element: spell.element, spell: spellId,
        x: m.castX, y: m.castY, vx: m.facing * spell.speed * (0.9 + power * 0.3),
        damage: spell.damage * mult, power, alive: true,
      };
      this.projectiles.push(proj);
      event.proj = proj.id;
    } else if (spell.type === 'strike') {
      this.strikes.push({
        owner: key, target: this.other(key).key, element: spell.element,
        damage: spell.damage * mult, power, delay: spell.delay ?? 0.15,
      });
    } else if (spell.type === 'shield') {
      const hp = jround(spell.shield * tierMult);
      m.shield = { hp, max: hp, time: spell.duration, duration: spell.duration };
      event.amount = hp;
    } else if (spell.type === 'heal') {
      const amount = jround(spell.heal * tierMult);
      const before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + amount);
      event.amount = jround(m.hp - before);
    }
    this.emit(event);
    return { ok: true, combo: c.count };
  }

  step() {
    this.frame++;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.time += DT;
    this.a.update(DT);
    this.b.update(DT);
    if (this.fighting && this.timeLimit > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - DT);
      if (this.timeLeft <= 0) {
        this._endByTime();
        return;
      }
    }
    this._updateProjectiles();
    this._updateStrikes();
  }

  _updateProjectiles() {
    const list = this.projectiles;
    for (const pr of list) if (pr.alive) pr.x += pr.vx * DT;
    const radius = 3;
    for (const a of list) {
      if (!a.alive || a.owner !== 'a') continue;
      for (const b of list) {
        if (!b.alive || b.owner !== 'b') continue;
        if (Math.abs(a.x - b.x) <= radius * 2 && Math.abs(a.y - b.y) <= radius * 2 + 4) this._clash(a, b);
        if (!a.alive) break;
      }
    }
    for (const pr of list) {
      if (!pr.alive) continue;
      const target = this.other(pr.owner);
      if (pr.owner === 'a') {
        if (target.shield && pr.x + radius >= target.x - 12) {
          this._block(target, pr.damage, pr.element, pr.power, pr.x, pr.y);
          pr.alive = false;
        } else if (pr.x + radius >= target.x - 6) {
          pr.alive = false;
          this._applyHit(target, pr.damage, pr.element, pr.power, pr.x, pr.y);
        }
      } else if (target.shield && pr.x - radius <= target.x + 12) {
        this._block(target, pr.damage, pr.element, pr.power, pr.x, pr.y);
        pr.alive = false;
      } else if (pr.x - radius <= target.x + 6) {
        pr.alive = false;
        this._applyHit(target, pr.damage, pr.element, pr.power, pr.x, pr.y);
      }
      if (pr.alive && (pr.x < -20 || pr.x > 340)) pr.alive = false;
    }
    // 종료 처리(_finish)가 목록을 비웠으면 그대로 둔다
    if (this.projectiles === list) this.projectiles = list.filter((pr) => pr.alive);
  }

  _updateStrikes() {
    for (const s of [...this.strikes]) {
      s.delay -= DT;
      if (s.delay > 0) continue;
      const i = this.strikes.indexOf(s);
      if (i >= 0) this.strikes.splice(i, 1);
      if (this.over) continue;
      const target = this.mage(s.target);
      this.emit({ type: 'strike', target: target.key });
      if (target.shield) this._block(target, s.damage, s.element, s.power, target.x, target.centerY);
      else this._applyHit(target, s.damage, s.element, s.power, target.x, target.centerY);
    }
  }

  _clash(a, b) {
    if (this.over) return;
    let winner = null, loser = null, both = false;
    const advantage = beats(a.element, b.element) || beats(b.element, a.element);
    if (beats(a.element, b.element)) { winner = a; loser = b; }
    else if (beats(b.element, a.element)) { winner = b; loser = a; }
    else {
      const diff = a.damage - b.damage;
      if (Math.abs(diff) < 2) both = true;
      else {
        winner = diff > 0 ? a : b;
        loser = diff > 0 ? b : a;
        winner.damage = Math.abs(diff);
      }
    }
    if (both) {
      a.alive = false;
      b.alive = false;
    } else {
      loser.alive = false;
      if (advantage) {
        winner.damage *= this.cfg.BATTLE.CLASH_KEEP;
        winner.power *= this.cfg.BATTLE.CLASH_KEEP;
      }
    }
    this._hitStop(0.2);
    if (winner && advantage) this.mage(winner.owner).stats.counters++;
    this.emit({
      type: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, winner: winner ? winner.owner : null,
      both, advantage, ea: a.element, eb: b.element,
    });
  }

  _block(target, damage, element, power, _x, y) {
    if (this.over) return;
    const s = target.shield;
    const mult = element === 'fire' ? this.cfg.ELEMENT.ICE_SHIELD_VS_FIRE : 1;
    s.hp -= damage * mult;
    target.stats.blocks++;
    this._hitStop(0.15);
    const broken = s.hp <= 0;
    this.emit({ type: 'blocked', who: target.key, element, y, broken });
    if (broken) {
      const overflow = -s.hp / mult;
      target.shield = null;
      if (overflow >= 1) this._applyHit(target, overflow, element, power * 0.5, target.x, target.centerY);
    }
  }

  _applyHit(target, damage, element, power, x, y) {
    if (this.over) return;
    const dmg = Math.max(1, jround(damage));
    target.hp = Math.max(0, target.hp - dmg);
    const attacker = this.other(target.key);
    target.stats.damageTaken += dmg;
    attacker.stats.damageDealt += dmg;
    this._hitStop(power);
    this.emit({ type: 'hit', target: target.key, damage: dmg, element, power, x, y });
    if (target.hp <= 0) this._finish(attacker.key, 'ko');
  }

  _endByTime() {
    const ra = this.a.hp / this.a.maxHp, rb = this.b.hp / this.b.maxHp;
    if (Math.abs(ra - rb) < 0.005) this._finish('draw', 'timeout');
    else this._finish(ra > rb ? 'a' : 'b', 'timeout');
  }

  _finish(winner, reason) {
    if (this.over) return;
    this.state = 'over';
    this.result = {
      winner, reason, time: jround(this.time * 10) / 10, timeLeft: jround(this.timeLeft * 10) / 10,
      hp: { a: jround(this.a.hp), b: jround(this.b.hp) },
    };
    for (const pr of this.projectiles) pr.alive = false;
    this.projectiles = [];
    this.strikes = [];
    this.hitstop = this.cfg.BATTLE.END_HITSTOP;
    this.emit({ type: 'end', result: this.result });
  }

  statsOf(key) {
    const m = this.mage(key);
    return { ...m.stats, maxCombo: m.maxCombo };
  }

  snapshot() {
    return {
      frame: this.frame, state: this.state, time: this.time, timeLeft: this.timeLeft, hitstop: this.hitstop,
      result: this.result, a: this.a.snapshot(), b: this.b.snapshot(),
      proj: this.projectiles.map((p) => ({ id: p.id, o: p.owner, e: p.element, x: p.x, y: p.y, vx: p.vx })),
    };
  }
}

export class SpellSim {
  static id = 'spell';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig(SIM_CONFIG, options && options.config);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
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
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  clientOptions() {
    const c = this.cfg;
    return {
      config: { LAYOUT: c.LAYOUT, PLAYER: c.PLAYER, COMBO: c.COMBO, BATTLE: c.BATTLE, FLOW: c.FLOW },
      rounds: this.schedule.length,
      voice: false,
    };
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
    if (!data || typeof data !== 'object' || !this.standings[playerId]) return;
    this._advance(now);
    if (this.phase !== 'fight') return;
    const found = this._duelOf(playerId);
    if (!found || !found.duel.fighting) return;
    if (data.k === 'cast' && typeof data.id === 'string' && SPELL_BY_ID[data.id]) found.duel.cast(found.key, data.id, 'key');
    else if (data.k === 'voice') this._outbox.push([playerId, 'event', { type: 'voiceOff' }]);
  }

  stateFor(_playerId, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _duelOf(id) {
    for (let index = 0; index < this.duels.length; index++) {
      const key = this.duels[index].keyOf(id);
      if (key) return { index, duel: this.duels[index], key };
    }
    return null;
  }

  _beginRound(round, now) {
    this.round = round;
    const plan = this.schedule[round - 1];
    this.duels = plan.matches.map(([a, b], index) => new Duel(this.cfg, a, b, (ev) => this._outbox.push([null, 'event', { ...ev, match: index }])));
    this.countdownAt = now + this.cfg.FLOW.INTRO_TIME;
    this.startAt = this.countdownAt + this.cfg.BATTLE.COUNTDOWN;
    this.simFrame = 0;
    this.allOverFrame = null;
    this.roundResults = [];
    this.phase = 'intro';
  }

  _advance(now) {
    for (let i = 0; i < 6; i++) {
      if (this.phase === 'intro') {
        if (now < this.countdownAt) return;
        this.phase = 'countdown';
      } else if (this.phase === 'countdown') {
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
          this.results = this._buildResults();
          this.phase = 'final';
          this.phaseUntil += this.cfg.FLOW.FINAL_TIME;
        }
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
      } else return;
    }
  }

  _simulate(now) {
    const target = Math.floor((now - this.startAt) * LOGIC_FPS + 1e-6);
    const holdFrames = Math.round(this.cfg.FLOW.END_HOLD * LOGIC_FPS);
    while (this.simFrame < target) {
      for (const d of this.duels) d.step();
      this.simFrame++;
      if (this.allOverFrame === null && this.duels.every((d) => d.over)) this.allOverFrame = this.simFrame;
      if (this.allOverFrame !== null && this.simFrame >= this.allOverFrame + holdFrames) {
        this._endRound();
        return;
      }
    }
  }

  _endRound() {
    this.roundResults = this.duels.map((d) => {
      const res = d.result || { winner: 'draw', reason: 'timeout', hp: { a: 0, b: 0 } };
      const scores = {};
      for (const [key, m] of [['a', d.a], ['b', d.b]]) {
        const hp = res.hp[key];
        scores[m.id] = { total: hp, hp, stats: d.statsOf(key) };
        const st = this.standings[m.id];
        st.matches += 1;
        st.score += hp;
        if (res.winner === 'draw') st.draws += 1;
        else if (res.winner === key) st.wins += 1;
        else st.losses += 1;
      }
      const winner = res.winner === 'draw' ? null : d.mage(res.winner).id;
      return { a: d.a.id, b: d.b.id, winner, reason: res.reason, scores };
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
      duels: this.duels.map((d) => d.snapshot()),
      standings,
      roundResults: this.phase === 'result' ? this.roundResults : null,
      results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
      voice: false,
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
 * 시험용 봇: 상대 투사체가 날아오면 상성 주문이나 방패로 받고, 틈틈이 공격한다.
 * @returns {(sim: SpellSim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const next = new Map(); // botId → 다음에 행동할 프레임
  const COUNTER = { fire: 'aqua_shot', wind: 'fireball', lightning: 'wind_cutter', water: 'thunder' };
  let round = 0;
  return (sim) => {
    if (sim.round !== round) {
      round = sim.round;
      next.clear();
    }
    if (sim.phase !== 'fight') return [];
    const out = [];
    for (const id of botIds) {
      const found = sim._duelOf(id);
      if (!found || !found.duel.fighting) continue;
      const { duel, key } = found;
      const t = duel.frame;
      if (t < (next.get(id) ?? 40 + Math.floor(rng() * 40))) continue;
      next.set(id, t + 35 + Math.floor(rng() * 55));
      const me = duel.mage(key);
      const incoming = duel.projectiles.find((p) => p.owner !== key);
      let spell;
      const r = rng();
      if (me.hp < 45 && r < 0.4) spell = 'heal';
      else if (incoming && r < 0.55) spell = r < 0.2 ? 'ice_shield' : COUNTER[incoming.element] || 'fireball';
      else spell = ['fireball', 'aqua_shot', 'wind_cutter', 'thunder', 'wind_cutter', 'fireball'][Math.floor(rng() * 6)];
      out.push({ playerId: id, data: { k: 'cast', id: spell } });
    }
    return out;
  };
}
