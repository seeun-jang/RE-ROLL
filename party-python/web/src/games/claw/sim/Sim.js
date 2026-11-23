// =============================================================
// Sim — 시험용(LocalSession 전용) 잭팟 인형뽑기 진행기
//
// 실제 판정은 Python 서버(server/party/games/claw/)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 는 없다: 해설("say")은 기본 대사 몇 줄만, 총평("verdict")은 보내지 않는다.
// =============================================================
import { mergeConfig } from './config.js';
import { ClawBot, Machine, makePile } from './rules.js';

const CASTER = '꽥대장';
const SAY = {
  start: ['꽥! 코인 넣고 시작이다!', '오늘의 잭팟은 누구냐 꽥!'],
  gold: ['꽥! {name} 황금곰 잭팟!', '{name} 황금곰을 낚았다 꽥!'],
  win: ['{name} 하나 뽑았다 꽥!', '좋아 {name}, 그대로 쭉!'],
  lucky: ['{name} 굴러서 들어갔다 꽥!'],
  miss: ['{name} 허공을 집었다 꽥!'],
  slip: ['아이고 {name} 미끄러졌다!'],
  lastcoin: ['{name} 마지막 코인이다 꽥!'],
  lead: ['꽥! {name} 1등으로 올라선다!'],
  end: ['영업 끝! 우승은 {name} 꽥!'],
};

