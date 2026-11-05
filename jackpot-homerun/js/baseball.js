// =====================================================
// 야구 규칙: 투구 목록 · 공 궤적 · 맞았나 · 타구가 어디로 · 점수
//  좌표(m): x = 오른쪽(+) / y = 높이 / z = 홈 플레이트에서 투수 쪽으로
//  타구 방향 dir(도): 0 = 가운데, - = 3루(왼쪽), + = 1루(오른쪽) · 45도 넘으면 파울
// =====================================================
const PITCH_TYPES = {
  fast: { name: '직구', kmh: [142, 153], frames: [30, 34], breakX: 0, drop: 0.08, k: 2 },
  slider: { name: '슬라이더', kmh: [128, 137], frames: [36, 40], breakX: 0.28, drop: 0.1, k: 4 },
  curve: { name: '커브', kmh: [108, 119], frames: [44, 49], breakX: -0.2, drop: 0.5, k: 2 },
  change: { name: '체인지업', kmh: [118, 127], frames: [41, 45], breakX: 0.08, drop: 0.22, k: 3 },
};
const PITCH_ORDER = ['fast', 'slider', 'curve', 'change'];

// 결과 이름 · 색
const HIT_LOOK = {
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

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dateSeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// 모든 타자가 받을 같은 공 순서 (스트라이크 CHANCES 개 + 사이사이 볼)
function makePitches(seed) {
  const rnd = mulberry32(seed);
  const Z = CONFIG.ZONE;
  const list = [];
  let strikes = 0;
  while (strikes < CONFIG.CHANCES + 2) {
    const typeId = PITCH_ORDER[Math.floor(rnd() * PITCH_ORDER.length)];
    const T = PITCH_TYPES[typeId];
    const ball = list.length > 0 && strikes < CONFIG.CHANCES && rnd() < 0.28;
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
  strikesOnly[Math.min(CONFIG.GOLD_AT, strikesOnly.length - 1)].gold = true;
  return list;
}

// 공 위치 (p: 0 = 손에서 떠남, 1 = 홈 플레이트, 1 넘으면 포수 미트 쪽)
function pitchPos(pt, p) {
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
function project(x, y, z) {
  const d = Math.max(0.3, z + CONFIG.CAM_BACK);
  const s = CONFIG.FOCAL / d;
  return { sx: CONFIG.WIDTH / 2 + x * s, sy: CONFIG.HORIZON - (y - CONFIG.CAM_H) * s, s };
}

// 홈 플레이트 높이의 1m = 몇 px
const PLATE_SCALE = CONFIG.FOCAL / CONFIG.CAM_BACK;

const SWING_CONTACT = 6; // 스윙 시작 후 배트가 공 자리에 오는 프레임

// ---- 맞았을 때 타구 계산 (같은 입력이면 언제나 같은 결과) ----
//  dt: 타이밍 (프레임, - = 빠름) / dx: 배트 - 공 (px, + = 배트가 공 오른쪽)
function makeHit(pt, dt, dx) {
  const K = CONFIG;
  const qx = 1 - Math.abs(dx) / K.HIT_DX;
  const qt = 1 - Math.abs(dt) / K.HIT_DT;
  const q = Math.max(0, Math.pow(qx, 0.8) * (0.55 + 0.45 * qt));
  const v0 = K.EXIT_MIN + (K.EXIT_MAX - K.EXIT_MIN) * q + (pt.kmh - 130) * 0.06;
  // 발사각: 배트가 공 가운데면 26도 · 오른쪽으로 빗맞으면 뜬공, 왼쪽이면 땅볼
  const angle = 26 + (dx / K.HIT_DX) * 38;
  // 방향: 일찍 치면 당겨서 왼쪽, 늦으면 밀어서 오른쪽
  const dir = (dt / K.HIT_DT) * 52;
  const hit = { v0, angle, dir, q, gold: pt.gold };
  judgeHit(hit);
  return hit;
}

// 펜스까지 거리 (방향에 따라)
function fenceAt(dir) {
  const K = CONFIG;
  return K.FENCE_LINE + (K.FENCE_CENTER - K.FENCE_LINE) * Math.cos((dir * 2 * Math.PI) / 180);
}

// 수비수 자리 (방향 도, 거리 m)
const FIELDERS = [
  { id: 'LF', dir: -28, r: 82, of: true },
  { id: 'CF', dir: 0, r: 94, of: true },
  { id: 'RF', dir: 28, r: 82, of: true },
  { id: 'SS', dir: -14, r: 36 },
  { id: '2B', dir: 15, r: 37 },
  { id: '3B', dir: -36, r: 29 },
  { id: '1B', dir: 37, r: 29 },
  { id: 'P', dir: 0, r: 18 },
];
function polar(dir, r) {
  const a = (dir * Math.PI) / 180;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

function judgeHit(h) {
  const K = CONFIG;
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
    h.fielder = nearestFielder(h, false);
    return h;
  }
  h.ground = false;
  h.dist = ((h.v0 * h.v0 * Math.sin(2 * a)) / K.GRAV) * K.DRAG;
  h.hang = ((2 * h.v0 * Math.sin(a)) / K.GRAV) * 0.9;
  h.fence = fenceAt(h.dir);
  if (h.angle > 52) {
    h.result = 'pop';
    h.fielder = nearestFielder(h, false);
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
  h.fielder = f;
  if (need <= reach && !(h.dist < 42 && h.angle < 20)) h.result = h.dist < 42 ? 'pop' : 'fly';
  else h.result = h.dist < 70 ? 'single' : h.dist < h.fence - 10 ? 'double' : 'triple';
  return h;
}

function nearestFielder(h, outfield) {
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
const BASE_DIST = 27.43;
const BASE1 = { x: BASE_DIST / Math.SQRT2, z: BASE_DIST / Math.SQRT2 };
const RUN_SPEED = (7 * CONFIG.FLIGHT_SPEED) / 60;     // 타자 달리기
const THROW_SPEED = (30 * CONFIG.FLIGHT_SPEED) / 60;  // 내야 송구
const FIELD_PAUSE = 10;                               // 잡고 나서 던지기까지

// 점을 목표로 한 걸음 (움직였으면 true)
function stepToward(p, tgt, sp) {
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

function hitPoints(h) {
  let pts = 0;
  if (h.result === 'hr') pts = Math.round(h.dist);
  else pts = CONFIG.POINTS[h.result] || 0;
  return h.gold ? pts * CONFIG.GOLD_MULT : pts;
}

// =====================================================
// AtBat: 타자 한 명의 타석 (투구 → 스윙 → 판정 반복)
//  update(inp) 를 매 프레임 · 맞으면 phase 'hit' 에서 기다림 → resolve() 로 다음 공
//  inp: { left, right, swing }
// =====================================================
class AtBat {
  constructor(pitches) {
    this.pitches = pitches;
    this.idx = 0;
    this.chances = CONFIG.CHANCES;
    this.batX = 0; // 배트 위치 (존 가운데에서 px)
    this.phase = 'windup';
    this.t = 0;
    this.swingT = -1;
    this.events = [];
    this.log = []; // 공마다 결과
    this.total = 0;
    this.hr = 0;
    this.longest = 0;
    this.hits = 0;
    this.done = false;
    this.hit = null;
  }

  get pitch() {
    return this.pitches[this.idx];
  }

  // 공의 지금 위치 (투구 중일 때)
  ballP() {
    return this.phase === 'pitch' ? this.t / this.pitch.frames : null;
  }

  update(inp) {
    if (this.done) return;
    const K = CONFIG;
    // 배트 옮기기 (언제나)
    if (inp.left) this.batX -= K.BAT_SPEED;
    if (inp.right) this.batX += K.BAT_SPEED;
    this.batX = Math.max(-K.BAT_RANGE, Math.min(K.BAT_RANGE, this.batX));
    this.t++;
    if (this.phase === 'windup') {
      if (this.t >= K.WINDUP) {
        this.phase = 'pitch';
        this.t = 0;
        this.swingT = -1;
        this.events.push({ type: 'release', pitch: this.pitch });
      }
      return;
    }
    if (this.phase === 'pitch') {
      const pt = this.pitch;
      if (inp.swing && this.swingT < 0) {
        this.swingT = this.t;
        this.events.push({ type: 'swing' });
      }
      // 배트가 공 자리에 온 순간 판정
      if (this.swingT >= 0 && this.t === this.swingT + SWING_CONTACT) {
        const dt = this.t - pt.frames;
        const dx = this.batX - pt.tx * PLATE_SCALE;
        if (Math.abs(dt) <= K.HIT_DT && Math.abs(dx) <= K.HIT_DX) {
          this.hit = makeHit(pt, dt, dx);
          this.phase = 'hit';
          this.events.push({ type: 'contact', hit: this.hit, dt, dx });
          return;
        }
      }
      // 공이 미트에 들어감
      if (this.t === pt.frames + 6) {
        this.events.push({ type: 'mitt' });
        const res = this.swingT >= 0 ? 'miss' : pt.ball ? 'ball' : 'strike';
        this.finish(res, null);
      }
      return;
    }
    if (this.phase === 'after') {
      if (this.t >= K.AFTER) this.next();
    }
  }

  // 타구 연출이 끝나면 (또는 바로) 결과 기록
  resolve() {
    if (this.phase !== 'hit') return;
    this.finish(this.hit.result, this.hit);
  }

  finish(result, hit) {
    const pt = this.pitch;
    const pts = hit ? hitPoints(hit) : 0;
    if (result !== 'ball') this.chances--;
    this.total += pts;
    if (result === 'hr') {
      this.hr++;
      this.longest = Math.max(this.longest, Math.round(hit.dist));
    }
    if (['hr', 'triple', 'double', 'single'].includes(result)) this.hits++;
    this.log.push({ result, pts, gold: pt.gold, dist: hit ? Math.round(hit.dist) : 0, tx: pt.tx, ty: pt.ty, swung: this.swingT >= 0 });
    this.events.push({ type: 'call', result, pts, hit, pitch: pt });
    this.phase = 'after';
    this.t = 0;
  }

  next() {
    this.idx++;
    this.hit = null;
    if (this.chances <= 0 || this.idx >= this.pitches.length) {
      this.done = true;
      this.events.push({ type: 'done' });
      return;
    }
    this.phase = 'windup';
    this.t = 0;
  }
}
