// =============================================================
// Sim — 시험용(LocalSession 전용) 하노마노 진행기
//
// 실제 판정은 Python 서버(server/party/games/hanomano/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// AI 가 없으므로 해설(say)은 기본 대사 몇 줄만 나오고 총평(verdict)은 보내지 않는다.
// =============================================================
import { CONFIG, bellIsRight, bellReason, deal, makeDeck, shuffleCards } from './rules.js';

const CASTER = '마법사';
const SAY = {
  start: ['자, 눈을 크게 뜨시지요.', '딱 5개입니다. 4개도 6개도 아닙니다.'],
  correct: ['{name} 님, 눈이 밝으시군요.', '{name} 님이 가져가십니다.'],
  bigpot: ['{name} 님, 한몫 챙기셨군요!', '판이 {name} 님께 기울었습니다.'],
  wrong: ['{name} 님, 세어 보고 치시지요.', '성급하셨습니다, {name} 님.'],
  near: ['아깝군요, {name} 님. 4개였습니다.', '{name} 님, 하나가 모자랐습니다.'],
  low: ['{name} 님, 카드가 바닥입니다.', '{name} 님이 위태롭군요.'],
  lastMinute: ['이제 1분 남았습니다.', '마지막 1분, 서두르시지요.'],
  reshuffle: ['카드를 다시 모으겠습니다.', '판을 새로 고르지요.'],
  timeup: ['시간이 다 됐습니다.', '거기까지입니다, 여러분.'],
  sweep: ['{name} 님이 판을 쓸어 갔습니다!', '{name} 님, 전부 가져가셨군요.'],
};

