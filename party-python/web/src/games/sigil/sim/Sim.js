// =============================================================
// Sim — 시험용(LocalSession 전용) 마법진 그리기 진행기
//
// 실제 진행 · 채점은 Python 서버(server/party/games/sigil/game.py)가 한다.
// 이 파일은 서버 없이 화면 흐름을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 가 없으므로: 대사(say)는 기본 대사 몇 줄만, 그림 감상평(review)과 총평(verdict)은 보내지 않는다.
// =============================================================
import { CONFIG } from '../config.js';
import { SHAPES, planRounds } from '../shapes.js';
import { AutoDrawer, Paper, scoreDrawing } from '../sketch.js';

const CASTER = '마법사';
const CANNED = {
  round_start: ['가볍게 손부터 풀어 보시지요.', '선만 따라 그리면 됩니다. 쉽지요?'],
  curse: ['제 저주가 마음에 드십니까?', '이번엔 조금 불편하실 겁니다.'],
  jackpot: ['마지막은 점수 두 배입니다.', '잭팟 라운드, 뒤집어 보시지요.'],
  first_done: ['{name}, 벌써 끝내셨습니까?', '{name}, 손이 빠르시군요.'],
  success: ['{name}, 마법이 발동했군요.', '{name}, 제법이십니다.'],
  poof: ['{name}, 그건 낙서 아닙니까?', '{name}, 펑 소리가 났습니다만.'],
  all_poof: ['전원 실패라니, 흐뭇하군요.', '이 마을은 아직 제 것입니다.'],
  lead_change: ['{name}, 선두로 올라섰군요.', '1등이 {name}로 바뀌었습니다.'],
  final: ['{name}, 저주를 풀 자격이 있군요.', '{name}, 오늘은 인정하지요.'],
};

