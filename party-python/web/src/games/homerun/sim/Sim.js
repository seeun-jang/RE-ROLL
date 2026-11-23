// =============================================================
// Sim — 시험용(LocalSession 전용) 잭팟 홈런 더비 진행기
//
// 실제 판정은 Python 서버(server/party/games/homerun/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 는 없다: 해설은 기본 대사 몇 줄만, 총평(verdict)은 보내지 않는다.
// =============================================================
import { mergeConfig } from '../config.js';
import { HIT_RESULTS, PITCH_TYPES, flightFrames, hitPoints, makeHit, makePitches, plateScale } from './rules.js';

const CASTER = '해설자';
const CANNED = {
  hr: ['{name}, 담장을 넘겼습니다!', '넘어갔다! {name} 홈런!'],
  monster: ['{name} 초대형 홈런입니다!', '어디까지 가나요! {name}!'],
  gold: ['잭팟 볼을 놓치지 않았다!', '{name}, 점수가 두 배입니다!'],
  b2b: ['{name} 연타석 홈런!', '또 넘겼습니다! {name}!'],
  hit: ['{name} 깔끔한 안타!', '수비 사이를 뚫었습니다!'],
  whiff: ['아, 방망이가 늦었습니다.', '공이 미트에 꽂힙니다!'],
  weak: ['아쉽게 빗맞았습니다.', '수비가 기다리고 있었네요.'],
  eye: ['{name} 잘 골라냈습니다!', '볼입니다, 좋은 선구안!'],
  last: ['자, 마지막 공입니다!', '이 공 하나에 달렸습니다!'],
  lead: ['{name} 선두로 올라섭니다!', '순위가 뒤집혔습니다! {name}!'],
};

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class Sim {
  static id = 'homerun';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.cfg = mergeConfig(options && options.config);
    this.F = 1 / this.cfg.FPS;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name || p.id]));
    this.seed = typeof (options && options.seed) === 'number' ? Math.floor(options.seed) : Math.floor(rng() * 1e9);
    this.pitches = makePitches(this.seed, this.cfg);
    this.P = {};
    for (const id of this.ids) {
      this.P[id] = { chances: this.cfg.CHANCES, total: 0, hr: 0, hits: 0, longest: 0, log: [], streak: 0, cur: null, pending: null };
    }
    this.phase = 'idle';
    this.idx = -1;
    this.windupAt = 0;
    this.releaseAt = 0;
    this.mittAt = 0;
    this.nextAt = null;
    this.judged = false;
    this.introUntil = 0;
    this.finalUntil = 0;
    this.finalResults = [];
    this.results = [];
    this.finished = false;
    this._lastStateAt = -1;
    this._says = [];
    this._saidAt = {};
    this._outbox = [];
  }

  clientOptions() {
    return {
      seed: this.seed, pitches: this.pitches, chances: this.cfg.CHANCES,
      intro: this.cfg.FLOW.INTRO_TIME, final: this.cfg.FLOW.FINAL_TIME,
    };
  }

  start(now) {
    this.phase = 'intro';
    this.introUntil = now + this.cfg.FLOW.INTRO_TIME;
    this._emit(now, true);
  }

  tick(now) {
    let changed = false;
    if (this.phase === 'intro' && now >= this.introUntil) {
      this.phase = 'play';
      this._beginPitch(0, this.introUntil);
      changed = true;
    }
    if (this.phase === 'play') {
      if (!this.judged && now >= this.mittAt + this.cfg.NET.MAX_LAG) {
        this._judge(now);
        changed = true;
      }
      if (this.judged && now >= this.nextAt) {
        this._close(now);
        changed = true;
      }
    }
    this._flushSays(now);
    if (this.phase === 'final' && now >= this.finalUntil) {
      this.phase = 'done';
      changed = true;
    }
    this._emit(now, changed);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  _beginPitch(idx, at) {
    const c = this.cfg;
    const pt = this.pitches[idx];
    this.idx = idx;
    this.windupAt = at;
    this.releaseAt = at + c.WINDUP * this.F;
    this.mittAt = this.releaseAt + (pt.frames + c.MITT_AFTER) * this.F;
    this.nextAt = null;
    this.judged = false;
    for (const id of this.ids) {
      this.P[id].cur = null;
      this.P[id].pending = null;
    }
    if (idx === this.pitches.length - 1) this._says.push({ at, to: null, kind: 'last', name: '' });
  }

  onInput(playerId, data, now) {
    const st = this.P[playerId];
    if (!st || !data || typeof data !== 'object' || data.k !== 'swing') return;
    if (this.phase !== 'play' || this.judged || st.cur !== null || st.chances <= 0) return;
    const c = this.cfg;
    const pt = this.pitches[this.idx];
    // 누른 시각: 너무 오래됐거나 미래면 지금 시각 쪽으로 당긴다
    const t = Math.min(now, Math.max(now - c.NET.MAX_LAG, num(data.t, now)));
    let f = Math.floor((t - this.releaseAt) / this.F + 0.5);
    if (f < -1) return;                                   // 와인드업 중의 스윙은 없던 일
    f = Math.max(1, f);
    if (f > pt.frames + c.MITT_AFTER - 1) return;         // 공이 이미 미트에 들어갔다
    const x = Math.max(-c.BAT_RANGE, Math.min(c.BAT_RANGE, num(data.x, 0)));
    const cur = { f, x, hit: null, at: 0, dt: 0, dx: 0, pts: 0 };
    const contact = f + c.SWING_CONTACT;
    const dt = contact - pt.frames;
    const dx = x - pt.tx * plateScale(c);
    if (contact <= pt.frames + c.MITT_AFTER && Math.abs(dt) <= c.HIT_DT && Math.abs(dx) <= c.HIT_DX) {
      const hit = makeHit(pt, dt, dx, c);
      Object.assign(cur, { hit, at: this.releaseAt + contact * this.F, dt, dx, pts: hitPoints(hit, c) });
      this._outbox.push([playerId, 'event', { type: 'contact', idx: this.idx, at: cur.at, dt, dx, pts: cur.pts, hit }]);
    } else {
      this._outbox.push([playerId, 'event', { type: 'whiff', idx: this.idx }]);
    }
    st.cur = cur;
  }

  _judge(now) {
    const c = this.cfg;
    const pt = this.pitches[this.idx];
    let end = this.mittAt + c.AFTER * this.F;
    for (const id of this.ids) {
      const st = this.P[id];
      if (st.chances <= 0) continue;
      const cur = st.cur;
      const name = this.names[id];
      if (cur && cur.hit) {
        const [shown, total] = flightFrames(cur.hit, c);
        end = Math.max(end, cur.at + total * this.F);
        st.pending = { result: cur.hit.result, pts: cur.pts, dist: Math.round(cur.hit.dist) };
        this._says.push({ at: cur.at + shown * this.F, to: id, kind: this._hitKind(st, cur.hit, cur.pts), name });
      } else {
        const result = cur ? 'miss' : pt.ball ? 'ball' : 'strike';
        st.pending = { result, pts: 0, dist: 0 };
        this._says.push({ at: now, to: id, kind: result === 'ball' ? 'eye' : 'whiff', name });
      }
      const p = st.pending;
      this._outbox.push([id, 'event', {
        type: 'call', idx: this.idx, result: p.result, pts: p.pts, dist: p.dist, gold: pt.gold,
        total: st.total + p.pts, chances: st.chances - (p.result === 'ball' ? 0 : 1),
      }]);
    }
    this.judged = true;
    this.nextAt = Math.max(now, end + c.FLOW.END_PAD);
  }

  _hitKind(st, hit, pts) {
    if (hit.result === 'hr') {
      if (hit.dist >= this.cfg.AI.MONSTER_DIST) return 'monster';
      if (hit.gold) return 'gold';
      return st.streak >= 1 ? 'b2b' : 'hr';
    }
    if (HIT_RESULTS.includes(hit.result)) return hit.gold && pts > 0 ? 'gold' : 'hit';
    return 'weak';
  }

  _close(now) {
    const pt = this.pitches[this.idx];
    const before = this._leader();
    for (const id of this.ids) {
      const st = this.P[id];
      const p = st.pending;
      if (!p) continue;
      if (p.result !== 'ball') {
        st.chances--;
        st.streak = p.result === 'hr' ? st.streak + 1 : 0;
      }
      st.total += p.pts;
      if (p.result === 'hr') {
        st.hr++;
        st.longest = Math.max(st.longest, p.dist);
      }
      if (HIT_RESULTS.includes(p.result)) st.hits++;
      st.log.push({ idx: this.idx, result: p.result, pts: p.pts, gold: pt.gold, dist: p.dist, swung: st.cur !== null });
    }
    const after = this._leader();
    if (after !== null && after !== before) this._says.push({ at: now, to: null, kind: 'lead', name: this.names[after] });
    if (this.idx + 1 < this.pitches.length) {
      this._beginPitch(this.idx + 1, this.nextAt);
      return;
    }
    this.finalResults = this.buildResults();
    this.phase = 'final';
    this.finalUntil = now + this.cfg.FLOW.FINAL_TIME;
  }

  _key(id) {
    const st = this.P[id];
    return [st.total, st.hr, st.longest];
  }

  _cmp(a, b) {
    const A = this._key(a);
    const B = this._key(b);
    return B[0] - A[0] || B[1] - A[1] || B[2] - A[2];
  }

  _leader() {
    const order = [...this.ids].sort((a, b) => this._cmp(a, b));
    const best = order[0];
    if (this.P[best].total <= 0) return null;
    if (order.length > 1 && this._cmp(best, order[1]) === 0) return null;
    return best;
  }

  _flushSays(now) {
    if (!this._says.length) return;
    const gap = this.cfg.AI.SAY_GAP;
    const due = this._says.filter((s) => s.at <= now);
    this._says = this._says.filter((s) => s.at > now);
    for (const s of due) {
      const lastAll = this._saidAt['*'] ?? -Infinity;
      const last = s.to === null ? lastAll : Math.max(lastAll, this._saidAt[s.to] ?? -Infinity);
      if (now - last < gap) continue;
      const pool = CANNED[s.kind] || [];
      if (!pool.length) continue;
      const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', s.name);
      this._saidAt[s.to === null ? '*' : s.to] = now;
      this._outbox.push([s.to, 'event', { type: 'say', text, source: 'canned', who: CASTER, kind: s.kind }]);
    }
  }

  // 공통 결과 형식. 순위: 점수 → 홈런 수 → 최장 비거리(셋 다 같으면 공동 순위)
  buildResults() {
    const order = this.ids.map((id, i) => [id, i]).sort((a, b) => this._cmp(a[0], b[0]) || a[1] - b[1]).map((e) => e[0]);
    const rows = [];
    order.forEach((id, i) => {
      const st = this.P[id];
      const same = i > 0 && this._cmp(id, order[i - 1]) === 0;
      rows.push({
        playerId: id, name: this.names[id], score: st.total, rank: same ? rows[i - 1].rank : i + 1, isWinner: false,
        stats: { homeRuns: st.hr, hits: st.hits, longest: st.longest, log: st.log.map((e) => e.result) },
      });
    });
    for (const r of rows) r.isWinner = r.rank === 1;
    return rows;
  }

  snapshot(now) {
    const players = {};
    for (const id of this.ids) {
      const st = this.P[id];
      players[id] = {
        total: st.total, hr: st.hr, hits: st.hits, longest: st.longest, chances: st.chances,
        last: st.log.length ? st.log[st.log.length - 1].result : null,
      };
    }
    return {
      phase: this.phase, now, idx: this.idx, count: this.pitches.length,
      introUntil: this.introUntil, windupAt: this.windupAt, releaseAt: this.releaseAt,
      mittAt: this.mittAt, nextAt: this.nextAt, finalUntil: this.finalUntil,
      players,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
      verdict: null,
    };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    const st = this.P[id];
    if (st) {
      const cur = st.cur;
      snap.me = {
        log: st.log,
        cur: cur === null ? null : { idx: this.idx, f: cur.f, x: cur.x, at: cur.at, dt: cur.dt, dx: cur.dx, pts: cur.pts, hit: cur.hit },
        pending: st.pending,
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
    if (force || now - this._lastStateAt >= 1 / this.cfg.NET.STATE_HZ - 1e-9) {
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇 (원본 js/bot.js 의 BatBot): 공이 올 자리로 배트를 옮기고, 들어올 때 스윙.
 * 실력이 낮을수록 위치 · 타이밍이 흔들리고, 볼에도 방망이가 나간다.
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "swing" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const CPU_SKILL = [0.4, 0.85];
  const gauss = () => (rng() + rng() + rng() - 1.5) * 1.4;
  const bots = botIds.map((id) => ({ id, skill: CPU_SKILL[0] + rng() * (CPU_SKILL[1] - CPU_SKILL[0]), idx: -1, plan: null }));
  return (sim, now) => {
    if (sim.phase !== 'play' || sim.judged || now < sim.releaseAt) return [];
    const c = sim.cfg;
    const pt = sim.pitches[sim.idx];
    const out = [];
    for (const b of bots) {
      if (b.idx !== sim.idx) {
        // 공을 보고 판단 (변화구일수록 위치가 더 흔들림)
        const s = b.skill;
        const breakErr = Math.abs(PITCH_TYPES[pt.typeId].breakX) * 18;
        b.idx = sim.idx;
        b.plan = {
          x: pt.tx * plateScale(c) + gauss() * ((1 - s) * 9 + breakErr * (1 - s * 0.6)),
          at: pt.frames - c.SWING_CONTACT + Math.round(gauss() * ((1 - s) * 7 + 1.2)),
          go: !pt.ball || rng() < (1 - s) * 0.7,
        };
      }
      const plan = b.plan;
      if (!plan || !plan.go) continue;
      const t = sim.releaseAt + Math.max(1, plan.at) * sim.F;
      if (now < t) continue;
      b.plan = null;
      out.push({ playerId: b.id, data: { k: 'swing', t, x: plan.x } });
    }
    return out;
  };
}
