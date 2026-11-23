// =============================================================
// Sim — 시험용(LocalSession 전용) 잭팟 그루브 진행기
//
// 실제 판정은 Python 서버(server/party/games/groove/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 는 없다: 해설(say)은 기본 대사 몇 줄만, 총평(verdict)은 보내지 않는다.
// =============================================================
import { CONFIG } from '../config.js';
import { SONGS, SONG_ORDER, expandSong } from '../song.js';
import { buildChart } from '../chart.js';
import { Performer } from '../performer.js';

const CASTER = '꽥대장';
const COMBO_SAY = [50, 100];
const BREAK_SAY = 30;
// 서버 game.py 의 SAY_CANNED 에서 한 줄씩
const SAY = {
  start: '꽥! 무대 조명 올려라!',
  jackpot: '꽥! 잭팟 타임이다!',
  combo50: '{name} 50콤보 꽥!',
  combo100: '{name} 100콤보! 꽥꽥!',
  pace: '{name} 풀콤보 페이스 꽥!',
  break: '앗, {name} 콤보 끊겼다 꽥!',
  lead: '{name} 1등으로 역전 꽥!',
  final: '막바지다, 끝까지 꽥!',
  finish_s: '{name} S 등급! 꽥꽥꽥!',
  finish: '다들 수고했다 꽥!',
};

