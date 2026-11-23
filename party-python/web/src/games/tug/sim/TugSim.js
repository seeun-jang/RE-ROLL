// =============================================================
// TugSim — 시험용(LocalSession 전용) 줄다리기 진행기
//
// 실제 판정은 Python 서버(server/party/games/tug/match.py)가 한다.
// 이 파일은 서버 없이 화면과 입력을 확인할 때만 쓰며, 서버와 같은 형식의 메시지를 만든다.
// 새 계산을 만들지 않고 원본 게임의 로직(systems/*.js)을 그대로 조립했다.
// 서버와 결과가 같은지는 tests/tug-parity.test.mjs 가 같은 입력으로 비교한다.
// =============================================================
import { DEFAULT_CONFIG } from '../config.js';
import { Rope } from '../systems/Rope.js';
import { TeamAssigner } from '../systems/Team.js';
import { ScoreBoard } from '../systems/ScoreBoard.js';
import { computePower } from '../systems/PowerCalculator.js';
import { FeverSchedule, BeatTimeline, TimelineJudge } from '../net/timeline.js';

/** 시뮬레이션 고정 스텝(초) */
export const STEP = 1 / 60;

/** 서버 config.py 에만 있는 값(장면 시간, 입력 시각 검증)의 시험용 기본값 */
const SIM_ONLY_DEFAULTS = Object.freeze({
  ASSIGN_TIME: 4.2,
  END_HOLD: 1.0,
  ROUND_RESULT_TIME: 4.0,
  SUMMARY_TIME: 15.0,
  FINAL_TIME: 8.0,
  SMALL_TEAM_MULT: 'ratio',
  INPUT_MAX_LAG: 0.35,
  INPUT_MAX_LEAD: 0.05,
});

/** 판정·진행에 쓰는 설정 키 (화면 배치 등은 보내지 않는다) */
const LOGIC_KEYS = [
  'ROUNDS', 'ROUND_TIME', 'COUNTDOWN', 'WIN_DISTANCE', 'ROPE_SPEED', 'ROPE_MAX_SPEED', 'FORCE_DECAY',
  'DRAW_EPSILON', 'BPM', 'FEVER_BPM', 'PERFECT_WINDOW', 'GOOD_WINDOW', 'SPAM_MAX_PRESSES_PER_BEAT', 'POWER',
  'FEVER_FIRST', 'FEVER_INTERVAL', 'FEVER_DURATION', 'FEVER_WARNING', 'FEVER_POWER_MULT', 'FEVER_SCORE_MULT', 'SCORE',
];

function buildConfig(over) {
  const cfg = {};
  for (const k of LOGIC_KEYS) {
    const v = DEFAULT_CONFIG[k];
    cfg[k] = v && typeof v === 'object' ? { ...v } : v;
  }
  Object.assign(cfg, SIM_ONLY_DEFAULTS);
  for (const [k, v] of Object.entries(over || {})) {
    cfg[k] = v && typeof v === 'object' && cfg[k] && typeof cfg[k] === 'object' ? { ...cfg[k], ...v } : v;
  }
  return cfg;
}

function teamMultipliers(nLeft, nRight, config) {
  const setting = config.SMALL_TEAM_MULT ?? 'ratio';
  const mult = (small, big) => {
    if (small <= 0 || small >= big) return 1;
    return setting === 'ratio' ? big / small : Number(setting);
  };
  return { left: mult(nLeft, nRight), right: mult(nRight, nLeft) };
}

export class TugSim {
  static id = 'tug';

  static tickHz = 30;

  /**
   * @param {{id:string,name:string,index:number}[]} players
   * @param {{config?:object}} options
   * @param {() => number} rng
   */
  constructor(players, options = {}, rng = Math.random) {
    this.config = buildConfig(options && options.config);
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.ids = this.players.map((p) => p.id);
    this.rng = rng;

    this.fever = new FeverSchedule(this.config);
    this.rope = new Rope(this.config);
    this.score = new ScoreBoard(this.ids, this.config);
    this.assigner = new TeamAssigner(this.ids, rng);
    this.timeline = new BeatTimeline(this.config, this.fever);
    this.judge = new TimelineJudge(this.config, this.timeline);

    this.phase = 'idle';
    this.round = 0;
    this.teams = { left: [], right: [], mult: { left: 1, right: 1 } };
    this.sideOf = new Map();
    this.countdownAt = 0;
    this.startAt = 0;
    this.endedAt = 0;
    this.phaseUntil = 0;
    this.simT = 0;
    this.winnerSide = null;
    this.roundResult = null;
    this.results = [];
    this.finished = false;
    this._events = [];
    this._outbox = [];
    this._lastPhase = null;
    this._lastStateAt = -1;
  }

