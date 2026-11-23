// =====================================================
// CPU 사수 (개인 화면의 CPU 4명 + 자동 시연)
//  표적이 올라오면 → 잠깐 반응 → 방향키로 조준점을 표적에 옮김 → 숨 고르고 → 발사
//  skill 0~1: 높을수록 빠르고 정확
// =====================================================
class RangeBot {
  constructor(skill) {
    this.skill = skill;
    this.plan = null;
  }

  // lane: 사로 상태, scene: 지금 표적 정보 → 이번 프레임 입력
  think(lane, scene) {
    const out = { left: false, right: false, up: false, down: false, skillPressed: false, skillHeld: false };
    const tg = scene.target;
    const can = scene.phase === 'fire' && tg && lane.hitK !== scene.k && lane.reloadT === 0 && lane.mag > 0 && (scene.tPhase === 'rise' || scene.tPhase === 'up');
    if (!can) {
      if (!tg || scene.tPhase === 'gap') this.plan = null;
      return out;
    }
    const s = this.skill;
    if (!this.plan || this.plan.k !== scene.k) {
      const D = CONFIG.DISTANCES[tg.dist];
      this.plan = {
        k: scene.k,
        x: tg.x + (Math.random() - 0.5) * (1 - s) * D.w * 2.8,
        y: D.y - D.h * 0.55 + (Math.random() - 0.5) * (1 - s) * D.h * 2.4,
        wait: 12 + Math.floor(Math.random() * (60 - s * 40)),
        settle: Math.floor(4 + Math.random() * 30 * s), // 숨 고르는 시간 (잘 쏘는 사람일수록 기다림)
      };
    }
    const P = this.plan;
    if (P.wait > 0) {
      P.wait--;
      return out;
    }
    const dx = P.x - lane.ax;
    const dy = P.y - lane.ay;
    if (Math.abs(dx) > CONFIG.AIM_SPEED_X) {
      out.left = dx < 0;
      out.right = dx > 0;
    }
    if (Math.abs(dy) > CONFIG.AIM_SPEED_Y) {
      out.up = dy < 0;
      out.down = dy > 0;
    }
    if (out.left || out.right || out.up || out.down) return out;
    if (P.settle-- > 0 || lane.kick > 0.5) return out;
    out.skillPressed = true;
    P.settle = 25; // 빗나가면 다시 숨 고르고 한 발 더
    return out;
  }
}
