// =============================================================
// MugunghwaSim — 시험용(LocalSession 전용) 무궁화 진행기
//
// 실제 판정은 Python 서버(server/party/games/mugunghwa/game.py)가 한다.
// 이 파일은 서버 없이 화면을 확인할 때만 쓰며, 서버와 같은 형식의 메시지를 만든다.
// 규칙은 서버 코드를 그대로 옮긴 것이고, 같은 입력에 같은 결과가 나오는지
// server/tests/test_mugunghwa_parity.py 가 비교한다.
// 서버가 없으므로 음성 인식은 되지 않는다 → 술래는 키(길게 눌렀다 떼기)로 외친다.
// =============================================================

const LOGIC_FPS = 60;
const DT = 1 / LOGIC_FPS;

/** 서버 config.py 의 DEFAULT_CONFIG 와 같은 값 */
export const SIM_CONFIG = Object.freeze({
  MOVE: { MAX_SPEED: 1.1, ACCEL: 3.0, DECEL: 6.5, MOVING_THRESHOLD: 0.05 },
  RULES: { TIME_LIMIT: 45, METERS: 15, GRACE_TIME: 0.4, COUNTDOWN: 3.0 },
  FLOW: { INTRO_TIME: 5.0, END_HOLD: 3.0, FINAL_TIME: 8.0 },
  TAGGER: { TURN_TIME: 0.15, TURN_BACK_TIME: 0.24, MIN_LOOK: 1.0, MAX_LOOK: 4.0, MIN_KEY_CHANT: 1.5, PHRASE: '무궁화 꽃이 피었습니다' },
  SCORE: {
    TAGGER_WIN: 1000, RUNNER_LOSE_MAX: 500, RUNNER_FINISH: 1000, RUNNER_WIN_BASE: 600, RUNNER_WIN_PROGRESS: 300,
    TAGGER_LOSE_PER_CATCH: 100,
  },
});

function mergeConfig(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = { ...base[k], ...((over && over[k]) || {}) };
  return out;
}

export class MugunghwaSim {
  static id = 'mugunghwa';

  static tickHz = 30;

