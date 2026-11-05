// =====================================================
// CPU 탁구 선수 (개인 화면 3연전 상대 / 자동 시연)
//  공이 내 쪽으로 오면 어디서 칠지 미리 계산해서 그 자리로 이동하고
//  공이 라켓에 올 즈음 휘두름. level 0~1: 높을수록 빠르고 정확, 찬스볼에 스매시
// =====================================================
class PaddleAI {
  constructor(level) {
    this.level = level;
    this.plan = null;     // { x(설 자리), hitFrame(칠 때까지 남은 프레임), shot }
    this.planFor = null;  // 어떤 공(타구)에 대한 계획인지
    this.serveDelay = 0;
    this.holdT = 0;
  }

  control(me, match) {
    const ctrl = { left: false, right: false, skillHeld: false };
    const ball = match.ball;
    const L = this.level;
    const fwd = me.facing === 1 ? 'right' : 'left';
    const back = me.facing === 1 ? 'left' : 'right';
    const moveTo = (x) => {
      const d = x - me.x;
      if (Math.abs(d) > 2) ctrl[d * me.facing > 0 ? fwd : back] = true;
    };

    // 서브: 잠깐 뜸 들이고 톡
    if (ball.state === 'held') {
      if (match.server === me && match.state === 'serve') {
        if (++this.serveDelay > 40 + Math.random() * 30) {
          ctrl.skillHeld = true;
          this.serveDelay = 0;
        }
      }
      moveTo(me.homeX);
      return ctrl;
    }

    // 서브가 아직 서버 쪽 코트에 튀기 전이면 기다림 (튄 뒤에 방향이 정해짐)
    const incoming = ball.state === 'flight' && ball.lastHitter !== me.side && !ball.netHit && ball.serveStage !== 1;
    if (!incoming) {
      this.plan = null;
      moveTo(me.homeX);
      return ctrl;
    }

    // 새 타구면 어디서 칠지 계산 (공을 복제해서 미리 굴려 봄)
    const key = ball.lastHitter + ':' + match.rally + ':' + ball.serveStage;
    if (this.planFor !== key) {
      this.planFor = key;
      this.plan = this.predict(me, ball);
      if (this.plan) {
        // 실력이 낮을수록 위치·타이밍이 어긋남
        this.plan.x += (Math.random() - 0.5) * (1 - L) * 22;
        this.plan.hitFrame += Math.round((Math.random() - 0.5) * (1 - L) * 8);
        const r = Math.random();
        if (ball.chance && r < 0.3 + L * 0.6) this.plan.shot = 'smash';
        else if (r < 0.12 + L * 0.1) this.plan.shot = 'drop';
        else if (r < 0.22 + L * 0.05) this.plan.shot = 'lob';
        else this.plan.shot = 'drive';
        // 느린 CPU 는 가끔 아예 못 따라감
        this.plan.lazy = Math.random() > 0.55 + L * 0.45;
        // 랠리가 길어질수록 실수할 확률이 올라감 (실력이 낮을수록 더 자주)
        const tired = Math.min(0.45, match.rally * 0.022); // 랠리가 길수록 실수 ↑ (경기가 너무 길어지지 않게)
        if (Math.random() < 0.05 + (1 - L) * 0.12 + tired) {
          this.plan.x += (Math.random() < 0.5 ? -1 : 1) * (24 + Math.random() * 10);
          this.plan.hitFrame += Math.random() < 0.5 ? -6 : 6;
        }
      }
      this.holdT = 0;
    }
    const plan = this.plan;
    if (!plan) return ctrl;
    plan.hitFrame--;
    if (!plan.lazy || plan.hitFrame < 30) moveTo(plan.x);
    // 스매시: 미리 꾹 눌러 모았다가 칠 때 떼기
    if (plan.shot === 'smash') {
      if (plan.hitFrame <= CONFIG.PLAYER.CHARGE_TIME + 4 && plan.hitFrame > 2) ctrl.skillHeld = true;
    } else if (plan.hitFrame === 2) {
      ctrl.skillHeld = true; // 다음 프레임에 떼면 휘두름
    }
    if (plan.shot === 'drop' && plan.hitFrame <= 2) ctrl[fwd] = true;
    if (plan.shot === 'lob' && plan.hitFrame <= 2) ctrl[back] = true;
    return ctrl;
  }

  // 공이 내 코트에 한 번 튄 뒤 라켓이 닿는 곳 중 치기 좋은 지점
  //  (내려오는 중인 첫 지점, 없으면 닿을 수 있는 마지막 지점)
  predict(me, ball) {
    const sim = ball.clone();
    const P = CONFIG.PLAYER;
    const top = CONFIG.FLOOR_Y - P.REACH_TOP + 4;
    const low = CONFIG.FLOOR_Y - P.REACH_LOW - 4;
    let bounced = sim.bounces;
    let last = null;
    for (let f = 1; f < 240; f++) {
      const ev = sim.step();
      for (const e of ev) if (e.type === 'bounce' && e.side === me.side) bounced++;
      if (ev.some((e) => e.type === 'floor' || e.type === 'out' || e.type === 'net')) break;
      if (bounced < 1 || sim.y < top || sim.y > low) continue;
      // 설 수 있는 곳에서 라켓이 닿는지 (탁구대에 바짝 붙어서 뻗는 것도 포함)
      const x = Math.max(me.minX, Math.min(me.maxX, sim.x - me.facing * 9));
      if (Math.abs(x + me.facing * 9 - sim.x) > P.REACH_X - 4) continue;
      const cand = { x, hitFrame: f };
      if (sim.vy > -0.5) return cand;
      last = cand;
    }
    return last;
  }
}
