// =============================================================
// 잭팟 탁구왕 한 경기의 규칙 — 원본 js/ball.js · js/paddler.js · js/match.js 의 판정 부분.
//
// 실제 판정은 Python 서버(server/party/games/pingpong/rules.py)가 한다. 이 파일은
//   ① 서버 없이 화면을 확인하는 시험용 진행기(sim/Sim.js)와
//   ② 화면이 서버 상태 사이의 공 위치를 계산할 때(Ball.step)
// 쓴다. 서버와 결과가 같은지는 server/tests/test_pingpong_game.py 가 같은 입력으로 비교한다.
// 옆에서 본 2D (x = 가로, y = 높이, 아래로 갈수록 y 가 커진다). step() 한 번이 1/60초.
// =============================================================

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;

/** 탁구공. 매 프레임 중력 → 이동 → 네트 / 탁구대 / 바닥 충돌을 검사해 '사건'을 돌려준다 */
export class Ball {
  constructor(cfg) {
    this.cfg = cfg;
    this.x = 0;
    this.y = 0;
    this.px = 0;
    this.py = 0;
    this.vx = 0;
    this.vy = 0;
    this.state = 'held';   // held(서브 전) | toss(서브 토스) | flight | dead(득점 후 굴러다님)
    this.serveStage = 0;   // 서브: 1 = 내 코트에 먼저 튀어야 함, 2 = 상대 코트로 가는 중
    this.serveTarget = 0;
    this.serveT = 0;
    this.tossY = 0;
    this.lastHitter = 0;   // 마지막으로 친 쪽 (0 왼쪽 / 1 오른쪽)
    this.bounces = 0;      // 받는 쪽 코트에 튄 횟수
    this.rest = 0.9;       // 탁구대에서 튀는 힘
    this.netHit = false;
    this.chance = false;   // 높게 뜬 찬스볼
    this.fast = false;     // 스매시
    this.shot = '';        // 마지막 샷 종류 (해설용)
    this.ticks = 0;        // step() 을 부른 횟수
  }

  clone() {
    const b = new Ball(this.cfg);
    Object.assign(b, this);
    return b;
  }

  /** 한 프레임 진행 → 일어난 사건 목록 [{ type: 'bounce'|'net'|'floor'|'out', side }] */
  step() {
    const T = this.cfg.TABLE;
    const ev = [];
    this.ticks++;
    this.px = this.x;
    this.py = this.y;
    this.vy += this.cfg.BALL.GRAVITY;
    this.x += this.vx;
    this.y += this.vy;
    // 네트에 걸림
    if (!this.netHit && (this.px - T.NET_X) * (this.x - T.NET_X) <= 0 && this.px !== this.x) {
      const k = (T.NET_X - this.px) / (this.x - this.px);
      const yAt = this.py + (this.y - this.py) * k;
      if (yAt > T.NET_TOP && yAt < T.Y + 2) {
        this.netHit = true;
        this.x = T.NET_X - Math.sign(this.vx) * 3;
        this.vx = -this.vx * 0.15;
        this.vy = Math.min(this.vy, 0.5);
        ev.push({ type: 'net' });
      }
    }
    // 탁구대에 튐
    if (this.y >= T.Y && this.py < T.Y && this.x >= T.LEFT && this.x <= T.RIGHT) {
      this.y = T.Y;
      this.vy = -Math.abs(this.vy) * this.rest;
      this.vx *= this.cfg.TABLE_GRIP;
      ev.push({ type: 'bounce', side: this.x < T.NET_X ? 0 : 1 });
    }
    // 바닥
    if (this.y >= this.cfg.FLOOR_Y) {
      this.y = this.cfg.FLOOR_Y;
      this.vy = -Math.abs(this.vy) * 0.45;
      this.vx *= 0.7;
      if (Math.abs(this.vy) < 0.4) this.vy = 0;
      ev.push({ type: 'floor' });
    }
    if (this.x < -20 || this.x > this.cfg.WIDTH + 20) ev.push({ type: 'out' });
    return ev;
  }

