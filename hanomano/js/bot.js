// =====================================================
// CPU 플레이어 (개인 화면의 상대 4명 / 자동 시연)
//  - 펼친 카드가 바뀔 때마다 과일 수를 세고, 5개면 반응 시간 뒤에 종
//  - 4개나 6개처럼 아슬아슬하면 가끔 헷갈려서 틀리게 침
// =====================================================
class BellBot {
  constructor(skill = 0.8) {
    this.skill = skill;
    this.sig = '';
    this.ringAt = null;
    this.flipAt = null;
  }

  wantsBell(scene, p) {
    const tops = scene.tops;
    const sig = tops.map((c) => (c ? c.fruit + ':' + c.n : '-')).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.ringAt = null;
      const [a, b] = CONFIG.CPU_REACTION;
      const react = Math.round(a + Math.random() * (b - a) * (1.6 - this.skill));
      if (bellIsRight(tops)) this.ringAt = scene.frame + react;
      else if (fruitTotals(tops).some((v) => v === CONFIG.TARGET - 1 || v === CONFIG.TARGET + 1) && Math.random() < CONFIG.CPU_MISTAKE * 4) {
        this.ringAt = scene.frame + react + 6;
      }
    }
    if (this.ringAt !== null && scene.frame >= this.ringAt) {
      this.ringAt = null;
      return true;
    }
    return false;
  }

  wantsFlip(scene, p) {
    if (this.flipAt === null) this.flipAt = scene.frame + 18 + Math.round(Math.random() * 30);
    if (scene.frame >= this.flipAt) {
      this.flipAt = null;
      return true;
    }
    return false;
  }
}
