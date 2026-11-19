// =============================================================
// 사격장 규칙 (JS) — 서버 server/party/games/livefire/range.py 와 같은 내용.
// 원본 js/range.js(makeSchedule · gradeOf · targetRect)와 js/scenes/play.js(updateTargets · updateLane · fire)를 옮긴 것.
//
// 실제 판정은 Python 서버가 한다. 이 파일은
//   - LocalSession 용 시험용 진행기(Sim.js)와
//   - 화면이 "내 조준점"을 서버 답을 기다리지 않고 먼저 그릴 때(aimStep · swayOf)
// 에만 쓴다.
// =============================================================
import { DOWN, LEFT, RIGHT, UP } from './config.js';

const roundHalfUp = (x) => Math.floor(x + 0.5);

/** 표적 순서: [{dist, x, time}]. 첫 표적은 연습 삼아 100m */
export function makeSchedule(rng, cfg) {
  const dists = [];
  for (const d of Object.keys(cfg.COUNTS).map(Number).sort((a, b) => a - b)) {
    for (let i = 0; i < cfg.COUNTS[d]; i++) dists.push(d);
  }
  for (let i = dists.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dists[i], dists[j]] = [dists[j], dists[i]];
  }
  const first = dists.indexOf(100);
  if (first >= 0) [dists[0], dists[first]] = [dists[first], dists[0]];
  const total = cfg.TARGETS;
  return dists.slice(0, total).map((dist, k) => {
    const D = cfg.DISTANCES[dist];
    return {
      dist,
      x: D.slots[Math.floor(rng() * D.slots.length) % D.slots.length],
      time: roundHalfUp(D.time * (k >= total / 2 ? cfg.LATE_TIME_MUL : 1)),
    };
  });
}

/** 명중 수 → 등급 { min, name, color } */
export function gradeOf(hits, cfg) {
  return cfg.GRADES.find((g) => hits >= g.min) || cfg.GRADES[cfg.GRADES.length - 1];
}

/** 표적 사각형 (사로 칸 좌표, 가운데가 x=0). rise: 0~1 올라온 정도 */
export function targetRect(tg, rise, cfg) {
  const D = cfg.DISTANCES[tg.dist];
  const h = Math.max(1, roundHalfUp(D.h * rise));
  return { x: tg.x - D.w / 2, y: D.y - h, w: D.w, h };
}

/** 호흡 흔들림 — 프레임 수와 사람별 박자(phase)만으로 정해진다 */
export function swayOf(frame, phase, amp) {
  const f = frame + phase * 60;
  return {
    sx: Math.sin(f * 0.047 + phase) * amp + Math.sin(f * 0.13) * 0.4 * amp,
    sy: Math.sin(f * 0.035 + phase * 2) * amp * 1.1,
  };
}

/** 조준점 한 프레임: 누르고 있는 키만큼 움직이고(한계에서 멈춤), 반동이 줄어든다. a = { ax, ay, kick, still } */
export function aimStep(a, held, cfg) {
  const dx = (held & RIGHT ? 1 : 0) - (held & LEFT ? 1 : 0);
  const dy = (held & DOWN ? 1 : 0) - (held & UP ? 1 : 0);
  a.ax = Math.max(-cfg.AIM_RANGE, Math.min(cfg.AIM_RANGE, a.ax + dx * cfg.AIM_SPEED_X));
  a.ay = Math.max(cfg.AIM_TOP_Y, Math.min(cfg.AIM_BOTTOM_Y, a.ay + dy * cfg.AIM_SPEED_Y));
  a.still = dx || dy ? 0 : a.still + 1;
  a.kick *= cfg.KICK_DECAY;
}

/** 숨을 골랐는지에 따른 흔들림 크기 */
export function swayAmp(still, cfg) {
  return cfg.SWAY * (still > cfg.STEADY_TIME ? cfg.STEADY_SWAY : 1);
}

/** 사로 하나(참가자 한 명)의 상태 */
export class Lane {
  constructor(cfg, swayPhase) {
    this.ax = 0;
    this.ay = cfg.AIM_START_Y;
    this.kick = 0;
    this.still = 0;
    this.sx = 0;
    this.sy = 0;
    this.cooldown = 0;
    this.mag = cfg.MAG_SIZE;
    this.spare = Math.ceil(cfg.TARGETS / cfg.MAG_SIZE) - 1;
    this.reloadT = 0;
    this.shots = 0;
    this.hits = 0;
    this.quick = 0;
    this.hitK = -1;
    this.fallT = 0;
    this.phase = swayPhase;
    this.record = [];
    this.streak = 0;
    this.bestStreak = 0;
    this.missRun = 0;
    this.held = 0;
  }

  score(cfg) {
    return this.hits * cfg.HIT_POINTS + this.quick;
  }

  aim() {
    return { x: this.ax + this.sx, y: this.ay - this.kick + this.sy };
  }

  outOfAmmo() {
    return this.mag === 0 && this.spare === 0 && this.reloadT === 0;
  }
}

/**
 * 사격장 전체: 표적 진행(모두 같음) + 사로들.
 * phase: brief → fire → cease → over / tPhase(표적): gap → rise → up → fall
 */
export class Range {
  constructor(cfg, ids, schedule, swayPhases) {
    this.cfg = cfg;
    this.ids = [...ids];
    this.schedule = schedule;
    this.total = schedule.length;
    this.lanes = {};
    for (const id of this.ids) this.lanes[id] = new Lane(cfg, swayPhases[id] || 0);
    this.away = new Set();
    this.phase = 'brief';
    this.frame = 0;
    this.t = 0;
    this.k = 0;
    this.tPhase = 'gap';
    this.tT = 0;
    this.events = [];
  }

