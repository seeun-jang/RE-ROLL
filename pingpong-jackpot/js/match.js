// =====================================================
// Match: 1:1 탁구 한 경기 (5점 선승, 4:4부터 듀스 → 7점 먼저면 무조건 승리)
//  서브 → 랠리 → 득점 → (2점마다 서브 교대) → … → 승리
//  득점 규칙
//   - 받는 쪽 코트에 두 번 튀면 / 받는 쪽이 못 치고 공이 지나가면 → 친 쪽 득점
//   - 네트에 걸리거나 / 상대 코트에 안 떨어지고 나가면 → 받는 쪽 득점
// =====================================================
class Match {
  // a, b: 토너먼트 참가자 / opts: { mode, label, aiLevel, autoplay }
  constructor(game, a, b, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.left = new Paddler(a, 0);
    this.right = new Paddler(b, 1);
    this.fighters = [this.left, this.right];
    // 조종: 개인 모드에서는 오른쪽이 CPU / 자동 시연이면 둘 다 CPU
    this.controllers = this.fighters.map((f, i) => {
      if (opts.autoplay) return { ai: new PaddleAI(0.6 + i * 0.1) };
      if (opts.mode === 'personal' && i === 1) return { ai: new PaddleAI(opts.aiLevel || 0.5) };
      return { solo: opts.mode === 'personal' };
    });
    this.hall = new Hall();
    this.ball = new Ball();
    this.particles = new ParticleSystem();
    this.frame = 0;
    this.state = 'intro';   // intro | serve | rally | point | end
    this.stateT = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.slow = 0;          // 스매시 슬로모션 (남은 프레임, 2프레임에 1번만 진행)
    this.flash = 0;         // 스매시 순간 화면 번쩍
    this.rallyPop = 0;      // 랠리 카운터 톡 튀는 효과
    this.bestRally = 0;
    this.rally = 0;         // 이번 랠리에서 주고받은 횟수
    this.serveCount = 0;
    this.server = Math.random() < 0.5 ? this.left : this.right;
    this.banner = null;
    this.winner = null;
    this.loser = null;
    this.how = '';
    this.done = false;
    this.game.audio.sfx('start');
  }

