// =============================================================
// DuelCore — 검도 한 경기(두 사람)의 진행. 화면·소리 없이 판정만 한다.
//
// 서버(server/party/games/kendo/duel.py)와 같은 내용이다. 선수·판정·규칙은 원본(pk/)을 그대로 쓰고,
// 시합 흐름만 원본 match_scene.js 에서 옮겼다. 시험용 진행기(KendoSim)가 쓰며 테스트가 서버와 결과를 비교한다.
// =============================================================
import { PK } from '../pk/core.js';

const ATTACKS = ['men', 'kote', 'do'];
const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;
const NO_INPUT = { left: false, right: false, kiai: false, block: false, pressed: new Set() };

class Controller {
  constructor() {
    this.buf = null;
    this.bufT = 0;
  }

  clear() {
    this.buf = null;
    this.bufT = 0;
  }

  intent(f, inp) {
    const pressed = inp.pressed;
    const move = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const hit = ATTACKS.find((a) => pressed.has(a)) || null;
    if (hit) {
      this.buf = hit;
      this.bufT = PK.CONFIG.INPUT_BUFFER;
    }
    let attack = null;
    if (this.buf && (f.canAct || f.state === 'block')) {
      attack = this.buf;
      this.clear();
    } else if (this.bufT > 0) {
      this.bufT--;
      if (this.bufT === 0) this.buf = null;
    }
    return {
      move, attack, attackPressed: !!hit,
      block: inp.block || pressed.has('block'), blockPressed: pressed.has('block'),
      kiai: inp.kiai || pressed.has('kiai'), kiaiPressed: pressed.has('kiai'),
    };
  }
}

export function fighterView(f) {
  const s = f.strike;
  return {
    x: r2(f.x), state: f.state, stateT: f.stateT, momentum: r2(f.momentum), kiai: r2(f.kiai), kiaiHolding: f.kiaiHolding,
    strike: s ? [s.type, s.t, s.startup, s.recover, s.extra, s.bad, s.result] : null,
    blockT: f.blockT, counterT: f.counterT, flinchT: f.flinchT, squashT: f.squashT, stepFrame: f.stepFrame,
  };
}

export class DuelCore {
  constructor(cfg, red, white, rng) {
    this.cfg = cfg;      // 파티용 MATCH · FLOW
    this.rng = rng;
    this.red = new PK.Fighter({ name: red.name, side: 'red', facing: 1, x: 0 });
    this.white = new PK.Fighter({ name: white.name, side: 'white', facing: -1, x: 0 });
    this.red.playerId = red.id;
    this.white.playerId = white.id;
    this.fighters = [this.red, this.white];
    this.ctrl = { red: new Controller(), white: new Controller() };
    this.rules = new PK.MatchRules({ timeSec: cfg.MATCH.TIME_SEC, toWin: cfg.MATCH.POINTS_TO_WIN });
    this.pending = [];
    this.outPending = null;
    this.frame = 0;
    this.hitstop = 0;
    this.clinchT = 0;
    this.hanteiScore = { red: 0, white: 0 };
    this.stats = { red: { ippons: 0, strikes: 0, parries: 0 }, white: { ippons: 0, strikes: 0, parries: 0 } };
    this.over = false;
    this.started = false;
    this.events = [];
    this.flow = { name: 'wait', t: 0, dur: 0, onEnd: null };
    // 선수가 알리는 사건 (원본 Fighter 는 world.events 를 부른다)
    this.fighterEvents = {
      onKiai: (f) => this.events.push({ type: 'kiai', side: f.side }),
      onStep: (f) => this.events.push({ type: 'step', side: f.side }),
      onStrikeStart: () => {},
      onStrikeActive: (f) => this.onStrikeActive(f),
    };
    this.world = { frame: 0, events: this.fighterEvents };
    this.resetPositions();
    for (const f of this.fighters) f.freeze('sonkyo');
  }

  setFlow(name, dur = 0, onEnd = null) {
    this.flow = { name, t: 0, dur, onEnd };
  }

  start() {
    this.started = true;
    this.setFlow('intro', 80, () => this.beginPoint(true));
  }