  get target() {
    return this.phase === 'fire' && this.k < this.total ? this.schedule[this.k] : null;
  }

  riseFor(lane) {
    if (this.phase !== 'fire') return 0;
    const R = this.cfg.RISE_TIME;
    if (lane.hitK === this.k) return Math.max(0, 1 - lane.fallT / R);
    return { gap: 0, rise: this.tT / R, up: 1, fall: 1 - this.tT / R }[this.tPhase];
  }

  _updateTargets() {
    const cfg = this.cfg;
    const tg = this.schedule[this.k];
    this.tT++;
    if (this.tPhase === 'gap' && this.tT >= cfg.TARGET_GAP) {
      this.tPhase = 'rise';
      this.tT = 0;
      this.events.push({ type: 'popup', k: this.k, dist: tg.dist });
      if (this.k === Math.floor(this.total / 2)) {
        this.events.push({ type: 'half' });
        this.events.push({ type: 'tower', text: cfg.HALF_LINE });
      }
    } else if (this.tPhase === 'rise' && this.tT >= cfg.RISE_TIME) {
      this.tPhase = 'up';
      this.tT = 0;
    } else if (this.tPhase === 'up') {
      const here = this.ids.filter((id) => !this.away.has(id)).map((id) => this.lanes[id]);
      const allDone = here.length > 0 && here.every((l) => l.hitK === this.k || l.outOfAmmo());
      if (this.tT >= tg.time || (allDone && this.tT > cfg.EARLY_DROP)) {
        this.tPhase = 'fall';
        this.tT = 0;
      }
    } else if (this.tPhase === 'fall' && this.tT >= cfg.RISE_TIME) {
      const hitters = [];
      for (const id of this.ids) {
        const lane = this.lanes[id];
        const hit = lane.hitK === this.k;
        lane.record.push(hit);
        if (hit) hitters.push(id);
        else lane.streak = 0;
      }
      this.events.push({ type: 'down', k: this.k, dist: tg.dist, hitters });
      this.k++;
      this.tPhase = 'gap';
      this.tT = 0;
      if (this.k >= this.total) {
        this.phase = 'cease';
        this.t = 0;
        this.events.push({ type: 'cease' });
      }
    }
  }

  _updateLane(lane) {
    const cfg = this.cfg;
    if (lane.cooldown > 0) lane.cooldown--;
    if (this.phase === 'fire' && lane.hitK === this.k) lane.fallT++;
    if (lane.reloadT > 0) {
      lane.reloadT--;
      if (lane.reloadT === 0) {
        lane.mag = cfg.MAG_SIZE;
        lane.spare--;
      }
    }
    aimStep(lane, lane.held, cfg);
    const s = swayOf(this.frame, lane.phase, swayAmp(lane.still, cfg));
    lane.sx = s.sx;
    lane.sy = s.sy;
  }

  step() {
    if (this.phase === 'over') return;
    const cfg = this.cfg;
    this.frame++;
    this.t++;
    if (this.phase === 'brief') {
      for (const [at, text] of cfg.BRIEF) if (this.t === at + 1) this.events.push({ type: 'tower', text });
      if (this.t >= cfg.BRIEF_END) {
        this.phase = 'fire';
        this.t = 0;
        this.tPhase = 'gap';
        this.tT = 0;
      }
    } else if (this.phase === 'fire') this._updateTargets();
    else if (this.phase === 'cease') {
      for (const [at, text] of cfg.CEASE) if (this.t === at + 1) this.events.push({ type: 'tower', text });
      if (this.t >= cfg.CEASE_END) this.phase = 'over';
    }
    for (const id of this.ids) this._updateLane(this.lanes[id]);
  }

  setHeld(id, held) {
    const lane = this.lanes[id];
    if (lane) lane.held = held & 15;
  }

  fire(id) {
    const cfg = this.cfg;
    const lane = this.lanes[id];
    if (!lane || this.phase !== 'fire' || lane.cooldown > 0 || lane.reloadT > 0) return;
    if (lane.mag === 0) {
      this.events.push({ type: 'dry', playerId: id });
      return;
    }
    const { x: px, y: py } = lane.aim();
    lane.mag--;
    lane.shots++;
    lane.cooldown = cfg.FIRE_COOLDOWN;
    lane.kick += cfg.RECOIL;
    const tg = this.schedule[this.k];
    const rise = this.riseFor(lane);
    let hit = false;
    if (lane.hitK !== this.k && rise >= 0.5) {
      const r = targetRect(tg, rise, cfg);
      hit = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }
    let quick = 0;
    if (hit) {
      const react = this.tPhase === 'up' ? this.tT : 0;
      quick = Math.max(0, cfg.QUICK_MAX - Math.floor(react / cfg.QUICK_STEP));
      lane.hits++;
      lane.quick += quick;
      lane.hitK = this.k;
      lane.fallT = 0;
      lane.streak++;
      lane.bestStreak = Math.max(lane.bestStreak, lane.streak);
      lane.missRun = 0;
    } else lane.missRun++;
    const reload = lane.mag === 0 && lane.spare > 0;
    if (reload) lane.reloadT = cfg.RELOAD_TIME;
    this.events.push({
      type: 'shot', playerId: id, hit, k: this.k, dist: tg.dist,
      x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100, pts: hit ? cfg.HIT_POINTS + quick : 0,
      quick, streak: lane.streak, missRun: lane.missRun, reload,
    });
  }
}