  // ----- 공통 규격 (서버 MiniGame 과 같은 모양) -----
  clientOptions() {
    return { config: this.config };
  }

  start(now) {
    this._beginRound(1, now);
    this._emit(now, true);
  }

  tick(now) {
    this.advance(now);
    this._emit(now);
  }

  onInput(playerId, data, now) {
    if (!data || typeof data !== 'object') return;
    this.advance(now);
    this.input(playerId, data, now);
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

  _emit(now, force = false) {
    for (const ev of this.popEvents()) this._outbox.push([null, 'event', ev]);
    const changed = this.phase !== this._lastPhase;
    const due = this.phase === 'play' || now - this._lastStateAt >= 1.0;
    if (force || changed || due) {
      if (!force && !changed && now === this._lastStateAt) return;
      this._lastPhase = this.phase;
      this._lastStateAt = now;
      this._outbox.push([null, 'state', this.snapshot(now)]);
    }
  }

  // ----- 진행 -----
  get countdownLength() {
    const base = this.timeline.base;
    const beats = Math.max(1, Math.floor((Math.max(1, this.config.COUNTDOWN | 0) * 1.0) / base + 0.5));
    return beats * base;
  }

  _beginRound(round, now) {
    this.round = round;
    const split = this.assigner.next();
    const mult = teamMultipliers(split.left.length, split.right.length, this.config);
    this.teams = { left: split.left, right: split.right, mult };
    this.sideOf = new Map();
    for (const id of split.left) this.sideOf.set(id, 'left');
    for (const id of split.right) this.sideOf.set(id, 'right');

    this.rope.reset();
    this.score.startRound(round);
    this.timeline = new BeatTimeline(this.config, this.fever);
    this.judge = new TimelineJudge(this.config, this.timeline);

    this.countdownAt = now + this.config.ASSIGN_TIME;
    this.startAt = this.countdownAt + this.countdownLength;
    this.simT = 0;
    this.winnerSide = null;
    this.roundResult = null;
    this.phase = 'assign';
  }

  advance(now) {
    for (let i = 0; i < 8; i++) {
      if (this.phase === 'assign') {
        if (now < this.countdownAt) return;
        this.phase = 'countdown';
      } else if (this.phase === 'countdown') {
        if (now < this.startAt) return;
        this.phase = 'play';
      } else if (this.phase === 'play') {
        this._simulate(now);
        if (this.phase === 'play') return;
      } else if (this.phase === 'ended') {
        if (now < this.phaseUntil) return;
        if (this.round < this.config.ROUNDS) {
          this._beginRound(this.round + 1, this.phaseUntil);
        } else {
          this.phase = 'summary';
          this.phaseUntil += this.config.SUMMARY_TIME;
        }
      } else if (this.phase === 'summary') {
        if (now < this.phaseUntil) return;
        this._enterFinal(this.phaseUntil);
      } else if (this.phase === 'final') {
        if (now < this.phaseUntil) return;
        this.phase = 'done';
        this.finished = true;
      } else {
        return;
      }
    }
  }

  _simulate(now) {
    const target = now - this.startAt;
    const roundTime = Number(this.config.ROUND_TIME);
    while (this.simT + STEP <= target + 1e-9) {
      this.rope.update(STEP);
      this.simT += STEP;
      const winner = this.rope.winner();
      if (winner) {
        this._endRound(winner);
        return;
      }
      if (this.simT >= roundTime - 1e-9) {
        this._endRound(this.rope.leader());
        return;
      }
    }
  }

  _endRound(winnerSide) {
    this.winnerSide = winnerSide || null;
    this.endedAt = this.startAt + this.simT;
    const asTeam = (ids) => ({ members: ids.map((id) => ({ id })) });
    const res = this.score.endRound(this.round, this.winnerSide, {
      left: asTeam(this.teams.left), right: asTeam(this.teams.right),
    });
    this.roundResult = {
      round: this.round,
      winnerSide: res.winnerSide,
      left: [...this.teams.left],
      right: [...this.teams.right],
      roundScores: res.roundScores,
      bonus: res.bonus,
      isLastRound: this.round >= this.config.ROUNDS,
    };
    this.phase = 'ended';
    this.phaseUntil = this.endedAt + this.config.END_HOLD + this.config.ROUND_RESULT_TIME;
  }

  _enterFinal(at) {
    this.results = this.score.results(this.players);
    this.phase = 'final';
    this.phaseUntil = at + this.config.FINAL_TIME;
  }

  input(playerId, data, now) {
    const kind = data.k;
    if (!this.sideOf.has(playerId) && kind !== 'confirm') return;
    if (kind === 'pull') this._pull(playerId, data, now);
    else if (kind === 'confirm' && this.phase === 'summary') this._enterFinal(now);
  }

  _pull(playerId, data, now) {
    const cfg = this.config;
    if (this.phase !== 'countdown' && this.phase !== 'play') return;
    const serverT = now - this.startAt;
    let t = data.t;
    if (typeof t !== 'number' || !Number.isFinite(t)
      || !(serverT - cfg.INPUT_MAX_LAG <= t && t <= serverT + cfg.INPUT_MAX_LEAD)) {
      t = serverT;
    }
    if (t < -cfg.GOOD_WINDOW) return;
    if (this.phase === 'play' && t > cfg.ROUND_TIME) return;

    const verdict = this.judge.judge(playerId, t);
    const grade = verdict.grade;
    const side = this.sideOf.get(playerId);
    const fever = this.fever.activeAt(Math.max(0, t));
    const power = computePower({ grade, config: cfg, teamMultiplier: this.teams.mult[side], fever });
    this.rope.addForce(side, power);
    const scored = this.score.record(playerId, grade, { fever });
    this.score.addPower(playerId, power);
    this._events.push({
      type: 'judge', playerId, grade, t,
      offset: verdict.offset, beatIndex: verdict.beatIndex,
      points: scored.points, combo: scored.combo, power,
    });
  }

  popEvents() {
    const out = this._events;
    this._events = [];
    return out;
  }

  snapshot(now) {
    const scores = {};
    for (const id of this.ids) scores[id] = this.score.get(id);
    const ended = this.phase === 'ended';
    return {
      phase: this.phase,
      round: this.round,
      rounds: this.config.ROUNDS,
      now,
      teams: { left: [...this.teams.left], right: [...this.teams.right], mult: { ...this.teams.mult } },
      countdownAt: this.countdownAt,
      startAt: this.startAt,
      endedAt: ended ? this.endedAt : null,
      simT: this.simT,
      rope: { pos: this.rope.pos, vel: this.rope.vel, lf: this.rope.leftForce, rf: this.rope.rightForce },
      winnerSide: ended ? this.winnerSide : null,
      result: ended ? this.roundResult : null,
      scores,
      results: this.phase === 'final' || this.phase === 'done' ? this.results : null,
    };
  }
}

/**
 * 시험용 봇: 박마다 약간의 오차로 누른다. LocalSession 이 시험용 참가자 대신 입력을 넣을 때 쓴다.
 * @returns {(sim: TugSim, now: number) => {playerId:string, data:object}[]}
 */
export function createBots(botIds, rng = Math.random) {
  const next = new Map(); // botId → 다음에 누를 박 번호
  let round = 0;
  return (sim, now) => {
    if (sim.round !== round) {
      round = sim.round;
      for (const id of botIds) next.set(id, 0);
    }
    if (sim.phase !== 'play') return [];
    const t = now - sim.startAt;
    const out = [];
    for (const id of botIds) {
      const k = next.get(id) ?? 0;
      const beatT = sim.timeline.timeOf(k);
      if (t < beatT - 0.02) continue;
      next.set(id, k + 1);
      if (rng() < 0.15) continue;              // 가끔 놓친다
      const jitter = (rng() * 2 - 1) * 0.1;    // ±0.1초 오차
      out.push({ playerId: id, data: { k: 'pull', t: Math.max(t - 0.3, Math.min(t, beatT + jitter)) } });
    }
    return out;
  };
}
