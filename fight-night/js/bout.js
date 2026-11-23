// =====================================================
// Bout: 1:1 한 경기
// ROUND 1 → FIGHT! → (KO 또는 45초 판정) → 승자
// =====================================================
class Bout {
  // a, b: 토너먼트 참가자 / opts: { mode, labels, aiLevel(개인 모드 CPU) }
  constructor(game, a, b, opts = {}) {
    this.game = game;
    this.opts = opts;
    this.red = new Fighter(a, 'red');
    this.blue = new Fighter(b, 'blue');
    this.fighters = [this.red, this.blue];
    // 조종: 개인 모드에서는 파랑 코너가 CPU
    this.controllers = this.fighters.map((f, i) => {
      if (opts.autoplay) return { ai: new BoxerAI(0.4 + Math.random() * 0.5) };
      if (opts.mode === 'personal' && i === 1) return { ai: new BoxerAI(opts.aiLevel || 0.5) };
      return { solo: opts.mode === 'personal' };
    });
    this.ring = new Ring();
    this.particles = new ParticleSystem();
    this.frame = 0;
    this.time = CONFIG.BOUT_TIME;
    this.state = 'intro';
    this.stateT = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.slowmo = 0;
    this.flashScreen = 0;
    this.winner = null;
    this.loser = null;
    this.byKO = false;
    this.done = false;
    this.game.audio.sfx('bell');
  }

  get frozen() {
    return this.state !== 'fight';
  }

