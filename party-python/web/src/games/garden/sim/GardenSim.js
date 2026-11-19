// =============================================================
// GardenSim — 시험용(LocalSession 전용) 가든 디펜스 진행기
//
// 실제 판정은 Python 서버(server/party/games/garden/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 입력에 같은 결과를 낸다(테스트가 비교한다).
// =============================================================
import { mergeConfig } from './config.js';
import { World, buildBossDirs, buildSpawns } from './rules.js';

export class GardenSim {
  static id = 'garden';

  static tickHz = 20;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig(options && options.config);
    this.R = this.cfg.RULES;
    this.N = this.cfg.NET;
    this.duration = this.R.DURATION;
    this.fps = this.cfg.BASE.LOGIC_FPS;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.spawns = buildSpawns(rng, this.cfg);
    this.bossDirs = buildBossDirs(rng);
    this.worlds = {};
    for (const id of this.ids) this.worlds[id] = new World(this.cfg, this.spawns, this.bossDirs);
    this.phase = 'idle';
    this.startAt = 0;
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this._finalAt = 0;
    this._lastStateAt = -1;
    this._outbox = [];
  }

  clientOptions() {
    return {
      duration: this.duration, countdown: this.R.COUNTDOWN, intro: this.R.INTRO_TIME,
      waves: this.cfg.WAVES.map((w) => ({ name: w.name, start: w.start, boss: w.boss })),
      total: this.spawns.length, penalty: this.cfg.SCORE.BREACH_PENALTY,
      fireRate: this.cfg.GUN.FIRE_RATE, bulletSpeed: this.cfg.GUN.BULLET_SPEED,
    };
  }

  start(now) {
    this.startAt = now + this.R.INTRO_TIME + this.R.COUNTDOWN;
    this.phase = 'intro';
    this._emit(now, true);
  }

  gt(now) {
    return now - this.startAt;
  }

  _advance(now) {
    if (this.phase !== 'play' && this.phase !== 'timeup') return;
    const target = Math.min(Math.trunc(this.duration * this.fps), Math.floor(this.gt(now) * this.fps + 1e-6));
    for (const id of this.ids) {
      const w = this.worlds[id];
      while (w.frame < target) w.step();
      for (const e of w.events) this._outbox.push([id, 'event', e]);
      w.events = [];
    }
  }

  tick(now) {
    const gt = this.gt(now);
    const before = this.phase;
    if (this.phase === 'intro' && gt >= -this.R.COUNTDOWN) this.phase = 'countdown';
    if (this.phase === 'countdown' && gt >= 0) this.phase = 'play';
    this._advance(now);
    if (this.phase === 'play' && gt >= this.duration) this.phase = 'timeup';
    if (this.phase === 'timeup' && gt >= this.duration + this.R.END_DELAY) {
      this.finalResults = this.buildResults();
      this.phase = 'final';
      this._finalAt = now;
    }
    if (this.phase === 'final' && now >= this._finalAt + this.R.FINAL_TIME) this.phase = 'done';
    this._emit(now, this.phase !== before);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    const w = this.worlds[playerId];
    if (!w || !data || typeof data !== 'object' || data.k !== 'in') return;
    this._advance(now);
    w.setInput(data.lane, data.fire === true);
  }

  buildResults() {
    const rows = this.players.map((p, order) => ({
      playerId: p.id, name: p.name, score: this.worlds[p.id].score, rank: 0, isWinner: false,
      stats: this.worlds[p.id].stats(), order,
    }));
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

  snapshot(now) {
    const players = {};
    for (const id of this.ids) {
      const w = this.worlds[id];
      players[id] = { score: w.score, kills: w.kills, breaches: w.breaches };
    }
    return {
      phase: this.phase, now, startAt: this.startAt, duration: this.duration, players,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
    };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    if (this.worlds[id]) snap.me = this.worlds[id].view();
    return snap;
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    if (force || now - this._lastStateAt >= 1 / this.N.STATE_HZ - 1e-9) {
      this._lastStateAt = now;
      const common = this.snapshot(now);
      for (const id of this.ids) this._outbox.push([id, 'state', { ...common, me: this.worlds[id].view() }]);
    }
  }
}

/**
 * 시험용 봇: 가장 앞까지 온 좀비가 있는 레인으로 옮겨 가며 쏜다(가끔 딴짓).
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "in" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const next = new Map();
  return (sim, now) => {
    if (sim.phase !== 'play') return [];
    const out = [];
    for (const id of botIds) {
      if ((now ?? 0) < (next.get(id) ?? 0)) continue;
      next.set(id, (now ?? 0) + 0.25 + rng() * 0.45);
      const w = sim.worlds[id];
      let target = null;
      for (const e of w.enemies) if (!target || e.x < target.x) target = e;
      const lane = target && rng() > 0.15 ? target.lane : w.lane;
      const fire = !!target;
      if (lane !== w.lane || fire !== w.fire) out.push({ playerId: id, data: { k: 'in', lane, fire } });
    }
    return out;
  };
}