  /** landX 에 T 프레임 뒤 떨어지도록 속도 계산 (네트를 넘을 때까지 높게 조정) */
  launch(landX, T, clearNet = true) {
    const TB = this.cfg.TABLE;
    const g = this.cfg.BALL.GRAVITY;
    for (let tries = 0; tries < 40; tries++) {
      this.vx = (landX - this.x) / T;
      this.vy = (TB.Y - this.y - (g * T * (T + 1)) / 2) / T;
      if (!clearNet || this.vx === 0) return;
      const n = (TB.NET_X - this.x) / this.vx;
      if (n <= 0) return;
      const yNet = this.y + this.vy * n + (g * n * (n + 1)) / 2;
      if (yNet < TB.NET_TOP - 4) return;
      T += 3; // 네트에 걸릴 것 같으면 더 높게(천천히)
    }
  }
}

/** 탁구 선수. 치기 톡 = 드라이브(전진키와 함께 = 드롭, 후진키와 함께 = 로브), 꾹 → 떼기 = 스매시 */
export class Paddler {
  constructor(cfg, player, side) {
    this.cfg = cfg;
    this.playerId = player.id;
    this.name = player.name || player.id;
    this.side = side;           // 0 왼쪽 / 1 오른쪽
    this.facing = side === 0 ? 1 : -1;
    this.pts = 0;               // 이 경기 점수
    this.homeX = side === 0 ? cfg.HOME_X : cfg.WIDTH - cfg.HOME_X;
    this.x = this.homeX;
    this.vx = 0;
    this.state = 'ready';       // ready | charge | swing | win | lose
    this.t = 0;
    this.chargeT = 0;
    this.swingT = 0;
    this.shot = 'drive';
    this.hitDone = false;
    this.prevSkill = false;
    this.prevDx = null;
  }

  get minX() {
    return this.side === 0 ? this.cfg.ZONE.FAR : this.cfg.WIDTH - this.cfg.ZONE.NEAR;
  }

  get maxX() {
    return this.side === 0 ? this.cfg.ZONE.NEAR : this.cfg.WIDTH - this.cfg.ZONE.FAR;
  }

