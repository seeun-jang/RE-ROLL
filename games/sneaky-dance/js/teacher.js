// =====================================================
// 교수님 AI (그림과 분리 — seed 가 같으면 똑같이 움직임)
//  write(칠판에 쓰기) → tell(낌새: 분필 멈춤 · 흠흠) → turn(돌아봄) → look(반 보기) → back(다시 칠판) → write
//  fake: 낌새만 주고 다시 씀 · sudden: 낌새 없이 갑자기 돌아봄
// =====================================================
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateSeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const lerp = (a, b, k) => a + (b - a) * k;

class Teacher {
  constructor(seed) {
    this.rng = makeRng(seed);
    this.state = 'write';
    this.t = 0;
    this.dur = 160; // 첫 쓰기는 넉넉하게
    this.turnDur = CONFIG.TEACHER.TURN;
    this.sudden = false;
    this.fake = false;
    this.x = 160; // 칠판 앞 위치
    this.goalX = 160;
    this.events = [];
  }

  // k: 수업 진행도 0~1 (갈수록 어려워짐)
  range(pair, k) {
    const lo = lerp(pair[0][0], pair[1][0], k);
    const hi = lerp(pair[0][1], pair[1][1], k);
    return Math.round(lo + this.rng() * (hi - lo));
  }

  set(state, dur) {
    this.state = state;
    this.t = 0;
    this.dur = dur;
    this.events.push({ type: state });
  }

  update(k) {
    const T = CONFIG.TEACHER;
    this.t++;
    if (this.x !== this.goalX) this.x += Math.sign(this.goalX - this.x) * 0.5;
    if (this.state === 'write') {
      if (this.t % 9 === 0) this.events.push({ type: 'chalk' });
      if (this.t >= this.dur) {
        if (this.rng() < lerp(T.SUDDEN[0], T.SUDDEN[1], k)) {
          this.sudden = true;
          this.set('turn', T.SUDDEN_TURN);
        } else {
          this.sudden = false;
          this.fake = this.rng() < lerp(T.FAKE[0], T.FAKE[1], k);
          this.set('tell', this.range(T.TELL, k));
        }
      }
    } else if (this.state === 'tell') {
      if (this.t >= this.dur) {
        if (this.fake) {
          this.set('write', this.range(T.WRITE, k));
          this.events.push({ type: 'fake' });
        } else this.set('turn', T.TURN);
      }
    } else if (this.state === 'turn') {
      if (this.t >= this.dur) this.set('look', this.range(T.LOOK, k));
    } else if (this.state === 'look') {
      if (this.t >= this.dur) this.set('back', 10);
    } else if (this.state === 'back') {
      if (this.t >= this.dur) {
        this.set('write', this.range(T.WRITE, k));
        // 가끔 칠판의 다른 곳으로 옮겨 가며 씀
        if (this.rng() < 0.4) this.goalX = Math.round(110 + this.rng() * 100);
      }
    }
  }

  // 지금 반을 보고 있나 (이때 춤추면 걸림)
  get watching() {
    if (this.state === 'look') return true;
    if (this.state === 'turn') return this.t / this.dur >= CONFIG.TEACHER.SEE_FROM;
    return false;
  }

  // 돌아본 정도 0(칠판) ~ 1(반)
  get facing() {
    if (this.state === 'turn') return this.t / this.dur;
    if (this.state === 'look') return 1;
    if (this.state === 'back') return 1 - this.t / this.dur;
    return 0;
  }
}