export class Sim {
  static id = 'hanomano';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    const over = (options && options.config) || {};
    this.R = { ...CONFIG.RULES, ...(over.RULES || {}) };
    this.F = { ...CONFIG.FLOW, ...(over.FLOW || {}) };
    this.N = { ...CONFIG.NET, ...(over.NET || {}) };
    this.A = { ...CONFIG.AI, ...(over.AI || {}) };
    this.rng = rng;
    const { hands, spare } = deal(makeDeck(this.R, rng), players.length);
    this.spare = spare;
    this.seats = players.map((p, i) => ({
      id: p.id, name: p.name || p.id, deck: hands[i], pile: [], lock: 0, correct: 0, wrong: 0, got: 0,
      connected: true, lowSaid: false,
    }));
    this.byId = new Map(this.seats.map((s) => [s.id, s]));
    this.turn = Math.min(this.seats.length - 1, Math.floor(rng() * this.seats.length));
    this.phase = 'idle';
    this.since = 0;
    this.until = 0;
    this.endAt = 0;
    this.playSince = 0;
    this.turnSince = 0;
    this.stallSince = null;
    this.history = [];
    this.offers = [];
    this.offerDeadline = null;
    this.offerSeq = 0;
    this.last = null;
    this.endInfo = null;
    this.finalResults = null;
    this.lastSay = null;
    this.lastSayAt = -99;
    this.minuteSaid = false;
    this.finished = false;
    this.results = [];
    this._outbox = [];
    this._dirty = true;
    this._lastStateAt = -1;
  }

  // ----- 공통 규격 (서버 MiniGame 과 같은 모양) -----
  clientOptions() {
    return {
      rules: {
        TIME_LIMIT: this.R.TIME_LIMIT, TARGET: this.R.TARGET, FRUITS: this.R.FRUITS.slice(),
        TURN_TIME: this.R.TURN_TIME.slice(), WRONG_LOCK: this.R.WRONG_LOCK,
      },
      flow: { ...this.F },
      order: this.seats.map((s) => s.id),
      each: this.seats[0].deck.length,
      spare: this.spare.length,
      caster: CASTER,
    };
  }

  start(now) {
    this._set('intro', now, now + this.F.INTRO_TIME);
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    if (this.phase === 'play') this._commentary(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.finalResults || this.buildResults();
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    if (!this.byId.has(playerId) || !data || typeof data !== 'object') return;
    this._advance(now);
    if (data.k === 'flip') this._onFlip(playerId, now);
    else if (data.k === 'bell') this._onBell(playerId, data.t, now);
    this._emit(now);
  }

  stateFor(_playerId, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  // ----- 진행 -----
  _event(data) {
    this._outbox.push([null, 'event', data]);
  }

  _set(phase, at, until = 0) {
    this.phase = phase;
    this.since = at;
    this.until = until;
    this._dirty = true;
  }

  tops() {
    return this.seats.map((s) => (s.pile.length ? s.pile[s.pile.length - 1] : null));
  }

  cardsOf(seat) {
    return seat.deck.length + seat.pile.length;
  }

  turnTime(at) {
    const [a, b] = this.R.TURN_TIME;
    const k = 1 - Math.max(0, this.endAt - at) / this.R.TIME_LIMIT;
    return a + (b - a) * Math.min(1, Math.max(0, k));
  }

  _flipDeadline() {
    let wait = this.turnTime(this.turnSince);
    if (!this.seats[this.turn].connected) wait = Math.min(wait, this.N.AWAY_TURN_TIME);
    return this.turnSince + wait;
  }

  _advance(now) {
    for (let i = 0; i < 400; i++) {
      const ph = this.phase;
      if (ph === 'intro') {
        if (now < this.until) return;
        this._set('deal', this.until, this.until + this.F.DEAL_TIME);
      } else if (ph === 'deal') {
        if (now < this.until) return;
        this._beginPlay(this.until);
      } else if (ph === 'play') {
        if (!this._advancePlay(now)) return;
      } else if (ph === 'collect' || ph === 'wrong') {
        if (now < Math.min(this.until, this.endAt)) return;
        if (this.endAt <= this.until) this._finish('time', this.endAt, null);
        else this._resume(this.until);
      } else if (ph === 'end') {
        if (now < this.until) return;
        this._set('final', this.until, this.until + this.F.FINAL_TIME);
        this._event({ type: 'final', results: this.finalResults });
      } else if (ph === 'final') {
        if (now < this.until) return;
        this._set('done', this.until);
      } else return;
    }
  }

  _beginPlay(at) {
    this.endAt = at + this.R.TIME_LIMIT;
    this._event({ type: 'go' });
    this._say('start', at, true);
    this._resume(at);
  }

  _resume(at) {
    this._set('play', at);
    this.playSince = at;
    this.turnSince = at;
    this.stallSince = null;
    this.offers = [];
    this.offerDeadline = null;
    this.history = [[at, this.tops()]];
    this._settle(at);
  }

  _advancePlay(now) {
    // 가장 먼저 일어날 일 하나: 시간 종료 → 종 판정 → 자동 뒤집기 → 다시 모으기
    const todo = [[this.endAt, 0, 'time']];
    if (this.offerDeadline !== null) todo.push([this.offerDeadline, 1, 'bell']);
    if (this.seats[this.turn].deck.length) todo.push([this._flipDeadline(), 2, 'flip']);
    if (this.stallSince !== null) todo.push([this.stallSince + this.N.STALL_TIME, 3, 'stall']);
    todo.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [at, , what] = todo[0];
    if (at > now) return false;
    if (what === 'time') this._finish('time', at, null);
    else if (what === 'bell') this._resolveBell(at);
    else if (what === 'flip') this._flip(this.turn, at, true);
    else this._reshuffle(at);
    return true;
  }

  _onFlip(id, now) {
    const cur = this.seats[this.turn];
    if (this.phase !== 'play' || cur.id !== id || !cur.deck.length) return;
    this._flip(this.turn, now, false);
  }

  _flip(index, at, auto) {
    const seat = this.seats[index];
    const card = seat.deck.shift();
    seat.pile.push(card);
    this.history.push([at, this.tops()]);
    this._nextTurn(at);
    this._dirty = true;
    this._event({ type: 'flip', playerId: seat.id, card, auto, next: this.seats[this.turn].id });
    this._settle(at);
  }

  _nextTurn(at) {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turn + k) % n;
      if (this.seats[i].deck.length) {
        this.turn = i;
        this.turnSince = at;
        return;
      }
    }
  }

  _settle(at) {
    const total = this.seats.reduce((s, p) => s + this.cardsOf(p), 0);
    const leader = this.seats.find((p) => this.cardsOf(p) === total);
    if (leader) {
      this._finish('sweep', at, leader);
      return;
    }
    if (!this.seats[this.turn].deck.length) this._nextTurn(at);
    if (this.seats.some((s) => s.deck.length)) {
      this.stallSince = null;
      return;
    }
    if (bellIsRight(this.tops(), this.R)) {
      if (this.stallSince === null) this.stallSince = at;
    } else {
      this._reshuffle(at);
    }
  }

  _reshuffle(at) {
    for (const s of this.seats) {
      s.deck.push(...shuffleCards(s.pile, this.rng));
      s.pile = [];
    }
    this.stallSince = null;
    this.history.push([at, this.tops()]);
    this._dirty = true;
    this._event({ type: 'reshuffle' });
    this._say('reshuffle', at);
    this._nextTurn(at);
  }

  _onBell(id, t, now) {
    const seat = this.byId.get(id);
    if (this.phase !== 'play' || seat.lock > now) return;
    const N = this.N;
    let ts = now;
    if (typeof t === 'number' && Number.isFinite(t)) ts = Math.min(Math.max(t, now - N.BELL_MAX_LAG), now + N.BELL_MAX_LEAD);
    if (ts < this.playSince - N.BELL_MAX_LEAD) return;
    ts = Math.max(ts, this.playSince);
    if (this.offers.some((o) => o.id === id)) return;
    this.offers.push({ ts, seq: ++this.offerSeq, id });
    if (this.offerDeadline === null) this.offerDeadline = now + N.BELL_WINDOW;
  }

  _topsAt(ts) {
    let found = this.history[0][1];
    for (const [at, tops] of this.history) if (at <= ts) found = tops;
    return found;
  }

  _resolveBell(at) {
    const offers = this.offers.filter((o) => this.byId.get(o.id).lock <= at).sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    this.offers = [];
    this.offerDeadline = null;
    if (!offers.length) return;
    const { ts, id } = offers[0];
    const seat = this.byId.get(id);
    const shown = this._topsAt(ts);
    const why = bellReason(shown, this.R);
    const event = { type: 'ring', playerId: id, ok: why.ok, text: why.text, fruit: why.fruit, tops: shown, t: ts };
    if (why.ok) {
      let got = 0;
      const piles = {};
      for (const q of this.seats) {
        piles[q.id] = q.pile.length;
        got += q.pile.length;
        seat.deck.push(...shuffleCards(q.pile, this.rng));
        q.pile = [];
      }
      seat.correct++;
      seat.got += got;
      this.turn = this.seats.indexOf(seat);
      event.got = got;
      event.piles = piles;
      this._set('collect', at, at + this.R.COLLECT_PAUSE);
      this._say(got >= this.A.BIG_POT ? 'bigpot' : 'correct', at, false, seat.name);
    } else {
      const to = [];
      for (const q of this.seats) {
        if (q === seat || !seat.deck.length) continue;
        q.deck.push(seat.deck.pop());
        to.push(q.id);
      }
      seat.wrong++;
      seat.lock = at + this.R.WRONG_LOCK;
      event.gave = to.length;
      event.to = to;
      event.near = why.near;
      event.lock = seat.lock;
      this._set('wrong', at, at + this.R.WRONG_PAUSE);
      this._say(why.near ? 'near' : 'wrong', at, false, seat.name);
    }
    this.last = event;
    this._event(event);
  }

  _finish(reason, at, leader) {
    this.offers = [];
    this.offerDeadline = null;
    this.finalResults = this.buildResults();
    this.endInfo = { reason, playerId: leader ? leader.id : null, text: leader ? `${leader.name} 싹쓸이!` : '시간 종료!' };
    this._set('end', at, at + this.F.END_TIME);
    this._event({ type: 'end', ...this.endInfo });
    this._say(leader ? 'sweep' : 'timeup', at, true, leader ? leader.name : '');
  }

  // ----- 해설(기본 대사만) -----
  _say(kind, at, force = false, name = '') {
    if (!force && at - this.lastSayAt < this.A.SAY_GAP) return false;
    const pool = SAY[kind] || [];
    if (!pool.length) return false;
    const text = pool[Math.floor(this.rng() * pool.length) % pool.length].replace('{name}', name);
    this.lastSayAt = at;
    this.lastSay = { type: 'say', text, source: 'canned', who: CASTER, kind };
    this._event({ ...this.lastSay });
    return true;
  }

  _commentary(now) {
    if (!this.minuteSaid && this.endAt - now <= this.A.LAST_MINUTE) {
      this.minuteSaid = true;
      this._say('lastMinute', now, true);
    }
    for (const s of this.seats) {
      const low = this.cardsOf(s) <= this.A.LOW_CARDS;
      if (!low) s.lowSaid = false;
      else if (!s.lowSaid && this._say('low', now, false, s.name)) s.lowSaid = true;
    }
  }

  // ----- 결과 / 상태 -----
  buildResults() {
    const rows = this.seats.map((s, order) => {
      const cards = this.cardsOf(s);
      return {
        playerId: s.id, name: s.name, score: cards, rank: 0, isWinner: false,
        stats: { cards, correct: s.correct, wrong: s.wrong, got: s.got }, order,
      };
    });
    rows.sort((a, b) => b.score - a.score || b.stats.correct - a.stats.correct || a.stats.wrong - b.stats.wrong || a.order - b.order);
    const same = (a, b) => a.score === b.score && a.stats.correct === b.stats.correct && a.stats.wrong === b.stats.wrong;
    rows.forEach((r, i) => {
      r.rank = i > 0 && same(r, rows[i - 1]) ? rows[i - 1].rank : i + 1;
    });
    for (const r of rows) {
      r.isWinner = r.rank === 1;
      delete r.order;
    }
    return rows;
  }

  snapshot(now) {
    const ph = this.phase;
    const playing = ph === 'play' || ph === 'collect' || ph === 'wrong';
    return {
      phase: ph,
      now,
      since: this.since,
      until: ph !== 'play' ? this.until : null,
      endAt: playing ? this.endAt : null,
      timeLeft: playing ? Math.max(0, this.endAt - now) : ph === 'intro' || ph === 'deal' ? this.R.TIME_LIMIT : 0,
      turn: this.seats[this.turn].id,
      turnSince: this.turnSince,
      turnTime: ph === 'play' ? this._flipDeadline() - this.turnSince : 0,
      players: this.seats.map((s) => ({
        id: s.id, deck: s.deck.length, pile: s.pile.length, show: s.pile.slice(-4), lock: s.lock,
        correct: s.correct, wrong: s.wrong, connected: s.connected,
      })),
      last: this.last,
      end: this.endInfo,
      say: this.lastSay,
      verdict: null,
      results: ph === 'end' || ph === 'final' || ph === 'done' ? this.finalResults : null,
    };
  }

  _emit(now, force = false) {
    if (force || this._dirty || now - this._lastStateAt >= 0.5) {
      this._dirty = false;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇 (원본 js/bot.js 의 BellBot 과 같은 방식):
 *  - 펼친 카드가 바뀔 때마다 과일 수를 세고, 5개면 0.43~0.8초 뒤에 종
 *  - 4개나 6개처럼 아슬아슬하면 가끔 헷갈려서 틀리게 친다
 *  - 자기 차례에는 0.3~0.8초 뒤에 카드를 뒤집는다
 * @returns {(sim: Sim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const REACTION = [26 / 60, 48 / 60];
  const MISTAKE = 0.02;
  const mind = new Map(botIds.map((id) => [id, { sig: '', ringAt: null, flipAt: null }]));
  return (sim, now) => {
    const out = [];
    if (sim.phase !== 'play') return out;
    const tops = sim.tops();
    const sig = JSON.stringify(tops);
    for (const id of botIds) {
      const m = mind.get(id);
      if (sig !== m.sig) {
        m.sig = sig;
        m.ringAt = null;
        const react = REACTION[0] + rng() * (REACTION[1] - REACTION[0]) * 0.8;
        const totals = tops.reduce((s, c) => { if (c) s[c[0]] += c[1]; return s; }, [0, 0, 0, 0]);
        if (bellIsRight(tops, sim.R)) m.ringAt = now + react;
        else if (totals.some((v) => v === sim.R.TARGET - 1 || v === sim.R.TARGET + 1) && rng() < MISTAKE * 4) m.ringAt = now + react + 0.1;
      }
      if (m.ringAt !== null && now >= m.ringAt) {
        m.ringAt = null;
        out.push({ playerId: id, data: { k: 'bell', t: now } });
      }
      const cur = sim.seats[sim.turn];
      if (cur.id === id && cur.deck.length) {
        if (m.flipAt === null) m.flipAt = now + 0.3 + rng() * 0.5;
        if (now >= m.flipAt) {
          m.flipAt = null;
          out.push({ playerId: id, data: { k: 'flip' } });
        }
      } else {
        m.flipAt = null;
      }
    }
    return out;
  };
}