export class Sim {
  static id = 'groove';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.rng = rng;
    this.F = { ...CONFIG.FLOW, ...((options && options.flow) || {}) };
    this.N = CONFIG.NET;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.names = Object.fromEntries(this.players.map((p) => [p.id, p.name]));
    let songId = options && options.song;
    if (!SONGS[songId]) songId = SONG_ORDER[Math.floor(rng() * SONG_ORDER.length) % SONG_ORDER.length];
    let diff = options && options.difficulty;
    if (!CONFIG.DIFFICULTY[diff]) diff = 'normal';
    this.songId = songId;
    this.difficulty = diff;
    this.song = SONGS[songId];
    this.ex = expandSong(this.song);
    this.chart = buildChart(this.song, diff);
    this.lastTime = Math.max(...this.chart.map((n) => (n.endTime !== null ? n.endTime : n.time)));
    this.lead = this.ex.barSec + this.F.LEAD_EXTRA;
    this.P = {};
    this._lastT = {};
    for (const id of this.ids) {
      const p = new Performer(this.chart);
      p.happened = [];
      // 서버 performer.py 의 happened 와 같은 기록: 콤보가 오르거나 끊긴 일
      p.on('judge', (kind) => {
        if (kind !== 'miss') p.happened.push(['combo', p.combo]);
      });
      p.on('break', (combo) => p.happened.push(['break', combo]));
      this.P[id] = p;
      this._lastT[id] = -Infinity;
    }
    this.phase = 'idle';
    this.startAt = 0;
    this.results = [];
    this.finalResults = [];
    this.finished = false;
    this.lastSay = null;
    this._lastSayAt = -Infinity;
    this._said = new Set();
    this._leader = null;
    this._jackpotAt = this.ex.bars.filter((b) => b.fever && b.firstOfSection).map((b) => b.index * this.ex.barSec);
    this._phaseAt = 0;
    this._lastStateAt = -1;
    this._outbox = [];
  }

  clientOptions() {
    return {
      song: this.songId, title: this.song.title, difficulty: this.difficulty,
      approach: CONFIG.DIFFICULTY[this.difficulty].approach, lead: this.lead, intro: this.F.INTRO_TIME,
      duration: this.ex.duration, notes: this.chart.length, total: this.P[this.ids[0]].total,
      maxLag: this.N.MAX_LAG, outro: this.F.OUTRO_TIME, final: this.F.FINAL_TIME,
    };
  }

  start(now) {
    this.startAt = now + this.F.INTRO_TIME + this.lead;
    this.phase = 'intro';
    this._phaseAt = now;
    this._emit(now, true);
  }

  gt(now) {
    return now - this.startAt;
  }

  tick(now) {
    const gt = this.gt(now);
    const before = this.phase;
    if (this.phase === 'intro' && gt >= -this.lead) {
      this.phase = 'play';
      this._say('start', now);
    }
    if (this.phase === 'play') {
      for (const id of this.ids) {
        this.P[id].sweep(gt - this.N.MAX_LAG);
        this._afterJudge(id, now);
      }
      this._commentary(gt, now);
      if (gt > this.lastTime + this.F.END_WAIT + this.N.MAX_LAG && this.ids.every((id) => this.P[id].finished)) this._endSong(now);
    }
    if (this.phase === 'outro' && now >= this._phaseAt + this.F.OUTRO_TIME) {
      this.phase = 'final';
      this._phaseAt = now;
    }
    if (this.phase === 'final' && now >= this._phaseAt + this.F.FINAL_TIME) this.phase = 'done';
    this._emit(now, this.phase !== before);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults;
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    const p = this.P[playerId];
    if (!p || !data || typeof data !== 'object' || data.k !== 'key' || this.phase !== 'play') return;
    const { lane, down } = data;
    let t = data.t;
    if (![0, 1, 2].includes(lane) || typeof down !== 'boolean' || typeof t !== 'number' || !Number.isFinite(t)) return;
    const gt = this.gt(now);
    t = Math.min(gt, Math.max(gt - this.N.MAX_LAG, t));
    t = Math.max(t, this._lastT[playerId]);
    this._lastT[playerId] = t;
    p.sweep(t);
    if (down && p.keyDown[lane]) p.input(lane, t, false); // 떼지 않고 또 눌렀다고 하면 먼저 뗀 것으로 본다
    p.input(lane, t, down);
    this._afterJudge(playerId, now);
  }

  _afterJudge(id, now) {
    const p = this.P[id];
    if (!p.happened.length) return;
    const happened = p.happened;
    p.happened = [];
    for (const [what, n] of happened) {
      if (what === 'combo' && n % 50 === 0) {
        this._outbox.push([null, 'event', { type: 'combo', playerId: id, n }]);
        if (COMBO_SAY.includes(n)) this._say(`combo${n}`, now, id);
      } else if (what === 'break' && n >= BREAK_SAY) {
        this._outbox.push([null, 'event', { type: 'break', playerId: id, combo: n }]);
        this._say('break', now, id);
      }
    }
  }

  _commentary(gt, now) {
    // 한 번만 하는 해설: 다른 말과 겹쳐 못 했으면 몇 초 동안 다시 시도한다 (서버와 같은 규칙)
    this._jackpotAt.forEach((t0, i) => {
      if (t0 <= gt && gt < t0 + 4 && !this._said.has(`jackpot${i}`) && this._say('jackpot', now)) this._said.add(`jackpot${i}`);
    });
    const dur = this.ex.duration;
    if (dur / 2 <= gt && gt < dur / 2 + 6 && !this._said.has('pace')) {
      const clean = this.ids.filter((id) => this.P[id].counts.miss === 0 && this.P[id].judged > 0);
      if (!clean.length || this._say('pace', now, clean.reduce((x, y) => (this.P[y].score > this.P[x].score ? y : x)))) this._said.add('pace');
    }
    if (dur - 10 <= gt && gt < dur - 4 && !this._said.has('final') && this._say('final', now)) this._said.add('final');
    const best = this.ids.reduce((a, b) => (this.P[b].score > this.P[a].score ? b : a));
    if (this.P[best].score > 0 && best !== this._leader) {
      if (this._leader === null || this.P[best].score > this.P[this._leader].score) {
        const changed = this._leader !== null;
        this._leader = best;
        if (changed) {
          this._outbox.push([null, 'event', { type: 'lead', playerId: best }]);
          if (gt > 3) this._say('lead', now, best);
        }
      }
    }
  }

  _say(kind, now, id = null, force = false) {
    if (!force && now - this._lastSayAt < this.N.SAY_GAP) return false;
    const text = (SAY[kind] || '').replace('{name}', id ? this.names[id] : '');
    if (!text) return false;
    this._lastSayAt = now;
    this.lastSay = { type: 'say', text, source: 'canned', who: CASTER, kind };
    this._outbox.push([null, 'event', { ...this.lastSay }]);
    return true;
  }

  _endSong(now) {
    this.finalResults = this.buildResults();
    this.phase = 'outro';
    this._phaseAt = now;
    for (const r of this.finalResults) {
      this._outbox.push([null, 'event', {
        type: 'finish', playerId: r.playerId, grade: r.stats.grade, fullCombo: r.stats.fullCombo, allPerfect: r.stats.allPerfect,
      }]);
    }
    const s = this.finalResults.find((r) => r.stats.grade === 'S');
    if (s) this._say('finish_s', now, s.playerId, true);
    else this._say('finish', now, null, true);
  }

  buildResults() {
    const rows = this.players.map((pl, order) => {
      const { score, ...rest } = this.P[pl.id].summary();
      return {
        playerId: pl.id, name: pl.name, score, rank: 0, isWinner: false,
        stats: { ...rest, song: this.songId, difficulty: this.difficulty }, order,
      };
    });
    rows.sort((a, b) => b.score - a.score || b.stats.maxCombo - a.stats.maxCombo || b.stats.perfect - a.stats.perfect || a.order - b.order);
    const same = (a, b) => a.score === b.score && a.stats.maxCombo === b.stats.maxCombo && a.stats.perfect === b.stats.perfect;
    rows.forEach((r, i) => {
      r.rank = i > 0 && same(r, rows[i - 1]) ? rows[i - 1].rank : i + 1;
      r.isWinner = r.rank === 1;
      delete r.order;
    });
    return rows;
  }

  snapshot(now) {
    const players = {};
    for (const id of this.ids) {
      const p = this.P[id];
      const g = p.liveGrade;
      players[id] = { score: p.score, combo: p.combo, maxCombo: p.maxCombo, ...p.counts, judged: p.judged, grade: g ? g.grade : null };
    }
    const done = ['outro', 'final', 'done'].includes(this.phase);
    return {
      phase: this.phase, now, startAt: this.startAt, song: this.songId, difficulty: this.difficulty, players,
      leader: this._leader, results: done ? this.finalResults : null, verdict: null, say: this.lastSay,
    };
  }

  stateFor(id, now) {
    const snap = this.snapshot(now);
    if (this.P[id]) snap.me = this.P[id].dump();
    return snap;
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _emit(now, force = false) {
    const gap = this.phase === 'play' ? 1 / this.N.STATE_HZ : 1;
    if (force || now - this._lastStateAt >= gap - 1e-9) {
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇: 원본의 자동 연주(autoPlay)와 같은 방식 — 노트 시각이 되면 누르고 롱노트는 끝까지 누른다.
 * 실력이 낮을수록 타이밍이 흔들리고 가끔 놓치거나 롱노트를 일찍 뗀다.
 * 돌려주는 값: [{ playerId, data }] — 사람과 똑같은 "key" 입력.
 */
export function createBots(botIds, rng = Math.random) {
  const [a, b] = CONFIG.BOT_SKILL;
  const bots = botIds.map((id) => ({ id, skill: a + rng() * (b - a), plan: new Map(), early: new Map() }));
  return (sim, now) => {
    if (sim.phase !== 'play') return [];
    const t = sim.gt(now);
    const out = [];
    const key = (id, lane, down, at) => out.push({ playerId: id, data: { k: 'key', lane, down, t: at } });
    for (const bot of bots) {
      const p = sim.P[bot.id];
      if (!p) continue;
      const miss = (1 - bot.skill) * 0.12;
      const jitter = (1 - bot.skill) * 0.13;
      for (let l = 0; l < 3; l++) {
        const h = p.holdNote[l];
        if (h && h.holding) {
          if (!bot.early.has(h.id)) bot.early.set(h.id, rng() < miss ? h.time + (h.endTime - h.time) * 0.5 : null);
          const e = bot.early.get(h.id);
          if (e !== null && t >= e) key(bot.id, l, false, t);
          continue;
        }
        if (p.keyDown[l]) key(bot.id, l, false, t);
        const n = p.lanes[l][p.ptr[l]];
        if (!n) continue;
        if (!bot.plan.has(n.id)) bot.plan.set(n.id, { skip: rng() < miss, off: (rng() + rng() - 1) * jitter });
        const pl = bot.plan.get(n.id);
        if (!pl.skip && t >= n.time + pl.off) key(bot.id, l, true, n.time + pl.off);
      }
    }
    return out;
  };
}
