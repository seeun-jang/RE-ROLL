// =============================================================
// RacingSim — 시험용(LocalSession 전용) 레이싱 진행기
//
// 실제 판정은 Python 서버(server/party/games/racing/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 입력에 같은 결과를 낸다(테스트가 비교한다).
// =============================================================
import { mergeConfig } from './config.js';
import { LOGIC_FPS, buildTrack, detCos, detSin, newCar, r2, r3, stepCar } from './rules.js';

function num(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

export class RacingSim {
  static id = 'racing';

  static tickHz = 30;

  constructor(players, options = {}, _rng = Math.random) {
    this.cfg = mergeConfig(options && options.config);
    this.R = this.cfg.RULES;
    this.laps = Math.trunc(this.R.LAPS);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    this.track = buildTrack(this.cfg);
    this.cars = {};
    this.ids.forEach((id, i) => { this.cars[id] = newCar(this.cfg, this.track, i, this.ids.length); });
    this.phase = 'idle';
    this.startAt = 0;
    this.frame = 0;
    this.deadline = null;
    this.finishCount = 0;
    this.endFrame = null;
    this.finalResults = [];
    this.results = [];
    this.finished = false;
    this._finalAt = 0;
    this._lastPhase = null;
    this._lastStateAt = -1;
    this._outbox = [];
  }

  clientOptions() {
    const t = this.track;
    return {
      laps: this.laps, countdown: this.R.COUNTDOWN, intro: this.R.INTRO_TIME, grace: this.R.FINISH_GRACE,
      scores: [...this.R.RANK_SCORES], world: { ...this.cfg.WORLD },
      track: { x: t.x, y: t.y, half: t.half, limit: t.limit },
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
    if (this.phase !== 'race') return;
    const dt = 1 / LOGIC_FPS;
    const n = this.track.n;
    const target = Math.floor(this.gt(now) * LOGIC_FPS + 1e-6);
    while (this.frame < target && this.phase === 'race') {
      this.frame++;
      const t = this.frame / LOGIC_FPS;
      for (const id of this.ids) {
        const car = this.cars[id];
        stepCar(car, this.cfg, this.track, dt);
        if (car.hit > this.cfg.CAR.WALL_EVENT_SPEED) this._outbox.push([null, 'event', { type: 'wall', playerId: id, speed: r2(car.hit) }]);
        if (car.finished) continue;
        const done = Math.floor(car.total / n);
        if (done > car.laps) {
          car.laps = done;
          const lapTime = t - car.lapStart;
          car.lapStart = t;
          car.lapTimes.push(r2(lapTime));
          this._outbox.push([null, 'event', { type: 'lap', playerId: id, lap: done, time: r2(lapTime) }]);
          if (done >= this.laps) {
            car.finished = true;
            car.finishTime = r2(t);
            car.steer = 0;
            car.throttle = 0;
            car.drift = 0;
            this.finishCount++;
            car.place = this.finishCount;
            if (this.deadline === null) this.deadline = t + this.R.FINISH_GRACE;
            this._outbox.push([null, 'event', { type: 'finish', playerId: id, place: this.finishCount, time: r2(t) }]);
          }
        }
      }
      const over = this.finishCount === this.ids.length || (this.deadline !== null && t >= this.deadline) || t >= this.R.MAX_TIME;
      if (over) {
        this.phase = 'ending';
        this.endFrame = this.frame;
      }
    }
  }

  tick(now) {
    const gt = this.gt(now);
    if (this.phase === 'intro' && gt >= -this.R.COUNTDOWN) this.phase = 'countdown';
    if (this.phase === 'countdown' && gt >= 0) this.phase = 'race';
    this._advance(now);
    if (this.phase === 'ending' && gt >= this.endFrame / LOGIC_FPS + this.R.END_DELAY) {
      this.finalResults = this.buildResults();
      this.phase = 'final';
      this._finalAt = now;
    }
    if (this.phase === 'final' && now >= this._finalAt + this.R.FINAL_TIME) this.phase = 'done';
    this._emit(now);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    const car = this.cars[playerId];
    if (!car || !data || typeof data !== 'object' || data.k !== 'in') return;
    this._advance(now);
    if (this.phase !== 'race' || car.finished) return;
    car.steer = num(data.steer, -1, 1);
    car.throttle = num(data.throttle, -1, 1);
    car.drift = num(data.drift, 0, 1);
  }

  order() {
    const idx = Object.fromEntries(this.ids.map((id, i) => [id, i]));
    const key = (id) => {
      const car = this.cars[id];
      return car.finished ? [0, car.place, 0, idx[id]] : [1, 0, -car.total, idx[id]];
    };
    return [...this.ids].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
  }

  buildResults() {
    const scores = this.R.RANK_SCORES;
    const n = this.track.n;
    const rows = [];
    let prev = null;
    this.order().forEach((id, i) => {
      const car = this.cars[id];
      const same = prev !== null && !car.finished && !this.cars[prev.playerId].finished
        && r3(car.total) === r3(this.cars[prev.playerId].total);
      const rank = same ? prev.rank : i + 1;
      const row = {
        playerId: id, name: this.names[id], score: rank - 1 < scores.length ? scores[rank - 1] : 0, rank, isWinner: rank === 1,
        stats: {
          finished: car.finished, time: car.finishTime, laps: Math.min(this.laps, Math.max(0, car.laps)),
          progress: r2(Math.max(0, Math.min(this.laps, car.total / n))),
          bestLap: car.lapTimes.length ? Math.min(...car.lapTimes) : null,
        },
      };
      rows.push(row);
      prev = row;
    });
    return rows;
  }

  snapshot(now) {
    const n = this.track.n;
    const order = this.order();
    const place = Object.fromEntries(order.map((id, i) => [id, i + 1]));
    const cars = {};
    for (const id of this.ids) {
      const c = this.cars[id];
      cars[id] = [r2(c.x), r2(c.y), r3(c.a), r2(c.vx), r2(c.vy), c.drifting ? 1 : 0,
        Math.min(this.laps, Math.max(0, c.laps) + 1), r3(c.total / n), place[id], c.finished ? 1 : 0, c.finishTime];
    }
    return {
      phase: this.phase, now, startAt: this.startAt, frame: this.frame, laps: this.laps, deadline: this.deadline, cars, order,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
    };
  }

  stateFor(_id, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'race' || this.phase === 'ending';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 가운데 선의 조금 앞쪽을 바라보며 달린다(봇마다 실력이 조금 다르다).
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "in" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const skill = new Map(botIds.map((id) => [id, { look: 5 + Math.floor(rng() * 4), top: 0.75 + rng() * 0.25, next: 0 }]));
  return (sim, now) => {
    if (sim.phase !== 'race') return [];
    const out = [];
    const tr = sim.track;
    for (const id of botIds) {
      const s = skill.get(id);
      const car = sim.cars[id];
      if (!car || car.finished || (now ?? 0) < s.next) continue;
      s.next = (now ?? 0) + 0.06;
      const i = (car.seg + s.look) % tr.n;
      const dx = tr.x[i] - car.x;
      const dy = tr.y[i] - car.y;
      const fx = detCos(car.a);
      const fy = detSin(car.a);
      const ang = Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy);
      const speed = Math.hypot(car.vx, car.vy);
      const sharp = Math.abs(ang) > 0.7;
      out.push({
        playerId: id,
        data: {
          k: 'in', steer: r2(Math.max(-1, Math.min(1, ang * 2.5))),
          throttle: sharp && speed > 90 ? -0.3 : speed > 160 * s.top ? 0 : 1, drift: sharp && speed > 110 ? 0.6 : 0,
        },
      });
    }
    return out;
  };
}
