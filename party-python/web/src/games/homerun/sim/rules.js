// =====================================================
// 야구 규칙 (원본 js/baseball.js): 투구 목록 · 공 궤적 · 맞았나 · 타구가 어디로 · 점수
//  좌표(m): x = 오른쪽(+) / y = 높이 / z = 홈 플레이트에서 투수 쪽으로
//  타구 방향 dir(도): 0 = 가운데, - = 3루(왼쪽), + = 1루(오른쪽) · 45도 넘으면 파울
//
// 실제 판정은 Python 서버(server/party/games/homerun/baseball.py)가 한다.
// 이 파일은 화면(공 궤적 · 내 스윙 결과 미리 보기)과 시험용 진행기가 쓴다 — 같은 입력에 같은 결과가 나와야 한다.
// =====================================================
import { CONFIG, RULES } from '../config.js';

export const PITCH_TYPES = {
  fast: { name: '직구', kmh: [142, 153], frames: [30, 34], breakX: 0, drop: 0.08, k: 2 },
  slider: { name: '슬라이더', kmh: [128, 137], frames: [36, 40], breakX: 0.28, drop: 0.1, k: 4 },
  curve: { name: '커브', kmh: [108, 119], frames: [44, 49], breakX: -0.2, drop: 0.5, k: 2 },
  change: { name: '체인지업', kmh: [118, 127], frames: [41, 45], breakX: 0.08, drop: 0.22, k: 3 },
};
export const PITCH_ORDER = ['fast', 'slider', 'curve', 'change'];

// 결과 이름 · 색
export const HIT_LOOK = {
  hr: { name: '홈런!', color: '9' },
  triple: { name: '3루타!', color: 'e' },
  double: { name: '2루타!', color: 'e' },
  single: { name: '안타!', color: 'h' },
  fly: { name: '플라이 아웃', color: 'j' },
  pop: { name: '내야 뜬공', color: 'j' },
  ground: { name: '땅볼 아웃', color: 'j' },
  foul: { name: '파울', color: 'k' },
  miss: { name: '헛스윙!', color: '5' },
  strike: { name: '스트라이크!', color: '5' },
  ball: { name: '볼', color: 'h' },
};
export const HIT_RESULTS = ['hr', 'triple', 'double', 'single'];        // 안타로 치는 결과
export const BATTED = ['hr', 'triple', 'double', 'single', 'fly', 'pop', 'ground', 'foul']; // 방망이에 맞은 결과

export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 모든 타자가 받을 같은 공 순서 (스트라이크 CHANCES 개 + 사이사이 볼)
//  원본은 여유로 스트라이크 2개를 더 만들지만, 여기서는 CHANCES 번째 스트라이크에서 끊는다
export function makePitches(seed, K = RULES) {
  const rnd = mulberry32(seed);
  const Z = K.ZONE;
  const list = [];
  let strikes = 0;
  while (strikes < K.CHANCES + 2) {
    const typeId = PITCH_ORDER[Math.floor(rnd() * PITCH_ORDER.length)];
    const T = PITCH_TYPES[typeId];
    const ball = list.length > 0 && strikes < K.CHANCES && rnd() < 0.28;
    let tx = (rnd() * 2 - 1) * Z.HALF_W * 0.85;
    let ty = Z.LOW + 0.08 + rnd() * (Z.HIGH - Z.LOW - 0.16);
    if (ball) {
      // 존 밖: 옆으로 빠지거나 낮게 떨어짐
      if (rnd() < 0.6) tx = Math.sign(rnd() - 0.5) * (Z.HALF_W + 0.1 + rnd() * 0.14);
      else ty = Z.LOW - 0.12 - rnd() * 0.15;
    }
    const p = {
      id: list.length,
      typeId,
      name: T.name,
      kmh: Math.round(T.kmh[0] + rnd() * (T.kmh[1] - T.kmh[0])),
      frames: Math.round(T.frames[0] + rnd() * (T.frames[1] - T.frames[0])),
      tx,
      ty,
      ball,
      gold: false,
    };
    list.push(p);
    if (!ball) strikes++;
  }
  // 잭팟 볼: 정해진 순서의 스트라이크 하나
  const strikesOnly = list.filter((p) => !p.ball);
  strikesOnly[Math.min(K.GOLD_AT, strikesOnly.length - 1)].gold = true;
  // CHANCES 번째 스트라이크까지만 쓴다
  return list.slice(0, strikesOnly[K.CHANCES - 1].id + 1);
}