  get frozen() {
    return this.state === 'intro' || this.state === 'point' || this.state === 'end';
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  update(input) {
    if (this.slow > 0) {
      this.slow--;
      if (this.slow % 2 === 1) return; // 반 속도
    }
    if (this.flash > 0) this.flash--;
    if (this.rallyPop > 0) this.rallyPop--;
    this.frame++;
    this.stateT++;
    this.hall.update(this.frame, this.ball.state === 'held' ? CONFIG.WIDTH / 2 : this.ball.x, this.ball);
    if (this.hitstop > 0) {
      this.hitstop--;
      for (const f of this.fighters) {
        f.px = f.x;
        f.paddleP = { ...f.paddle };
      }
      this.ball.px = this.ball.x;
      this.ball.py = this.ball.y;
      return;
    }
    if (this.shake > 0) this.shake--;

    if (this.state === 'intro' && this.stateT >= 90) this.startServe();
    if (this.state === 'serve' && this.stateT >= CONFIG.AUTO_SERVE && this.ball.state === 'held') this.serve(this.server); // 자동 서브
    if (this.state === 'point') {
      if (this.stateT >= CONFIG.POINT_PAUSE) this.afterPoint();
    }
    if (this.state === 'end' && this.stateT >= 180) this.done = true;

    // 조종 입력
    this.fighters.forEach((f, i) => {
      const c = this.controllers[i];
      let ctrl;
      if (this.frozen) ctrl = { left: false, right: false, skillHeld: false };
      else if (c.ai) ctrl = c.ai.control(f, this);
      else if (c.solo) ctrl = input.solo(f.index);
      else ctrl = input.player(f.index);
      f.update(this, ctrl);
    });

    // 공
    const ball = this.ball;
    if (ball.state === 'held') {
      // 서브 전: 빈손 위에 공을 올려놓고 대기 (살짝 통통)
      const s = this.server;
      ball.px = ball.x;
      ball.py = ball.y;
      ball.x = s.x + s.facing * 4;
      ball.y = CONFIG.FLOOR_Y - 20 - Math.round(Math.abs(Math.sin(this.frame / 14)) * 2);
    } else if (ball.state === 'toss') {
      // 토스: 공을 위로 띄웠다가 내려올 때 라켓으로 침
      ball.px = ball.x;
      ball.py = ball.y;
      ball.vy += CONFIG.BALL.GRAVITY * 0.7;
      ball.y += ball.vy;
      if (ball.vy > 0 && ball.y >= ball.tossY - 8) this.strikeServe(this.server);
    } else if (ball.state !== 'gone') {
      for (const ev of ball.step()) this.onBallEvent(ev);
    }
    this.particles.update();
  }

  // ---- 서브 ----
  startServe() {
    this.ball = new Ball();
    this.ball.state = 'held';
    this.rally = 0;
    this.banner = { text: `${this.server.name} 서브`, color: 'a', t: 0 };
    this.setState('serve');
  }

  // 치기 키 → 공을 위로 토스 (진짜 탁구처럼)
  serve(p) {
    const ball = this.ball;
    if (ball.state !== 'held' || this.state !== 'serve' || p !== this.server) return;
    ball.state = 'toss';
    ball.tossY = ball.y;
    ball.vy = -2.3;
    p.setState('ready');
    this.game.audio.sfx('swing');
  }

  // 토스한 공이 내려오면 라켓으로 침
  //  → 내 코트에 한 번 튀고 → 네트를 넘어 → 상대 코트에 튀어야 함
  strikeServe(p) {
    p.setState('swing');
    p.swingT = 0;
    p.shot = 'drive';
    p.hitDone = true;
    this.hitBall(p, 'serve', 0.8);
    this.banner = null;
    this.setState('rally');
  }

  // 휘두르는 중에 공이 라켓에 닿았나
  tryHit(p) {
    const ball = this.ball;
    const P = CONFIG.PLAYER;
    if (ball.state !== 'flight' || ball.lastHitter === p.side || ball.bounces < 1 || ball.netHit) return;
    const dx = Math.abs(ball.x - p.paddleX);
    const top = CONFIG.FLOOR_Y - P.REACH_TOP;
    const low = CONFIG.FLOOR_Y - P.REACH_LOW;
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

  // 공 치기: 샷 종류와 타이밍으로 상대 코트 어디에 얼마나 빨리 떨어질지 결정
  hitBall(p, type, q) {
    const T = CONFIG.TABLE;
    const S = CONFIG.SHOTS[type];
    const ball = this.ball;
    const dir = p.facing;
    const start = T.NET_X + dir * 6;
    const end = dir > 0 ? T.RIGHT - 4 : T.LEFT + 4;
    const half = Math.abs(end - start);
    let depth = S.depth[0] + Math.random() * (S.depth[1] - S.depth[0]);
    let frames = S.T;
    let clearNet = true;
    ball.chance = false;
    ball.fast = type === 'smash';
    if (type === 'smash' && q < CONFIG.SMASH_MIN_QUALITY) {
      // 무리한 스매시 → 네트
      depth = 0.02;
      frames = 12;
      clearNet = false;
      ball.fast = false;
      p.popup = { text: '앗!', color: 'j', t: 0 };
    } else if (type !== 'serve' && q < CONFIG.CHANCE_QUALITY && type !== 'smash') {
      // 타이밍이 나쁨 → 높고 느린 찬스볼 (가끔은 아웃)
      frames = Math.round(frames * 1.4) + 10;
      ball.chance = true;
      if (q < 0.1 && Math.random() < 0.5) depth = 1.25;
    } else if (type !== 'serve' && type !== 'smash' && q < 0.55 && Math.random() < (0.55 - q) * 0.5) {
      // 애매한 타이밍 → 가끔 길게 나가서 아웃
      depth = 1.2;
      p.popup = { text: '앗!', color: 'j', t: 0 };
    } else if (q > 0.85 && type !== 'serve') {
      // 나이스 타이밍 → 더 빠르고 낮게
      frames = Math.round(frames * 0.85);
      p.popup = { text: type === 'smash' ? '스매시!' : '나이스!', color: type === 'smash' ? '9' : 'e', t: 0 };
    }
    if (type === 'smash' && q >= CONFIG.SMASH_MIN_QUALITY && !p.popup) p.popup = { text: '스매시!', color: '9', t: 0 };
    ball.state = 'flight';
    ball.lastHitter = p.side;
    ball.bounces = 0;
    ball.netHit = false;
    ball.rest = S.bounce;
    ball.serveStage = 0;
    if (type === 'serve') {
      // 1단계: 내 코트 가운데쯤에 먼저 튀게 (2단계는 튀는 순간 상대 코트로)
      const ownEnd = dir > 0 ? T.LEFT : T.RIGHT;
      const ownLand = ownEnd + dir * (0.3 + Math.random() * 0.25) * (T.NET_X - T.LEFT);
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
    if (type !== 'serve') this.rallyPop = 8;
    // 손맛: 칠 때마다 작은 고리 + 불티, 스매시는 번쩍 + 흔들림 + 잠깐 슬로모션
    const smash = type === 'smash' && clearNet;
    this.game.audio.sfx('paddle', smash ? 1 : 0);
    this.hitstop = smash ? 7 : 3;
    if (smash) {
      this.shake = 10;
      this.flash = 4;
      this.slow = 24;
      this.particles.burst(ball.x, ball.y, 20, [C('9'), C('b'), C('8')], 2.2, 16, 1);
      this.particles.ring(ball.x, ball.y, 1.8, C('9'), 12);
      this.particles.ring(ball.x, ball.y, 3, C('b'), 8);
      this.hall.excite = Math.max(this.hall.excite, 40);
    } else {
      this.particles.burst(ball.x, ball.y, 6, [C('b'), C('k')], 1, 10, 1);
      this.particles.ring(ball.x, ball.y, 0.9, C('b'), 6);
    }
    // 랠리가 길어지면 관중 환호
    if (this.rally >= 6 && this.rally % 6 === 0) {
      this.hall.excite = Math.max(this.hall.excite, 50);
      this.game.audio.sfx('point');
    }
  }

  // 받는 쪽 탁구대 위에서 두 번 튀어 버리면(받을 방법이 없음) 조금씩 더 깊게 보냄
  //  → 모든 공은 받는 사람이 탁구대 끝 근처에서 칠 수 있음
  aimSafely(ball, target, frames, dir) {
    const T = CONFIG.TABLE;
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

  // 공이 어딘가에 닿음 → 규칙 판정
  onBallEvent(ev) {
    const ball = this.ball;
    if (ev.type === 'bounce') this.game.audio.sfx('pong');
    if (ev.type === 'net') this.game.audio.sfx('net');
    if (ev.type === 'floor' && Math.abs(ball.vy) > 0.4) this.game.audio.sfx('floor');
    if (this.state !== 'rally' || ball.state !== 'flight') return;
    const hitter = ball.lastHitter;
    const receiver = 1 - hitter;
    if (ev.type === 'bounce' && ball.serveStage === 1) {
      // 서브: 내 코트에 먼저 튀어야 정상 → 상대 코트로 넘어감
      if (ev.side === hitter) {
        ball.serveStage = 2;
        this.aimSafely(ball, ball.serveTarget, ball.serveT, hitter === 0 ? 1 : -1);
      } else this.pointTo(receiver, '서브 실수');
      return;
    }
    if (ev.type === 'bounce') {
      if (ev.side === hitter) this.pointTo(receiver, ball.serveStage === 2 ? '서브 실수' : '내 코트');
      else if (++ball.bounces >= 2) this.pointTo(hitter, ball.fast ? '스매시!' : '못 받음');
      ball.serveStage = 0;
    } else if (ev.type === 'net') {
      this.pointTo(receiver, '네트!');
    } else if (ev.type === 'floor' || ev.type === 'out') {
      if (ball.bounces >= 1) this.pointTo(hitter, ball.fast ? '스매시!' : '놓침');
      else this.pointTo(receiver, '아웃!');
    }
  }

  // 득점
  pointTo(side, reason) {
    const p = this.fighters[side];
    const o = this.fighters[1 - side];
    p.pts++;
    this.ball.state = 'dead';
    this.serveCount++;
    this.hall.excite = reason === '스매시!' || this.rally >= 8 ? 90 : 40;
    this.game.audio.sfx('point');
    this.particles.text(p.x, CONFIG.FLOOR_Y - 70, '+1', C('9'), { life: 50, scale: 2 });
    this.banner = { text: `${p.name} 득점!`, sub: reason, color: side === 0 ? '5' : 'h', t: 0 };
    // 승부가 났나? (5점 선승, 4:4부터는 2점 차, 7점이면 무조건)
    const G = CONFIG.GAME_POINTS;
    if ((p.pts >= G && p.pts - o.pts >= 2) || p.pts >= CONFIG.DEUCE_CAP) {
      this.finish(p, o);
      return;
    }
    this.setState('point');
  }

  afterPoint() {
    // 2점마다 서브 교대 (듀스에서는 1점마다)
    const deuce = this.left.pts >= CONFIG.GAME_POINTS - 1 && this.right.pts >= CONFIG.GAME_POINTS - 1;
    if (deuce || this.serveCount % CONFIG.SERVE_EVERY === 0) this.server = this.server === this.left ? this.right : this.left;
    this.startServe();
  }

  finish(w, l) {
    this.winner = w;
    this.loser = l;
    this.how = `${w.pts}:${l.pts}`;
    w.setState('win');
    l.setState('lose');
    this.hall.excite = 200;
    this.banner = { text: '게임 셋!', sub: `${w.name} 승리 (${this.how})`, color: '9', t: 0 };
    this.setState('end');
    this.game.audio.sfx('win');
  }

  get isDeuce() {
    return this.left.pts >= CONFIG.GAME_POINTS - 1 && this.right.pts >= CONFIG.GAME_POINTS - 1 && this.left.pts === this.right.pts;
  }

  // 한 점만 더 따면 이기는 사람
  get matchPointPlayer() {
    for (const p of this.fighters) {
      const o = p === this.left ? this.right : this.left;
      if ((p.pts + 1 >= CONFIG.GAME_POINTS && p.pts + 1 - o.pts >= 2) || p.pts + 1 >= CONFIG.DEUCE_CAP) return p;
    }
    return null;
  }

  // ---------------- 그리기 ----------------
  render(ctx, alpha) {
    const a = this.hitstop > 0 ? 1 : alpha;
    ctx.save();
    if (this.shake > 0) {
      const m = Math.min(2, Math.ceil(this.shake / 4));
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    this.hall.renderBack(ctx, this.frame, a);
    this.hall.renderTable(ctx);
    this.fighters.forEach((f) => f.render(ctx, this, a));
    this.ball.render(ctx, a);
    this.hall.renderNet(ctx);
    this.particles.render(ctx);
    ctx.restore();
    this.renderHUD(ctx);
    this.renderKeyBar(ctx);
    this.renderOverlay(ctx);
  }

  // 위: 이름 + 큰 점수 + 서브 표시
  renderHUD(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 30, W, 1);
    this.fighters.forEach((f, i) => {
      const left = i === 0;
      const face = f.spr.portrait;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left ? 1 : W - 35, 1, 34, 28);
      ctx.clip();
      if (left) ctx.drawImage(face, 18 - Math.round(face.width / 2), 6);
      else {
        ctx.translate(W * 2 - 36, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(face, W - 18 - Math.round(face.width / 2), 6);
      }
      ctx.restore();
      const nameX = left ? 38 : W - 38;
      KText.draw(ctx, f.name, nameX, 1, f.color, { align: left ? 'left' : 'right', font: 'b', outline: C('1') });
      // 서브권 (공 그림 + '서브')
      if (this.server === f && this.state !== 'end') {
        // 서브권: 금색 꼬리표 (공 그림 + 서브)
        const tw = KText.width('서브', 's') + 14;
        const sx = left ? nameX : nameX - tw;
        ctx.fillStyle = C('8');
        ctx.fillRect(sx, 16, tw, 13);
        ctx.fillStyle = C('1');
        ctx.fillRect(sx + 1, 17, tw - 2, 11);
        ctx.fillStyle = C('b');
        ctx.fillRect(sx + 3, 20, 5, 5);
        ctx.fillStyle = C('w');
        ctx.fillRect(sx + 4, 21, 2, 2);
        KText.draw(ctx, '서브', sx + 10, 15, C('9'), { font: 's' });
      }
      // 점수 (크게)
      const sc = String(f.pts);
      const col = this.matchPointPlayer === f && this.frame % 30 < 20 ? C('9') : C('a');
      BitmapFont.draw(ctx, sc, left ? W / 2 - 14 : W / 2 + 14, 4, col, { align: 'center', scale: 4, outline: C('1') });
    });
    BitmapFont.draw(ctx, ':', W / 2, 6, C('8'), { align: 'center', scale: 3 });
    // 점수판 아래 띠: 매치포인트 / 랠리 카운터 (숫자와 안 겹치게)
    const mp = this.matchPointPlayer;
    const tags = [];
    if (this.isDeuce) tags.push(['듀스', '5']);
    else if (mp && this.state !== 'end') tags.push(['매치포인트', '9']);
    if (this.state === 'rally' && this.rally >= 3) tags.push([`랠리 ${this.rally}`, this.rally >= 10 ? '8' : 'a']);
    let ty = 31;
    for (const [txt, col] of tags) {
      const tw = KText.width(txt, 's') + 10;
      const pop = this.rallyPop > 4 && txt.startsWith('랠리') ? 1 : 0;
      ctx.fillStyle = C('8');
      ctx.fillRect(Math.round(W / 2 - tw / 2), ty, tw, 14);
      ctx.fillStyle = C('o');
      ctx.fillRect(Math.round(W / 2 - tw / 2) + 1, ty, tw - 2, 13);
      KText.draw(ctx, txt, W / 2, ty - 1 - pop, C(col), { align: 'center', font: 's' });
      ty += 14;
    }
    this.renderWaiting(ctx);
  }

  // 아래: 두 선수의 조작키 (게임 내내 표시)
  renderKeyBar(ctx) {
    const W = CONFIG.WIDTH;
    const y0 = 156;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, y0, W, CONFIG.HEIGHT - y0);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, y0, W, 1);
    const inp = this.game.input;
    // 개인 화면(나 vs CPU)은 내 키 칸을 넓게 (Space 키가 길어서)
    const divX = this.controllers[1].ai && !this.controllers[0].ai ? 228 : W / 2;
    this.fighters.forEach((f, i) => {
      const c = this.controllers[i];
      const x0 = i === 0 ? 4 : divX + 5;
      if (i === 1) {
        ctx.fillStyle = C('3');
        ctx.fillRect(divX, y0 + 3, 1, 20);
      }
      if (c.ai) {
        const cx = i === 0 ? W / 4 : (divX + W) / 2;
        KText.draw(ctx, `CPU ${f.name}`, cx, y0 + 5, C('j'), { align: 'center', font: 'b' });
        return;
      }
      const K = KEYMAP[f.index];
      const labels = c.solo ? ['<', 'Space', '>'] : K.keys;
      const held = c.solo
        ? [inp.anyDown(SOLO_KEYS.left), inp.anyDown(SOLO_KEYS.skill), inp.anyDown(SOLO_KEYS.right)]
        : [inp.isDown(K.left), inp.isDown(K.skill), inp.isDown(K.right)];
      // 왼쪽 선수: 왼쪽 키 = 후진(뒤로), 오른쪽 키 = 전진(탁구대 쪽) (오른쪽 선수는 반대)
      const leftBack = f.side === 0;
      const caps = [
        [labels[0], leftBack ? '후진' : '전진', leftBack ? 'back' : 'fwd', 0],
        [labels[1], '치기', 'strike', 1],
        [labels[2], leftBack ? '전진' : '후진', leftBack ? 'fwd' : 'back', 2],
      ];
      drawFaceChip(ctx, f.spr, x0, y0 + 4, f.color);
      let cx = x0 + 18;
      caps.forEach(([lab, mean, tone, j]) => {
        const cap = getKeycap(lab, tone, held[j]);
        ctx.drawImage(cap, cx, y0 + 3);
        cx += cap.width + 1;
        KText.draw(ctx, mean, cx, y0 + 5, C(tone === 'strike' ? '9' : 'a'), { font: 's' });
        cx += KText.width(mean, 's') + 3;
      });
    });
  }

  renderOverlay(ctx) {
    const W = CONFIG.WIDTH;
    if (this.state === 'intro') {
      KText.draw(ctx, this.opts.label || '경기', W / 2, 32, C('a'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
      drawPanel(ctx, W / 2 - 112, 68, 224, 58, 'dark');
      KText.draw(ctx, '톡 = 드라이브 (빠르고 낮게)', W / 2, 71, C('a'), { align: 'center', font: 's' });
      KText.draw(ctx, '꾹 → 떼기 = 스매시 (찬스볼에!)', W / 2, 84, C('9'), { align: 'center', font: 's' });
      KText.draw(ctx, '전진 + 톡 = 드롭 (짧게)', W / 2, 97, C('h'), { align: 'center', font: 's' });
      KText.draw(ctx, '후진 + 톡 = 로브 (높고 깊게)', W / 2, 110, C('e'), { align: 'center', font: 's' });
      return;
    }
    const b = this.banner;
    if (!b) return;
    b.t++;
    if (this.state === 'serve') {
      if (b.t < 70 && b.t % 20 < 15) {
        const tw = KText.width(b.text, 'b') + 14;
        drawPanel(ctx, Math.round(W / 2 - tw / 2), 58, tw, 17, 'dark');
        KText.draw(ctx, b.text, W / 2, 59, C('a'), { align: 'center', font: 'b' });
      }
      return;
    }
    const pop = Math.min(1, b.t / 6);
    if (pop < 0.3) return;
    drawPanel(ctx, W / 2 - 90, 48, 180, b.sub ? 40 : 24, 'dark');
    KText.draw(ctx, b.text, W / 2, 51, C(b.color), { align: 'center', font: 'b', outline: C('1') });
    if (b.sub) KText.draw(ctx, b.sub, W / 2, 68, C('a'), { align: 'center', font: 's' });
  }

  // 기다리는 선수들 (토너먼트): 왼쪽 위에 얼굴, 오른쪽 위에 다음 경기
  renderWaiting(ctx) {
    const w = this.opts.waiting;
    if (!w || this.state === 'intro') return;
    const W = CONFIG.WIDTH;
    if (w.faces.length) {
      const bw = 26 + w.faces.length * 17;
      ctx.fillStyle = C('o');
      ctx.fillRect(0, 31, bw, 18);
      ctx.fillStyle = C('8');
      ctx.fillRect(0, 49, bw, 1);
      KText.draw(ctx, '대기', 3, 32, C('j'), { font: 'n' });
      w.faces.forEach((p, i) => drawFaceChip(ctx, p.spr, 24 + i * 17, 32, p.color));
    }
    if (w.next) {
      const tw = KText.width(w.next, 'n') + 8;
      ctx.fillStyle = C('o');
      ctx.fillRect(W - tw, 31, tw, 14);
      ctx.fillStyle = C('8');
      ctx.fillRect(W - tw, 45, tw, 1);
      KText.draw(ctx, w.next, W - 4, 32, C('k'), { font: 'n', align: 'right' });
    }
  }
}

// 얼굴 작은 칩 (16x16): 캐릭터 그림 머리 부분을 잘라서 + 색 테두리
function drawFaceChip(ctx, spr, x, y, color) {
  const src = spr.portrait;
  const S = 14;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, S + 2, S + 2);
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 1, y + 1, S, S);
  ctx.drawImage(src, Math.round((src.width - S) / 2), Math.max(0, src.height - S - 1), S, S, x + 1, y + 1, S, S);
}
