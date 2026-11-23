// =============================================================
// 가든 디펜스 계산식 — 서버(server/party/games/garden/world.py)와 같은 내용.
// 시험용 진행기(GardenSim)가 쓴다. 테스트가 서버와 결과를 비교한다.
// =============================================================

export const r1 = (v) => Math.floor(v * 10 + 0.5) / 10;
export const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;

/** 웨이브 일정 → 시간순 좀비 목록 [{t, lane, type, speedMul, hpMul}] */
export function buildSpawns(rng, cfg) {
  const lanes = cfg.LAYOUT.LANES;
  const out = [];
  for (const wave of cfg.WAVES) {
    const entries = [];
    for (const [etype, count] of wave.spawns) for (let k = 0; k < Math.trunc(count); k++) entries.push(etype);
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const n = entries.length;
    let prevLane = -1;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const slot = wave.duration / n;
      const t = (i + 0.5) * slot + (-0.45 + 0.9 * rng()) * slot;
      let lane = Math.min(lanes - 1, Math.floor(rng() * lanes));
      if (lane === prevLane) {
        if (rng() < 0.6) lane = (lane + 1 + Math.min(lanes - 2, Math.floor(rng() * (lanes - 1)))) % lanes;
      }
      prevLane = lane;
      rows.push({ t: Math.max(0.3, t), lane, type: entries[i] });
    }
    if (wave.boss) rows.push({ t: cfg.BOSS_SPAWN_DELAY, lane: Math.floor(lanes / 2), type: 'boss' });
    for (const row of rows) {
      out.push({ t: r2(wave.start + row.t), lane: row.lane, type: row.type, speedMul: wave.speedMul, hpMul: wave.hpMul });
    }
  }
  const order = out.map((_, i) => i).sort((a, b) => out[a].t - out[b].t || a - b);
  return order.map((i) => out[i]).filter((s) => s.t < cfg.RULES.DURATION);
}

export function buildBossDirs(rng, count = 16) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(rng() < 0.5 ? 1 : -1);
  return out;
}

/** 한 사람의 정원. 1/60초 단위로 진행한다. */
export class World {
  constructor(cfg, spawns, bossDirs) {
    this.cfg = cfg;
    this.L = cfg.LAYOUT;
    this.G = cfg.GUN;
    this.E = cfg.ENEMIES;
    this.fps = cfg.BASE.LOGIC_FPS;
    this.dt = 1 / this.fps;
    this.spawns = spawns;
    this.bossDirs = bossDirs;
    this.lane = Math.floor(this.L.LANES / 2);
    this.fire = false;
    this.cooldown = 0;
    this.frame = 0;
    this.enemies = [];
    this.bullets = [];
    this.nextId = 1;
    this.nextBullet = 1;
    this.spawnI = 0;
    this.bossDirI = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.kills = 0;
    this.breaches = 0;
    this.shots = 0;
    this.hits = 0;
    this.helmets = 0;
    this.bossKilled = false;
    this.events = [];
  }

  get multiplier() {
    const c = this.cfg.COMBO;
    return Math.min(c.MAX_MUL, 1 + Math.floor(this.combo / c.STEP) * c.MUL_PER_STEP);
  }

  setInput(lane, fire) {
    if (Number.isInteger(lane)) this.lane = Math.max(0, Math.min(this.L.LANES - 1, lane));
    this.fire = !!fire;
  }

  waveMods(t) {
    let mods = [1, 1];
    for (const w of this.cfg.WAVES) if (w.start <= t) mods = [w.speedMul, w.hpMul];
    return mods;
  }

  spawn(etype, lane, x, speedMul, hpMul, fromBoss = false) {
    const base = this.E[etype];
    const e = {
      id: this.nextId, type: etype, lane, x,
      maxHp: Math.ceil(base.hp * hpMul), hp: Math.ceil(base.hp * hpMul),
      maxHelmet: etype === 'helmet' ? Math.ceil(base.helmetHp * hpMul) : 0,
      helmetHp: etype === 'helmet' ? Math.ceil(base.helmetHp * hpMul) : 0,
      speed: base.speed * speedMul, speedMul, score: base.score, hitL: base.hitL, hitR: base.hitR,
      state: 'walk', eatTimer: 0, summonTimer: base.summonInterval ?? 0, laneTimer: base.laneSwitchInterval ?? 0,
      dead: false, fromBoss,
    };
    this.nextId++;
    this.enemies.push(e);
    return e;
  }