  get paddleX() {
    return this.x + this.facing * 9;
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  /** ctrl: { fwd(탁구대 쪽), back, hit(누르고 있음), hitPressed(방금 누름) } */
  update(match, ctrl) {
    const P = this.cfg.PLAYER;
    this.t++;
    const fwd = !!ctrl.fwd;
    const back = !!ctrl.back;
    // 한 프레임보다 짧게 톡 친 것도 놓치지 않게 (눌린 순간 = 이번 프레임은 누른 것으로)
    const skill = !!ctrl.hit || (!!ctrl.hitPressed && !this.prevSkill);

    if (this.state === 'win' || this.state === 'lose' || match.frozen) {
      this.vx *= P.FRICTION;
      // 쉬는 동안 제자리로 천천히
      if (this.state !== 'win' && this.state !== 'lose' && match.state === 'point') this.x += (this.homeX - this.x) * 0.04;
    } else {
      // 이동 (스매시를 모으는 중에는 느리게)
      const speed = this.state === 'charge' ? P.MAX_SPEED * 0.55 : P.MAX_SPEED;
      const dir = (fwd ? this.facing : 0) - (back ? this.facing : 0);
      if (dir) this.vx += (dir * speed - this.vx) * P.ACCEL;
      else this.vx *= P.FRICTION;

      if (this.state === 'swing') {
        this.swingT++;
        if (!this.hitDone && this.swingT >= 1 && this.swingT <= P.SWING) match.tryHit(this);
        if (this.swingT >= P.SWING + 6) this.setState('ready');
      } else if (this.state === 'charge') {
        this.chargeT++;
        if (this.chargeT === P.CHARGE_TIME) match.emit({ type: 'smashReady', side: this.side });
        if (!skill) this.startSwing(this.chargeT >= P.CHARGE_TIME ? 'smash' : fwd ? 'drop' : back ? 'lob' : 'drive', match);
      } else if (skill && !this.prevSkill) {
        this.setState('charge');
        this.chargeT = 0;
      }
    }
    this.prevSkill = skill;
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
  }

  startSwing(shot, match) {
    this.setState('swing');
    this.shot = shot;
    this.swingT = 0;
    this.hitDone = false;
    this.prevDx = null;
    match.emit({ type: 'swing', side: this.side, shot });
    if (match.ball.state === 'held' && match.server === this) match.serve(this);
  }

  snapshot() {
    return { x: r3(this.x), vx: r3(this.vx), state: this.state, chargeT: this.chargeT, swingT: this.swingT, shot: this.shot };
  }
}

const NO_INPUT = Object.freeze({ fwd: false, back: false, hit: false, hitPressed: false });

/**
 * 1:1 탁구 한 경기. 서브 → 랠리 → 득점 → (2점마다 서브 교대) → … → 승리
 *  - 받는 쪽 코트에 두 번 튀면 / 받는 쪽이 못 치고 공이 지나가면 → 친 쪽 득점
 *  - 네트에 걸리거나 / 상대 코트에 안 떨어지고 나가면 → 받는 쪽 득점
 */
export class Duel {
  constructor(cfg, a, b, rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.left = new Paddler(cfg, a, 0);
    this.right = new Paddler(cfg, b, 1);
    this.fighters = [this.left, this.right];
    this.ball = new Ball(cfg);
    this.frame = 0;
    this.state = 'intro';   // intro | serve | rally | point | end
    this.stateT = 0;
    this.hitstop = 0;
    this.slow = 0;          // 스매시 슬로모션 (남은 프레임, 2프레임에 1번만 진행)
    this.rally = 0;         // 이번 랠리에서 주고받은 횟수
    this.bestRally = 0;
    this.serveCount = 0;
    this.server = rng() < 0.5 ? this.left : this.right;
    this.winner = null;
    this.loser = null;
    this.done = false;      // "게임 셋!" 연출까지 끝남
    this._events = [];
  }

  get over() {
    return this.done;
  }

  get frozen() {
    return this.state === 'intro' || this.state === 'point' || this.state === 'end';
  }

  emit(ev) {
    this._events.push(ev);
  }

