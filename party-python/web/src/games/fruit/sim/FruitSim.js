// =============================================================
// FruitSim — 시험용(LocalSession 전용) 과일자르기 진행기
//
// 실제 판정은 Python 서버(server/party/games/fruit/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 입력에 같은 결과를 낸다(테스트가 비교한다).
// =============================================================
import { OBJECT_KEYS, buildSchedule, distToSegment, mergeConfig, posAt } from './rules.js';

export class FruitSim {
  static id = 'fruit';

  static tickHz = 20;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.cfg = mergeConfig(options && options.config);
    this.R = this.cfg.RULES;
    this.SC = this.cfg.SCORE;
    this.N = this.cfg.NET;
    this.IT = this.cfg.ITEMS;
    this.duration = this.R.DURATION;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.points = Object.fromEntries(this.cfg.FRUITS.map((f) => [f.id, f.points]));
    this.objects = buildSchedule(rng, this.cfg);
    this.bursts = new Map();
    for (const o of this.objects) {
      if (o.mode !== 2) continue;
      if (!this.bursts.has(o.group)) this.bursts.set(o.group, []);
      this.bursts.get(o.group).push(o);
    }
    this.P = {};
    for (const id of this.ids) {
      this.P[id] = {
        score: 0, sliced: 0, bombs: 0, items: 0, combo: 0, comboExpire: 0, maxCombo: 0,
        doubleFrom: -1, doubleUntil: -1, triples: [], bursts: {}, cut: new Set(), extra: new Map(),
      };
    }
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
      duration: this.duration, countdown: this.R.COUNTDOWN, intro: this.R.INTRO_TIME, endDelay: this.R.END_DELAY,
      objects: this.objects.map((o) => OBJECT_KEYS.map((k) => o[k])),
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