  resetPositions() {
    const C = PK.CONFIG;
    this.red.reset(C.COURT_CENTER - C.START_GAP);
    this.white.reset(C.COURT_CENTER + C.START_GAP);
    this.ctrl.red.clear();
    this.ctrl.white.clear();
    this.pending = [];
    this.outPending = null;
    this.clinchT = 0;
  }

  beginPoint(first) {
    this.resetPositions();
    for (const f of this.fighters) f.freeze(first ? 'sonkyo' : 'frozen');
    this.setFlow('ready', first ? 50 : 30, () => this.callHajime());
  }

  callHajime() {
    const label = this.rules.isShobu ? '승부!' : this.rules.totalPoints > 0 ? '두 번째 판!' : '시작!';
    const K = PK.CONFIG.KIAI;
    for (const f of this.fighters) {
      f.setState('idle');
      f.kiai = Math.max(f.kiai, K.REQUIRED + 15);
    }
    this.events.push({ type: 'hajime', label, shobu: this.rules.isShobu });
    this.setFlow('play');
  }

  stopPlay(dur, then) {
    this.pending = [];
    this.outPending = null;
    this.setFlow('stop', dur, then);
  }

  opponent(f) {
    return f === this.red ? this.white : this.red;
  }

  onStrikeActive(att) {
    if (this.flow.name !== 'play' || this.rules.timeLeft === 0) return { kind: 'whiff' };
    const C = PK.CONFIG;
    const M = C.MOMENTUM;
    const def = this.opponent(att);
    const s = att.strike;
    const res = PK.Judge.resolveStrike(att, def);
    const kind = res.kind;
    this.stats[att.side].strikes++;
    if (kind === 'whiff') {
      att.addMomentum(-M.WHIFF);
    } else if (kind === 'parried') {
      att.stagger(C.PARRY.STAGGER);
      att.addMomentum(-M.PARRIED);
      def.blockHit = true;
      def.onParry();
      this.stats[def.side].parries++;
      this.hitstop = C.FX.HITSTOP_CLASH;
    } else if (kind === 'blocked') {
      att.addMomentum(-M.BLOCKED);
      def.addMomentum(M.BLOCK_GAIN);
      def.blockHit = true;
      this.hitstop = 2;
    } else if (kind === 'deflected') {
      att.addMomentum(-M.DEFLECTED);
      this.hitstop = 2;
    } else {
      this.hitstop = C.FX.HITSTOP_CONTACT;
      def.flinch();
      def.addMomentum(-M.GOT_HIT);
      const rec = {
        att, side: att.side, type: s.type, contactFrame: this.frame, dist: res.dist,
        band: PK.Judge.band(s.type, att.reach), tooClose: res.tooClose, opening: res.opening, openReason: res.reason,
        kiaiOk: s.kiaiOk, kiaiGauge: s.kiaiGauge,
        kiaiTimed: (this.frame - att.lastKiaiPress) <= C.KIAI.TIMING_WINDOW,
        counter: s.counter, debana: res.defPhase === 'windup',
        momentum: s.momentumAtStart, backward: s.moveRelAtStart < 0,
        zanshinT: 0, retreatT: 0, zanshinBroken: null, aiuchi: false,
      };
      if (rec.kiaiOk && !rec.tooClose) {
        for (const p of this.pending) {
          if (p.att !== att && p.kiaiOk && !p.tooClose && this.frame - p.contactFrame <= C.AIUCHI_TICKS) {
            p.aiuchi = true;
            rec.aiuchi = true;
          }
        }
      }
      this.pending.push(rec);
    }
    this.events.push({ type: 'strike', side: att.side, kind, strike: s.type, kiaiOk: s.kiaiOk });
    return res;
  }

  updatePending(intents) {
    const Z = PK.CONFIG.ZANSHIN;
    for (const rec of this.pending.slice()) {
      rec.zanshinT++;
      const intent = intents[rec.side];
      const att = rec.att;
      if (!rec.zanshinBroken) {
        if (intent.attackPressed || intent.blockPressed) rec.zanshinBroken = '잔심 중 다시 공격/막기 입력';
        else if (att.moveRel < 0) {
          rec.retreatT++;
          if (rec.retreatT > Z.RETREAT_MAX) rec.zanshinBroken = '잔심 중 물러남';
        }
        if (att.state === 'stagger' || att.state === 'stun') rec.zanshinBroken = '자세가 무너짐';
      }
      if (rec.zanshinT >= Z.TICKS) {
        this.pending.splice(this.pending.indexOf(rec), 1);
        this.judgeRecord(rec);
        if (this.flow.name !== 'play') return;
      }
    }
  }