  constructor(players, options = {}, rng = Math.random) {
    this.cfg = mergeConfig(SIM_CONFIG, options && options.config);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    const n = this.ids.length;
    const forced = options && options.tagger;
    this.taggerId = this.ids.includes(forced) ? forced : this.ids[Math.min(n - 1, Math.floor(rng() * n))];
    this.runners = this.ids.filter((id) => id !== this.taggerId).map((id) => ({
      id, dist: 0, speed: 0, held: false, alive: true, finished: false, elimDist: 0,
    }));
    this.runnerById = new Map(this.runners.map((r) => [r.id, r]));
    this.phase = 'idle';
    this.countdownAt = 0;
    this.startAt = 0;
    this.phaseUntil = 0;
    this.simFrame = 0;
    this.endFrame = null;
    this.timeLeft = this.cfg.RULES.TIME_LIMIT;
    this.tPhase = 'back';
    this.tTime = 0;
    this.tClock = 0;
    this.micOn = false;
    this.keyOn = false;
    this.keyTime = 0;
    this.level = 0;
    this.looks = 0;
    this.caughtTotal = 0;
    this.caughtThisLook = 0;
    this.result = null;
    this.results = [];
    this.finished = false;
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  get chanting() {
    return this.micOn || this.keyOn;
  }

  get facing() {
    return this.tPhase === 'turning' || this.tPhase === 'watching';
  }

  clientOptions() {
    const c = this.cfg;
    return {
      config: { MOVE: c.MOVE, RULES: c.RULES, FLOW: c.FLOW, SCORE: c.SCORE },
      taggerId: this.taggerId,
      phrase: c.TAGGER.PHRASE,
      minKeyChant: c.TAGGER.MIN_KEY_CHANT,
      voice: false,
    };
  }

  start(now) {
    this.countdownAt = now + this.cfg.FLOW.INTRO_TIME;
    this.startAt = this.countdownAt + this.cfg.RULES.COUNTDOWN;
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

  _advance(now) {
    for (let i = 0; i < 6; i++) {
      if (this.phase === 'intro') {
        if (now < this.countdownAt) return;
        this.phase = 'countdown';
      } else if (this.phase === 'countdown') {
        if (now < this.startAt) return;
        this.phase = 'play';
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
        this.results = this.buildResults();
        this.phase = 'final';
        this.phaseUntil = this.startAt + this.simFrame / LOGIC_FPS + this.cfg.FLOW.FINAL_TIME;
        return;
      }
    }
  }

  _step() {
    const M = this.cfg.MOVE, R = this.cfg.RULES, T = this.cfg.TAGGER;
    this.timeLeft = Math.max(0, this.timeLeft - DT);

    this.tTime += DT;
    if (this.tPhase === 'back') {
      if (this.keyOn) this.keyTime += DT;
    } else if (this.tPhase === 'turning') {
      this.tClock += DT;
      if (this.tTime >= T.TURN_TIME) {
        this.tPhase = 'watching';
        this.tTime = 0;
      }
    } else if (this.tPhase === 'watching') {
      this.tClock += DT;
      if ((this.tTime >= T.MIN_LOOK && this.chanting) || this.tTime >= T.MAX_LOOK) {
        this.tPhase = 'turnBack';
        this.tTime = 0;
        this._event({ type: 'turnBack', caught: this.caughtThisLook });
      }
    } else if (this.tPhase === 'turnBack') {
      if (this.tTime >= T.TURN_BACK_TIME) {
        this.tPhase = 'back';
        this.tTime = 0;
        this.keyTime = 0;
      }
    }

    const finished = [];
    for (const r of this.runners) {
      if (!r.alive || r.finished) continue;
      if (r.held) r.speed = Math.min(M.MAX_SPEED, r.speed + M.ACCEL * DT);
      else r.speed = Math.max(0, r.speed - M.DECEL * DT);
      r.dist += r.speed * DT;
      if (r.dist >= R.METERS) {
        r.dist = R.METERS;
        r.speed = 0;
        r.finished = true;
        finished.push(r.id);
      }
    }

    if (this.facing && this.tClock >= R.GRACE_TIME) {
      const caught = this.runners.filter((r) => r.alive && !r.finished && r.speed > M.MOVING_THRESHOLD);
      if (caught.length) {
        for (const r of caught) {
          r.alive = false;
          r.elimDist = r.dist;
          r.speed = 0;
        }
        this.caughtThisLook += caught.length;
        this.caughtTotal += caught.length;
        this._event({ type: 'caught', ids: caught.map((r) => r.id) });
      }
    }

    if (finished.length) {
      for (const id of finished) this._event({ type: 'finish', id });
      this._end('runners', 'finish', finished);
    } else if (this.runners.every((r) => !r.alive)) this._end('tagger', 'allCaught');
    else if (this.timeLeft <= 0) this._end('tagger', 'timeUp');
  }

  _turn() {
    this.tPhase = 'turning';
    this.tTime = 0;
    this.tClock = 0;
    this.caughtThisLook = 0;
    this.looks++;
    this.keyTime = 0;
    this._event({ type: 'turn' });
  }

  _end(winner, reason, finishers = []) {
    if (this.phase !== 'play') return;
    this.phase = 'end';
    this.endFrame = this.simFrame;
    this.result = { winner, reason, finishers };
    for (const r of this.runners) {
      r.speed = 0;
      r.held = false;
    }
    this._event({ type: 'end', result: this.result });
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object' || !this.ids.includes(playerId)) return;
    this._advance(now);
    if (playerId !== this.taggerId) {
      const r = this.runnerById.get(playerId);
      if (data.k === 'move' && r) r.held = !!data.on && (this.phase === 'countdown' || this.phase === 'play');
      return;
    }
    if (this.phase !== 'play') return;
    if (data.k === 'mic') {
      const on = !!data.on;
      this.level = typeof data.lv === 'number' ? Math.min(1, Math.max(0, data.lv)) : 0;
      if (on !== this.micOn) {
        this.micOn = on;
        this._event({ type: 'chant', on: this.chanting });
      }
    } else if (data.k === 'chant') {
      const on = !!data.on;
      if (on === this.keyOn) return;
      this.keyOn = on;
      if (on) this.keyTime = 0;
      else if (this.tPhase === 'back' && this.keyTime >= this.cfg.TAGGER.MIN_KEY_CHANT) this._turn();
      this._event({ type: 'chant', on: this.chanting });
    } else if (data.k === 'voice') {
      this._event({ type: 'voiceOff' }, this.taggerId);
    }
  }

  buildResults() {
    const S = this.cfg.SCORE;
    const meters = this.cfg.RULES.METERS;
    const runnersWin = !!this.result && this.result.winner === 'runners';
    const rows = this.players.map((p, order) => {
      let score, stats;
      if (p.id === this.taggerId) {
        score = runnersWin ? Math.min(S.RUNNER_WIN_BASE - 1, this.caughtTotal * S.TAGGER_LOSE_PER_CATCH) : S.TAGGER_WIN;
        stats = { role: 'tagger', caught: this.caughtTotal, looks: this.looks };
      } else {
        const r = this.runnerById.get(p.id);
        const reached = r.alive ? r.dist : r.elimDist;
        const ratio = Math.min(1, reached / meters);
        if (runnersWin) score = r.finished ? S.RUNNER_FINISH : S.RUNNER_WIN_BASE + Math.floor(ratio * S.RUNNER_WIN_PROGRESS);
        else score = Math.min(S.RUNNER_LOSE_MAX, Math.floor(ratio * S.RUNNER_LOSE_MAX));
        stats = { role: 'runner', meters: Math.floor(reached * 10) / 10, finished: r.finished, eliminated: !r.alive };
      }
      return { playerId: p.id, name: p.name, score, rank: 0, isWinner: false, stats, order };
    });
    rows.sort((x, y) => y.score - x.score || x.order - y.order);
    rows.forEach((row, i) => {
      row.rank = i > 0 && rows[i - 1].score === row.score ? rows[i - 1].rank : i + 1;
    });
    for (const row of rows) {
      row.isWinner = row.rank === 1;
      delete row.order;
    }
    return rows;
  }

  snapshot(now) {
    return {
      phase: this.phase,
      now,
      countdownAt: this.countdownAt,
      startAt: this.startAt,
      timeLeft: this.timeLeft,
      meters: this.cfg.RULES.METERS,
      taggerId: this.taggerId,
      tagger: {
        phase: this.tPhase, t: this.tTime, clock: this.tClock, chanting: this.chanting, level: this.level,
        keyTime: this.keyOn ? this.keyTime : 0, looks: this.looks, caught: this.caughtTotal,
      },
      runners: this.runners.map((r) => ({ id: r.id, dist: r.dist, speed: r.speed, alive: r.alive, finished: r.finished, elimDist: r.elimDist })),
      result: this.result,
      results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
      voice: false,
    };
  }

  _emit(now, force = false) {
    const changed = this.phase !== this._lastPhase;
    const live = this.phase === 'countdown' || this.phase === 'play' || this.phase === 'end';
    if (force || changed || live || now - this._lastStateAt >= 1.0) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }
}

/**
 * 시험용 봇.
 *  - 술래 봇: 키로 외친다(1.6~3.2초 누르고 있다 뗀다). 돌아본 뒤에는 잠깐 지켜보다 다시 외친다.
 *  - 도망자 봇: 술래가 외치기 시작하고 얼마 동안만 달리다 멈춘다. 가끔 욕심을 부리다 걸린다.
 * @returns {(sim: MugunghwaSim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const state = new Map();
  let chantStart = null; // 술래가 외치기 시작한 프레임
  return (sim) => {
    if (sim.phase !== 'play') return [];
    const out = [];
    const f = sim.simFrame;
    if (sim.chanting && sim.tPhase === 'back') {
      if (chantStart === null) chantStart = f;
    } else chantStart = null;
    for (const id of botIds) {
      let st = state.get(id);
      if (!st) {
        st = { held: false, until: 0, wait: 30 + Math.floor(rng() * 30), greedy: 60 + Math.floor(rng() * 70) };
        state.set(id, st);
      }
      if (id === sim.taggerId) {
        if (!sim.keyOn) {
          if (sim.tPhase === 'back' ? f >= st.until : sim.tPhase === 'watching' && sim.tTime >= 1.0 + st.wait / 60) {
            st.until = f + 96 + Math.floor(rng() * 96);
            out.push({ playerId: id, data: { k: 'chant', on: true } });
          }
        } else if (sim.tPhase === 'back' && f >= st.until && sim.keyTime >= sim.cfg.TAGGER.MIN_KEY_CHANT) {
          st.until = f + 12 + Math.floor(rng() * 30);
          st.wait = Math.floor(rng() * 60);
          out.push({ playerId: id, data: { k: 'chant', on: false } });
        }
        continue;
      }
      const r = sim.runnerById.get(id);
      if (!r || !r.alive || r.finished) continue;
      // 술래가 뒤돌아 있고, 외치기 시작한 지 얼마 안 됐을 때만 달린다
      const safe = sim.tPhase === 'back' && (chantStart === null || f - chantStart < st.greedy);
      if (safe !== st.held) {
        st.held = safe;
        if (!safe) st.greedy = 55 + Math.floor(rng() * 80);
        out.push({ playerId: id, data: { k: 'move', on: safe } });
      }
    }
    return out;
  };
}