  popEvents() {
    const out = this._events;
    this._events = [];
    return out;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  /** 한 프레임 진행. 입력을 실제로 읽었으면 true (멈춤 · 슬로모션으로 건너뛴 프레임은 false) */
  step(inLeft, inRight) {
    const C = this.cfg;
    if (this.slow > 0) {
      this.slow--;
      if (this.slow % 2 === 1) return false; // 반 속도
    }
    this.frame++;
    this.stateT++;
    if (this.hitstop > 0) {
      this.hitstop--;
      return false;
    }

    if (this.state === 'intro' && this.stateT >= C.MATCH_INTRO) this.startServe();
    if (this.state === 'serve' && this.stateT >= C.AUTO_SERVE && this.ball.state === 'held') this.serve(this.server); // 자동 서브
    if (this.state === 'point' && this.stateT >= C.POINT_PAUSE) this.afterPoint();
    if (this.state === 'end' && this.stateT >= C.MATCH_END) this.done = true;

    // 조종 입력
    this.left.update(this, this.frozen ? NO_INPUT : inLeft);
    this.right.update(this, this.frozen ? NO_INPUT : inRight);

    // 공
    const ball = this.ball;
    if (ball.state === 'held') {
      // 서브 전: 빈손 위에 공을 올려놓고 대기 (살짝 통통)
      const s = this.server;
      ball.px = ball.x;
      ball.py = ball.y;
      ball.x = s.x + s.facing * 4;
      ball.y = C.FLOOR_Y - 20 - Math.round(Math.abs(Math.sin(this.frame / 14)) * 2);
    } else if (ball.state === 'toss') {
      // 토스: 공을 위로 띄웠다가 내려올 때 라켓으로 침
      ball.px = ball.x;
      ball.py = ball.y;
      ball.vy += C.BALL.GRAVITY * 0.7;
      ball.y += ball.vy;
      if (ball.vy > 0 && ball.y >= ball.tossY - 8) this.strikeServe(this.server);
    } else {
      for (const ev of ball.step()) this.onBallEvent(ev);
    }
    return true;
  }

  // ---- 서브 ----
  startServe() {
    this.ball = new Ball(this.cfg);
    this.ball.state = 'held';
    this.rally = 0;
    this.setState('serve');
    this.emit({ type: 'serve', side: this.server.side });
  }

  /** 치기 키 → 공을 위로 토스 (진짜 탁구처럼) */
  serve(p) {
    const ball = this.ball;
    if (ball.state !== 'held' || this.state !== 'serve' || p !== this.server) return;
    ball.state = 'toss';
    ball.tossY = ball.y;
    ball.vy = -2.3;
    p.setState('ready');
    this.emit({ type: 'toss', side: p.side });
  }

  /** 토스한 공이 내려오면 라켓으로 침 → 내 코트에 한 번 튀고 → 네트를 넘어 → 상대 코트에 튀어야 함 */
  strikeServe(p) {
    p.setState('swing');
    p.swingT = 0;
    p.shot = 'drive';
    p.hitDone = true;
    this.hitBall(p, 'serve', 0.8);
    this.setState('rally');
  }

  // ---- 치기 ----
  /** 휘두르는 중에 공이 라켓에 닿았나 */
  tryHit(p) {
    const ball = this.ball;
    const P = this.cfg.PLAYER;
    if (ball.state !== 'flight' || ball.lastHitter === p.side || ball.bounces < 1 || ball.netHit) return;
    const dx = Math.abs(ball.x - p.paddleX);
    const top = this.cfg.FLOOR_Y - P.REACH_TOP;
    const low = this.cfg.FLOOR_Y - P.REACH_LOW;
    if (dx > P.REACH_X || ball.y < top || ball.y > low) {
      p.prevDx = null;
      return;
    }
    // 라켓 끝에 닿자마자 치지 않고, 공이 라켓 한가운데에 가장 가까워지는 순간에 침
    const closing = p.prevDx === null || dx < p.prevDx;
    if (closing && dx > 3 && p.swingT < P.SWING) {
      p.prevDx = dx;
      return;
    }
    const best = p.prevDx === null ? dx : Math.min(dx, p.prevDx);
    // 타이밍 점수: 라켓 한가운데 + 휘두르기 시작하고 2~7프레임 사이가 최고
    const center = 1 - best / P.REACH_X;
    const timing = p.swingT >= 2 && p.swingT <= 7 ? 1 : 0.7;
    const q = Math.max(0, Math.min(1, center * 0.75 + timing * 0.3 - 0.05));
    p.hitDone = true;
    this.hitBall(p, p.shot, q);
  }

  /** 공 치기: 샷 종류와 타이밍으로 상대 코트 어디에 얼마나 빨리 떨어질지 결정 */
  hitBall(p, type, q) {
    const C = this.cfg;
    const T = C.TABLE;
    const S = C.SHOTS[type];
    const ball = this.ball;
    const dir = p.facing;
    const start = T.NET_X + dir * 6;
    const end = dir > 0 ? T.RIGHT - 4 : T.LEFT + 4;
    const half = Math.abs(end - start);
    let depth = S.depth[0] + this.rng() * (S.depth[1] - S.depth[0]);
    let frames = S.T;
    let clearNet = true;
    let popup = null;        // 머리 위 글씨: oops(앗!) | nice(나이스!) | smash(스매시!)
    ball.chance = false;
    ball.fast = type === 'smash';
    if (type === 'smash' && q < C.SMASH_MIN_QUALITY) {
      // 무리한 스매시 → 네트
      depth = 0.02;
      frames = 12;
      clearNet = false;
      ball.fast = false;
      popup = 'oops';
    } else if (type !== 'serve' && q < C.CHANCE_QUALITY && type !== 'smash') {
      // 타이밍이 나쁨 → 높고 느린 찬스볼 (가끔은 아웃)
      frames = Math.round(frames * 1.4) + 10;
      ball.chance = true;
      if (q < 0.1 && this.rng() < 0.5) depth = 1.25;
    } else if (type !== 'serve' && type !== 'smash' && q < 0.55 && this.rng() < (0.55 - q) * 0.5) {
      // 애매한 타이밍 → 가끔 길게 나가서 아웃
      depth = 1.2;
      popup = 'oops';
    } else if (q > 0.85 && type !== 'serve') {
      // 나이스 타이밍 → 더 빠르고 낮게
      frames = Math.round(frames * 0.85);
      popup = type === 'smash' ? 'smash' : 'nice';
    }
    if (type === 'smash' && q >= C.SMASH_MIN_QUALITY) popup = 'smash';
    ball.state = 'flight';
    ball.lastHitter = p.side;
    ball.bounces = 0;
    ball.netHit = false;
    ball.rest = S.bounce;
    ball.serveStage = 0;
    ball.shot = type;
    if (type === 'serve') {
      // 1단계: 내 코트 가운데쯤에 먼저 튀게 (2단계는 튀는 순간 상대 코트로)
      const ownEnd = dir > 0 ? T.LEFT : T.RIGHT;
      const ownLand = ownEnd + dir * (0.3 + this.rng() * 0.25) * (T.NET_X - T.LEFT);
      ball.serveStage = 1;
      ball.serveTarget = start + dir * depth * half;
      ball.serveT = frames;
      ball.launch(ownLand, 22, false);
    } else if (!clearNet || depth > 1) {
      ball.launch(start + dir * depth * half, frames, clearNet); // 일부러 실수 (네트 / 아웃)
    } else {
      this.aimSafely(ball, start + dir * depth * half, frames, dir);
    }
    this.rally++;
    this.bestRally = Math.max(this.bestRally, this.rally);
    const smash = type === 'smash' && clearNet;
    this.hitstop = smash ? C.HITSTOP_SMASH : C.HITSTOP;
    if (smash) this.slow = C.SMASH_SLOW;
    this.emit({
      type: 'hit', side: p.side, shot: type, q: r2(q), smash, popup,
      chance: ball.chance, rally: this.rally, x: r1(ball.x), y: r1(ball.y),
    });
  }

  /** 받는 쪽 탁구대 위에서 두 번 튀어 버리면(받을 방법이 없음) 조금씩 더 깊게 보냄 */
  aimSafely(ball, target, frames, dir) {
    const T = this.cfg.TABLE;
    const end = dir > 0 ? T.RIGHT - 3 : T.LEFT + 3;
    for (let k = 0; k < 10; k++) {
      ball.launch(target, frames);
      const sim = ball.clone();
      let n = 0;
      let bad = false;
      for (let f = 0; f < 200; f++) {
        const ev = sim.step();
        if (ev.some((e) => e.type !== 'bounce')) break;
        const b = ev.find((e) => e.type === 'bounce');
        if (b && ++n === 2) {
          bad = true; // 탁구대 위에서 두 번째로 튐 (받을 수 없는 공)
          break;
        }
      }
      if (!bad) return;
      target = dir > 0 ? Math.min(end, target + 7) : Math.max(end, target - 7);
    }
  }

  // ---- 판정 ----
  /** 공이 어딘가에 닿음 → 규칙 판정 */
  onBallEvent(ev) {
    const ball = this.ball;
    if (ev.type === 'bounce') this.emit({ type: 'bounce', side: ev.side });
    else if (ev.type === 'net') this.emit({ type: 'net' });
    else if (ev.type === 'floor' && Math.abs(ball.vy) > 0.4) this.emit({ type: 'floor' });
    if (this.state !== 'rally' || ball.state !== 'flight') return;
    const hitter = ball.lastHitter;
    const receiver = 1 - hitter;
    if (ev.type === 'bounce' && ball.serveStage === 1) {
      // 서브: 내 코트에 먼저 튀어야 정상 → 상대 코트로 넘어감
      if (ev.side === hitter) {
        ball.serveStage = 2;
        this.aimSafely(ball, ball.serveTarget, ball.serveT, hitter === 0 ? 1 : -1);
      } else this.pointTo(receiver, 'serveFault');
      return;
    }
    if (ev.type === 'bounce') {
      if (ev.side === hitter) this.pointTo(receiver, ball.serveStage === 2 ? 'serveFault' : 'ownCourt');
      else if (++ball.bounces >= 2) this.pointTo(hitter, ball.fast ? 'smash' : 'unreturned');
      ball.serveStage = 0;
    } else if (ev.type === 'net') {
      this.pointTo(receiver, 'net');
    } else if (ev.type === 'floor' || ev.type === 'out') {
      if (ball.bounces >= 1) this.pointTo(hitter, ball.fast ? 'smash' : 'missed');
      else this.pointTo(receiver, 'out');
    }
  }

  /** 득점. reason: serveFault | ownCourt | smash | unreturned | net | missed | out */
  pointTo(side, reason) {
    const C = this.cfg;
    const p = this.fighters[side];
    const o = this.fighters[1 - side];
    p.pts++;
    this.ball.state = 'dead';
    this.serveCount++;
    this.emit({
      type: 'point', side, reason, pts: [this.left.pts, this.right.pts],
      rally: this.rally, shot: this.ball.shot, hitter: this.ball.lastHitter,
    });
    // 승부가 났나? (3점 선승, 2:2부터는 2점 차, 6점이면 무조건)
    if ((p.pts >= C.GAME_POINTS && p.pts - o.pts >= 2) || p.pts >= C.DEUCE_CAP) {
      this.finish(p, o);
      return;
    }
    // 원본에 없는 안전장치: 경기가 너무 길어지면 이 득점에서 앞선 쪽이 이긴다
    if (this.frame >= C.FLOW.MATCH_LIMIT * 60 && p.pts !== o.pts) {
      if (p.pts > o.pts) this.finish(p, o);
      else this.finish(o, p);
      return;
    }
    this.setState('point');
  }

  afterPoint() {
    // 2점마다 서브 교대 (듀스에서는 1점마다)
    const G = this.cfg.GAME_POINTS;
    const deuce = this.left.pts >= G - 1 && this.right.pts >= G - 1;
    if (deuce || this.serveCount % this.cfg.SERVE_EVERY === 0) this.server = this.server === this.left ? this.right : this.left;
    this.startServe();
  }

  finish(w, l) {
    this.winner = w;
    this.loser = l;
    w.setState('win');
    l.setState('lose');
    this.setState('end');
    this.emit({ type: 'end', winner: w.side, pts: [this.left.pts, this.right.pts] });
  }

  get isDeuce() {
    const G = this.cfg.GAME_POINTS;
    return this.left.pts >= G - 1 && this.right.pts >= G - 1 && this.left.pts === this.right.pts;
  }

  /** 한 점만 더 따면 이기는 쪽 (없으면 null) */
  get matchPointSide() {
    const C = this.cfg;
    for (const p of this.fighters) {
      const o = p === this.left ? this.right : this.left;
      if ((p.pts + 1 >= C.GAME_POINTS && p.pts + 1 - o.pts >= 2) || p.pts + 1 >= C.DEUCE_CAP) return p.side;
    }
    return null;
  }

  snapshot() {
    const b = this.ball;
    return {
      frame: this.frame, state: this.state, stateT: this.stateT,
      hitstop: this.hitstop, slow: this.slow,
      server: this.server.side, rally: this.rally,
      pts: [this.left.pts, this.right.pts],
      winner: this.winner ? this.winner.side : null, over: this.done,
      ball: {
        x: r3(b.x), y: r3(b.y), vx: r4(b.vx), vy: r4(b.vy),
        state: b.state, fast: b.fast, chance: b.chance, netHit: b.netHit,
        lastHitter: b.lastHitter, bounces: b.bounces, rest: b.rest,
        serveStage: b.serveStage, ticks: b.ticks,
      },
      left: this.left.snapshot(), right: this.right.snapshot(),
    };
  }
}
