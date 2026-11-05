// =====================================================
// CPU 손님 (개인 화면의 CPU 4명 + 자동 시연)
//  위가 비어 있는(다른 인형에 안 깔린) 인형 중 점수가 높은 걸 골라
//  그 위로 집게를 옮기고 내림. skill 0~1: 높을수록 정확하게 가운데를 노림
// =====================================================
class ClawBot {
  constructor(skill) {
    this.skill = skill;
    this.plan = null;
  }

  // 위에 다른 인형이 덮고 있지 않은 인형
  static exposed(m) {
    return m.prizes.filter((p) => p.x > CONFIG.BOX.HOLE_W && !m.prizes.some((q) => q !== p && q.y < p.y - 2 && Math.abs(q.x - p.x) < q.r + p.r - 3));
  }

  // m: Machine → 이번 프레임 입력 { left, right, drop }
  think(m) {
    const out = { left: false, right: false, drop: false };
    const c = m.claw;
    if (c.state !== 'move') {
      this.plan = null;
      return out;
    }
    if (!this.plan) {
      const s = this.skill;
      const list = ClawBot.exposed(m);
      // 점수 높고 가벼운 걸 좋아함 (+ 약간의 변덕)
      list.sort((a, b) => b.value / Math.pow(b.weight, 1.5) + Math.random() * (4 + (1 - s) * 30) - (a.value / Math.pow(a.weight, 1.5) + Math.random() * (4 + (1 - s) * 30)));
      const tg = list[0] || m.prizes[0];
      this.plan = {
        x: tg ? tg.x + (Math.random() - 0.5) * (1 - s) * 22 : 30,
        wait: 15 + Math.floor(Math.random() * 40),
      };
    }
    const P = this.plan;
    if (P.wait > 0) {
      P.wait--;
      return out;
    }
    const dx = P.x - c.x;
    if (Math.abs(dx) > CONFIG.CLAW.MOVE) {
      out.left = dx < 0;
      out.right = dx > 0;
    } else out.drop = true;
    return out;
  }
}
