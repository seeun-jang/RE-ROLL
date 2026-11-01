// =============================================================
//  상태별 자세 (킥복싱)
//  엔진의 선수 상태를 보고 지금 취할 자세를 만듭니다. 형식은 rig.js 참고.
// =============================================================

import { FIGHTER } from '../config.js';
import { moveSpec } from '../engine/fighter.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function mix(a, b, t) {
  const out = { ...a };
  for (const key of Object.keys(b)) {
    const va = a[key];
    const vb = b[key];
    if (Array.isArray(va) && Array.isArray(vb)) out[key] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
    else if (va?.foot && vb?.foot) out[key] = { foot: [lerp(va.foot[0], vb.foot[0], t), lerp(va.foot[1], vb.foot[1], t)] };
    else if (typeof va === 'number' && typeof vb === 'number') out[key] = lerp(va, vb, t);
    else out[key] = t < 0.5 && va !== undefined ? va : vb;
  }
  return out;
}

// ---------------- 기본 ----------------

export const STANCE = {
  hipY: 78, dx: 0, lean: 0.08, head: 0.08, twist: 0,
  aF: [1.0, 2.05], aB: [0.78, 2.35],
  lF: { foot: [30, 0] }, lB: { foot: [-36, 0] },
};

const GUARD = { ...STANCE, hipY: 74, lean: 0.16, head: 0.22, aF: [1.6, 2.6], aB: [1.45, 2.75] };

const LYING = {
  hipY: 18, dx: -40, lean: -1.5, head: -0.15, twist: 0,
  aF: [2.6, 0.4], aB: [2.1, 0.6],
  lF: [1.35, 1.2], lB: [1.05, 0.6],
};

// ---------------- 기술 ----------------
// ready: 준비 동작 / hit: 기술이 나가는 순간

const CROUCH = { ...STANCE, hipY: 54, lean: 0.55, head: -0.1, aF: [1.1, 2.4], aB: [0.9, 2.5], lF: { foot: [34, 0] }, lB: { foot: [-44, 0] } };
const SPRINT = { hipY: 64, dx: 6, lean: 0.8, head: -0.55, twist: 0, aF: [-0.5, 0.6], aB: [-0.8, 0.4], lF: { foot: [46, 0] }, lB: { foot: [-74, -12] } };
const TUCK = { hipY: 44, dx: 0, lean: 1.2, head: 0.6, twist: 0, aF: [1.5, 2.5], aB: [1.3, 2.6], lF: [1.95, 2.6], lB: [1.7, 2.7] };

