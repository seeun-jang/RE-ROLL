// =============================================================
// MirrorMatch — 서버가 보낸 경기 상태를 원본 Match / Fighter 와 같은 모양으로 보여주는 '거울'
//
// 원본 대결 장면과 그리기 코드는 match.player(왼쪽) / match.cpu(오른쪽)를 읽는다.
// 여기서는 계산을 하지 않고 서버 값을 그대로 담는다.
// 내 경기는 항상 내가 왼쪽에 보이도록 좌우를 바꿔 담는다(조작 방향이 모두 같아진다).
// =============================================================

const EMPTY_INPUT = Object.freeze({ lean: 0, pushDown: false, feintPressed: false, holdDown: false });

class MirrorFighter {
  constructor({ cfg, side, player }) {
    this.cfg = cfg;
    this.side = side;                               // 화면에서의 자리
    this.id = player.id;
    this.name = player.name;
    this.lookId = player.lookId;
    this.baseX = side === 'left' ? cfg.STAGE.P1_X : cfg.STAGE.P2_X;
    this.dir = side === 'left' ? 1 : -1;
    this.facing = side === 'left' ? 'right' : 'left';
    this.body = { b: 0, v: 0 };
    this.state = 'idle';
    this.stateFrame = 0;
    this.charge = 0;
    this.charged = false;
    this.stamina = cfg.ACTION.HOLD_STAMINA;
    this.fallen = false;
    this.fallDir = 0;
    this.fallT = 0;
    this.won = false;
    this.frozen = false;
    this.flash = 0;
    this.squash = 0;
    this.leanInput = 0;
    this.input = EMPTY_INPUT;
    this.animT = 0;
    this.stats = { cleanFeints: 0 };
  }

  apply(s) {
    this.body.b = s.b;
    this.body.v = s.v;
    this.state = s.state;
    this.stateFrame = s.stateFrame;
    this.charge = s.charge;
    this.charged = !!s.charged;
    this.stamina = s.stamina;
    this.fallen = !!s.fallen;
    this.fallDir = s.fallDir;
    this.fallT = s.fallT;
    this.won = !!s.won;
    this.frozen = !!s.frozen;
    this.flash = s.flash;
    this.squash = s.squash;
    this.leanInput = s.lean;
    this.stats.cleanFeints = s.cleanFeints;
  }

  get balance() { return this.body.b; }
  get screenBalance() { return this.body.b * this.dir; }
  fallWaterX() { return Math.round(this.baseX + this.dir * this.fallDir * 13); }
}

export class MirrorMatch {
  /**
   * @param {object} o
   * @param {object} o.cfg
   * @param {{id,name,lookId}} o.a 서버 기준 a 자리 선수
   * @param {{id,name,lookId}} o.b 서버 기준 b 자리 선수
   * @param {boolean} o.swap true 면 b 를 화면 왼쪽에 둔다
   */
  constructor({ cfg, a, b, swap = false }) {
    this.cfg = cfg;
    this.swap = swap;
    this.player = new MirrorFighter({ cfg, side: 'left', player: swap ? b : a });
    this.cpu = new MirrorFighter({ cfg, side: 'right', player: swap ? a : b });
    this.frame = 0;
    this.hitstop = 0;
    this.timeLeft = cfg.MATCH.TIME_LIMIT;
    this.wobble = 0;
    this.over = false;
    this.result = null;
  }

  /** 서버 자리 이름('a' | 'b') → 화면의 선수 */
  byKey(key) {
    return (key === 'a') !== this.swap ? this.player : this.cpu;
  }

  apply(d) {
    this.frame = d.frame;
    this.timeLeft = d.timeLeft;
    this.wobble = d.wobble;
    this.over = !!d.over;
    this.result = d.result;
    this.byKey('a').apply(d.a);
    this.byKey('b').apply(d.b);
  }

  /** 화면용 애니메이션 시계만 진행한다 */
  update() {
    this.player.animT += 1;
    this.cpu.animT += 1;
  }

  get elapsedSec() {
    return this.frame / this.cfg.SCREEN.LOGIC_FPS;
  }

  // 받침대 흔들림 오프셋(px) — 원본과 같은 식
  stoneWobble(which) {
    const g = this.wobble;
    if (g <= 0 || this.over) return 0;
    const phase = which === 'player' ? 0 : 1.7;
    return Math.round(Math.sin(this.frame * 0.35 + phase) * (0.4 + g * 1.2));
  }

  drainEvents() { return []; }
  start() {}
}
