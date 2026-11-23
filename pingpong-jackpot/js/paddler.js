// =====================================================
// 탁구 선수 (사람 / CPU 공용)
//  - 탁구대 쪽 키: 앞으로 / 반대쪽 키: 뒤로 (발을 부드럽게 미끄러뜨림)
//  - 치기 키 톡: 드라이브 (앞키 누른 채 = 드롭, 뒤키 누른 채 = 로브)
//  - 치기 키 꾹 → 떼기: 스매시 (라켓이 금색으로 빛나면 준비 완료)
//  - 공이 내 코트에 한 번 튄 뒤, 휘두르는 동안 라켓 근처에 오면 맞음
//    (공이 라켓 한가운데 올수록 '나이스 타이밍' → 낮고 빠른 좋은 공)
// =====================================================
class Paddler {
  constructor(player, side) {
    this.player = player;       // 토너먼트 참가자 정보 (점수 기록용)
    this.index = player.index;
    this.def = player.def;
    this.name = player.name;
    this.color = player.color;
    this.side = side;           // 0 왼쪽 / 1 오른쪽
    this.facing = side === 0 ? 1 : -1;
    this.pts = 0;               // 이 경기 점수
    this.homeX = side === 0 ? 58 : CONFIG.WIDTH - 58;
    this.x = this.homeX;
    this.px = this.x;
    this.vx = 0;
    this.state = 'ready';       // ready | charge | swing | win | lose
    this.t = 0;
    this.chargeT = 0;
    this.swingT = 0;
    this.shot = 'drive';
    this.hitDone = false;
    this.prevSkill = false;
    this.walkPhase = 0;
    this.lean = 0;
    this.paddle = { x: 10, y: -18 };  // 라켓 위치 (몸 기준, 앞쪽 +)
    this.paddleP = { ...this.paddle };
    this.popup = null;          // 머리 위 글씨 ('나이스!', '스매시!')
    this.squash = 0;
  }

  get spr() {
    return SPR.players[this.index];
  }

  // 움직일 수 있는 범위 (탁구대 쪽으로는 바짝, 뒤로는 넓게)
  get minX() {
    return this.side === 0 ? CONFIG.ZONE.FAR : CONFIG.WIDTH - CONFIG.ZONE.NEAR;
  }

  get maxX() {
    return this.side === 0 ? CONFIG.ZONE.NEAR : CONFIG.WIDTH - CONFIG.ZONE.FAR;
  }

