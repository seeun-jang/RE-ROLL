// =============================================================
// 볼링 규칙 계산 — 원본 js/bowling.js (Rack · scoreFrames · frameState) 를 ES 모듈로 옮긴 것.
//
// 서버(server/party/games/bowling/rules.py)와 **숫자 하나까지 같은 결과**가 나와야 한다.
// 화면은 이 계산으로 핀이 쓰러지는 모습을 바로 그리고, 서버가 같은 계산으로 판정하기 때문이다.
// 그래서 양쪽이 다르게 계산할 수 있는 것은 쓰지 않는다:
//   - 난수: Math.random 대신 씨앗으로 만드는 간단한 난수(makeRng)
//   - sin · cos: Math.sin/cos 대신 사칙연산 다항식(detSin, detCos)
//   - hypot: Math.sqrt(dx*dx + dy*dy)
// 숫자는 server/party/games/bowling/config.py 와 같아야 한다(테스트가 비교한다).
// =============================================================

export const DEFAULT_CONFIG = {
  FRAMES: 5,               // 프레임 수 — 임시 값 (원본은 3 · 5 · 10 중 선택)
  JACKPOT_BONUS: 3,        // 금색 '잭팟 핀'을 쓰러뜨리면 +3점
  JACKPOT_CHANCE: 0.25,    // 새로 세운 핀에 금색 핀이 섞여 있을 확률
  // 레인 (x = 가운데 0 기준 좌우, y = 파울 라인 0 에서 핀 쪽으로 +)
  LANE: { HALF: 20, HEAD_Y: 54, PIN_GAP_X: 9, PIN_GAP_Y: 7, PIN_R: 2.2, BALL_R: 3.2, PIT_Y: 80, WALL: 25 },
  THROW: {
    MOVE_SPEED: 0.45, START_RANGE: 17, AIM_MAX: 0.2, AIM_SPEED: 0.045, POWER_PERIOD: 70,
    SPEED_MIN: 1.0, SPEED_MAX: 2.5, SPIN_BUDGET: 0.5, SPIN_ACCEL: 0.02,
  },
  FLOW: { FPS: 60, SETTLE_TIME: 50, SHOW_PLAIN: 50, SHOW_JACKPOT: 80, SHOW_ANIM: 100, SWEEP_TIME: 54, SWEEP_MID: 26 },
  RULES: {
    INTRO_TIME: 3.0, THROW_LIMIT: 10.0, GRACE: 1.5, AWAY_LIMIT: 1.5, EARLY: 0.5,
    MAX_SPIN_FRAMES: 90, FINAL_TIME: 8.0, STATE_HZ: 5, SAY_GAP: 3.0,
  },
};

/** 화면 · 그리기 코드가 쓰는 값 (원본 CONFIG 와 같은 이름) */
export const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60,
  LANE: DEFAULT_CONFIG.LANE,
  ...DEFAULT_CONFIG.THROW,
  JACKPOT_BONUS: DEFAULT_CONFIG.JACKPOT_BONUS,
  SETTLE_TIME: DEFAULT_CONFIG.FLOW.SETTLE_TIME,
};

export function mergeConfig(override) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const [section, values] of Object.entries(override || {})) {
    if (values && typeof values === 'object' && !Array.isArray(values) && cfg[section] && typeof cfg[section] === 'object') {
      Object.assign(cfg[section], values);
    } else cfg[section] = values;
  }
  return cfg;
}

// ----- 양쪽이 같은 값을 내는 난수 · 삼각함수 -----
/** 씨앗 → 0 이상 1 미만 난수 함수 (선형 합동법) */
export function makeRng(seed) {
  let state = seed % 4294967296;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** n 번째 투구의 씨앗. 모든 참가자가 같은 값을 쓴다 (salt 0 = 핀 물리, 1 = 방향 화살표 시작 위치) */
export function throwSeed(seed, n, salt = 0) {
  return (seed + n * 7919 + salt * 104729 + 1) % 4294967296;
}

export function detSin(x) {
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - x2 / 20));
}

export function detCos(x) {
  const x2 = x * x;
  return 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - x2 / 30));
}

// 핀 배치 (1번 핀이 앞, 뒤로 갈수록 넓어지는 삼각형)
export function pinSpots(cfg = DEFAULT_CONFIG) {
  const L = cfg.LANE;
  const spots = [];
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) {
      spots.push({ x: (j - row / 2) * L.PIN_GAP_X, y: L.HEAD_Y + row * L.PIN_GAP_Y });
    }
  }
  return spots;
}