const MOVE_KEYS = {
  // ----- student -----
  jab: {
    ready: { ...STANCE, aF: [0.95, 2.5], lean: 0.1 },
    hit: { ...STANCE, lean: 0.2, dx: 10, twist: 0.25, aF: [1.62, 0.05], reachA: 1.12, aB: [0.9, 2.6], head: 0.12 },
  },
  cross: {
    ready: { ...STANCE, lean: 0.02, twist: -0.3, aB: [0.6, 2.7], dx: -4 },
    hit: { ...STANCE, lean: 0.34, dx: 22, twist: 1, aF: [1.2, 2.6], aB: [1.6, 0.04], head: 0.14, lB: { foot: [-44, 0] } },
  },
  claw: {
    ready: { ...STANCE, lean: -0.1, twist: -0.5, aF: [2.9, 0.7], aB: [0.7, 2.5], head: -0.1 },
    hit: { ...STANCE, lean: 0.42, dx: 22, twist: 0.9, aF: [1.15, 0.25], reachA: 1.12, aB: [1.0, 2.6], head: 0.25, lB: { foot: [-48, 0] } },
  },
  knee: {
    ready: { ...STANCE, lean: 0.15, aF: [1.5, 1.0], aB: [1.4, 1.1] },
    hit: { ...STANCE, hipY: 86, lean: -0.08, dx: 20, lF: [1.85, 2.55], lB: { foot: [-12, 0] }, aF: [1.55, 0.75], aB: [1.45, 0.85], head: 0.25 },
  },
  dash: { ready: CROUCH, hit: SPRINT, end: { ...STANCE, lean: 0.3, aF: [1.5, 0.4], reachA: 1.1 } },
  pounce: {
    ready: { ...CROUCH, hipY: 46 },
    hit: { hipY: 70, dx: 0, lean: 0.25, head: 0.1, twist: 0, aF: [2.8, 0.6], aB: [2.5, 0.7], lF: [1.4, 2.3], lB: [0.9, 2.4] },
    end: { ...CROUCH, hipY: 44, lean: 0.85, head: 0.2, aF: [1.0, 0.2], aB: [0.8, 0.3], reachA: 1.1 },
  },
  roar: {
    ready: { ...STANCE, lean: 0.3, head: 0.3, aF: [1.0, 2.4], aB: [0.9, 2.5] },
    hit: { ...STANCE, hipY: 82, lean: -0.35, head: -0.65, aF: [2.1, 0.35], aB: [-2.1, -0.3], lF: { foot: [40, 0] }, lB: { foot: [-44, 0] } },
  },
  roll: { ready: { ...CROUCH, hipY: 48 }, hit: TUCK, end: CROUCH },
  whiteTiger: { ready: { ...CROUCH, aF: [2.6, 0.6], aB: [2.3, 0.8] }, hit: SPRINT, end: STANCE },

  // ----- 교수 -----
  missile: {
    ready: { ...STANCE, aF: [0.9, 2.3], lean: 0.05 },
    hit: { ...STANCE, lean: 0.14, dx: 6, twist: 0.3, aF: [1.6, 0.1], reachA: 1.05, aB: [0.8, 2.4] },
  },
  palm: {
    ready: { ...STANCE, aF: [0.9, 2.4], twist: -0.2 },
    hit: { ...STANCE, lean: 0.25, dx: 14, twist: 0.6, aF: [1.6, 0.05], reachA: 1.1, aB: [0.9, 2.5] },
  },
  fireball: {
    ready: { ...STANCE, hipY: 72, lean: -0.08, twist: -0.5, aF: [0.25, 1.7], aB: [0.15, 1.9], head: 0.1 },
    hit: { ...STANCE, hipY: 74, lean: 0.28, dx: 14, twist: 0.4, aF: [1.58, 0.1], aB: [1.48, 0.15], reachA: 1.05, head: 0.05, lB: { foot: [-50, 0] } },
  },
  lightning: {
    ready: { ...STANCE, aF: [2.3, 0.5], aB: [0.6, 1.9], head: -0.2 },
    hit: { ...STANCE, hipY: 82, lean: -0.18, head: -0.4, aF: [3.05, 0.08], aB: [0.5, 1.6] },
  },
  blink: { ready: { ...STANCE, aF: [1.3, 2.6], aB: [1.2, 2.7], hipY: 70 }, hit: STANCE },
  blast: {
    ready: { ...STANCE, hipY: 70, lean: 0.25, aF: [1.25, 2.6], aB: [1.05, 2.7], head: 0.2 },
    hit: { ...STANCE, hipY: 80, lean: -0.15, head: -0.2, aF: [2.15, 0.2], aB: [-2.15, -0.2], lF: { foot: [44, 0] }, lB: { foot: [-48, 0] } },
  },
  backstep: { ready: STANCE, hit: { ...STANCE, hipY: 72, lean: -0.22, dx: -10, aF: [1.5, 2.5], aB: [1.3, 2.7] }, end: STANCE },
  meteor: {
    ready: { ...STANCE, hipY: 80, lean: -0.15, head: -0.45, aF: [3.0, 0.2], aB: [3.35, 0.1] },
    hit: { ...STANCE, hipY: 80, lean: 0.25, head: 0.1, aF: [1.7, 0.1], aB: [1.6, 0.15], reachA: 1.05 },
  },
};

