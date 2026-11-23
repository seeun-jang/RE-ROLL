// =============================================================
// QuizSim — 시험용(LocalSession 전용) 음성 퀴즈 진행기
//
// 실제 판정은 Python 서버(server/party/games/quiz/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 형식의 메시지를 만든다.
// 서버가 없으므로 음성 인식은 되지 않는다 → 타자로만 답한다(voice: false). 문제도 시험용 10개뿐이다.
// =============================================================
import { AnswerChecker } from '../core/AnswerChecker.js';
import { chosungHint, firstLetterHint, normalize } from '../util/hangul.js';
import { SAMPLE_QUESTIONS } from './sampleQuestions.js';

const RULES = {
  QUESTION_COUNT: 10, QUESTION_TIME: 45, HINT_CHOSUNG_AT: 10, HINT_FIRST_AT: 20, ANSWER_TIME: 10,
  READY_TIME: 4, INTRO_TIME: 2.2, REVEAL_TIME: 3.6, WRONG_FEEDBACK_TIME: 1.2, FINAL_TIME: 8,
  VOICE_ATTEMPTS: 2, MAX_VOICE_SECONDS: 8, BUZZ_WINDOW: 0.12, BUZZ_MAX_LAG: 0.35, BUZZ_MAX_LEAD: 0.05,
};
const SCORE = { CORRECT: 100, WRONG: -50 };

export class QuizSim {
  static id = 'quiz';

  static tickHz = 20;

  constructor(players, options = {}, rng = Math.random) {
    this.R = { ...RULES, ...((options && options.rules) || {}) };
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    const pool = SAMPLE_QUESTIONS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.questions = pool.slice(0, this.R.QUESTION_COUNT).map((q) => ({
      ...q, hints: { chosung: chosungHint(q.answer), firstLetter: firstLetterHint(q.answer) },
    }));
    this.stats = {};
    for (const id of this.ids) this.stats[id] = { score: 0, correct: 0, wrong: 0, buzzes: 0, correctTime: 0 };
    this.phase = 'idle';
    this.index = -1;
    this.until = 0;
    this.elapsed = 0;
    this.openSince = 0;
    this.hintLevel = 0;
    this.locked = new Set();
    this.buzzer = null;
    this.answerDeadline = 0;
    this.last = null;
    this.checker = null;
    this.offers = [];
    this.offerDeadline = null;
    this.offerSeq = 0;
    this.finished = false;
    this.results = [];
    this._outbox = [];
    this._dirty = true;
    this._lastStateAt = -1;
  }

  // ----- 공통 규격 (서버 MiniGame 과 같은 모양) -----
  clientOptions() {
    const R = this.R;
    return {
      rules: {
        QUESTION_COUNT: R.QUESTION_COUNT, QUESTION_TIME: R.QUESTION_TIME, HINT_CHOSUNG_AT: R.HINT_CHOSUNG_AT,
        HINT_FIRST_AT: R.HINT_FIRST_AT, ANSWER_TIME: R.ANSWER_TIME, VOICE_ATTEMPTS: R.VOICE_ATTEMPTS,
        MAX_VOICE_SECONDS: R.MAX_VOICE_SECONDS,
      },
      score: { ...SCORE },
      voice: false,
    };
  }

