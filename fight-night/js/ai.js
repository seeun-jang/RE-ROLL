// =====================================================
// CPU 복서 (개인 화면 모드 3연전 상대)
// level 0~1: 높을수록 상대 펀치를 잘 막고, 거리를 잘 재고, 강펀치를 섞음
// =====================================================
class BoxerAI {
  constructor(level) {
    this.level = level;
    this.think = 0;
    this.plan = 'approach'; // approach | guard | retreat | jab | power | wait
    this.planT = 0;
    this.holdT = 0;
  }

  control(me, opp) {
    const ctrl = { left: false, right: false, skillHeld: false, down: false };
    const dist = Math.abs(opp.x - me.x);
    const fwd = me.facing === 1 ? 'right' : 'left';
    const back = me.facing === 1 ? 'left' : 'right';
    const L = this.level;

    // 상대가 강펀치를 모으거나 휘두르기 시작하면 확률적으로 가드
    const danger = (opp.state === 'charge' && opp.chargeT > 8) || (opp.state === 'punch' && opp.punch.t < 4);
    if (danger && dist < 63 && this.plan !== 'guard' && Math.random() < L * 0.12) {
      this.plan = 'guard';
      this.planT = 18 + Math.floor(Math.random() * 12);
    }

    // 상대 펀치가 막 시작되면 실력에 따라 타이밍 맞춰 가드(슥) 시도
    if (opp.state === 'punch' && opp.punch.t === Math.max(1, CONFIG.PUNCH[opp.punch.kind].startup - 3) && dist < 60 && Math.random() < L * 0.15) {
      this.plan = 'guard';
      this.planT = 10;
    }
    // 카운터 찬스: 바로 잽
    if (me.counterT > 0 && me.canAct && dist < 50 && this.plan !== 'jab') {
      this.plan = 'jab';
      this.planT = 2;
      this.holdT = 0;
    }
    if (--this.think <= 0 && this.planT <= 0) {
      this.think = 8;
      const r = Math.random();
      if (dist > 48) this.plan = r < 0.85 ? 'approach' : 'wait';
      else if (dist < 38) this.plan = r < 0.5 ? 'retreat' : 'jab';
      else if (r < 0.25 + L * 0.35) this.plan = 'jab';
      else if (r < 0.32 + L * 0.45) this.plan = 'power';
      else if (r < 0.6) this.plan = 'wait';
      else this.plan = 'retreat';
      this.planT = this.plan === 'power' ? 28 : this.plan === 'jab' ? 2 : 10 + Math.floor(Math.random() * 14);
      this.holdT = 0;
    }
    this.planT--;

    switch (this.plan) {
      case 'approach':
        ctrl[fwd] = true;
        break;
      case 'retreat':
        ctrl[back] = true;
        break;
      case 'guard':
        ctrl.down = true; // 가드 키
        break;
      case 'jab':
        // 한 프레임 눌렀다 떼기 = 잽
        if (me.canAct && this.holdT === 0) {
          ctrl.skillHeld = true;
          this.holdT = 1;
        }
        break;
      case 'power':
        // 꾹 눌렀다 떼기 = 강펀치 (거리가 멀면 다가가며)
        if (this.holdT < 24 && (me.canAct || me.state === 'charge')) {
          ctrl.skillHeld = true;
          this.holdT++;
        }
        if (dist > 47 && me.state !== 'charge') ctrl[fwd] = true;
        break;
    }
    return ctrl;
  }
}
