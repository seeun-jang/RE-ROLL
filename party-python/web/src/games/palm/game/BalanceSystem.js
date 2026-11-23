// =============================================================
// BalanceSystem.js — 균형 게이지 물리
//   BalanceBody : 한 캐릭터의 균형(위치 b, 속도 v). +는 앞(상대 쪽), -는 뒤.
//   SwayField   : 받침대 흔들림 힘 생성기 (시드 고정 → 모든 도전자가 같은 조건)
// =============================================================
import { clamp, createRng } from '../util.js';

export class BalanceBody {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.b = 0; // 균형 위치 (-100 ~ 100)
    this.v = 0; // 균형 속도
    this.lastImpulse = 0; // 직전에 받은 충격량 (연출용)
  }

  // 순간 충격 (밀림/헛손질 등). +면 앞으로 쏠림
  applyImpulse(amount) {
    this.v += amount;
    this.lastImpulse = amount;
  }

  // dt 프레임만큼 적분. force = 이번 프레임에 작용하는 모든 힘(입력+흔들림+차지 쏠림)의 합
  step(dt, force) {
    const B = this.cfg.BALANCE;
    // 자연 복원력: 중앙(0) 근처에서는 약하게 되돌아오지만(RECOVER),
    // 많이 기울수록 넘어지려는 힘(TIP)이 커져서 |균형| 50 부근부터는 스스로 더 기운다
    const restore = this.b * ((B.TIP * Math.abs(this.b)) / B.LIMIT - B.RECOVER);
    this.v += (force + restore) * dt;
    // 감쇠: dt가 1이 아닐 때(슬로모션)도 같은 궤적이 되도록 거듭제곱
    this.v *= Math.pow(B.DAMPING, dt);
    this.v = clamp(this.v, -B.MAX_SPEED, B.MAX_SPEED);
    this.b += this.v * dt;
  }

  // 남은 균형 (0~100): 중앙에 가까울수록 높다 — 점수/판정용
  get stability() {
    return clamp(this.cfg.BALANCE.LIMIT - Math.abs(this.b), 0, this.cfg.BALANCE.LIMIT);
  }

  get fallen() {
    return Math.abs(this.b) >= this.cfg.BALANCE.LIMIT;
  }
}

// 받침대 흔들림: 서로 다른 주기의 사인파 2개 + 부드러운 무작위 성분
export class SwayField {
  constructor(cfg, seed) {
    this.cfg = cfg;
    this.rng = createRng(seed);
    this.p1 = this.rng() * Math.PI * 2;
    this.p2 = this.rng() * Math.PI * 2;
    this.w1 = 0.006 + this.rng() * 0.004; // 라디안/프레임 — 느린 쏠림 (주기 10~17초)
    this.w2 = 0.025 + this.rng() * 0.012; // 빠른 출렁임
    this.noise = 0;
  }

  // t: 경과 프레임, 반환: 이번 프레임의 흔들림 힘
  force(t, dt = 1) {
    const B = this.cfg.BALANCE;
    // 무작위 성분은 천천히 변하도록 (저역 통과)
    this.noise += ((this.rng() * 2 - 1) - this.noise) * 0.05 * dt;
    const amp = B.SWAY_BASE + B.SWAY_GROWTH * this.growth(t);
    return amp * (Math.sin(t * this.w1 + this.p1) * 0.65 + Math.sin(t * this.w2 + this.p2) * 0.35) + this.noise * B.SWAY_NOISE;
  }

  // 받침대 흔들림 정도 0~1 (WOBBLE_START 초 이후 시간이 갈수록 커짐)
  growth(t) {
    const M = this.cfg.MATCH;
    const sec = t / this.cfg.SCREEN.LOGIC_FPS;
    return clamp((sec - M.WOBBLE_START) / Math.max(1, M.TIME_LIMIT - M.WOBBLE_START), 0, 1);
  }
}