  tick(now) {
    const gt = this.gt(now);
    const before = this.phase;
    if (this.phase === 'intro' && gt >= -this.R.COUNTDOWN) this.phase = 'countdown';
    if (this.phase === 'countdown' && gt >= 0) this.phase = 'play';
    if (this.phase === 'play' || this.phase === 'timeup') {
      for (const id of this.ids) this._settleCombo(id, gt - this.N.MAX_LAG);
    }
    if (this.phase === 'play' && gt >= this.duration) this.phase = 'timeup';
    if (this.phase === 'timeup' && gt >= this.duration + this.R.END_DELAY) {
      for (const id of this.ids) this._settleCombo(id, Infinity);
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
    if (!this.P[playerId] || !data || typeof data !== 'object' || data.k !== 'cut') return;
    if (this.phase !== 'play' && this.phase !== 'timeup') return;
    if (!Array.isArray(data.segs)) return;
    const gt = this.gt(now);
    const { W, H } = this.cfg.VIEW;
    const minSpeed = this.cfg.BLADE.MIN_SLICE_SPEED;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    for (const seg of data.segs.slice(0, this.N.MAX_SEGS)) {
      if (!Array.isArray(seg) || seg.length !== 6 || !seg.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const [t0, , , t1] = seg;
      const x0 = clamp(seg[1], -20, W + 20);
      const x1 = clamp(seg[4], -20, W + 20);
      const y0 = clamp(seg[2], -20, H + 20);
      const y1 = clamp(seg[5], -20, H + 20);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const speed = Math.sqrt(dx * dx + dy * dy) / Math.max(1 / 240, t1 - t0);
      if (speed < minSpeed) continue;
      const t = Math.min(gt, Math.max(gt - this.N.MAX_LAG, t1));
      if (t < 0 || t >= this.duration) continue;
      this._cut(playerId, t, x0, y0, x1, y1);
    }
  }

  /** t 시각에 id 의 화면에 떠 있는 물체 [물체, 던진 시각] — 번호 순 */
  visible(id, t) {
    const st = this.P[id];
    const out = [];
    for (const o of this.objects) {
      if (st.cut.has(o.id)) continue;
      let t0;
      if (o.mode === 2) {
        if (!st.extra.has(o.id)) continue;
        t0 = st.extra.get(o.id);
      } else {
        t0 = o.t;
        if (o.mode === 1 && !st.triples.some(([a, b]) => a <= t0 && t0 < b)) continue;
      }
      if (t < t0 || t - t0 > o.life) continue;
      out.push([o, t0]);
    }
    return out;
  }

  _cut(id, t, x0, y0, x1, y1) {
    const tol = this.N.HIT_TOLERANCE;
    for (const [o, t0] of this.visible(id, t)) {
      const [x, y] = posAt(o, t - t0, this.cfg);
      if (distToSegment(x, y, x0, y0, x1, y1) <= o.r + tol) this._slice(id, o, t);
    }
  }

  _slice(id, o, t) {
    const st = this.P[id];
    st.cut.add(o.id);
    let pts = 0;
    if (o.kind === 'bomb') {
      this._settleCombo(id, t);
      st.combo = 0;
      st.bombs++;
      const before = st.score;
      st.score = Math.max(0, st.score - this.SC.BOMB_PENALTY);
      pts = st.score - before;
    } else if (o.kind === 'item') {
      st.items++;
      pts = this.SC.ITEM_POINTS;
      st.score = Math.min(this.SC.MAX, st.score + pts);
      const act = t + this.IT.ACTIVATE_DELAY;
      if (o.def === 'double') {
        st.doubleFrom = act;
        st.doubleUntil = act + this.IT.DOUBLE_TIME;
      } else {
        st.triples.push([act, act + this.IT.TRIPLE_TIME]);
        st.bursts[o.id] = act;
        for (const b of this.bursts.get(o.id) || []) {
          if (act + b.t < this.duration) st.extra.set(b.id, act + b.t);
        }
      }
    } else {
      this._settleCombo(id, t);
      pts = this.points[o.def] * this._mult(st, t);
      st.score = Math.min(this.SC.MAX, st.score + pts);
      st.sliced++;
      st.combo++;
      st.comboExpire = t + this.SC.COMBO_WINDOW;
    }
    this._outbox.push([id, 'event', { type: 'slice', id: o.id, kind: o.kind, t, pts, score: st.score }]);
  }

  _mult(st, t) {
    return st.doubleFrom <= t && t < st.doubleUntil ? this.IT.DOUBLE_MULT : 1;
  }

  _settleCombo(id, t) {
    const st = this.P[id];
    if (st.combo <= 0 || t <= st.comboExpire) return;
    const n = st.combo;
    st.combo = 0;
    if (n >= this.SC.COMBO_MIN) {
      const bonus = n * this.SC.COMBO_BONUS_PER_FRUIT * this._mult(st, st.comboExpire);
      st.score = Math.min(this.SC.MAX, st.score + bonus);
      st.maxCombo = Math.max(st.maxCombo, n);
      this._outbox.push([id, 'event', { type: 'combo', n, bonus, score: st.score }]);
    }
  }

  buildResults() {
    const rows = this.players.map((p, order) => {
      const st = this.P[p.id];
      return {
        playerId: p.id, name: p.name, score: st.score, rank: 0, isWinner: false,
        stats: { sliced: st.sliced, bombs: st.bombs, maxCombo: st.maxCombo, items: st.items }, order,
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

  snapshot(now) {
    const players = {};
    for (const id of this.ids) {
      const st = this.P[id];
      players[id] = { score: st.score, sliced: st.sliced, bombs: st.bombs, maxCombo: st.maxCombo };
    }
    return {
      phase: this.phase, now, startAt: this.startAt, duration: this.duration, players,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
    };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    const st = this.P[id];
    if (st) {
      snap.me = {
        cut: [...st.cut].sort((a, b) => a - b), doubleFrom: st.doubleFrom, doubleUntil: st.doubleUntil,
        triples: st.triples.map((w) => [...w]), bursts: { ...st.bursts },
      };
    }
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
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 떠 있는 물체를 가끔 벤다(과일은 자주, 폭탄은 드물게).
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "cut" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const next = new Map();
  return (sim, now) => {
    if (sim.phase !== 'play') return [];
    const t = sim.gt(now ?? sim._lastStateAt);
    const out = [];
    for (const id of botIds) {
      if (t < (next.get(id) ?? 1 + rng())) continue;
      next.set(id, t + 0.25 + rng() * 0.5);
      const seen = sim.visible(id, t).filter(([o, t0]) => {
        const [, y] = posAt(o, t - t0, sim.cfg);
        return y < 150;
      });
      if (!seen.length) continue;
      const [o, t0] = seen[Math.floor(rng() * seen.length)];
      if (o.kind === 'bomb' && rng() > 0.12) continue;
      const [x, y] = posAt(o, t - t0, sim.cfg);
      out.push({ playerId: id, data: { k: 'cut', segs: [[t - 0.03, x - 12, y - 6, t, x + 12, y + 6]] } });
    }
    return out;
  };
}