export class Sim {
  static id = 'claw';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig(options && options.config);
    this.R = this.cfg.RULES;
    this.fps = this.cfg.BASE.LOGIC_FPS;
    this.rng = rng;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    this.seed = (rng() * 1e9) | 0;
    const pile = makePile(this.cfg, this.seed);
    this.machines = {};
    for (const id of this.ids) this.machines[id] = new Machine(this.cfg, this.seed, pile);
    this.phase = 'idle';
    this.startAt = 0;
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this._endAt = 0;
    this._finalAt = 0;
    this._lastStateAt = -1;
    this._lastSayAt = -99;
    this._leader = null;
    this._outbox = [];
  }

  clientOptions() {
    const prizes = {};
    for (const [k, v] of Object.entries(this.cfg.PRIZES)) prizes[k] = { r: v.r, value: v.value };
    return {
      seed: this.seed, coins: this.cfg.COINS, moveTime: this.cfg.MOVE_TIME,
      intro: this.R.INTRO_TIME, endDelay: this.R.END_DELAY, final: this.R.FINAL_TIME,
      types: this.cfg.PRIZE_TYPES, prizes, caster: CASTER,
    };
  }

  start(now) {
    this.startAt = now + this.R.INTRO_TIME;
    this.phase = 'intro';
    this._emit(now, true);
  }

  gt(now) {
    return now - this.startAt;
  }

  _say(kind, now, name = '', priority = false) {
    const gap = priority ? this.cfg.SAY.PRIORITY_GAP : this.cfg.SAY.MIN_GAP;
    if (now - this._lastSayAt < gap) return;
    const pool = SAY[kind] || [];
    if (!pool.length) return;
    this._lastSayAt = now;
    const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', name);
    this._outbox.push([null, 'event', { type: 'say', kind, text, source: 'canned', who: CASTER }]);
  }

  _cmp(a, b) {
    const ka = this.machines[a].rankKey();
    const kb = this.machines[b].rankKey();
    return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
  }

  _leaderNow() {
    const sorted = [...this.ids].sort((a, b) => this._cmp(a, b));
    const best = sorted[0];
    if (this.machines[best].score <= 0) return null;
    if (sorted.length > 1 && this._cmp(best, sorted[1]) === 0) return null;
    return best;
  }

  _advance(now) {
    if (this.phase !== 'play' && this.phase !== 'end') return;
    const target = Math.floor(this.gt(now) * this.fps + 1e-6);
    for (const id of this.ids) {
      const m = this.machines[id];
      while (m.frame < target) m.step();
      if (!m.events.length) continue;
      const events = m.events;
      m.events = [];
      const name = this.names[id];
      for (const e of events) {
        this._outbox.push([id, 'event', e]);
        if (e.type === 'won') {
          if (e.prize === 'gold') this._say('gold', now, name, true);
          else this._say(e.lucky ? 'lucky' : 'win', now, name);
          const leader = this._leaderNow();
          if (leader !== null && leader !== this._leader) {
            this._say('lead', now, this.names[leader], true);
            this._leader = leader;
          }
        } else if (e.type === 'miss') this._say('miss', now, name);
        else if (e.type === 'slip') this._say('slip', now, name);
        else if (e.type === 'coin' && e.left === 0) this._say('lastcoin', now, name);
      }
    }
  }

  tick(now) {
    const gt = this.gt(now);
    const before = this.phase;
    if (this.phase === 'intro' && gt >= 0) {
      this.phase = 'play';
      this._say('start', now, '', true);
    }
    this._advance(now);
    if (this.phase === 'play' && this.ids.every((id) => this.machines[id].done)) {
      this.phase = 'end';
      this._endAt = now;
    }
    if (this.phase === 'end' && now >= this._endAt + this.R.END_DELAY) {
      this.finalResults = this.buildResults();
      this.phase = 'final';
      this._finalAt = now;
      const win = this.finalResults.find((r) => r.isWinner);
      this._say('end', now, win ? win.name : '', true);
    }
    if (this.phase === 'final' && now >= this._finalAt + this.R.FINAL_TIME) this.phase = 'done';
    this._emit(now, this.phase !== before);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    const m = this.machines[playerId];
    if (!m || !data || typeof data !== 'object' || data.k !== 'in' || this.phase !== 'play') return;
    this._advance(now);
    m.setInput(data.dir, data.drop === true);
  }

  // 점수 높은 순 → 뽑은 개수 → 황금곰 수. 모두 같으면 공동 순위
  buildResults() {
    const rows = this.players.map((p, order) => ({
      playerId: p.id, name: p.name, score: this.machines[p.id].score, rank: 0, isWinner: false,
      stats: this.machines[p.id].stats(), order,
    }));
    rows.sort((a, b) => this._cmp(a.playerId, b.playerId) || a.order - b.order);
    rows.forEach((r, i) => {
      r.rank = i > 0 && this._cmp(rows[i - 1].playerId, r.playerId) === 0 ? rows[i - 1].rank : i + 1;
    });
    for (const r of rows) {
      r.isWinner = r.rank === 1;
      delete r.order;
    }
    return rows;
  }

  snapshot(now) {
    const types = this.cfg.PRIZE_TYPES;
    const players = {};
    for (const id of this.ids) {
      const m = this.machines[id];
      players[id] = { score: m.score, coins: m.coins, done: m.done, won: m.won.map((p) => types.indexOf(p.type)) };
    }
    return {
      phase: this.phase, now, startAt: this.startAt, players,
      results: this.phase === 'final' || this.phase === 'done' ? this.finalResults : null,
      verdict: null,
    };
  }

  _personal(id) {
    const m = this.machines[id];
    const out = { me: m.view() };
    if (m.done && this.phase === 'play') {
      const other = this.ids.find((x) => !this.machines[x].done);
      if (other) out.watch = { id: other, view: this.machines[other].view() };
    }
    return out;
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    if (this.machines[id]) Object.assign(snap, this._personal(id));
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
      const common = this.snapshot(now);
      for (const id of this.ids) this._outbox.push([id, 'state', { ...common, ...this._personal(id) }]);
    }
  }
}

/**
 * 시험용 봇: 원본 CPU 손님(ClawBot)이 사람과 똑같은 "in" 입력을 만든다.
 * 돌려주는 값: [{ playerId, data }]
 */
export function createBots(botIds, rng = Math.random) {
  const bots = new Map(botIds.map((id) => [id, { bot: new ClawBot(0.15 + rng() * 0.75, rng), dir: 0 }]));
  return (sim) => {
    if (sim.phase !== 'play') return [];
    const out = [];
    for (const [id, b] of bots) {
      const m = sim.machines[id];
      if (!m) continue;
      const k = b.bot.think(m);
      const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      if (dir !== b.dir || k.drop) {
        b.dir = dir;
        const data = { k: 'in', dir };
        if (k.drop) data.drop = true;
        out.push({ playerId: id, data });
      }
    }
    return out;
  };
}