  vote(ev, side) {
    const C = PK.CONFIG;
    return C.REFEREES.map((ref) => {
      const th = ref.threshold + (this.rng() * 2 - 1) * C.REF_NOISE;
      if (ev.valid && ev.quality >= th) return side;
      if (!ev.valid || ev.quality >= C.JUDGE.WAVE_MIN) return 'wave';
      return 'none';
    });
  }

  judgeRecord(rec) {
    const ev = PK.Judge.evaluateStrike(rec);
    const votes = this.vote(ev, rec.side);
    const n = votes.filter((v) => v === rec.side).length;
    const ippon = ev.valid && n >= 2;
    this.hanteiScore[rec.side] += ev.quality * (ev.valid ? 1 : 0.4);
    let reason = null;
    if (!ippon) reason = ev.mainReason || (n === 1 ? '깃발 1개 — 한판 부족' : '판정 점수 부족 (빈틈이 작다)');
    this.events.push({ type: 'judge', side: rec.side, strike: rec.type, ippon, votes, quality: ev.quality, tags: ev.tags, reason });
    if (ippon) this.awardIppon(rec);
  }

  awardIppon(rec) {
    this.hitstop = PK.CONFIG.FX.HITSTOP_IPPON;
    this.stats[rec.side].ippons++;
    for (const f of this.fighters) if (f.state !== 'strike') f.freeze('frozen');
    const winner = this.rules.award(rec.side, rec.type).winner;
    this.stopPlay(130, winner ? () => this.endMatch(winner) : () => this.beginPoint(false));
  }

  doHansoku(f) {
    const r = this.rules.addHansoku(f.side);
    for (const x of this.fighters) x.freeze('frozen');
    this.events.push({ type: 'hansoku', side: f.side, converted: r.converted, count: r.converted ? 0 : r.count });
    const winner = r.converted ? r.winner : null;
    this.stopPlay(110, winner ? () => this.endMatch(winner) : () => this.beginPoint(false));
  }

  wakare() {
    const C = PK.CONFIG;
    for (const x of this.fighters) {
      if (x.state === 'stun') x.momentum = Math.max(x.momentum, C.MOMENTUM.STUN_RECOVER);
      x.freeze('frozen');
    }
    const mid = Math.max(C.COURT_LEFT + 40, Math.min(C.COURT_RIGHT - 40, (this.red.x + this.white.x) / 2));
    this.events.push({ type: 'wakare' });
    this.stopPlay(50, () => {
      this.red.x = mid - 28;
      this.white.x = mid + 28;
      this.clinchT = 0;
      this.ctrl.red.clear();
      this.ctrl.white.clear();
      this.callHajime();
    });
  }

  timeUp() {
    for (const x of this.fighters) x.freeze('frozen');
    this.events.push({ type: 'timeup' });
    this.stopPlay(90, () => {
      const w = this.rules.decideOnTime();
      if (w) this.endMatch(w);
      else this.hantei();
    });
  }

  /** 동점으로 시간 종료 → 심판 판정 (원본의 연장전은 하지 않는다) */
  hantei() {
    const C = PK.CONFIG;
    const scRed = this.hanteiScore.red + (this.red.momentum / C.MOMENTUM.MAX) * 0.5;
    const scWhite = this.hanteiScore.white + (this.white.momentum / C.MOMENTUM.MAX) * 0.5;
    const votes = C.REFEREES.map(() => {
      const d = scRed - scWhite + (this.rng() * 2 - 1) * this.cfg.MATCH.HANTEI_NOISE;
      return d >= 0 ? 'red' : 'white';
    });
    const winner = votes.filter((v) => v === 'red').length >= 2 ? 'red' : 'white';
    this.rules.winner = winner;
    this.rules.decidedBy = 'hantei';
    this.events.push({ type: 'hantei', votes, winner });
    this.stopPlay(100, () => this.endMatch(winner));
  }

  endMatch(winner) {
    this.rules.winner = winner;
    this.pending = [];
    this.events.push({ type: 'end', winner, decidedBy: this.rules.decidedBy });
    this.setFlow('end', 150, () => { this.over = true; });
  }