  step() {
    this.frame++;
    const dt = this.dt;
    const t = this.frame / this.fps;
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.comboTimer = 0;
      }
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.fire && this.cooldown <= 0) {
      this.cooldown = 1 / this.G.FIRE_RATE;
      const x = this.L.PLAYER_X + this.L.MUZZLE_DX;
      this.bullets.push({ id: this.nextBullet, lane: this.lane, x, prev: x, dead: false });
      this.nextBullet++;
      this.shots++;
    }
    for (let i = 0; i < this.enemies.length; i++) this._updateEnemy(this.enemies[i], dt, t);
    for (const b of this.bullets) {
      b.prev = b.x;
      b.x += this.G.BULLET_SPEED * dt;
      if (b.x > this.cfg.BASE.WIDTH + 8) b.dead = true;
      else this._collide(b);
    }
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.bullets.some((b) => b.dead)) this.bullets = this.bullets.filter((b) => !b.dead);
    while (this.spawnI < this.spawns.length && this.spawns[this.spawnI].t <= t) {
      const s = this.spawns[this.spawnI];
      this.spawnI++;
      this.spawn(s.type, s.lane, this.L.SPAWN_X, s.speedMul, s.hpMul);
    }
  }

  _updateEnemy(e, dt, t) {
    if (e.dead) return;
    if (e.type === 'boss') this._updateBoss(e, dt, t);
    if (e.state === 'walk') {
      e.x -= e.speed * dt;
      if (e.x + e.hitL <= this.L.EXIT_X) {
        if (e.type === 'boss') {
          e.x = this.L.EXIT_X - e.hitL;
          e.state = 'eat';
          e.eatTimer = 0;
        } else {
          e.dead = true;
          this._breach(e);
        }
      }
    } else if (e.state === 'eat') {
      e.eatTimer -= dt;
      if (e.eatTimer <= 0) {
        e.eatTimer = this.cfg.SCORE.BOSS_BITE_EVERY;
        this._breach(e);
      }
    }
  }

  _updateBoss(e, dt, t) {
    const base = this.E.boss;
    const lanes = this.L.LANES;
    e.summonTimer -= dt;
    if (e.summonTimer <= 0) {
      e.summonTimer = base.summonInterval;
      const [speedMul, hpMul] = this.waveMods(t);
      for (let i = 0; i < base.summonCount; i++) {
        const d = i % 2 === 0 ? 1 : -1;
        let lane = e.lane + d;
        if (lane < 0 || lane >= lanes) lane = e.lane - d;
        lane = Math.max(0, Math.min(lanes - 1, lane));
        this.spawn('normal', lane, Math.min(e.x + 10, this.L.SPAWN_X), speedMul, hpMul, true);
      }
      this.events.push({ type: 'summon', lane: e.lane, x: r1(e.x) });
    }
    e.laneTimer -= dt;
    if (e.laneTimer <= 0 && e.state === 'walk') {
      e.laneTimer = base.laneSwitchInterval;
      let d = this.bossDirs[this.bossDirI % this.bossDirs.length];
      this.bossDirI++;
      if (e.lane + d < 1 || e.lane + d > lanes - 2) d = -d;
      e.lane += d;
    }
  }

  _collide(b) {
    const right = b.x + this.G.BULLET_W;
    for (const e of this.enemies) {
      if (e.dead || e.lane !== b.lane) continue;
      if (e.x + e.hitL <= right && e.x + e.hitR >= b.prev) {
        this.hits++;
        this._damage(e, this.G.DAMAGE);
        b.dead = true;
        break;
      }
    }
  }

  _damage(e, dmgIn) {
    let dmg = dmgIn;
    if (e.type !== 'boss') e.x = Math.min(e.x + this.cfg.FX.KNOCKBACK, this.L.SPAWN_X);
    if (e.helmetHp > 0) {
      e.helmetHp -= dmg;
      if (e.helmetHp > 0) return;
      dmg = -e.helmetHp;
      e.helmetHp = 0;
      e.speed = this.E.normal.speed * e.speedMul;
      this.score += this.cfg.SCORE.HELMET_BREAK;
      this.helmets++;
      this.events.push({ type: 'helmet', id: e.id, lane: e.lane, x: r1(e.x) });
      if (dmg <= 0) return;
    }
    e.hp -= dmg;
    if (e.hp <= 0) {
      e.hp = 0;
      e.dead = true;
      this._kill(e);
    }
  }

  _kill(e) {
    this.kills++;
    this.combo++;
    this.comboTimer = this.cfg.COMBO.WINDOW;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const mul = this.multiplier;
    const pts = Math.floor(e.score * mul + 0.5);
    this.score += pts;
    if (e.type === 'boss') this.bossKilled = true;
    this.events.push({ type: 'kill', id: e.id, etype: e.type, lane: e.lane, x: r1(e.x), pts, mul, combo: this.combo });
  }

  _breach(e) {
    const before = this.score;
    this.score = Math.max(0, this.score - this.cfg.SCORE.BREACH_PENALTY);
    this.breaches++;
    this.combo = 0;
    this.comboTimer = 0;
    this.events.push({ type: 'breach', lane: e.lane, boss: e.type === 'boss', lost: before - this.score });
  }

  view() {
    const types = this.cfg.ENEMY_TYPES;
    return {
      frame: this.frame, lane: this.lane, score: this.score, combo: this.combo, comboLeft: r2(this.comboTimer),
      mul: this.multiplier, kills: this.kills, breaches: this.breaches,
      enemies: this.enemies.map((e) => [e.id, types.indexOf(e.type), e.lane, r1(e.x), e.hp, e.maxHp, e.helmetHp,
        e.maxHelmet, e.state === 'eat' ? 1 : 0, r2(e.speed)]),
      bullets: this.bullets.map((b) => [b.id, b.lane, r1(b.x)]),
    };
  }

  stats() {
    return {
      kills: this.kills, breaches: this.breaches, bestCombo: this.bestCombo,
      accuracy: this.shots ? Math.floor((100 * this.hits) / this.shots + 0.5) : 0, bossKilled: this.bossKilled,
    };
  }
}
