// =============================================================
// Sim — 시험용(LocalSession 전용) 실거리 사격 진행기
//
// 실제 판정은 Python 서버(server/party/games/livefire/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 는 없다: 통제관 대본 방송(tower)은 그대로, 해설(say)은 기본 대사 몇 줄만, 총평(verdict)은 보내지 않는다.
// =============================================================
import { DOWN, LEFT, RIGHT, UP, mergeConfig } from './config.js';
import { Range, gradeOf, makeSchedule } from './rules.js';

const CASTER = '호랑대장';
const CANNED = {
  first_hit: ['{name}, 첫 명중이다!', '첫 발 명중! {name} 좋다!'],
  halfway: ['절반이다! 선두는 {name}!', '반 남았다! {name} 가 앞선다!'],
  cease: ['수고했다! 으뜸은 {name} 이다!', '사격 종료! {name} 가 빛났다!'],
};

export class Sim {
  static id = 'livefire';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig(options && options.config);
    this.rng = rng;
    this.fps = this.cfg.FPS;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = {};
    for (const p of this.players) this.names[p.id] = p.name;
    this.schedule = makeSchedule(rng, this.cfg);
    const sway = {};
    for (const id of this.ids) sway[id] = rng() * 10;
    this.range = new Range(this.cfg, this.ids, this.schedule, sway);
    this.phase = 'idle';
    this.startAt = 0;
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this.tower = null;
    this._finalAt = 0;
    this._lastStateAt = -1;
    this._lastSayAt = -99;
    this._scriptAt = -99;
    this._pending = null;
    this._firstHit = false;
    this._outbox = [];
  }

  clientOptions() {
    const c = this.cfg;
    const keys = ['TARGETS', 'MAG_SIZE', 'RELOAD_TIME', 'RISE_TIME', 'AIM_START_Y', 'AIM_TOP_Y', 'AIM_BOTTOM_Y',
      'AIM_SPEED_X', 'AIM_SPEED_Y', 'AIM_RANGE', 'SWAY', 'STEADY_TIME', 'STEADY_SWAY', 'RECOIL',
      'KICK_DECAY', 'FIRE_COOLDOWN', 'HIT_POINTS', 'QUICK_MAX', 'GRADES', 'BRIEF_END', 'CEASE_END',
      'GRADE_AT', 'FINAL_TIME', 'FPS'];
    const config = {};
    for (const k of keys) config[k] = c[k];
    config.DISTANCES = {};
    for (const [d, v] of Object.entries(c.DISTANCES)) config.DISTANCES[d] = { y: v.y, w: v.w, h: v.h };
    return { config, caster: CASTER };
  }

  start(now) {
    this.startAt = now;
    this.phase = 'brief';
    this._emit(now, true);
  }

  _advance(now) {
    if (!['brief', 'fire', 'cease'].includes(this.phase)) return;
    const target = Math.floor((now - this.startAt) * this.fps + 1e-6);
    const rg = this.range;
    while (rg.frame < target && rg.phase !== 'over') rg.step();
    this._handleEvents(now);
  }

  _handleEvents(now) {
    const rg = this.range;
    const events = rg.events;
    rg.events = [];
    for (const e of events) {
      if (e.type === 'tower') {
        this.tower = { text: e.text, source: 'script', at: now };
        this._scriptAt = now;
        this._outbox.push([null, 'event', { type: 'tower', text: e.text, who: CASTER }]);
      } else if (e.type === 'dry') this._outbox.push([e.playerId, 'event', { type: 'dry' }]);
      else if (e.type === 'shot') {
        this._outbox.push([null, 'event', e]);
        if (e.hit && !this._firstHit) {
          this._firstHit = true;
          this._comment('first_hit', this.names[e.playerId], now, 3);
        }
      } else if (e.type === 'half') this._comment('halfway', this._leader(), now, 6);
      else if (e.type === 'cease') {
        this.finalResults = this.buildResults();
        this._comment('cease', this._leader(), now, 8);
      }
    }
  }

  _rankKey(id) {
    const l = this.range.lanes[id];
    return [l.score(this.cfg), l.hits, -l.shots];
  }

  _sorted() {
    return [...this.ids].sort((a, b) => {
      const ka = this._rankKey(a);
      const kb = this._rankKey(b);
      return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
    });
  }

  _leader() {
    const top = this._sorted()[0];
    return top ? this.names[top] : '';
  }

  _canSay(now) {
    return now - this._lastSayAt >= this.cfg.SAY_GAP && now - this._scriptAt >= this.cfg.SCRIPT_GAP;
  }

  _comment(kind, name, now, hold = 0) {
    if (!this._canSay(now)) {
      if (hold > 0) this._pending = [kind, name, now + hold];
      return;
    }
    const pool = CANNED[kind];
    if (!pool) return;
    const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', name);
    this._lastSayAt = now;
    this.tower = { text, source: 'canned', at: now };
    this._outbox.push([null, 'event', { type: 'say', text, source: 'canned', who: CASTER, kind }]);
  }

  tick(now) {
    const before = this.phase;
    this._advance(now);
    const rg = this.range;
    if (['brief', 'fire', 'cease'].includes(this.phase)) {
      this.phase = rg.phase === 'over' ? 'final' : rg.phase;
      if (this.phase === 'final') {
        this._finalAt = now;
        if (!this.finalResults.length) this.finalResults = this.buildResults();
      }
    }
    if (this.phase === 'final' && now >= this._finalAt + this.cfg.FINAL_TIME) this.phase = 'done';
    if (this._pending) {
      const [kind, name, until] = this._pending;
      if (now > until) this._pending = null;
      else if (this._canSay(now)) {
        this._pending = null;
        this._comment(kind, name, now);
      }
    }
    this._emit(now, this.phase !== before);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    if (!this.range.lanes[playerId] || !data || typeof data !== 'object') return;
    if (data.k !== 'in' && data.k !== 'fire') return;
    this._advance(now);
    if (Number.isInteger(data.held) && data.held >= 0 && data.held <= 15) this.range.setHeld(playerId, data.held);
    if (data.k === 'fire') {
      this.range.fire(playerId);
      this._handleEvents(now);
    }
  }

  /** 공통 결과 형식 (점수 내림차순, 동점은 같은 순위) */
  buildResults() {
    const rows = this._sorted().map((id) => {
      const l = this.range.lanes[id];
      return {
        playerId: id, name: this.names[id], score: l.score(this.cfg), rank: 0, isWinner: false,
        stats: {
          hits: l.hits, shots: l.shots, quick: l.quick, grade: gradeOf(l.hits, this.cfg).name,
          accuracy: l.shots ? Math.round((100 * l.hits) / l.shots) : 0, bestStreak: l.bestStreak,
        },
      };
    });
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1;
    });
    const top = rows.length ? rows[0].score : 0;
    for (const r of rows) r.isWinner = r.score === top;
    return rows;
  }

  snapshot(now) {
    const rg = this.range;
    const tg = rg.tPhase !== 'gap' ? rg.target : null;
    const lanes = {};
    for (const id of this.ids) {
      const l = rg.lanes[id];
      const a = l.aim();
      lanes[id] = {
        hits: l.hits, shots: l.shots, score: l.score(this.cfg), mag: l.mag, spare: l.spare, reload: l.reloadT,
        hitK: l.hitK, fallT: l.fallT, streak: l.streak,
        aim: [Math.round(a.x * 10) / 10, Math.round(a.y * 10) / 10],
        rec: l.record.map((r) => (r ? '1' : '0')).join(''),
      };
    }
    return {
      phase: this.phase, now, startAt: this.startAt, frame: rg.frame, t: rg.t,
      k: rg.k, total: rg.total, tPhase: rg.tPhase, tT: rg.tT,
      target: tg ? { dist: tg.dist, x: tg.x, time: tg.time } : null,
      lanes, tower: this.tower, verdict: null,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
    };
  }

  meView(id) {
    const l = this.range.lanes[id];
    return { ax: l.ax, ay: l.ay, kick: l.kick, still: l.still, cooldown: l.cooldown, ph: l.phase, held: l.held };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    if (this.range.lanes[id]) snap.me = this.meView(id);
    return snap;
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    if (force || now - this._lastStateAt >= 1 / this.cfg.STATE_HZ - 1e-9) {
      this._lastStateAt = now;
      const common = this.snapshot(now);
      for (const id of this.ids) this._outbox.push([id, 'state', { ...common, me: this.meView(id) }]);
    }
  }
}