function attackPose(f, time) {
  const { type } = f.action;
  const t = f.action.time;
  const m = moveSpec(f);
  const keys = MOVE_KEYS[type];
  const end = keys.end ?? STANCE;
  // 백호 난무가 닿은 뒤: 양손 발톱을 번갈아 휘두름
  if (type === 'whiteTiger' && f.action.data?.connected) {
    const swing = Math.floor(f.action.data.t / 0.13) % 2;
    const k = (f.action.data.t % 0.13) / 0.13;
    const up = [2.7, 0.6];
    const down = [1.1, 0.25];
    const pose = { ...STANCE, lean: 0.35, dx: 10, twist: swing ? 0.9 : -0.2, head: 0.2 };
    pose.aF = swing ? mix({ a: up }, { a: down }, k).a : [1.3, 2.4];
    pose.aB = swing ? [1.1, 2.5] : mix({ a: up }, { a: down }, k).a;
    return pose;
  }
  if (t < m.startup) return mix(STANCE, keys.ready, easeOut(clamp01(t / m.startup)));
  if (t < m.startup + m.active) {
    const k = (t - m.startup) / m.active;
    // 도약은 공중에서 웅크렸다가 착지 직전 발톱을 내림
    if (type === 'pounce') return k < 0.7 ? keys.hit : mix(keys.hit, keys.end, (k - 0.7) / 0.3);
    if (type === 'roll' || type === 'backstep') return keys.hit;
    return mix(keys.ready, keys.hit, easeOut(clamp01(k / 0.55)));
  }
  const from = keys.end && type !== 'meteor' ? keys.end : keys.hit;
  return mix(from, STANCE, easeInOut(clamp01((t - m.startup - m.active) / m.recovery)));
}

/** 구르기 회전 (라디안, 몸 기준) */
export function spinFor(f) {
  if (f.state !== 'action' || f.action?.type !== 'roll') return 0;
  const m = moveSpec(f);
  const k = clamp01((f.action.time - m.startup) / m.active);
  return k * Math.PI * 2 * (f.action.dir === f.facing ? 1 : -1);
}

/** 블링크로 사라졌다 나타나는 투명도 */
export function alphaFor(f) {
  if (f.state !== 'action' || f.action?.type !== 'blink') return 1;
  const m = moveSpec(f);
  const t = f.action.time;
  if (t < m.startup) return 1 - t / m.startup;
  return clamp01((t - m.startup) / 0.18);
}

// ---------------- 맞음 ----------------

const HURT = {
  high: { ...STANCE, hipY: 74, lean: -0.42, head: -0.55, dx: -8, aF: [0.7, 1.3], aB: [0.3, 1.0] },
  mid: { ...STANCE, hipY: 70, lean: 0.62, head: 0.35, dx: -6, aF: [0.5, 2.1], aB: [0.35, 2.2] },
  low: { ...STANCE, hipY: 70, lean: 0.25, head: 0.25, lF: [0.55, 1.25], aF: [0.9, 1.6], aB: [0.2, 1.4] },
};

function downPose(f, time) {
  const t = f.stateTime;
  const stagger = { ...HURT[f.hitZone] ?? HURT.high, hipY: 66 };
  if (t < 0.22) return mix(STANCE, stagger, easeOut(t / 0.22));
  if (t < 0.7) return mix(stagger, LYING, easeOut((t - 0.22) / 0.48));
  const push = Math.sin(time * 4) * 0.05;
  return { ...LYING, aB: [-0.5 + push, 0.4], aF: [2.3 + push, 0.6], head: -0.15 + push };
}

function getupPose(f) {
  const t = clamp01(f.stateTime / FIGHTER.getupSeconds);
  const sit = { hipY: 28, dx: -26, lean: -0.3, head: 0.15, twist: 0, aF: [0.8, 1.0], aB: [-0.6, 0.2], lF: [1.6, 1.7], lB: [1.25, 2.0] };
  const kneel = { hipY: 48, dx: -12, lean: 0.35, head: 0.2, twist: 0, aF: [1.0, 2.2], aB: [0.6, 2.4], lF: { foot: [26, 0] }, lB: [0.2, 2.2] };
  if (t < 0.5) return mix(sit, kneel, easeInOut(t / 0.5));
  return mix(kneel, GUARD, easeInOut((t - 0.5) / 0.5));
}