export class Rack {
  constructor(cfg = DEFAULT_CONFIG, rng = Math.random) {
    this.cfg = cfg;
    this.rng = rng;
    this.pins = pinSpots(cfg).map((s, i) => ({ id: i, x: s.x, y: s.y, vx: 0, vy: 0, up: true, gone: false, fall: 0, gold: false }));
    this.ball = null;
  }

  // 새 판 (핀 10개 다시 세움). gold: 잭팟 핀 번호 (-1 이면 없음)
  reset(gold = -1) {
    this.setUp([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], gold);
  }

  /** 핀을 제자리에 다시 놓는다. up[i] 가 0 인 핀은 치워진 것(없음) */
  setUp(up, gold = -1) {
    const spots = pinSpots(this.cfg);
    this.pins.forEach((p, i) => Object.assign(p, { x: spots[i].x, y: spots[i].y, vx: 0, vy: 0, up: true, gone: !up[i], fall: 0, gold: i === gold }));
    this.ball = null;
  }

  // 쓰러진 핀 치우기 (2구째 전에)
  sweep() {
    for (const p of this.pins) if (!p.up) p.gone = true;
  }

  upMask() {
    return this.pins.map((p) => (p.up && !p.gone ? 1 : 0));
  }

  get standing() {
    return this.pins.filter((p) => p.up && !p.gone).length;
  }

  // 공 굴리기 시작
  launch(x, angle, speed) {
    this.ball = { x, y: -4, vx: angle * speed, vy: speed, gutter: false, gone: false, spin: this.cfg.THROW.SPIN_BUDGET, hits: 0 };
  }

  // spinDir: -1 왼쪽 / 0 / 1 오른쪽 (굴러가는 중 스핀 입력)
  // 반환: 이번 프레임에 일어난 일 { pinHits, gutter }
  step(spinDir = 0) {
    const ev = { pinHits: 0, gutter: false, wall: false };
    const L = this.cfg.LANE;
    const T = this.cfg.THROW;
    const b = this.ball;
    if (b && !b.gone) {
      // 스핀: 핀에 닿기 전까지만, 남은 양만큼
      if (spinDir && b.spin > 0 && b.y < L.HEAD_Y - 4 && !b.gutter) {
        const a = Math.min(b.spin, T.SPIN_ACCEL);
        b.vx += spinDir * a;
        b.spin -= a;
      }
    }
    // 2번 나눠서 움직임 (빠른 공이 핀을 뚫고 지나가지 않게)
    for (let sub = 0; sub < 2; sub++) {
      if (b && !b.gone) {
        b.x += b.vx / 2;
        b.y += b.vy / 2;
        if (!b.gutter && Math.abs(b.x) > L.HALF) {
          // 거터: 홈에 빠져서 끝까지 굴러감
          b.gutter = true;
          b.x = (b.x > 0 ? 1 : -1) * (L.HALF + 2.5);
          b.vx = 0;
          ev.gutter = true;
        }
        if (b.y > L.PIT_Y) b.gone = true;
        if (!b.gutter) {
          for (const p of this.pins) {
            if (p.gone) continue;
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const min = L.BALL_R + L.PIN_R;
            if (d < min && d > 0) {
              const nx = dx / d;
              const ny = dy / d;
              const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
              // 핀이 맞은 방향으로 튕겨 나감 (조금 흩어짐)
              const k = sp * (1.05 + this.rng() * 0.35) + 0.3;
              const rot = (this.rng() - 0.5) * 0.5;
              const c = detCos(rot);
              const s = detSin(rot);
              p.vx = (nx * c - ny * s) * k;
              p.vy = (nx * s + ny * c) * k;
              if (p.up) ev.pinHits++;
              p.up = false;
              // 공은 살짝 밀리고 느려짐 (무거워서 거의 직진)
              const dot = b.vx * nx + b.vy * ny;
              b.vx -= nx * dot * 0.22;
              b.vy -= ny * dot * 0.08;
              b.vy = Math.max(b.vy, 0.5);
              b.x = p.x - nx * min;
              b.y = p.y - ny * min;
              b.hits++;
            }
          }
        }
      }
      // 핀끼리 충돌
      for (const p of this.pins) {
        if (p.gone) continue;
        const ps = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (ps < 0.25) continue;
        for (const q of this.pins) {
          if (q === p || q.gone) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < L.PIN_R * 2 && d > 0) {
            const nx = dx / d;
            const ny = dy / d;
            const dot = p.vx * nx + p.vy * ny;
            if (dot <= 0) continue;
            const rot = (this.rng() - 0.5) * 0.7;
            const c = detCos(rot);
            const s = detSin(rot);
            const k = dot * (0.75 + this.rng() * 0.3);
            q.vx += (nx * c - ny * s) * k;
            q.vy += (nx * s + ny * c) * k;
            p.vx -= nx * dot * 0.55;
            p.vy -= ny * dot * 0.55;
            if (q.up) ev.pinHits++;
            q.up = false;
            q.x = p.x + nx * L.PIN_R * 2;
            q.y = p.y + ny * L.PIN_R * 2;
          }
        }
      }
      for (const p of this.pins) {
        if (p.gone) continue;
        p.x += p.vx / 2;
        p.y += p.vy / 2;
        // 옆벽에 튕겨서 다시 들어옴 (메신저 핀)
        if (Math.abs(p.x) > L.WALL) {
          p.x = (p.x > 0 ? 1 : -1) * L.WALL;
          p.vx *= -0.55;
          ev.wall = true;
        }
        if (p.y > L.PIT_Y || p.y < L.HEAD_Y - 14) p.gone = true;
      }
    }
    for (const p of this.pins) {
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (!p.up && p.fall < 1) p.fall = Math.min(1, p.fall + 0.12);
    }
    return ev;
  }

  // 공도 들어갔고 핀도 다 멈췄나
  get settled() {
    if (this.ball && !this.ball.gone) return false;
    return this.pins.every((p) => p.gone || Math.sqrt(p.vx * p.vx + p.vy * p.vy) < 0.05);
  }
}