  update(input) {
    this.frame++;
    this.ring.update(this.frame);
    this.stateT++;
    if (this.flashScreen > 0) this.flashScreen--;
    if (this.hitstop > 0) {
      this.hitstop--;
      // 멈춘 동안에도 보간 기준은 갱신 (떨림 방지)
      for (const f of this.fighters) {
        f.px = f.x;
        f.gloveP = { ...f.glove };
      }
      return;
    }
    // KO 순간 슬로모션: 2프레임에 한 번만 진행
    if (this.slowmo > 0) {
      this.slowmo--;
      if (this.slowmo % 2 === 1) {
        for (const f of this.fighters) {
          f.px = f.x;
          f.gloveP = { ...f.glove };
        }
        return;
      }
    }
    if (this.shake > 0) this.shake--;

    if (this.state === 'intro') {
      // 링 아나운서: 홍코너 소개 → 청코너 소개 → 라운드 → 땡! → FIGHT!
      if (this.stateT === 4 || this.stateT === 44) this.game.audio.sfx('call');
      if (this.stateT === 110) this.game.audio.sfx('bell');
      if (this.stateT === 128) this.game.audio.sfx('fight');
      if (this.stateT >= INTRO_LEN) this.setState('fight');
    } else if (this.state === 'fight') {
      this.time--;
      if (this.time > 0 && this.time <= 300 && this.time % 60 === 0) this.game.audio.sfx('countdown');
      if (this.time <= 0) this.decide();
    } else if (this.state === 'ko') {
      // 심판 카운트 1~10 → 땡땡 → K.O.!
      const c = Math.floor((this.stateT - COUNT_START) / COUNT_STEP) + 1;
      if (this.stateT >= COUNT_START && (this.stateT - COUNT_START) % COUNT_STEP === 0 && c <= 10) {
        this.count = c;
        this.game.audio.sfx('countdown');
      }
      if (this.stateT === COUNT_START + COUNT_STEP * 10) {
        this.game.audio.sfx('bell');
        this.ring.excite = 200;
      }
      if (this.stateT >= COUNT_START + COUNT_STEP * 10 + 110) this.done = true;
    } else if (this.state === 'decision') {
      if (this.stateT >= 170) this.done = true;
    }

    // 조종 입력
    this.fighters.forEach((f, i) => {
      const opp = this.fighters[1 - i];
      const c = this.controllers[i];
      let ctrl;
      if (c.ai) ctrl = c.ai.control(f, opp);
      else if (c.solo) ctrl = input.solo(f.index);
      else ctrl = input.player(f.index);
      f.update(this, ctrl, opp);
    });
    this.separate();
    // 체력바가 부드럽게 따라 줄어듦
    for (const f of this.fighters) f.hpShown += (f.hp - f.hpShown) * 0.08;
    this.particles.update();
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  // 몸끼리 겹치지 않게 밀어냄
  separate() {
    const min = CONFIG.FIGHTER.BODY_W * 2;
    const a = this.red;
    const b = this.blue;
    const d = b.x - a.x;
    if (Math.abs(d) < min) {
      const push = (min - Math.abs(d)) / 2;
      const s = d >= 0 ? 1 : -1;
      a.x -= s * push;
      b.x += s * push;
    }
  }

  // 펀치 적중 처리 (손맛: 히트스톱 + 흔들림 + 불꽃 + 숫자)
  resolveHit(att, def, kind) {
    const P = CONFIG.PUNCH[kind];
    const { dmg, blocked, slip, counter } = def.takeHit(att, kind, this);
    const hx = Math.round(def.x - att.facing * 9);
    const hy = CONFIG.RING.FLOOR_Y - Math.round((kind === 'power' ? 22 : 18) * CONFIG.SCALE); // 맞는 곳 = 턱 · 가슴 높이
    if (slip) {
      // 슥! 피함 → 카운터 찬스
      this.hitstop = 6;
      this.particles.text(def.x, hy - 22, '슥!', C('h'), { life: 36, kind: 'k', scale: 2 });
      this.particles.burst(def.x, hy, 8, [C('h'), C('b')], 1.2, 14, 1);
      this.game.audio.sfx('swish');
      this.caption = { text: `${def.name} 슥! 카운터 찬스!`, t: 0 };
      return;
    }
    if (counter) {
      // 빡! 카운터
      this.particles.text(hx, hy - 44, '빡!', C('9'), { life: 46, kind: 'k', scale: 2, vy: -0.2 });
      this.particles.text(hx, hy + 2, `카운터! ${dmg}`, C('5'), { life: 46, kind: 'k', vy: 0.2 });
      this.particles.ring(hx, hy, 3, C('9'), 16);
      this.ring.excite = 90;
      this.flashScreen = 4;
      this.caption = { text: `${att.name}의 카운터! 피해 2배!`, t: 0 };
    }
    if (blocked) {
      this.hitstop = 3;
      this.particles.burst(hx, hy, 6, [C('h'), C('b')], 1, 10, 1);
      this.particles.text(hx, hy - 16, '가드!', C('h'), { life: 30, kind: 'k' });
      this.game.audio.sfx('block');
    } else {
      this.hitstop = P.hitstop + (counter ? 8 : 0);
      this.shake = kind === 'power' || counter ? 12 : 4;
      this.particles.burst(hx, hy, kind === 'power' ? 22 : 10, [C('9'), C('b'), C('8')], kind === 'power' ? 2.4 : 1.4, 18, kind === 'power' ? 2 : 1);
      this.particles.ring(hx, hy, kind === 'power' ? 2 : 1.4, C('b'), 10);
      if (!counter) this.particles.text(hx, hy - 18, String(dmg), kind === 'power' ? C('9') : C('a'), { life: 40, kind: 'k', scale: kind === 'power' ? 2 : 1 });
      this.game.audio.sfx(kind === 'power' ? 'power' : 'hit');
      if (kind === 'power') {
        this.ring.excite = 50;
        this.flashScreen = 3;
      }
    }
    if (def.hp <= 0) this.knockout(att, def);
  }

  knockout(att, def) {
    def.setState('ko');
    def.vx = att.facing * 3;
    att.setState('win');
    this.winner = att;
    this.loser = def;
    this.byKO = true;
    this.slowmo = 60;
    this.shake = 16;
    this.hitstop = 14;
    this.ring.excite = 160;
    this.setState('ko');
    this.count = 0;
    this.game.audio.sfx('ko');
  }

  // 시간 종료: 남은 체력 → 맞힌 횟수 → 홍코너 순으로 판정
  decide() {
    const [a, b] = this.fighters;
    let w;
    if (a.hp !== b.hp) w = a.hp > b.hp ? a : b;
    else if (a.hits !== b.hits) w = a.hits > b.hits ? a : b;
    else w = Math.random() < 0.5 ? a : b;
    this.winner = w;
    this.loser = w === a ? b : a;
    this.byKO = false;
    w.setState('win');
    this.ring.excite = 120;
    this.setState('decision');
    this.game.audio.sfx('bell');
  }

  // ---------------- 그리기 ----------------
  render(ctx, alpha) {
    ctx.save();
    if (this.shake > 0) {
      const m = Math.min(3, Math.ceil(this.shake / 4));
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    this.ring.renderBack(ctx, this.frame);
    // 뒤에 있는(다운된) 선수 먼저
    // 다운된 선수는 뒤 · 펀치를 뻗는 선수는 앞 (글러브가 상대 몸에 가려지지 않게)
    const rank = (f) => (f.state === 'ko' ? -1 : f.state === 'punch' || f.state === 'charge' ? 1 : 0);
    const order = [...this.fighters].sort((a, b) => rank(a) - rank(b));
    order.forEach((f) => f.render(ctx, this, this.hitstop > 0 || this.slowmo % 2 === 1 ? 1 : alpha));
    this.ring.renderFront(ctx, this.frame);
    this.particles.render(ctx);
    ctx.restore();
    if (this.flashScreen > 0) {
      ctx.fillStyle = 'rgba(255,248,252,0.35)';
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    }
    this.renderHUD(ctx);
    this.renderKeyBar(ctx);
    this.renderOverlay(ctx);
  }

  // ---- 위: 중계 HUD (얼굴 · 이름 · 굵은 체력바 · 시계) ----
  renderHUD(ctx) {
    const W = CONFIG.WIDTH;
    px(ctx, 0, 0, W, 29, 'o');
    px(ctx, 0, 29, W, 1, '9');
    this.fighters.forEach((f, i) => {
      const left = i === 0;
      const corner = f.corner === 'red' ? '6' : 'g';
      const x = left ? 2 : W - 136;
      drawBroadcastPanel(ctx, x, 2, 134, 26, left ? corner : null);
      if (!left) {
        px(ctx, x + 131, 2, 3, 26, corner);
        px(ctx, x + 131, 2, 1, 26, 'f');
      }
      // 얼굴
      const fx = left ? x + 5 : x + 111;
      ctx.drawImage(f.spr.face, fx, 4);
      // 이름
      const label = `${f.index + 1}P ${f.name}`;
      KText.draw(ctx, label, left ? x + 25 : x + 109, 1, f.color, { font: 'b', align: left ? 'left' : 'right', outline: C('1') });
      // 체력바 (굵게 · 25칸 눈금 · 깎인 만큼 흰색이 잠깐 남음)
      const bw = 84;
      const bx = left ? x + 25 : x + 109 - bw;
      const by = 16;
      px(ctx, bx - 1, by - 1, bw + 2, 10, '1');
      px(ctx, bx, by, bw, 8, '7');
      const shown = Math.round((bw * f.hpShown) / CONFIG.FIGHTER.HP);
      const real = Math.round((bw * f.hp) / CONFIG.FIGHTER.HP);
      const fill = (w, k) => px(ctx, left ? bx : bx + bw - w, by, w, 8, k);
      fill(shown, 'b');
      const low = f.hp < 30;
      fill(real, low ? (this.frame % 20 < 10 ? '5' : '6') : f.corner === 'red' ? '5' : 'h');
      fill(real, null);
      ctx.fillStyle = C('w');
      ctx.fillRect(left ? bx : bx + bw - real, by, real, 2);
      for (let k = 1; k < 4; k++) px(ctx, bx + Math.round((bw * k) / 4), by, 1, 8, '1');
      KText.draw(ctx, String(Math.ceil(f.hp)), left ? bx + bw + 2 : bx - 2, by - 5, C(low ? '5' : 'a'), { font: 'b', align: left ? 'left' : 'right', outline: C('1') });
    });
    // 시계
    const sec = Math.max(0, Math.ceil(this.time / 60));
    drawBroadcastPanel(ctx, W / 2 - 22, 1, 44, 28, null, '1');
    px(ctx, W / 2 - 22, 1, 44, 2, '9');
    const hurry = sec <= 5 && this.state === 'fight';
    KText.draw(ctx, String(sec), W / 2, 3, C(hurry && this.frame % 20 < 10 ? '5' : '9'), { align: 'center', font: 'L', outline: C('1') });
  }

  // ---- 아래: 두 선수의 조작키 (게임 내내 · 큰 키캡 + 지금 뜻) ----
  renderKeyBar(ctx) {
    const W = CONFIG.WIDTH;
    const y0 = 148;
    px(ctx, 0, y0, W, CONFIG.HEIGHT - y0, '1');
    px(ctx, 0, y0, W, 1, '9');
    px(ctx, W / 2, y0 + 3, 1, CONFIG.HEIGHT - y0 - 6, '3');
    const inp = this.game.input;
    this.fighters.forEach((f, i) => {
      const c = this.controllers[i];
      const x0 = i === 0 ? 4 : W / 2 + 6;
      ctx.drawImage(f.spr.face, x0, y0 + 4);
      if (c.ai) {
        drawTag(ctx, x0 + 26, y0 + 8, 44, 14, '2', 'CPU', 'j', 'b');
        return;
      }
      const K = KEYMAP[f.index];
      const labels = c.solo ? ['<', 'SP', '>', 'v'] : K.keys;
      const held = c.solo
        ? [inp.anyDown(SOLO_KEYS.left), inp.anyDown(SOLO_KEYS.skill), inp.anyDown(SOLO_KEYS.right), inp.anyDown(SOLO_KEYS.down)]
        : [inp.isDown(K.left), inp.isDown(K.skill), inp.isDown(K.right), inp.isDown(K.down)];
      // 상대 쪽 키 = 앞 · 반대쪽 = 뒤 · 넷째 = 가드
      const means = f.facing === 1 ? ['뒤', '펀치', '앞', '가드'] : ['앞', '펀치', '뒤', '가드'];
      const tones = { 뒤: 'plain', 앞: 'fwd', 펀치: 'strike', 가드: 'back' };
      const cols = { 뒤: 'k', 앞: '5', 펀치: '9', 가드: 'h' };
      let cx = x0 + 22;
      labels.forEach((lab, j) => {
        const cap = getKeycap(lab, tones[means[j]], !!held[j]);
        const slot = 33;
        ctx.drawImage(cap, Math.round(cx + slot / 2 - cap.width / 2), y0 + 2);
        KText.draw(ctx, means[j], cx + slot / 2, y0 + 17, C(cols[means[j]]), { align: 'center', font: 'b', outline: C('o') });
        cx += slot;
      });
    });
  }

  // ---- 가운데 연출 ----
  renderOverlay(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.stateT;
    if (this.caption) {
      this.caption.t++;
      if (this.caption.t < 70 && this.state === 'fight') {
        const w = KText.width(this.caption.text, 'b') + 14;
        drawBroadcastPanel(ctx, W / 2 - w / 2, 32, w, 16, '9');
        KText.draw(ctx, this.caption.text, W / 2 + 2, 33, C('9'), { align: 'center', font: 'b' });
      }
    }
    if (this.state === 'intro') {
      // 홍코너 / 청코너 소개 카드
      this.introCard(ctx, this.red, t, 0);
      this.introCard(ctx, this.blue, t - 40, 1);
      if (t >= 86 && t < 128) {
        const label = this.opts.label || 'ROUND 1';
        const k = Math.min(1, (t - 86) / 6);
        drawBroadcastPanel(ctx, W / 2 - 80, 44, 160, 34, '9');
        KText.draw(ctx, label, W / 2, 44 + (1 - k) * 8, C('a'), { align: 'center', font: 'L', outline: C('1'), scale: 1 });
        KText.draw(ctx, this.opts.mode === 'personal' ? 'CPU 3연전' : '매직 파이트 나이트', W / 2, 62, C('9'), { align: 'center', font: 's', outline: C('1') });
      }
      if (t >= 128) {
        const s = t < 134 ? 3 : 2;
        KText.draw(ctx, 'FIGHT!', W / 2, 48 - (s - 2) * 8, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: s });
      }
      // 조작 안내 (깔끔한 한 줄)
      if (t >= 60) {
        const tip = '가드 키 = 막기 · 맞기 직전에 가드 = 슥 → 카운터';
        const w = KText.width(tip, 's') + 14;
        drawBroadcastPanel(ctx, W / 2 - w / 2, 120, w, 16, '9');
        KText.draw(ctx, tip, W / 2 + 2, 121, C('a'), { align: 'center', font: 's' });
      }
    }
    if (this.state === 'ko') {
      const end = COUNT_START + COUNT_STEP * 10;
      // 심판 + 카운트
      if (t >= COUNT_START - 10 && t < end + 20) {
        const ref = SPR.bouncer[((this.frame / 14) | 0) % 2];
        const rx = Math.round(this.loser.x + (this.loser.x < W / 2 ? 54 : -54));
        const cx = Math.max(40, Math.min(W - 40, rx));
        const fy = CONFIG.RING.FLOOR_Y - 2;
        // 심판도 선수와 같은 2배 크기 · 카운트할 때 팔을 내리치듯 통통
        const bob = (this.stateT - COUNT_START) % COUNT_STEP < 3 ? 2 : 0;
        ctx.save();
        ctx.translate(cx, fy);
        ctx.scale(CONFIG.SCALE, CONFIG.SCALE);
        ctx.translate(-cx, -fy);
        drawStanding(ctx, ref, cx, fy + bob / 2);
        ctx.restore();
      }
      if (this.count > 0 && t < end + 4) {
        // 카운트 숫자는 심판 반대쪽에 (머리를 가리지 않게)
        const pop = (t - COUNT_START) % COUNT_STEP < 3 ? 3 : 2;
        const cx = this.loser.x < W / 2 ? 84 : W - 84;
        drawBroadcastPanel(ctx, cx - 30, 36, 60, 44, null, '1');
        KText.draw(ctx, String(this.count), cx, 38 - (pop - 2) * 6, C(this.count >= 8 ? '5' : 'b'), { align: 'center', font: 'L', outline: C('1'), scale: pop });
      }
      if (t >= end) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 34, W, 54);
        ctx.clip();
        drawRays(ctx, W / 2, 60, 240, this.frame, '6', '7');
        ctx.restore();
        px(ctx, 0, 33, W, 2, '9');
        px(ctx, 0, 87, W, 2, '9');
        KText.draw(ctx, 'K.O.!', W / 2, 36, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 3 });
      }
    }
    const showWin = (this.state === 'ko' && t > COUNT_START + COUNT_STEP * 10 + 30) || (this.state === 'decision' && t > 30);
    if (this.state === 'decision' && t > 4) {
      drawBroadcastPanel(ctx, W / 2 - 64, 40, 128, 30, '9');
      KText.draw(ctx, '시간 종료!', W / 2, 42, C('a'), { align: 'center', font: 'L', outline: C('1') });
    }
    if (showWin) {
      const msg = `${this.winner.name} 승리! ${this.byKO ? 'KO' : '판정'}`;
      const w = KText.width(msg, 'b') + 30;
      drawBroadcastPanel(ctx, W / 2 - w / 2, 92, w, 20, this.winner.corner === 'red' ? '6' : 'g');
      ctx.drawImage(SPR.crown, W / 2 - w / 2 + 7, 99);
      KText.draw(ctx, msg, W / 2 + 6, 95, C('9'), { align: 'center', font: 'b', outline: C('1') });
    }
  }

  // 선수 소개 카드 (TV 하단 자막처럼 밀려 들어옴)
  introCard(ctx, f, t, side) {
    if (t < 0 || this.stateT >= 84) return;
    const W = CONFIG.WIDTH;
    const k = Math.min(1, t / 10);
    const w = 150;
    const target = side === 0 ? 6 : W - 6 - w;
    const x = Math.round(target + (1 - k) * (side === 0 ? -(w + 6) : w + 6));
    const y = side === 0 ? 38 : 76;
    const col = f.corner === 'red' ? '6' : 'g';
    drawBroadcastPanel(ctx, x, y, w, 36, col);
    px(ctx, x + 3, y, w - 3, 13, col);
    KText.draw(ctx, `${side === 0 ? '홍코너' : '청코너'} · ${f.def.title || ''}`, x + 8, y - 1, C('b'), { font: 's', outline: C('1') });
    ctx.drawImage(f.spr.face, x + 8, y + 15);
    KText.draw(ctx, f.name, x + 32, y + 14, C('9'), { font: 'L', outline: C('1') });
  }
}

const INTRO_LEN = 150;   // 소개 → 라운드 → FIGHT! 까지
const COUNT_START = 40;  // KO 후 카운트 시작
const COUNT_STEP = 10;   // 카운트 한 번 간격

function px(ctx, x, y, w, h, k) {
  if (!k) return;
  ctx.fillStyle = C(k);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