/**
 * @param f     선수
 * @param time  전체 시간 (반복 동작용)
 */
export function poseFor(f, time) {
  const bounce = Math.abs(Math.sin(time * 6.2 + (f.id === 'p1' ? 0 : 1.3)));
  switch (f.state) {
    case 'walk': {
      const ph = time * 12;
      const back = f.vx * f.facing < 0 ? -1 : 1;
      return {
        ...STANCE,
        hipY: STANCE.hipY - bounce * 2,
        lF: { foot: [30 + Math.sin(ph) * 10 * back, Math.min(0, -Math.cos(ph) * 6)] },
        lB: { foot: [-36 + Math.sin(ph + Math.PI) * 10 * back, Math.min(0, Math.cos(ph) * 6)] },
      };
    }
    case 'guard':
      return { ...GUARD, hipY: GUARD.hipY - bounce * 1.5 };
    case 'block':
      return { ...GUARD, lean: 0.02, dx: -8, head: 0.32 };
    case 'action':
      return f.action ? attackPose(f, time) : STANCE;
    case 'stunned':
      return { ...HURT.high, lean: -0.2 + Math.sin(time * 9) * 0.08, head: -0.3, aF: [0.3, 0.6], aB: [-0.2, 0.5] };
    case 'hit':
      return HURT[f.hitZone] ?? HURT.high;
    case 'broken':
      return { ...HURT.high, aF: [0.2, 0.5], aB: [-0.4, 0.4], head: -0.3 + Math.sin(time * 10) * 0.1 };
    case 'down':
      return downPose(f, time);
    case 'getup':
      return getupPose(f);
    case 'ko': {
      const t = f.stateTime;
      const flat = { ...LYING, lean: -1.56, aF: [3.0, 0.15], aB: [2.4, 0.25], lF: [1.45, 0.35], lB: [1.6, 0.15], head: -0.3 };
      const stagger = { ...HURT.high, hipY: 70, head: -0.8, lean: -0.6 };
      if (t < 0.3) return mix(STANCE, stagger, easeOut(t / 0.3));
      if (t < 0.9) return mix(stagger, flat, easeOut((t - 0.3) / 0.6));
      return flat;
    }
    case 'win': {
      const pump = Math.sin(time * 5);
      return {
        ...STANCE, hipY: 80, lean: -0.12, head: -0.25, twist: 0,
        aF: [2.4 + pump * 0.08, 0.55], aB: [3.6 - pump * 0.08, -0.3],
        lF: { foot: [22, 0] }, lB: { foot: [-24, 0] },
      };
    }
    case 'lose':
      return { ...STANCE, hipY: 72, lean: 0.4, head: 0.5, aF: [0.15, 0.3], aB: [0.0, 0.25], lF: { foot: [18, 0] }, lB: { foot: [-20, 0] } };
    default: {
      const sway = Math.sin(time * 3.1 + (f.id === 'p1' ? 0 : 2)) * 0.03;
      return { ...STANCE, hipY: STANCE.hipY - bounce * 3, lean: STANCE.lean + sway, aF: [1.0 + sway, 2.05] };
    }
  }
}

export function poseSpeed(f) {
  if (f.state === 'action') return 40;
  if (f.state === 'hit' || f.state === 'block' || f.state === 'broken' || f.state === 'stunned') return 30;
  if (f.state === 'down' || f.state === 'ko' || f.state === 'getup') return 20;
  return 16;
}

export function expressionFor(f) {
  switch (f.state) {
    case 'hit':
    case 'broken':
      return 'ouch';
    case 'down':
    case 'ko':
    case 'stunned':
      return 'dizzy';
    case 'getup':
      return 'strain';
    case 'win':
      return 'happy';
    case 'lose':
      return 'sad';
    case 'action':
      return 'shout';
    default:
      return f.tired > 0 ? 'tired' : 'fierce';
  }
}
