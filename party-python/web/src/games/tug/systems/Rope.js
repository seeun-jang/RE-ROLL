// =============================================================
// Rope — 두 팀의 힘 → 줄 이동 물리
//
// pos: px, 0 = 중앙. 음수 = 왼쪽(빨강) 팀 쪽으로 끌려옴.
// 팀 힘은 입력이 들어올 때 addForce 로 쌓이고 지수적으로 감쇠한다(연타를 멈추면 힘이 빠짐).
// 속도 = (오른쪽 힘 - 왼쪽 힘) × ROPE_SPEED, ±ROPE_MAX_SPEED 로 제한.
// =============================================================

/** 줄 튕김(wobble) 진동 각속도 (rad/s) */
const WOBBLE_FREQ = 28;
/** 줄 튕김 진폭 감쇠율 (1/s) */
const WOBBLE_DECAY = 7;
/** 줄 튕김 최대 진폭 (px) */
const WOBBLE_MAX = 4;
/** 승리 선 너머로 줄이 더 갈 수 있는 여유 (px) — 그리기가 화면 밖으로 튀지 않게 */
const POS_OVERSHOOT = 16;

export class Rope {
  constructor(config) {
    this.config = config;
    this.winDistance = config.WIN_DISTANCE;
    this.reset();
  }

  /** pos=0, vel=0, 힘 0, wobble 0 */
  reset() {
    this.pos = 0;
    this.vel = 0;
    this.leftForce = 0;
    this.rightForce = 0;
    this.wobble = 0;
    this.wobbleAmp = 0;
    this.wobblePhase = 0;
  }

  /** side 팀에 힘 추가 */
  addForce(side, amount) {
    if (!Number.isFinite(amount)) return;
    if (side === 'left') this.leftForce += amount;
    else if (side === 'right') this.rightForce += amount;
  }

  update(dt) {
    const cfg = this.config;
    // 1) 힘 지수 감쇠
    const decay = Math.exp(-cfg.FORCE_DECAY * dt);
    this.leftForce *= decay;
    this.rightForce *= decay;
    // 2) 힘 차이 → 속도 (오른쪽 힘이 크면 +, 왼쪽 힘이 크면 -)
    const raw = (this.rightForce - this.leftForce) * cfg.ROPE_SPEED;
    const max = cfg.ROPE_MAX_SPEED;
    this.vel = raw > max ? max : raw < -max ? -max : raw;
    // 3) 위치 적분 (승리선 너머 약간까지만)
    const limit = this.winDistance + POS_OVERSHOOT;
    this.pos += this.vel * dt;
    if (this.pos > limit) this.pos = limit;
    if (this.pos < -limit) this.pos = -limit;
    // 4) 줄 튕김: 감쇠 진동
    this.wobbleAmp *= Math.exp(-WOBBLE_DECAY * dt);
    if (this.wobbleAmp < 0.05) this.wobbleAmp = 0;
    this.wobblePhase += WOBBLE_FREQ * dt;
    this.wobble = this.wobbleAmp * Math.cos(this.wobblePhase);
  }

  /** 줄 튕김 (Perfect 연출) */
  kick(amount = 2) {
    this.wobbleAmp = Math.min(WOBBLE_MAX, this.wobbleAmp + amount);
    this.wobblePhase = 0;
    this.wobble = this.wobbleAmp;
  }

  /** 'left' | 'right' | null — 표식이 진영 선을 넘었나 */
  winner() {
    if (this.pos <= -this.winDistance) return 'left';
    if (this.pos >= this.winDistance) return 'right';
    return null;
  }

  /** 시간 종료용 우세 팀. DRAW_EPSILON 안이면 null (무승부) */
  leader() {
    const eps = this.config.DRAW_EPSILON;
    if (this.pos < -eps) return 'left';
    if (this.pos > eps) return 'right';
    return null;
  }
}
