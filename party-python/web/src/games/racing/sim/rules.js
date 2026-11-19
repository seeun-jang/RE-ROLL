// =============================================================
// 레이싱 계산식 — 서버(server/party/games/racing/track.py)와 같은 내용.
// 화면(내 차를 기다리지 않고 바로 움직여 보이기)과 시험용 진행기(RacingSim)가 쓴다. 테스트가 서버와 결과를 비교한다.
//
// sin·cos 은 사칙연산으로 직접 계산한다(서버와 브라우저가 끝자리까지 같은 값을 내도록).
// =============================================================

export const LOGIC_FPS = 60;
const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;

export function detSin(xIn) {
  let x = xIn - TWO_PI * Math.floor((xIn + PI) / TWO_PI);
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (
    1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

export const detCos = (x) => detSin(x + PI / 2);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;
export const r3 = (v) => Math.floor(v * 1000 + 0.5) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod = (a, n) => ((a % n) + n) % n;

/** 가운데 선을 잘게 나눈 점 목록과 구간 정보 */
export function buildTrack(cfg) {
  const T = cfg.TRACK;
  const pts = T.POINTS;
  const n = pts.length;
  const per = T.SAMPLES_PER_POINT;
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[mod(i - 1, n)];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      for (const [axis, out] of [[0, xs], [1, ys]]) {
        const a = p0[axis];
        const b = p1[axis];
        const c = p2[axis];
        const d = p3[axis];
        const v = 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push(r2(v));
      }
    }
  }
  const count = xs.length;
  const lens = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    lens.push(Math.sqrt(dx * dx + dy * dy));
  }
  return { x: xs, y: ys, len: lens, n: count, half: T.HALF_WIDTH, limit: T.HALF_WIDTH - T.WALL_MARGIN, search: T.SEARCH };
}

/** around 번째 구간 근처에서 (x, y) 에 가장 가까운 가운데 선 위의 점 → [구간, 구간 안 위치, 점 x, 점 y, 거리] */
export function nearest(track, x, y, around) {
  const n = track.n;
  const xs = track.x;
  const ys = track.y;
  const lens = track.len;
  const a0 = mod(around, n);
  let best = [a0, 0, xs[a0], ys[a0], Infinity];
  for (let off = -track.search; off <= track.search; off++) {
    const i = mod(around + off, n);
    const j = (i + 1) % n;
    const ax = xs[i];
    const ay = ys[i];
    const bx = xs[j] - ax;
    const by = ys[j] - ay;
    const l2 = lens[i] * lens[i];
    let t = l2 > 0 ? ((x - ax) * bx + (y - ay) * by) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + bx * t;
    const py = ay + by * t;
    const dx = x - px;
    const dy = y - py;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best[4]) best = [i, t, px, py, d];
  }
  return best;
}

export function angleOf(ux, uy) {
  let lo = -PI;
  let hi = PI;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (detCos(mid) * uy - detSin(mid) * ux > 0) lo = mid;
    else hi = mid;
  }
  let a = (lo + hi) / 2;
  if (detCos(a) * ux + detSin(a) * uy < 0) a = a <= 0 ? a + PI : a - PI;
  return a;
}

/** 출발선 바로 뒤, 도로 폭 방향으로 나란히 세운 차 */
export function newCar(cfg, track, slot, slots) {
  const C = cfg.CAR;
  const n = track.n;
  const back = C.GRID_BACK;
  const i = mod(Math.trunc(n - Math.ceil(back)), n);
  const t = Math.ceil(back) - back;
  const j = (i + 1) % n;
  const dx = track.x[j] - track.x[i];
  const dy = track.y[j] - track.y[i];
  const length = track.len[i];
  const ux = dx / length;
  const uy = dy / length;
  const lateral = (slot - (slots - 1) / 2) * C.GRID_SPACING;
  return {
    x: track.x[i] + dx * t - uy * lateral, y: track.y[i] + dy * t + ux * lateral, a: angleOf(ux, uy), vx: 0, vy: 0,
    seg: i, prog: i + t, total: (i + t) - n, drifting: false, hit: 0, finished: false, finishTime: null,
    lapTimes: [], lapStart: 0, steer: 0, throttle: 0, drift: 0, laps: 0, place: 0,
  };
}

/** 차 한 대를 dt 초 진행한다 (원본 stepPhysics + 벽 + 진행도) */
export function stepCar(car, cfg, track, dt) {
  const C = cfg.CAR;
  const { steer, throttle, drift } = car;
  const fx = detCos(car.a);
  const fy = detSin(car.a);
  const rx = -fy;
  const ry = fx;
  let vF = car.vx * fx + car.vy * fy;
  let vL = car.vx * rx + car.vy * ry;

  vF += throttle * C.ACCEL * dt;
  vF *= (1 - C.DRAG * dt);
  vF = clamp(vF, -C.MAX_SPEED * C.REVERSE_RATIO, C.MAX_SPEED);

  const grip = C.GRIP_NORMAL + (C.GRIP_DRIFT - C.GRIP_NORMAL) * drift;
  vL *= Math.max(0, 1 - grip * dt);

  const speedFactor = clamp(Math.abs(vF) / C.TURN_SPEED_REF, 0, 1);
  const turn = C.TURN_BASE + drift * C.TURN_DRIFT;
  car.a += steer * turn * dt * speedFactor * (sign(vF) || 1);
  if (car.a > PI) car.a -= TWO_PI;
  else if (car.a < -PI) car.a += TWO_PI;

  car.vx = fx * vF + rx * vL;
  car.vy = fy * vF + ry * vL;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.drifting = Math.abs(vL) > C.SKID_SPEED;

  // 잔디 = 보이지 않는 벽
  const [seg, t, px, py, dist] = nearest(track, car.x, car.y, car.seg);
  car.hit = 0;
  if (dist > track.limit) {
    const nx = (car.x - px) / dist;
    const ny = (car.y - py) / dist;
    car.x = px + nx * track.limit;
    car.y = py + ny * track.limit;
    const vn = car.vx * nx + car.vy * ny;
    if (vn > 0) {
      car.vx -= vn * nx;
      car.vy -= vn * ny;
      car.vx *= C.WALL_KEEP;
      car.vy *= C.WALL_KEEP;
      car.hit = vn;
    }
  }

  const n = track.n;
  const prog = seg + t;
  let d = prog - car.prog;
  if (d < -n / 2) d += n;
  else if (d > n / 2) d -= n;
  car.total += d;
  car.prog = prog;
  car.seg = seg;
}