  start(now) {
    this.phase = 'ready';
    this.until = now + this.R.READY_TIME;
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) {
      this.results = this.buildResults();
      this.finished = true;
    }
  }

  onInput(playerId, data, now) {
    if (!this.stats[playerId] || !data || typeof data !== 'object') return;
    this._advance(now);
    if (data.k === 'buzz') this._onBuzz(playerId, data.t, now);
    else if (data.k === 'typed') this._onTyped(playerId, data.text, now);
    else if (data.k === 'voice') this._outbox.push([playerId, 'event', { type: 'voiceOff' }]);
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
  get question() {
    return this.questions[this.index] || null;
  }

  _event(data) {
    this._outbox.push([null, 'event', data]);
  }

  _set(phase) {
    this.phase = phase;
    this._dirty = true;
  }

  _advance(now) {
    for (let i = 0; i < 12; i++) {
      const ph = this.phase;
      if (ph === 'ready') {
        if (now < this.until) return;
        this._nextQuestion(this.until);
      } else if (ph === 'intro') {
        if (now < this.until) return;
        this._set('open');
        this.openSince = this.until;
        this._event({ type: 'open', index: this.index });
      } else if (ph === 'open') {
        if (!this._advanceOpen(now)) return;
      } else if (ph === 'answering') {
        if (now < this.answerDeadline) return;
        this._wrong('timeout', '', this.answerDeadline);
      } else if (ph === 'wrong') {
        if (now < this.until) return;
        this._reopen(this.until);
      } else if (ph === 'reveal') {
        if (now < this.until) return;
        this._nextQuestion(this.until);
      } else if (ph === 'final') {
        if (now < this.until) return;
        this._set('done');
      } else return;
    }
  }

  _nextQuestion(at) {
    this.index++;
    this.offers = [];
    this.offerDeadline = null;
    if (this.index >= this.questions.length) {
      this._set('final');
      this.until = at + this.R.FINAL_TIME;
      this.last = null;
      this._event({ type: 'final', results: this.buildResults() });
      return;
    }
    this.locked = new Set();
    this.buzzer = null;
    this.hintLevel = 0;
    this.elapsed = 0;
    this.last = null;
    this.checker = new AnswerChecker(this.question);
    this._set('intro');
    this.until = at + this.R.INTRO_TIME;
    this._event({ type: 'intro', index: this.index });
  }

  _advanceOpen(now) {
    const R = this.R;
    const endAt = this.openSince + (R.QUESTION_TIME - this.elapsed);
    const e = this.elapsed + (Math.min(now, endAt) - this.openSince);
    const level = e >= R.HINT_FIRST_AT ? 2 : e >= R.HINT_CHOSUNG_AT ? 1 : 0;
    if (level > this.hintLevel) {
      this.hintLevel = level;
      this._dirty = true;
      this._event({ type: 'hint', level });
    }
    if (this.offerDeadline !== null && (now >= this.offerDeadline || now >= endAt)) {
      const at = Math.min(now, this.offerDeadline, endAt);
      const win = this._resolveOffers();
      if (win) {
        this._grant(win.id, Math.max(this.openSince, Math.min(win.ts, at)), at);
        return true;
      }
    }
    if (now >= endAt) {
      this.elapsed = R.QUESTION_TIME;
      this._reveal('timeup', endAt);
      return true;
    }
    return false;
  }

  _onBuzz(id, t, now) {
    if ((this.phase !== 'open' && this.phase !== 'wrong') || this.locked.has(id)) return;
    const R = this.R;
    let ts = now;
    if (typeof t === 'number' && Number.isFinite(t)) ts = Math.min(Math.max(t, now - R.BUZZ_MAX_LAG), now + R.BUZZ_MAX_LEAD);
    if (this.offers.some((o) => o.id === id)) return;
    this.offers.push({ ts, seq: ++this.offerSeq, id });
    if (this.offerDeadline === null) this.offerDeadline = now + R.BUZZ_WINDOW;
  }

  _resolveOffers() {
    const offers = this.offers.filter((o) => !this.locked.has(o.id)).sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    this.offers = [];
    this.offerDeadline = null;
    return offers[0] || null;
  }

  _grant(id, pressedAt, now) {
    this.elapsed = Math.min(this.R.QUESTION_TIME, this.elapsed + Math.max(0, pressedAt - this.openSince));
    this.buzzer = id;
    this.answerDeadline = now + this.R.ANSWER_TIME;
    this.stats[id].buzzes++;
    this.last = { type: 'buzz', player: id };
    this._set('answering');
    this._event({ type: 'buzz', player: id });
  }

  _onTyped(id, text, now) {
    if (this.phase !== 'answering' || id !== this.buzzer || typeof text !== 'string') return;
    const t = text.slice(0, 40);
    if (!normalize(t)) return;
    if (this.checker.isCorrect(t)) {
      const st = this.stats[id];
      st.correct++;
      st.score += SCORE.CORRECT;
      st.correctTime = Math.round((st.correctTime + this.elapsed) * 1000) / 1000;
      this.last = { type: 'correct', player: id, text: t, source: 'typed' };
      this.offers = [];
      this.offerDeadline = null;
      this._set('reveal');
      this.until = now + this.R.REVEAL_TIME;
      this._event({ type: 'correct', player: id, text: t, source: 'typed', answer: this.question.answer, points: SCORE.CORRECT });
    } else {
      this._wrong('typed', t, now);
    }
  }

  _wrong(cause, text, now) {
    const id = this.buzzer;
    const st = this.stats[id];
    st.wrong++;
    st.score += SCORE.WRONG;
    this.locked.add(id);
    this.buzzer = null;
    this.last = { type: 'wrong', player: id, text, cause };
    this._set('wrong');
    this.until = now + this.R.WRONG_FEEDBACK_TIME;
    this._event({ type: 'wrong', player: id, text, cause, points: SCORE.WRONG });
  }

  _reopen(at) {
    if (this.ids.every((id) => this.locked.has(id))) {
      this._reveal('allWrong', at);
      return;
    }
    this._set('open');
    this.openSince = at;
    this._event({ type: 'reopen' });
    if (this.offers.length) {
      const win = this._resolveOffers();
      if (win) this._grant(win.id, at, at);
    }
  }

  _reveal(kind, at) {
    this.offers = [];
    this.offerDeadline = null;
    this.buzzer = null;
    this.last = { type: kind };
    this._set('reveal');
    this.until = at + this.R.REVEAL_TIME;
    this._event({ type: kind, answer: this.question.answer });
  }

  buildResults() {
    const rows = this.players.map((p, order) => {
      const st = this.stats[p.id];
      return {
        playerId: p.id, name: p.name, score: st.score, rank: 0, isWinner: false,
        stats: { correct: st.correct, wrong: st.wrong, buzzes: st.buzzes, correctTime: Math.round(st.correctTime * 100) / 100 },
        order,
      };
    });
    rows.sort((a, b) => b.score - a.score || b.stats.correct - a.stats.correct || a.stats.correctTime - b.stats.correctTime || a.order - b.order);
    const same = (a, b) => a.score === b.score && a.stats.correct === b.stats.correct && Math.abs(a.stats.correctTime - b.stats.correctTime) <= 0.05;
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
    const q = this.question;
    const ph = this.phase;
    const showQ = !!q && ph !== 'intro' && ph !== 'ready' && ph !== 'idle';
    const revealed = ph === 'reveal';
    const hints = {};
    if (showQ && (this.hintLevel >= 1 || revealed)) hints.chosung = q.hints.chosung;
    if (showQ && (this.hintLevel >= 2 || revealed)) hints.firstLetter = q.hints.firstLetter;
    const e = this.elapsed + (ph === 'open' ? Math.max(0, now - this.openSince) : 0);
    const scores = {};
    for (const id of this.ids) {
      const st = this.stats[id];
      scores[id] = { score: st.score, correct: st.correct, wrong: st.wrong };
    }
    return {
      phase: ph,
      now,
      index: this.index,
      total: this.questions.length,
      category: q ? q.category : '',
      question: showQ ? q.question : null,
      answerLength: showQ ? q.answer.length : 0,
      answer: revealed ? q.answer : null,
      hintLevel: this.hintLevel,
      hints,
      timeLeft: Math.max(0, this.R.QUESTION_TIME - e),
      timeRunning: ph === 'open',
      answerLeft: ph === 'answering' ? Math.max(0, this.answerDeadline - now) : 0,
      answerRunning: ph === 'answering',
      until: ['ready', 'intro', 'wrong', 'reveal', 'final'].includes(ph) ? this.until : null,
      buzzer: this.buzzer,
      tries: 0,
      locked: this.ids.filter((id) => this.locked.has(id)),
      scores,
      last: this.last,
      voice: false,
      source: 'sample',
      results: ph === 'final' || ph === 'done' ? this.buildResults() : null,
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
 * 시험용 봇: 문제가 열리면 몇 초 뒤 버저를 누르고, 잠시 뒤 답한다(가끔 틀린다).
 * @returns {(sim: QuizSim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const plan = new Map(); // botId → { index, buzzAt, answerAt }
  return (sim, now) => {
    const out = [];
    for (const id of botIds) {
      let p = plan.get(id);
      if (!p || p.index !== sim.index) {
        p = { index: sim.index, wait: 6 + rng() * 22, answerAt: null };
        plan.set(id, p);
      }
      if (sim.phase === 'open' && !sim.locked.has(id)) {
        const e = sim.elapsed + Math.max(0, now - sim.openSince);
        if (e >= p.wait && !sim.offers.some((o) => o.id === id)) out.push({ playerId: id, data: { k: 'buzz', t: now } });
      } else if (sim.phase === 'answering' && sim.buzzer === id) {
        if (p.answerAt === null) p.answerAt = now + 1.5 + rng() * 2;
        if (now >= p.answerAt) {
          p.answerAt = null;
          const text = rng() < 0.65 ? sim.question.answer : '모르겠다';
          out.push({ playerId: id, data: { k: 'typed', text } });
        }
      }
    }
    return out;
  };
}