/** 힘(0~1) → 공 속도 */
export function speedOf(cfg, power) {
  return cfg.THROW.SPEED_MIN + power * (cfg.THROW.SPEED_MAX - cfg.THROW.SPEED_MIN);
}

/**
 * 투구 하나를 끝까지 굴린다 (서버의 simulate_throw 와 같은 결과).
 * up: 던지기 전에 서 있는 핀(10칸), gold: 잭팟 핀 번호(-1 = 없음), spin: 프레임별 스핀 입력(-1/0/1)
 */
export function simulateThrow(cfg, up, gold, x, angle, power, spin, seed) {
  const rack = new Rack(cfg, makeRng(seed));
  rack.setUp(up, gold);
  const before = rack.standing;
  rack.launch(x, angle, speedOf(cfg, power));
  let frames = 0;
  let settle = 0;
  for (;;) {
    rack.step(frames < spin.length ? spin[frames] : 0);
    frames++;
    if (rack.ball.gone) settle++;
    if ((rack.ball.gone && rack.settled) || settle > cfg.FLOW.SETTLE_TIME) break;
  }
  const mask = rack.upMask();
  return {
    frames,
    up: mask,
    knocked: before - mask.reduce((a, b) => a + b, 0),
    gutter: rack.ball.gutter,
    goldHit: gold >= 0 && !!up[gold] && !mask[gold],
    rack,
  };
}

