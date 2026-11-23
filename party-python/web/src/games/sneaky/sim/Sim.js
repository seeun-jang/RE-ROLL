// =============================================================
// Sim — 시험용(LocalSession 전용) "교수님 몰래 댄스!" 진행기
//
// 실제 판정은 Python 서버(server/party/games/sneaky/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 모양의 메시지를 만든다.
// 규칙은 서버 코드를 그대로 옮긴 것이다. AI 가 없으므로
//  - 교수님은 항상 규칙 기반(원본 난수)으로 움직이고(AI 수업 계획 없음)
//  - 대사(say)는 기본 대사 몇 줄만, 총평(verdict)은 보내지 않는다.
// =============================================================
import { Teacher, TEACHER } from './teacher.js';

const LOGIC_FPS = 60;

/** 서버 config.py 의 DEFAULT_CONFIG 와 같은 값 */
export const SIM_CONFIG = Object.freeze({
  CLASS_TIME: 60 * 60,
  SMALL_RATE: 6,
  BIG_RATE: 15,
  BIG_RECOVER: 14,
  FEVER: [1, 1.5, 2, 3],
  CAUGHT_PENALTY: 20,
  PUNISH_TIME: 150,
  MAX_STRIKES: 3,
  GRACE: 12,
  FLOW: { INTRO_TIME: 4.0, END_HOLD: 170 / 60, FINAL_TIME: 8.0 },
  SAY_GAP: 3.0,
  LAST_SECONDS: 10,
});

/** 기본 대사 (서버 game.py 의 SAY_CANNED 에서 몇 줄) */
const CANNED = {
  start: ['자, 수업을 시작하겠습니다.'],
  caught_one: ['{name} 학생, 다 보입니다.', '{name} 학생, 춤은 쉬는 시간에.'],
  caught_many: ['단체로 춤바람이 나셨군요.'],
  fake: ['흠, 기분 탓이었나 보군요.'],
  clean: ['다들 얌전하군요. 수상합니다.'],
  fever: ['{name} 학생, 표정이 수상하군요.'],
  hallway: ['{name} 학생, 복도로 나가시지요.'],
  last10: ['10초 남았습니다. 방심 마시지요.'],
};

export class Sim {
  static id = 'sneaky';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = { ...SIM_CONFIG, ...((options && options.config) || {}) };
    this.cfg.FLOW = { ...SIM_CONFIG.FLOW, ...((options && options.config && options.config.FLOW) || {}) };
    this.rng = rng;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.names = new Map(this.players.map((p) => [p.id, p.name]));
    this.teacher = new Teacher(rng);
    this.students = this.players.map((p) => ({
      id: p.id, big: false, small: false, mode: 'none', recover: 0, punish: 0, strikes: 0, out: false, outFrames: 0,
      fever: 0, maxFever: 0, score: 0, danced: false, caughtLook: false, danceFrames: 0,
    }));
    this.byId = new Map(this.students.map((s) => [s.id, s]));
    this.phase = 'idle';
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.endFrame = null;
    this.left = this.cfg.CLASS_TIME;
    this.lineIdx = 0;
    this.lookCaught = 0;
    this.results = [];
    this.finished = false;
    this._outbox = [];
    this._lastSayFrame = -1e9;
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  clientOptions() {
    const c = this.cfg;
    return {
      config: {
        CLASS_TIME: c.CLASS_TIME, SMALL_RATE: c.SMALL_RATE, BIG_RATE: c.BIG_RATE, BIG_RECOVER: c.BIG_RECOVER,
        FEVER: c.FEVER, CAUGHT_PENALTY: c.CAUGHT_PENALTY, PUNISH_TIME: c.PUNISH_TIME, MAX_STRIKES: c.MAX_STRIKES,
        GRACE: c.GRACE, FLOW: c.FLOW,
      },
      seeFrom: TEACHER.SEE_FROM,
    };
  }

  start(now) {
    this.startAt = now + this.cfg.FLOW.INTRO_TIME;
    this.phase = 'intro';
    this._emit(now, true);
  }

  tick(now) {
    this._advance(now);
    this._emit(now);
    if (this.phase === 'done' && !this.finished) this.finished = true;
  }

  stateFor(_id, now) {
    return this.snapshot(now);
  }

  drain() {
    const out = this._outbox;
    this._outbox = [];
    return out;
  }

  _event(data, to = null) {
    this._outbox.push([to, 'event', data]);
  }

  _say(kind, name = '여러분', force = false) {
    if (!force && this.simFrame - this._lastSayFrame < this.cfg.SAY_GAP * LOGIC_FPS) return;
    const pool = CANNED[kind] || [];
    if (!pool.length) return;
    const text = pool[Math.floor(Math.random() * pool.length) % pool.length].replace('{name}', name);
    this._lastSayFrame = this.simFrame;
    this._event({ type: 'say', kind, text, source: 'canned', who: '마법사' });
  }

