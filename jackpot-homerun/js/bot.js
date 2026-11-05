// =====================================================
// CPU 타자: 공이 올 자리로 배트를 옮기고, 들어올 때 스윙
//  실력이 낮을수록 위치 · 타이밍이 흔들리고, 볼에도 방망이가 나감
// =====================================================
class BatBot {
  constructor(skill, rng = Math.random) {
    this.skill = skill;
    this.rng = rng;
    this.plan = null;
  }

  gauss() {
    return (this.rng() + this.rng() + this.rng() - 1.5) * 1.4;
  }

  // ab: AtBat → { left, right, swing }
  think(ab) {
    const s = this.skill;
    const pt = ab.pitch;
    if (!pt) return {};
    if (ab.phase === 'windup') this.plan = null;
    if (ab.phase === 'pitch' && !this.plan) {
      // 공을 보고 판단 (변화구일수록 위치가 더 흔들림)
      const breakErr = Math.abs(PITCH_TYPES[pt.typeId].breakX) * 18;
      this.plan = {
        x: pt.tx * PLATE_SCALE + this.gauss() * ((1 - s) * 9 + breakErr * (1 - s * 0.6)),
        at: pt.frames - SWING_CONTACT + Math.round(this.gauss() * ((1 - s) * 7 + 1.2)),
        go: !pt.ball || this.rng() < (1 - s) * 0.7,
      };
    }
    const target = this.plan ? this.plan.x : 0;
    const d = target - ab.batX;
    return {
      left: d < -1.2,
      right: d > 1.2,
      swing: !!(this.plan && this.plan.go && ab.phase === 'pitch' && ab.t >= this.plan.at && ab.swingT < 0),
    };
  }
}