/** 남은 핀이 두 덩어리 이상으로 떨어져 있고 1번 핀이 없으면 스플릿 */
export function isSplit(cfg, upMask) {
  const spots = pinSpots(cfg);
  const up = [];
  for (let i = 0; i < 10; i++) if (upMask[i]) up.push(i);
  if (up.length < 2 || up.includes(0)) return false;
  const seen = new Set([up[0]]);
  const queue = [up[0]];
  while (queue.length) {
    const a = queue.pop();
    for (const b of up) {
      if (seen.has(b)) continue;
      const dx = spots[a].x - spots[b].x;
      const dy = spots[a].y - spots[b].y;
      if (Math.sqrt(dx * dx + dy * dy) < 9.6) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return seen.size < up.length;
}

// 정식 볼링 점수. rolls = [쓰러뜨린 핀 수...]
// 반환: [{ rolls:[...], marks:['X','/','-','7'...], cum: 누적점수|null }]
export function scoreFrames(rolls, N = DEFAULT_CONFIG.FRAMES) {
  const frames = [];
  let i = 0;
  let cum = 0;
  let ok = true; // 앞 프레임이 모두 확정됐나 (보너스 기다리는 중이면 누적 표시 안 함)
  const at = (k) => rolls[k];
  for (let f = 0; f < N; f++) {
    const last = f === N - 1;
    const fr = { rolls: [], marks: [], cum: null };
    let score = null;
    if (i < rolls.length && !last) {
      if (at(i) === 10) {
        fr.rolls = [10];
        fr.marks = ['X'];
        if (at(i + 1) != null && at(i + 2) != null) score = 10 + at(i + 1) + at(i + 2);
        i += 1;
      } else {
        fr.rolls = rolls.slice(i, i + 2);
        fr.marks = [mark(at(i))];
        if (at(i + 1) != null) {
          const spare = at(i) + at(i + 1) === 10;
          fr.marks.push(spare ? '/' : mark(at(i + 1)));
          if (!spare) score = at(i) + at(i + 1);
          else if (at(i + 2) != null) score = 10 + at(i + 2);
        }
        i += 2;
      }
    } else if (i < rolls.length) {
      // 마지막 프레임: 스트라이크/스페어면 보너스 투구 (최대 3구)
      const r = rolls.slice(i, i + 3);
      fr.rolls = r;
      r.forEach((v, k) => {
        if (k === 0) fr.marks.push(v === 10 ? 'X' : mark(v));
        else if (k === 1) fr.marks.push(r[0] === 10 ? (v === 10 ? 'X' : mark(v)) : r[0] + v === 10 ? '/' : mark(v));
        else {
          // 3구째 앞에 핀이 새로 세워졌나 (X X 또는 스페어 뒤)
          const fresh = r[0] !== 10 || r[1] === 10;
          fr.marks.push(fresh ? (v === 10 ? 'X' : mark(v)) : r[1] + v === 10 ? '/' : mark(v));
        }
      });
      const need = r.length >= 2 && r[0] + r[1] < 10 ? 2 : 3;
      if (r.length >= need) score = r.slice(0, need).reduce((a, b) => a + b, 0);
      i += r.length;
    }
    if (ok && score != null) {
      cum += score;
      fr.cum = cum;
    } else ok = false;
    frames.push(fr);
  }
  return frames;
}

function mark(v) {
  return v === 0 ? '-' : String(v);
}

// 지금까지 확정된 점수
export function runningScore(rolls, N = DEFAULT_CONFIG.FRAMES) {
  const fr = scoreFrames(rolls, N);
  let best = 0;
  for (const f of fr) if (f.cum != null) best = f.cum;
  return best;
}

// 이 선수는 다음에 몇 번째 프레임·몇 구째를 던지나 / 다 끝났나
export function frameState(rolls, N = DEFAULT_CONFIG.FRAMES) {
  let i = 0;
  for (let f = 0; f < N; f++) {
    const last = f === N - 1;
    if (!last) {
      if (i >= rolls.length) return { frame: f, ball: 0, done: false };
      if (rolls[i] === 10) {
        i += 1;
        continue;
      }
      if (i + 1 >= rolls.length) return { frame: f, ball: 1, done: false };
      i += 2;
    } else {
      const r = rolls.slice(i);
      if (r.length === 0) return { frame: f, ball: 0, done: false };
      if (r.length === 1) return { frame: f, ball: 1, done: false };
      if (r.length === 2) {
        if (r[0] === 10 || r[0] + r[1] === 10) return { frame: f, ball: 2, done: false };
        return { frame: f, ball: 2, done: true };
      }
      return { frame: f, ball: 3, done: true };
    }
  }
  return { frame: N, ball: 0, done: true };
}

// ----- 게이지 -----
/** 방향 화살표: 시작 위상 phase0 에서 frames 프레임 뒤의 기울기 */
export function aimAngle(cfg, phase0, frames) {
  return Math.sin(phase0 + cfg.THROW.AIM_SPEED * frames) * cfg.THROW.AIM_MAX;
}

/** 힘 게이지: frames 프레임 뒤의 값 (0 → 1 → 0 …) */
export function powerAt(cfg, frames) {
  const u = (frames / (cfg.THROW.POWER_PERIOD / 2)) % 2;
  return 1 - Math.abs(1 - u);
}

/** n 번째 투구에서 방향 화살표가 흔들리기 시작하는 위상 (모두 같다) */
export function aimPhase0(seed, n) {
  return makeRng(throwSeed(seed, n, 1))() * Math.PI * 2;
}
