// =====================================================
// CPU 볼러 (개인 화면의 CPU 4명 + 자동 시연)
//  - 핀 10개면 포켓(1번 핀 살짝 옆)을, 남은 핀이 있으면 그 가운데를 노림
//  - 위치 옮기기 → 화살표가 목표 방향에 오면 멈춤 → 힘 게이지가 목표에 오면 멈춤
//  skill 0~1: 높을수록 정확
// =====================================================
class BowlBot {
  constructor(skill) {
    this.skill = skill;
    this.plan = null;
    this.wait = 0;
  }

  // 새 투구 계획
  newPlan(rack) {
    const L = CONFIG.LANE;
    const s = this.skill;
    const up = rack.pins.filter((p) => p.up && !p.gone);
    let target;
    if (up.length === 10) target = (Math.random() < 0.5 ? -1 : 1) * 2.2;
    else target = up.reduce((a, p) => a + p.x, 0) / Math.max(1, up.length);
    target += (Math.random() - 0.5) * (1 - s) * 14;
    let startX = Math.max(-12, Math.min(12, (Math.random() - 0.5) * 16));
    // 화살표 각도 한계 안에서 닿을 수 있게 출발 위치 조정
    const maxA = CONFIG.AIM_MAX * 0.85;
    let ang = (target - startX) / L.HEAD_Y;
    if (Math.abs(ang) > maxA) {
      startX = target - Math.sign(ang) * maxA * L.HEAD_Y;
      ang = (target - startX) / L.HEAD_Y;
    }
    this.plan = {
      startX,
      angle: ang,
      angleTol: 0.006 + (1 - s) * 0.03,
      power: 0.6 + Math.random() * 0.35,
      powerTol: 0.04 + (1 - s) * 0.2,
    };
    this.wait = 15 + Math.floor(Math.random() * 25); // 사람처럼 잠깐 생각
  }

  // lane: PlayScene 의 레인 상태 → 이번 프레임 입력 { left, right, skillPressed, skillHeld }
  think(lane) {
    const out = { left: false, right: false, skillPressed: false, skillHeld: false };
    if (lane.state === 'aim') {
      if (!this.plan) this.newPlan(lane.rack);
      if (this.wait > 0) {
        this.wait--;
        return out;
      }
      const dx = this.plan.startX - lane.startX;
      if (Math.abs(dx) > CONFIG.MOVE_SPEED) {
        out.left = dx < 0;
        out.right = dx > 0;
      } else if (Math.abs(lane.angle - this.plan.angle) < this.plan.angleTol) out.skillPressed = true;
    } else if (lane.state === 'power') {
      if (Math.abs(lane.power - this.plan.power) < this.plan.powerTol && lane.powerT > 8) out.skillPressed = true;
    } else this.plan = null;
    return out;
  }
}
