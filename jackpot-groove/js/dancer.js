// =====================================================
// 춤추는 캐릭터
//  - 박자마다 통통 튀고 (곡 시계 기준이라 음악과 딱 맞음)
//  - 왼쪽 레인을 치면 왼쪽으로, 오른쪽 레인은 오른쪽으로 몸을 돌리고
//    가운데 레인은 점프
//  - MISS 면 휘청 + 회색 번쩍, 피버면 금빛 오라
// =====================================================
class Dancer {
  constructor(performer, x, feetY, scale = 1) {
    this.p = performer;
    this.x = x;
    this.feetY = feetY;
    this.scale = scale;
    this.facing = 1;
    this.lean = 0;
    this.prevLean = 0;
    this.leanTarget = 0;
    this.hop = 0;
    this.prevHop = 0;
    this.hopV = 0;
    this.missT = 0;
    this.poseT = 0;
    this.cheer = false; // 결과·끝 화면 만세
  }

  // 판정이 나면 동작
  onJudge(kind, lane) {
    if (kind === 'miss') {
      this.missT = 18;
      this.leanTarget = 0;
      return;
    }
    this.poseT = 14;
    if (lane === 0) {
      this.facing = -1;
      this.leanTarget = -3;
    } else if (lane === 2) {
      this.facing = 1;
      this.leanTarget = 3;
    } else if (this.hop >= -1) {
      this.hopV = -2.6; // 가운데: 점프
    }
  }

  update() {
    this.prevLean = this.lean;
    this.prevHop = this.hop;
    if (this.poseT > 0) this.poseT--;
    else this.leanTarget = 0;
    // 부드럽게 따라가기 (뚝뚝 끊기지 않게)
    this.lean += (this.leanTarget - this.lean) * 0.3;
    this.hopV += 0.4;
    this.hop = Math.min(0, this.hop + this.hopV);
    if (this.hop === 0) this.hopV = 0;
    if (this.missT > 0) this.missT--;
  }

  render(ctx, t, beatSec, alpha, frame) {
    const sp = this.p.spr;
    const s = this.scale;
    const phase = (((t / beatSec) % 1) + 1) % 1;
    const beatIdx = Math.floor(t / beatSec);
    // 박자 바운스: 박에서 꾹 눌렸다가 위로 통
    let bob = -Math.round(Math.sin(phase * Math.PI) * 2 * s);
    let squash = phase < 0.12 ? 2 * s : 0;
    if (t < -beatSec * 4) {
      bob = 0;
      squash = 0;
    }
    if (this.cheer) bob = -Math.round(Math.abs(Math.sin(frame / 7)) * 5 * s);
    const lean = this.prevLean + (this.lean - this.prevLean) * alpha;
    const hop = this.prevHop + (this.hop - this.prevHop) * alpha;
    let x = this.x + Math.round(lean * s);
    if (this.missT > 0) x += Math.round(Math.sin(this.missT * 1.4) * 2 * s);
    const y = this.feetY + bob + Math.round(hop); // 점프 높이는 크기와 상관없이 같게
    const img = sp.frames[((beatIdx % 2) + 2) % 2];
    const w = img.width * s + (hop < -0.5 ? 0 : squash);
    const h = img.height * s - (hop < -0.5 ? 0 : squash);

    ctx.save();
    ctx.translate(Math.round(x), 0);
    if (this.facing < 0) ctx.scale(-1, 1);
    const dx = -Math.round(w / 2);
    const dy = Math.round(y - h);
    // 피버: 금빛 테두리 오라 (박자에 맞춰 깜빡)
    if (this.p.fever && phase < 0.7) {
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(sp.gold, dx + ox * s, dy + oy * s, w, h);
    }
    ctx.drawImage(img, dx, dy, w, h);
    if (this.missT > 0 && this.missT % 4 < 2) ctx.drawImage(sp.ghost, dx, dy, w, h);
    ctx.restore();
  }
}