// 공 위치 (p: 0 = 손에서 떠남, 1 = 홈 플레이트, 1 넘으면 포수 미트 쪽)
export function pitchPos(pt, p) {
  const T = PITCH_TYPES[pt.typeId];
  const x0 = -0.32;
  const y0 = 1.85;
  const z0 = CONFIG.MOUND - 1.4;
  const x = x0 + (pt.tx - x0) * p + T.breakX * (Math.pow(p, T.k) - p);
  const y = y0 + (pt.ty - y0) * p + T.drop * 2 * (p - p * p);
  const z = z0 * (1 - p);
  return { x, y, z };
}

// 중계 화면 투영
export function project(x, y, z) {
  const d = Math.max(0.3, z + CONFIG.CAM_BACK);
  const s = CONFIG.FOCAL / d;
  return { sx: CONFIG.WIDTH / 2 + x * s, sy: CONFIG.HORIZON - (y - CONFIG.CAM_H) * s, s };
}

// 홈 플레이트 높이의 1m = 몇 px
export const PLATE_SCALE = RULES.FOCAL / RULES.CAM_BACK;
export const plateScale = (K = RULES) => K.FOCAL / K.CAM_BACK;

export const SWING_CONTACT = RULES.SWING_CONTACT; // 스윙 시작 후 배트가 공 자리에 오는 프레임

// ---- 맞았을 때 타구 계산 (같은 입력이면 언제나 같은 결과) ----
//  dt: 타이밍 (프레임, - = 빠름) / dx: 배트 - 공 (px, + = 배트가 공 오른쪽)
export function makeHit(pt, dt, dx, K = RULES) {
  const qx = 1 - Math.abs(dx) / K.HIT_DX;
  const qt = 1 - Math.abs(dt) / K.HIT_DT;
  const q = Math.max(0, Math.pow(Math.max(0, qx), 0.8) * (0.55 + 0.45 * qt));
  const v0 = K.EXIT_MIN + (K.EXIT_MAX - K.EXIT_MIN) * q + (pt.kmh - 130) * 0.06;
  // 발사각: 배트가 공 가운데면 26도 · 오른쪽으로 빗맞으면 뜬공, 왼쪽이면 땅볼
  const angle = 26 + (dx / K.HIT_DX) * 38;
  // 방향: 일찍 치면 당겨서 왼쪽, 늦으면 밀어서 오른쪽
  const dir = (dt / K.HIT_DT) * 52;
  const hit = { v0, angle, dir, q, gold: !!pt.gold, result: '', dist: 0, hang: 0, ground: false, fence: null, fielder: null };
  judgeHit(hit, K);
  return hit;
}

// 펜스까지 거리 (방향에 따라)
export function fenceAt(dir, K = RULES) {
  return K.FENCE_LINE + (K.FENCE_CENTER - K.FENCE_LINE) * Math.cos((dir * 2 * Math.PI) / 180);
}

// 수비수 자리 (방향 도, 거리 m)
export const FIELDERS = [
  { id: 'LF', dir: -28, r: 82, of: true },
  { id: 'CF', dir: 0, r: 94, of: true },
  { id: 'RF', dir: 28, r: 82, of: true },
  { id: 'SS', dir: -14, r: 36 },
  { id: '2B', dir: 15, r: 37 },
  { id: '3B', dir: -36, r: 29 },
  { id: '1B', dir: 37, r: 29 },
  { id: 'P', dir: 0, r: 18 },
];
export const fielderById = (id) => FIELDERS.find((f) => f.id === id) || null;