  get paddleX() {
    return this.x + this.facing * 9;
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  // ctrl: { left, right, skillHeld }
  update(match, ctrl) {
    const P = CONFIG.PLAYER;
    this.px = this.x;
    this.paddleP = { ...this.paddle };
    this.t++;
    if (this.squash > 0) this.squash--;
    if (this.popup && ++this.popup.t > 40) this.popup = null;
    const fwdKey = this.facing === 1 ? ctrl.right : ctrl.left;
    const backKey = this.facing === 1 ? ctrl.left : ctrl.right;
    // 한 프레임보다 짧게 톡 친 것도 놓치지 않게 (눌린 순간 = 이번 프레임은 누른 것으로)
    ctrl = { ...ctrl, skillHeld: ctrl.skillHeld || (ctrl.skillPressed && !this.prevSkill) };

    if (this.state === 'win' || this.state === 'lose' || match.frozen) {
      this.vx *= P.FRICTION;
      // 쉬는 동안 제자리로 천천히
      if (this.state !== 'win' && this.state !== 'lose' && match.state === 'point') this.x += (this.homeX - this.x) * 0.04;
    } else {
      // 이동 (스매시를 모으는 중에는 느리게)
      const speed = this.state === 'charge' ? P.MAX_SPEED * 0.55 : P.MAX_SPEED;
      const dir = (fwdKey ? this.facing : 0) - (backKey ? this.facing : 0);
      if (dir) this.vx += (dir * speed - this.vx) * P.ACCEL;
      else this.vx *= P.FRICTION;

      if (this.state === 'swing') {
        this.swingT++;
        if (!this.hitDone && this.swingT >= 1 && this.swingT <= P.SWING) match.tryHit(this);
        if (this.swingT >= P.SWING + 6) this.setState('ready');
      } else if (this.state === 'charge') {
        this.chargeT++;
        if (this.chargeT === P.CHARGE_TIME) match.game.audio.sfx('smashReady');
        if (!ctrl.skillHeld) this.startSwing(this.chargeT >= P.CHARGE_TIME ? 'smash' : fwdKey ? 'drop' : backKey ? 'lob' : 'drive', match);
      } else if (ctrl.skillHeld && !this.prevSkill) {
        this.setState('charge');
        this.chargeT = 0;
      }
    }
    this.prevSkill = ctrl.skillHeld;
    this.x += this.vx;
    if (this.x < this.minX) {
      this.x = this.minX;
      this.vx = 0;
    }
    if (this.x > this.maxX) {
      this.x = this.maxX;
      this.vx = 0;
    }
    if (Math.abs(this.vx) < 0.02) this.vx = 0;
    this.walkPhase += Math.abs(this.vx) * 0.22;
    let leanTarget = Math.max(-2, Math.min(2, this.vx * 1.2));
    if (this.state === 'swing') leanTarget = this.facing * 2;
    this.lean += (leanTarget - this.lean) * 0.3;
    this.animatePaddle(match);
  }

  startSwing(shot, match) {
    this.setState('swing');
    this.shot = shot;
    this.swingT = 0;
    this.hitDone = false;
    this.prevDx = null;
    match.game.audio.sfx('swing');
    if (match.ball.state === 'held' && match.server === this) match.serve(this);
  }

  // 라켓 목표 위치 → 부드럽게 따라감
  animatePaddle(match) {
    const P = CONFIG.PLAYER;
    let tx = 13;   // 몸 앞쪽 (얼굴을 가리지 않게)
    let ty = -12;
    let k = 0.3;
    const ball = match.ball;
    // 공이 내 쪽으로 오면 라켓 높이를 공에 맞춤
    if (ball.state === 'flight' && ball.lastHitter !== this.side) {
      ty = Math.max(-P.REACH_TOP + 6, Math.min(-8, ball.y - CONFIG.FLOOR_Y));
    }
    if (this.state === 'charge') {
      // 뒤로 크게 젖힘
      tx = -6;
      ty = -30;
      k = 0.25;
    } else if (this.state === 'swing') {
      // 뒤 → 앞으로 휘두름
      const s = Math.min(1, this.swingT / 4);
      tx = -4 + s * 20;
      ty = ty - (this.shot === 'smash' ? 14 - s * 14 : this.shot === 'lob' ? -s * 4 : s * 6);
      k = 0.6;
    } else if (this.state === 'win') {
      tx = 4;
      ty = -48 - Math.abs(Math.sin(match.frame / 8)) * 3;
    } else if (this.state === 'lose') {
      tx = 6;
      ty = -6;
    }
    if (match.server === this && this.state === 'ready') {
      if (match.ball.state === 'held') {
        tx = 12;
        ty = -14;
      } else if (match.ball.state === 'toss') {
        // 토스하는 동안 라켓을 뒤로 빼고 기다림
        tx = -7;
        ty = -12;
      }
    }
    this.paddle.x += (tx - this.paddle.x) * k;
    this.paddle.y += (ty - this.paddle.y) * k;
  }

  render(ctx, match, alpha) {
    const fy = CONFIG.FLOOR_Y;
    const x = this.px + (this.x - this.px) * alpha;
    const ix = Math.round(x + this.lean);
    const f = this.facing;
    const pdx = this.paddleP.x + (this.paddle.x - this.paddleP.x) * alpha;
    const pdy = this.paddleP.y + (this.paddle.y - this.paddleP.y) * alpha;
    // 그림자
    ctx.fillStyle = C('s');
    ctx.fillRect(Math.round(x) - 12, fy - 1, 24, 2);
    // 몸
    const walking = Math.abs(this.vx) > 0.3;
    const bounce = walking ? Math.round(Math.abs(Math.sin(this.walkPhase)) * 2) : 0;
    const hop = this.state === 'win' ? Math.round(Math.abs(Math.sin(match.frame / 8)) * 4) : 0;
    const breath = ((match.frame / 15) | 0) % 2;
    const img = this.spr.frames[breath];
    ctx.save();
    if (f === -1) {
      ctx.translate(ix * 2, 0);
      ctx.scale(-1, 1);
    }
    drawStanding(ctx, img, ix, fy - bounce - hop, this.state === 'lose' ? 2 : this.squash);
    ctx.restore();
    // 라켓 (빨간 고무 + 나무 손잡이)
    const rx = Math.round(ix + f * pdx);
    const ry = Math.round(fy + pdy - hop);
    const glow = this.state === 'charge' && this.chargeT >= CONFIG.PLAYER.CHARGE_TIME && match.frame % 6 < 3;
    ctx.fillStyle = C('1');
    ctx.fillRect(rx - 1, ry + 3, 3, 5);
    ctx.fillStyle = C('m');
    ctx.fillRect(rx, ry + 4, 1, 3);
    ctx.fillStyle = C('1');
    ctx.fillRect(rx - 4, ry - 3, 9, 7);
    ctx.fillRect(rx - 3, ry - 4, 7, 9);
    ctx.fillStyle = C(glow ? '9' : '6');
    ctx.fillRect(rx - 3, ry - 3, 7, 7);
    ctx.fillRect(rx - 2, ry - 4, 5, 1);
    ctx.fillStyle = C(glow ? 't' : '5');
    ctx.fillRect(rx - 2, ry - 2, 2, 2);
    // 머리 위 글씨
    if (this.popup) {
      const k = this.popup.t;
      if (!(k > 30 && k % 4 < 2)) KText.draw(ctx, this.popup.text, ix, fy - 62 - Math.min(4, k / 2), C(this.popup.color), { align: 'center', font: 'b', outline: C('1') });
    }
  }
}
