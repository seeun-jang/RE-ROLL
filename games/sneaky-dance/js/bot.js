// =====================================================
// CPU 학생 (개인 화면의 CPU 4명 + 자동 시연)
//  교수님이 칠판에 쓰기 시작하면 → 잠깐 뒤 춤 시작
//  낌새(분필 멈춤 · 흠흠)가 보이면 → 반응 시간 뒤 멈춤 (실력이 낮으면 늦게 멈춰서 걸림)
//  자신 있으면 쓰기 초반에 큰 춤
// =====================================================
class DanceBot {
  constructor(skill) {
    this.skill = skill;
    this.react = 0;
    this.alertT = 0;
    this.startDelay = 0;
    this.seenState = null;
    this.big = false;
  }

  // s: 학생, tc: 교수님 → { left, right, skillHeld }
  think(s, tc) {
    const out = { left: false, right: false, skillHeld: false, skillPressed: false };
    if (s.out || s.punishT > 0) return out;
    const sk = this.skill;
    if (tc.state !== this.seenState) {
      const prev = this.seenState;
      this.seenState = tc.state;
      if (tc.state === 'write') {
        this.startDelay = Math.round(8 + Math.random() * 30 + (1 - sk) * 20);
        this.big = Math.random() < 0.1 + sk * 0.45;
      }
      // 첫 낌새(또는 갑작스런 돌아봄)부터 반응 시간을 잼 (낌새 → 돌아봄으로 넘어가도 이어서)
      if ((tc.state === 'tell' || tc.state === 'turn') && prev === 'write') {
        this.react = Math.round(4 + (1 - sk) * 14 + Math.random() * 8);
        this.alertT = 0;
      }
    }
    if (tc.state === 'tell' || tc.state === 'turn') this.alertT++;
    if (tc.state === 'write') {
      if (tc.t < this.startDelay) return out;
      // 큰 춤은 쓰기 시작하고 한동안만 (오래 쓸수록 위험)
      const bold = this.big && tc.t < 60 + sk * 50;
      if (bold) out.right = true;
      else out.skillHeld = true;
      return out;
    }
    // 낌새 · 갑자기 돌아봄: 반응 시간 동안은 계속 춤춤 (못 알아챔)
    if ((tc.state === 'tell' || tc.state === 'turn') && this.alertT < this.react && s.mode !== 'none') {
      if (s.mode === 'big' || s.mode === 'recover') out.right = true;
      else out.skillHeld = true;
    }
    return out;
  }
}