export function polar(dir, r) {
  const a = (dir * Math.PI) / 180;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

// 타구 판정. h.fielder 는 잡으러 가는 수비수 id (서버와 같은 모양으로 주고받기 위해 id 만 담는다)
export function judgeHit(h, K = RULES) {
  const a = (h.angle * Math.PI) / 180;
  if (Math.abs(h.dir) > 45) {
    h.result = 'foul';
    h.dist = Math.max(20, (h.v0 * h.v0 * Math.abs(Math.sin(2 * a)) / K.GRAV) * K.DRAG * 0.6);
    h.hang = Math.max(0.8, ((2 * h.v0 * Math.max(0.2, Math.sin(a))) / K.GRAV) * 0.9);
    h.ground = h.angle < 8;
    return h;
  }
  if (h.angle < 8) {
    // 땅볼: 빠르고 수비 사이로 가면 안타
    h.ground = true;
    h.dist = 30 + h.v0 * 1.2;
    h.hang = h.dist / (h.v0 * 0.7);
    const gap = Math.min(...FIELDERS.filter((f) => !f.of).map((f) => Math.abs(f.dir - h.dir)));
    h.result = h.v0 > 37 && gap > 7 ? 'single' : 'ground';
    h.fielder = nearestFielder(h, false).id;
    return h;
  }
  h.ground = false;
  h.dist = ((h.v0 * h.v0 * Math.sin(2 * a)) / K.GRAV) * K.DRAG;
  h.hang = ((2 * h.v0 * Math.sin(a)) / K.GRAV) * 0.9;
  h.fence = fenceAt(h.dir, K);
  if (h.angle > 52) {
    h.result = 'pop';
    h.fielder = nearestFielder(h, false).id;
    return h;
  }
  if (h.dist > h.fence && h.angle >= 14) {
    h.result = 'hr';
    return h;
  }
  if (h.dist > h.fence) h.dist = h.fence - 2; // 낮은 총알 타구는 펜스 맞고 떨어짐
  // 외야수가 따라가서 잡을 수 있나
  const land = polar(h.dir, h.dist);
  const f = nearestFielder(h, h.dist > 42);
  const fp = polar(f.dir, f.r);
  const need = Math.hypot(land.x - fp.x, land.z - fp.z);
  const reach = K.FIELDER_RUN * h.hang + (f.of ? 4 : 2);
  h.fielder = f.id;
  if (need <= reach && !(h.dist < 42 && h.angle < 20)) h.result = h.dist < 42 ? 'pop' : 'fly';
  else h.result = h.dist < 70 ? 'single' : h.dist < h.fence - 10 ? 'double' : 'triple';
  return h;
}

export function nearestFielder(h, outfield) {
  const land = polar(h.dir, h.ground ? Math.min(h.dist, 40) : h.dist);
  let best = null;
  let bd = Infinity;
  for (const f of FIELDERS) {
    if (outfield && !f.of) continue;
    const p = polar(f.dir, f.r);
    const d = Math.hypot(land.x - p.x, land.z - p.z);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

// 1루 · 주자 · 송구 (타구 화면 속도 기준, m/프레임)
export const BASE_DIST = RULES.BASE_DIST;
export const BASE1 = { x: BASE_DIST / Math.SQRT2, z: BASE_DIST / Math.SQRT2 };
export const RUN_SPEED = (RULES.RUN_MPS * RULES.FLIGHT_SPEED) / 60;     // 타자 달리기
export const THROW_SPEED = (RULES.THROW_MPS * RULES.FLIGHT_SPEED) / 60; // 내야 송구
export const FIELD_PAUSE = RULES.FIELD_PAUSE;                           // 잡고 나서 던지기까지

// 점을 목표로 한 걸음 (움직였으면 true)
export function stepToward(p, tgt, sp) {
  const dx = tgt.x - p.x;
  const dz = tgt.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d <= sp) {
    p.x = tgt.x;
    p.z = tgt.z;
    return d > 0.01;
  }
  p.x += (dx / d) * sp;
  p.z += (dz / d) * sp;
  return true;
}

export function hitPoints(h, K = RULES) {
  let pts = 0;
  if (h.result === 'hr') pts = Math.round(h.dist);
  else pts = K.POINTS[h.result] || 0;
  return h.gold ? pts * K.GOLD_MULT : pts;
}

// 타구 연출 길이(프레임): [맞은 뒤 결과 글자가 뜰 때까지, 연출이 끝날 때까지]
//  서버는 이 값으로 "모두의 연출이 끝나는 시각"을 정해 다음 공을 던진다 (net/Flight.js 의 연출과 맞춘 계산)
export function flightFrames(h, K = RULES) {
  const dur = Math.max(K.FLIGHT_MIN, Math.round((h.hang * 60) / K.FLIGHT_SPEED));
  let shown = K.FLIGHT_HOLD + dur;
  if (h.ground && h.result === 'ground') {
    const b = K.BASE_DIST / Math.SQRT2;
    const f = polar(h.dir, Math.min(h.dist, 38));
    const to = Math.hypot(b - f.x, b - f.z);
    const run = (K.RUN_MPS * K.FLIGHT_SPEED) / 60;
    const thr = (K.THROW_MPS * K.FLIGHT_SPEED) / 60;
    if (h.fielder === '1B') shown += Math.ceil(to / run) + 1;
    else shown += K.FIELD_PAUSE + Math.max(14, Math.ceil(to / thr));
  }
  return [shown, shown + K.RESULT_TIME];
}