  _advance(now) {
    for (let i = 0; i < 6; i++) {
      if (this.phase === 'intro') {
        if (now < this.startAt) return;
        this.phase = 'play';
        this._say('start', '여러분', true);
      } else if (this.phase === 'play' || this.phase === 'end') {
        this._simulate(now);
        if (this.phase === 'play' || this.phase === 'end') return;
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
      } else return;
    }
  }

  _simulate(now) {
    const target = Math.floor((now - this.startAt) * LOGIC_FPS + 1e-6);
    const hold = Math.round(this.cfg.FLOW.END_HOLD * LOGIC_FPS);
    while (this.simFrame < target) {
      this.simFrame++;
      if (this.phase === 'play') this._step();
      if (this.endFrame !== null && this.simFrame >= this.endFrame + hold) {
        this.phase = 'final';
        this.phaseUntil = this.startAt + this.simFrame / LOGIC_FPS + this.cfg.FLOW.FINAL_TIME;
        return;
      }
    }
  }

  /** 한 프레임(1/60초) */
  _step() {
    const c = this.cfg;
    const tc = this.teacher;
    const k = 1 - this.left / c.CLASS_TIME;
    const wasLook = tc.state === 'look';
    tc.update(k);
    for (const e of tc.events) {
      if (e.type === 'fake') {
        this._event({ type: 'fake', frame: this.simFrame });
        this._say('fake');
        continue;
      }
      if (e.type === 'write') {
        this.lineIdx++;
        for (const s of this.students) s.danced = false;
      } else if (e.type === 'turn') this.lookCaught = 0;
      this._event({ type: 'teacher', state: e.type, frame: this.simFrame, sudden: tc.sudden && e.type === 'turn' });
    }
    tc.events.length = 0;

    // 다 보고 다시 칠판으로 → 안 걸린 사람은 피버 상승
    if (wasLook && tc.state === 'back') {
      let top = null;
      for (const s of this.students) {
        if (!s.out && !s.caughtLook && s.danced && s.punish === 0 && s.fever < c.FEVER.length - 1) {
          s.fever++;
          s.maxFever = Math.max(s.maxFever, s.fever);
          this._event({ type: 'fever', id: s.id, level: s.fever, mult: c.FEVER[s.fever] });
          if (s.fever >= 2 && (!top || s.fever > top.fever)) top = s;
        }
        s.caughtLook = false;
      }
      if (top) this._say('fever', this.names.get(top.id));
      else if (this.lookCaught === 0) this._say('clean');
    }

    const caught = this.students.filter((s) => this._updateStudent(s));
    if (caught.length) {
      this.lookCaught += caught.length;
      const out = caught.filter((s) => s.out).map((s) => s.id);
      this._event({ type: 'caught', ids: caught.map((s) => s.id), out, penalty: c.CAUGHT_PENALTY });
      if (out.length) this._say('hallway', this.names.get(out[0]), true);
      else if (caught.length === 1) this._say('caught_one', this.names.get(caught[0].id), true);
      else this._say('caught_many', '여러분', true);
    }

    this.left--;
    if (this.left === c.LAST_SECONDS * LOGIC_FPS) this._say('last10', '여러분', true);
    if (this.left <= 0) this._end();
  }

  /** 학생 한 명의 한 프레임. 이번 프레임에 걸렸으면 true (원본 updateStudent) */
  _updateStudent(s) {
    const c = this.cfg;
    if (s.out) {
      s.outFrames++;
      return false;
    }
    if (s.punish > 0) {
      s.punish--;
      s.mode = 'none';
      return false;
    }
    if (s.big) {
      s.mode = 'big';
      s.recover = c.BIG_RECOVER;
    } else if (s.recover > 0) {
      s.recover--;
      s.mode = 'recover';
    } else s.mode = s.small ? 'small' : 'none';
    const mult = c.FEVER[s.fever];
    if (s.mode === 'small') s.score += (c.SMALL_RATE / LOGIC_FPS) * mult;
    else if (s.mode === 'big') s.score += (c.BIG_RATE / LOGIC_FPS) * mult;
    if (s.mode === 'small' || s.mode === 'big') {
      s.danced = true;
      s.danceFrames++;
    }
    // 딱 걸림! (교수님이 보기 시작하고 유예가 지났는데도 춤추고 있으면)
    const tc = this.teacher;
    if (tc.watching && tc.watchT > c.GRACE && s.mode !== 'none') {
      s.strikes++;
      s.score = Math.max(0, s.score - c.CAUGHT_PENALTY);
      s.fever = 0;
      s.mode = 'none';
      s.recover = 0;
      s.caughtLook = true;
      s.punish = c.PUNISH_TIME;
      if (s.strikes >= c.MAX_STRIKES) {
        s.out = true;
        s.outFrames = 0;
      }
      return true;
    }
    return false;
  }

