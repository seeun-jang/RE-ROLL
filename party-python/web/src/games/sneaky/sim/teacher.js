// =====================================================
// 교수님 (원본 js/teacher.js 를 ES 모듈로 옮긴 것 — 시험용 진행기 전용)
//  write(칠판에 쓰기) → tell(낌새: 분필 멈춤 · 흠흠) → turn(돌아봄) → look(반 보기) → back(다시 칠판) → write
//  fake: 낌새만 주고 다시 씀 · sudden: 낌새 없이 갑자기 돌아봄
// 실제 게임의 교수님은 서버(server/party/games/sneaky/teacher.py)가 움직인다. AI 수업 계획은 서버에만 있다.
// =====================================================

/** 서버 config.py 의 TEACHER 와 같은 값 */
export const TEACHER = {
  FIRST_WRITE: 160,
  WRITE: [[100, 220], [55, 150]],
  TELL: [[34, 52], [22, 36]],
  TURN: 9,
  SUDDEN_TURN: 26,
  LOOK: [[60, 110], [70, 140]],
  BACK: 10,
  FAKE: [0.15, 0.35],
  SUDDEN: [0.06, 0.2],
  SEE_FROM: 0.55,
};

const lerp = (a, b, k) => a + (b - a) * k;

export class Teacher {
  /** rng: 0 이상 1 미만 난수 함수 */
  constructor(rng) {
    this.rng = rng;
    this.state = 'write';
    this.t = 0;
    this.dur = TEACHER.FIRST_WRITE; // 첫 쓰기는 넉넉하게
    this.sudden = false;
    this.fake = false;
    this.x = 160; // 칠판 앞 위치
    this.goalX = 160;
    this.watchT = 0; // 반을 보기 시작한 뒤 지난 프레임(유예 판정용)
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
    const T = TEACHER;
    this.t++;
    if (this.x !== this.goalX) this.x += Math.sign(this.goalX - this.x) * 0.5;
    if (this.state === 'write') {
      if (this.t >= this.dur) {
        if (this.rng() < lerp(T.SUDDEN[0], T.SUDDEN[1], k)) {
          this.sudden = true;
          this.fake = false;
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
      if (this.t >= this.dur) this.set('back', T.BACK);
    } else if (this.state === 'back') {
      if (this.t >= this.dur) {
        this.set('write', this.range(T.WRITE, k));
        // 가끔 칠판의 다른 곳으로 옮겨 가며 씀
        if (this.rng() < 0.4) this.goalX = Math.round(110 + this.rng() * 100);
      }
    }
    this.watchT = this.watching ? this.watchT + 1 : 0;
  }

  // 지금 반을 보고 있나 (이때 춤추면 걸림)
  get watching() {
    if (this.state === 'look') return true;
    if (this.state === 'turn') return this.t / this.dur >= TEACHER.SEE_FROM;
    return false;
  }
}