/**
 * 시험용 봇 (원본 js/bot.js RangeBot 을 입력 방식에 맞춰 옮긴 것).
 * 표적이 올라오면 → 잠깐 반응 → 조준 키로 조준점을 옮김 → 숨 고르고 → 발사. skill 0~1: 높을수록 빠르고 정확.
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "in" / "fire" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const bots = new Map();
  for (const id of botIds) bots.set(id, { skill: 0.15 + rng() * 0.75, plan: null, sent: 0 });
  return (sim) => {
    const rg = sim.range;
    const cfg = sim.cfg;
    const out = [];
    for (const [id, bot] of bots) {
      const lane = rg.lanes[id];
      if (!lane) continue;
      let held = 0;
      let fire = false;
      const tg = rg.target;
      const can = rg.phase === 'fire' && tg && lane.hitK !== rg.k && lane.reloadT === 0 && lane.mag > 0
        && (rg.tPhase === 'rise' || rg.tPhase === 'up');
      if (!can) {
        if (!tg || rg.tPhase === 'gap') bot.plan = null;
      } else {
        const s = bot.skill;
        if (!bot.plan || bot.plan.k !== rg.k) {
          const D = cfg.DISTANCES[tg.dist];
          bot.plan = {
            k: rg.k,
            x: tg.x + (rng() - 0.5) * (1 - s) * D.w * 2.8,
            y: D.y - D.h * 0.55 + (rng() - 0.5) * (1 - s) * D.h * 2.4,
            wait: 6 + Math.floor(rng() * (30 - s * 20)),       // 틱(1/30초) 단위
            settle: Math.floor(2 + rng() * 15 * s),
          };
        }
        const P = bot.plan;
        if (P.wait > 0) P.wait--;
        else {
          const dx = P.x - lane.ax;
          const dy = P.y - lane.ay;
          if (Math.abs(dx) > cfg.AIM_SPEED_X * 2) held |= dx < 0 ? LEFT : RIGHT;
          if (Math.abs(dy) > cfg.AIM_SPEED_Y * 2) held |= dy < 0 ? UP : DOWN;
          if (!held && P.settle-- <= 0 && lane.kick <= 0.5) {
            fire = true;
            P.settle = 12;      // 빗나가면 다시 숨 고르고 한 발 더
          }
        }
      }
      if (fire) out.push({ playerId: id, data: { k: 'fire', held } });
      else if (held !== bot.sent) out.push({ playerId: id, data: { k: 'in', held } });
      bot.sent = held;
    }
    return out;
  };
}