  _end() {
    if (this.phase !== 'play') return;
    this.phase = 'end';
    this.endFrame = this.simFrame;
    for (const s of this.students) s.big = s.small = false;
    this.results = this.buildResults();
    this._event({ type: 'end' });
  }

  onInput(playerId, data, now) {
    const s = this.byId.get(playerId);
    if (!data || typeof data !== 'object' || !s) return;
    if (typeof now === 'number') this._advance(now);
    if (data.k !== 'in' || (this.phase !== 'intro' && this.phase !== 'play')) return;
    s.big = data.big === true;
    s.small = data.small === true;
  }

  /** 공통 결과 형식. 순위: 점수 → 덜 걸린 순 → 최고 피버 */
  buildResults() {
    const F = this.cfg.FEVER;
    const rows = this.students.map((s, order) => ({
      playerId: s.id, name: this.names.get(s.id), score: Math.floor(s.score), rank: 0, isWinner: false,
      stats: { caught: s.strikes, out: s.out, maxFever: F[s.maxFever], danceSec: Math.round(s.danceFrames / 6) / 10 },
      order,
    }));
    const cmp = (a, b) => b.score - a.score || a.stats.caught - b.stats.caught || b.stats.maxFever - a.stats.maxFever;
    rows.sort((a, b) => cmp(a, b) || a.order - b.order);
    rows.forEach((row, i) => {
      row.rank = i > 0 && cmp(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
    });
    for (const row of rows) {
      row.isWinner = row.rank === 1;
      delete row.order;
    }
    return rows;
  }

  snapshot(now) {
    const tc = this.teacher;
    return {
      phase: this.phase,
      now,
      startAt: this.startAt,
      frame: this.simFrame,
      left: this.left,
      teacher: { state: tc.state, t: tc.t, dur: tc.dur, x: tc.x, sudden: tc.sudden, planned: false },
      students: this.students.map((s) => ({
        id: s.id, mode: s.mode, recover: s.recover, punish: s.punish, strikes: s.strikes, out: s.out,
        outFrames: s.outFrames, fever: s.fever, maxFever: s.maxFever, score: Math.round(s.score * 100) / 100,
      })),
      line: this.lineIdx,
      plan: 'none',
      results: this.phase === 'end' || this.phase === 'final' || this.phase === 'done' ? this.results : null,
      verdict: null,
    };
  }

  _emit(now, force = false) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'play' || this.phase === 'end';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇 (원본 js/bot.js 의 DanceBot 을 옮긴 것).
 *  - 교수님이 칠판에 쓰기 시작하면 잠깐 뒤 춤 시작(자신 있으면 쓰기 초반에 큰 춤)
 *  - 낌새(또는 갑작스런 돌아봄)가 보이면 반응 시간 뒤 멈춘다. 실력이 낮으면 늦게 멈춰서 걸린다.
 * @returns {(sim: Sim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const bots = new Map(botIds.map((id) => [id, {
    skill: 0.35 + rng() * 0.45, seen: null, startDelay: 0, big: false, react: 0, alertAt: 0, sent: '00',
  }]));
  return (sim) => {
    if (sim.phase !== 'play') return [];
    const out = [];
    const tc = sim.teacher;
    const f = sim.simFrame;
    for (const [id, b] of bots) {
      const s = sim.byId.get(id);
      if (!s) continue;
      const sk = b.skill;
      if (tc.state !== b.seen) {
        const prev = b.seen;
        b.seen = tc.state;
        if (tc.state === 'write') {
          b.startDelay = Math.round(8 + rng() * 30 + (1 - sk) * 20);
          b.big = rng() < 0.1 + sk * 0.45;
        }
        // 첫 낌새(또는 갑작스런 돌아봄)부터 반응 시간을 잰다
        if ((tc.state === 'tell' || tc.state === 'turn') && prev === 'write') {
          b.react = Math.round(4 + (1 - sk) * 14 + rng() * 8);
          b.alertAt = f;
        }
      }
      let big = false;
      let small = false;
      if (!s.out && s.punish === 0) {
        if (tc.state === 'write') {
          if (tc.t >= b.startDelay) {
            // 큰 춤은 쓰기 시작하고 한동안만 (오래 쓸수록 위험)
            if (b.big && tc.t < 60 + sk * 50) big = true;
            else small = true;
          }
        } else if ((tc.state === 'tell' || tc.state === 'turn') && f - b.alertAt < b.react && s.mode !== 'none') {
          // 반응 시간 동안은 계속 춤춘다 (못 알아챔)
          if (s.mode === 'big' || s.mode === 'recover') big = true;
          else small = true;
        }
      }
      const key = `${big ? 1 : 0}${small ? 1 : 0}`;
      if (key !== b.sent) {
        b.sent = key;
        out.push({ playerId: id, data: { k: 'in', big, small } });
      }
    }
    return out;
  };
}