function merge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export class Sim {
  static id = 'sigil';

  static tickHz = 20;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.cfg = merge(CONFIG, options.config);
    this.F = this.cfg.FLOW;
    this.S = this.cfg.SCORE;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    this.plan = options.plan
      ? options.plan.map((r) => ({ shape: r.shape % SHAPES.length, twist: r.twist || 'none', mult: r.mult || 1 }))
      : planRounds(rng, this.cfg.ROUNDS);
    this.rounds = this.plan.length;
    this.P = {};
    for (const id of this.ids) {
      this.P[id] = { paper: new Paper(false), done: false, doneAt: null, points: 0, rounds: new Array(this.rounds).fill(null), total: 0, live: 0, dirty: false };
    }
    this.connected = new Set(this.ids);
    this.phase = 'idle';
    this.since = 0;
    this.until = 0;
    this.round = 0;
    this.drawUntil = 0;
    this.gallery = null;
    this.results = [];
    this.finished = false;
    this._firstDone = false;
    this._lastSay = -99;
    this._sayQueue = [];
    this._outbox = [];
    this._dirty = true;
    this._lastStateAt = -99;
    this._lastLiveAt = -99;
  }

  get nowPlan() {
    return this.plan[this.round - 1] || null;
  }

  get shape() {
    return this.nowPlan ? SHAPES[this.nowPlan.shape] : null;
  }

  drawTime() {
    return this.nowPlan.twist === 'speed' ? this.cfg.SPEED_TIME : this.cfg.DRAW_TIME;
  }

  clientOptions() {
    const c = this.cfg;
    return {
      rounds: c.ROUNDS.slice(0, this.rounds).map((r) => ({ tier: r.tier, mult: r.mult })),
      canvas: c.CANVAS, brush: c.BRUSH, score: { ...c.SCORE }, twists: c.TWISTS,
      drawTime: c.DRAW_TIME, speedTime: c.SPEED_TIME, memoryTime: c.MEMORY_TIME, shake: { ...c.SHAKE }, flow: { ...c.FLOW },
      shapes: SHAPES.map((s) => ({ name: s.name, short: s.short, color: s.color, gc: s.gc, tier: s.tier, pts: s.pts })),
    };
  }

  start(now) {
    this._set('intro', now, this.F.INTRO_TIME);
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    this._flushSays(now);
    if (this.phase === 'draw') this._updateLive(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) this.finished = true;
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _event(data) {
    this._outbox.push([null, 'event', data]);
  }

  _set(phase, at, duration) {
    this.phase = phase;
    this.since = at;
    this.until = at + duration;
    this._dirty = true;
  }

  _advance(now) {
    const F = this.F;
    for (let i = 0; i < 12; i++) {
      const ph = this.phase;
      if (ph === 'idle' || ph === 'done') return;
      if (ph === 'draw' && this._everyoneDone()) {
        this._finishDraw(now);
        continue;
      }
      if (now < this.until) return;
      const at = this.until;
      if (ph === 'intro') this._beginRound(1, at);
      else if (ph === 'slot') {
        this._set('ready', at, F.READY_TIME);
        const p = this.nowPlan;
        this._say(p.mult > 1 ? 'jackpot' : p.twist !== 'none' ? 'curse' : 'round_start', at);
      } else if (ph === 'ready') {
        this.drawUntil = at + this.drawTime();
        this._set('draw', at, this.drawTime() + F.INK_GRACE);
      } else if (ph === 'draw') this._finishDraw(at);
      else if (ph === 'score') this._set('gallery', at, F.GALLERY_TIME);
      else if (ph === 'gallery') {
        if (this.round < this.rounds) this._beginRound(this.round + 1, at);
        else {
          this.results = this.buildResults();
          this._set('final', at, F.FINAL_TIME);
          this._sayQueue = [];
          this._lastSay = -99;
          this._say('final', at, this.results[0].name);
        }
      } else if (ph === 'final') {
        this.phase = 'done';
        this._dirty = true;
      } else return;
    }
  }

  _beginRound(round, at) {
    this.round = round;
    this.gallery = null;
    this._firstDone = false;
    for (const st of Object.values(this.P)) {
      Object.assign(st, { paper: new Paper(false), done: false, doneAt: null, points: 0, live: 0, dirty: false });
    }
    this._set('slot', at, this.F.SLOT_TIME);
  }

  _everyoneDone() {
    const active = this.ids.filter((id) => this.connected.has(id));
    return active.length > 0 && active.every((id) => this.P[id].done);
  }

  _leader() {
    const rows = this.ids.map((id) => [this.P[id].total, id]).sort((a, b) => b[0] - a[0]);
    if (rows.length > 1 && rows[0][0] === rows[1][0]) return null;
    return rows.length && rows[0][0] > 0 ? rows[0][1] : null;
  }

  // 그리기 끝 → 모두 채점 (원본 finishTurn)
  _finishDraw(at) {
    const S = this.S;
    const plan = this.nowPlan;
    const per = S.TIME_BONUS * (plan.twist === 'speed' ? 2 : 1);
    const before = this._leader();
    const scores = {};
    for (const id of this.ids) {
      const st = this.P[id];
      st.paper.end();
      const sc = scoreDrawing(st.paper, this.shape);
      const early = st.doneAt !== null;
      const left = early ? Math.max(0, this.drawUntil - st.doneAt) : 0;
      const bonus = early && sc.accuracy >= S.OKAY ? Math.min(S.BONUS_MAX, Math.floor(left) * per) : 0;
      const result = {
        accuracy: sc.accuracy, cover: Math.round(sc.cover * 1000) / 1000, neat: Math.round(sc.neat * 1000) / 1000,
        bonus, mult: plan.mult, total: (sc.accuracy + bonus) * plan.mult,
      };
      st.rounds[this.round - 1] = result;
      st.total += result.total;
      st.live = sc.accuracy;
      scores[id] = result;
    }
    this.gallery = Object.fromEntries(this.ids.map((id) => [id, this.P[id].paper.bits()]));
    this._event({ type: 'reveal', round: this.round, scores, drawings: this.gallery });
    this._set('score', at, this.F.SCORE_TIME);
    const best = this.ids.reduce((a, b) => (scores[b].total > scores[a].total ? b : a));
    const worst = this.ids.reduce((a, b) => (scores[b].accuracy < scores[a].accuracy ? b : a));
    if (this.ids.every((id) => scores[id].accuracy < S.OKAY)) this._say('all_poof', at);
    else if (scores[best].accuracy >= S.SUCCESS) this._say('success', at, this.names[best]);
    else if (scores[worst].accuracy < S.OKAY) this._say('poof', at, this.names[worst]);
    const after = this._leader();
    if (after && after !== before && this.round > 1) this._say('lead_change', at + this.cfg.SAY_GAP + 0.1, this.names[after]);
  }

  _say(kind, at, name = '') {
    this._sayQueue.push({ at, kind, name });
  }

  _flushSays(now) {
    const keep = [];
    for (const q of this._sayQueue) {
      if (now < q.at) keep.push(q);
      else if (now - this._lastSay >= this.cfg.SAY_GAP && now - q.at < 1) {
        const pool = CANNED[q.kind] || [];
        if (!pool.length) continue;
        const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', q.name);
        this._lastSay = now;
        this._event({ type: 'say', text, source: 'canned', who: CASTER, kind: q.kind });
      }
    }
    this._sayQueue = keep;
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || !this.P[playerId]) return;
    this._advance(now);
    if (this.phase !== 'draw') return;
    const st = this.P[playerId];
    if (st.done) return;
    if (data.k === 'ink') this._ink(st, data);
    else if (data.k === 'done') {
      if (now < this.since + this.F.DONE_LOCK) return;
      let t = data.t;
      if (!isNum(t) || t < now - this.F.INK_GRACE || t > now) t = now;
      st.done = true;
      st.doneAt = Math.max(this.since, Math.min(t, this.drawUntil));
      st.paper.end();
      this._event({ type: 'done', playerId });
      this._dirty = true;
      if (!this._firstDone && now < this.drawUntil) {
        this._firstDone = true;
        this._say('first_done', now, this.names[playerId]);
      }
      this._advance(now);
    }
  }

  _ink(st, data) {
    const pts = data.p;
    const L = this.cfg.LIMITS;
    const S = this.cfg.CANVAS;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 || pts.length > L.PACKET_POINTS * 2) return;
    if (st.points + pts.length / 2 > L.ROUND_POINTS) return;
    for (const v of pts) if (!isNum(v) || v < -0.5 || v >= S - 0.5) return;
    if (!data.c) st.paper.end();
    for (let i = 0; i < pts.length; i += 2) st.paper.stroke(Math.round(pts[i]), Math.round(pts[i + 1]), null);
    st.points += pts.length / 2;
    st.dirty = true;
  }

  _updateLive(now) {
    if (now - this._lastLiveAt < 0.5) return;
    this._lastLiveAt = now;
    for (const st of Object.values(this.P)) {
      if (!st.dirty) continue;
      st.dirty = false;
      st.live = scoreDrawing(st.paper, this.shape).accuracy;
    }
  }

  buildResults() {
    const rows = this.players.map((p, order) => {
      const st = this.P[p.id];
      const done = st.rounds.filter(Boolean);
      return {
        playerId: p.id, name: p.name, score: st.total, rank: 0, isWinner: false, order,
        stats: {
          rounds: st.rounds.map((r) => (r ? r.total : 0)),
          accuracy: st.rounds.map((r) => (r ? r.accuracy : 0)),
          best: Math.max(0, ...done.map((r) => r.accuracy)),
          spells: done.filter((r) => r.accuracy >= this.S.SUCCESS).length,
        },
      };
    });
    rows.sort((a, b) => b.score - a.score || a.order - b.order);
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
    });
    for (const r of rows) {
      r.isWinner = r.score === rows[0].score;
      delete r.order;
    }
    return rows;
  }

  snapshot(now, me = null) {
    const plan = this.nowPlan;
    const hideLive = !!plan && plan.twist === 'ghost' && this.phase === 'draw';
    const players = {};
    for (const id of this.ids) {
      const st = this.P[id];
      players[id] = { total: st.total, rounds: st.rounds.slice(), done: st.done, live: hideLive ? null : st.live };
    }
    const snap = {
      phase: this.phase, now, since: this.since, until: this.until, round: this.round, rounds: this.rounds,
      shape: plan ? plan.shape : null, twist: plan ? plan.twist : null, mult: plan ? plan.mult : 1,
      drawUntil: this.phase === 'draw' ? this.drawUntil : null,
      players, reviews: null, verdict: null,
      results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
    };
    if (me !== null) {
      if (this.phase === 'draw' && this.P[me]) snap.me = { ink: this.P[me].paper.bits() };
      if ((this.phase === 'score' || this.phase === 'gallery') && this.gallery) snap.drawings = this.gallery;
    }
    return snap;
  }

  stateFor(id, now) {
    return this.snapshot(now, id);
  }

  _emit(now, force = false) {
    const gap = this.phase === 'draw' ? 1 / this.F.STATE_HZ : 1;
    if (force || this._dirty || now - this._lastStateAt >= gap) {
      this._dirty = false;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 그리기 시간에 모양을 따라 자동으로 그리고(AutoDrawer, 솜씨는 봇마다 다르게) 다 그리면 '완료'를 보낸다.
 * 반환값은 (sim, 지금 시각) → [{ playerId, data }] 함수.
 */
export function createBots(botIds, rng = Math.random) {
  const bots = botIds.map((id) => ({ id, key: '', auto: null, cont: 0, done: false, last: 0 }));
  return (sim, now) => {
    const out = [];
    if (sim.phase !== 'draw' || now >= sim.drawUntil) return out;
    const S = sim.cfg.CANVAS;
    for (const b of bots) {
      const key = `${sim.round}`;
      if (b.key !== key) {
        Object.assign(b, { key, auto: new AutoDrawer(sim.shape, 0.15 + rng() * 0.8, rng), cont: 0, done: false, last: sim.since });
      }
      if (b.done) continue;
      // 지난번 뒤로 흐른 시간만큼(60분의 1초에 한 점) 펜을 움직인다
      const steps = Math.max(1, Math.min(12, Math.round((now - b.last) * 60)));
      b.last = now;
      const pts = [];
      let finished = false;
      for (let i = 0; i < steps; i++) {
        const p = b.auto.next();
        if (!p) {
          finished = true;
          break;
        }
        pts.push(Math.max(0, Math.min(S - 1, Math.round(p.x))), Math.max(0, Math.min(S - 1, Math.round(p.y))));
      }
      if (pts.length) {
        out.push({ playerId: b.id, data: { k: 'ink', p: pts, c: b.cont } });
        b.cont = 1;
      }
      if (finished && now >= sim.since + sim.F.DONE_LOCK) {
        b.done = true;
        out.push({ playerId: b.id, data: { k: 'done', t: now } });
      }
    }
    return out;
  };
}