  resolveBodies() {
    const C = PK.CONFIG;
    const a = this.red;
    const b = this.white;
    const d = b.x - a.x;
    if (d < C.BODY_MIN_DIST) {
      const over = C.BODY_MIN_DIST - d;
      const pa = Math.max(0, a.vx) + (a.state === 'strike' ? 0.6 : 0) + 0.5;
      const pb = Math.max(0, -b.vx) + (b.state === 'strike' ? 0.6 : 0) + 0.5;
      const ra = pb / (pa + pb);
      a.x -= over * ra;
      b.x += over * (1 - ra);
      if (a.vx > 0) a.vx *= 0.3;
      if (b.vx < 0) b.vx *= 0.3;
    }
    for (const f of this.fighters) f.x = Math.max(10, Math.min(C.WORLD_W - 10, f.x));
  }

  checkOut() {
    const C = PK.CONFIG;
    for (const f of this.fighters) {
      if (f.x < C.COURT_LEFT - C.OUT_MARGIN || f.x > C.COURT_RIGHT + C.OUT_MARGIN) {
        if (this.pending.length) {
          if (!this.outPending) this.outPending = f;
          continue;
        }
        this.doHansoku(f);
        return;
      }
    }
    if (!this.pending.length && this.outPending) {
      const f = this.outPending;
      this.outPending = null;
      this.doHansoku(f);
    }
  }

  checkClinch() {
    const C = PK.CONFIG;
    const d = Math.abs(this.red.x - this.white.x);
    if (d < C.CLINCH_DIST && this.red.state !== 'strike' && this.white.state !== 'strike') {
      this.clinchT++;
      if (this.clinchT > C.CLINCH_WAKARE_TICKS && !this.pending.length) this.wakare();
    } else if (d > C.CLINCH_DIST + 6) this.clinchT = 0;
  }

  checkStun() {
    for (const f of this.fighters) {
      if (f.momentum <= 0 && f.state !== 'stun' && f.state !== 'frozen' && f.state !== 'sonkyo') {
        f.stun();
        this.events.push({ type: 'stun', side: f.side });
      }
    }
  }

  step(redIn, whiteIn) {
    if (this.over || !this.started) return;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    const f = this.flow;
    f.t++;
    if (f.name === 'play') this.stepPlay(redIn || NO_INPUT, whiteIn || NO_INPUT);
    else this.stepIdle();
    if (this.flow === f && f.dur && f.t >= f.dur && f.onEnd) {
      const cb = f.onEnd;
      f.onEnd = null;
      cb();
    }
  }

  stepIdle() {
    const none = { move: 0 };
    this.frame++;
    this.world.frame = this.frame;
    this.red.update(none, this.world);
    this.white.update(none, this.world);
    this.resolveBodies();
  }

  stepPlay(redIn, whiteIn) {
    this.frame++;
    this.world.frame = this.frame;
    const intents = { red: this.ctrl.red.intent(this.red, redIn), white: this.ctrl.white.intent(this.white, whiteIn) };
    this.red.update(intents.red, this.world);
    if (this.flow.name !== 'play') return;
    this.white.update(intents.white, this.world);
    if (this.flow.name !== 'play') return;
    this.resolveBodies();
    this.updatePending(intents);
    if (this.flow.name !== 'play') return;
    this.checkStun();
    this.checkOut();
    if (this.flow.name !== 'play') return;
    this.checkClinch();
    if (this.flow.name !== 'play') return;
    this.rules.tick();
    if (this.rules.timeLeft === 0 && !this.pending.length) this.timeUp();
  }

  popEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  snapshot() {
    const r = this.rules;
    return {
      frame: this.frame, flow: [this.flow.name, this.flow.t, this.flow.dur], hitstop: this.hitstop,
      timeLeft: r.timeLeft, points: { red: [...r.points.red], white: [...r.points.white] },
      hansoku: { ...r.hansoku }, winner: r.winner, decidedBy: r.decidedBy, over: this.over,
      red: fighterView(this.red), white: fighterView(this.white),
      pending: this.pending.map((p) => [p.side, p.zanshinT, !!p.zanshinBroken]),
    };
  }
}
