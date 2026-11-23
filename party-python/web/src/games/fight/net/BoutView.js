// =====================================================
// BoutView: 서버가 보내 준 한 경기 상태를 원본 그림 코드로 그린다.
//  - 선수 그림은 원본 Fighter(orig/fighter.js)의 render · animateGloves 를 그대로 쓴다.
//  - HUD · 조작 바 · 소개 카드 · KO 카운트 · 자막은 원본 bout.js 의 그리기 코드를 옮긴 것이다.
//  - 판정은 하지 않는다. 서버 상태(apply)와 사건(onEvent)만 받아 보여 준다.
//  - 내 선수가 청코너(오른쪽)면 화면을 좌우로 뒤집어, 내 선수가 항상 왼쪽(홍코너 색)에 보이게 한다.
// =====================================================
import { CONFIG } from '../config.js';
import { C } from '../orig/palette.js';
import { CHARACTERS } from '../orig/characters.js';
import { SPR, drawStanding, getKeycap } from '../orig/sprites.js';
import { KText } from '../orig/ui.js';
import { drawBroadcastPanel, drawTag, drawRays } from '../orig/ui-broadcast.js';
import { ParticleSystem } from '../orig/particles.js';
import { Ring } from '../orig/ring.js';
import { Fighter } from '../orig/fighter.js';

const INTRO_LEN = CONFIG.INTRO_LEN;
const COUNT_START = CONFIG.COUNT_START;
const COUNT_STEP = CONFIG.COUNT_STEP;
const SNAP_TICKS = 2;   // 서버 상태는 로직 2프레임(1/30초)마다 온다
const SAY_FRAMES = 150; // 해설 자막을 보여 주는 시간

function px(ctx, x, y, w, h, k) {
  if (!k) return;
  ctx.fillStyle = C(k);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 동물 id → 원본 캐릭터 번호 */
export function charIndex(character) {
  const i = CHARACTERS.findIndex((c) => c.id === character);
  return i >= 0 ? i : 0;
}

export class BoutView {
  /**
   * left, right: 화면 왼쪽 · 오른쪽에 그릴 참가자 { id, name, character }
   * opts: { mirror(서버의 청코너가 왼쪽인지), mine(내 경기인지), label, audio, heldKeys() }
   */
  constructor(left, right, opts) {
    this.opts = opts;
    this.mirror = !!opts.mirror;
    this.audio = opts.audio;
    const make = (p, corner) => {
      const idx = charIndex(p.character);
      const def = CHARACTERS[idx];
      return new Fighter({ index: idx, def, name: p.name, color: C(def.color) }, corner);
    };
    this.red = make(left, 'red');     // 화면 왼쪽 (홍코너 색)
    this.blue = make(right, 'blue');  // 화면 오른쪽 (청코너 색)
    this.fighters = [this.red, this.blue];
    for (const f of this.fighters) {
      f.target = f.x;
      f.punchBase = 0;
      f.blockShake = 0;
      f.slipT = 0;
      f.counterT = 0;
    }
    this.ring = new Ring();
    this.particles = new ParticleSystem();
    this.frame = 0;
    this.time = CONFIG.BOUT_TIME;
    this.state = 'intro';
    this.stateT = 0;
    this.snapStateT = 0;
    this.sinceSnap = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.shake = 0;
    this.flashScreen = 0;
    this.count = 0;
    this.winner = null;
    this.loser = null;
    this.byKO = false;
    this.caption = null;
    this.got = false;
  }

  /** 서버 코너 이름('red'|'blue') → 화면의 선수 */
  side(name) {
    const red = this.mirror ? name === 'blue' : name === 'red';
    return red ? this.red : this.blue;
  }

  mx(x) {
    return this.mirror ? CONFIG.WIDTH - x : x;
  }

  /** 서버 상태 반영 */
  apply(s) {
    if (!s) return;
    const sign = this.mirror ? -1 : 1;
    for (const name of ['red', 'blue']) {
      const src = s[name];
      const f = this.side(name);
      f.target = this.mx(src.x);
      if (!this.got || Math.abs(f.target - f.x) > 40) {
        f.x = f.target;
        f.px = f.x;
      }
      f.vx = src.vx * sign;
      f.hp = src.hp;
      if (!this.got) f.hpShown = src.hp;
      f.facing = src.facing * sign;
      f.state = src.state;
      f.t = src.t;
      f.punch = src.punch ? { kind: src.punch[0], t: src.punch[1], hit: false } : null;
      if (f.state === 'punch' && !f.punch) f.state = 'idle';
      f.punchBase = src.punch ? src.punch[1] : 0;
      f.chargeT = src.chargeT;
      f.flash = src.flash;
      f.squash = src.squash;
      f.blockShake = src.blockShake;
      f.slipT = src.slipT;
      f.counterT = src.counterT;
      f.hits = src.hits;
    }
    this.time = s.time;
    this.state = s.state;
    this.snapStateT = s.stateT;
    this.stateT = s.stateT;
    this.hitstop = s.hitstop;
    this.slowmo = s.slowmo;
    this.count = s.count;
    this.byKO = s.byKO;
    this.winner = s.winner ? this.side(s.winner) : null;
    this.loser = this.winner ? (this.winner === this.red ? this.blue : this.red) : null;
    this.done = s.done;
    this.sinceSnap = 0;
    this.got = true;
  }

  /** 화면 쪽 1프레임(1/60초): 위치를 부드럽게 따라가고 글러브 · 효과를 움직인다 */
  tick() {
    this.frame++;
    this.ring.update(this.frame);
    this.sinceSnap++;
    if (this.flashScreen > 0) this.flashScreen--;
    if (this.shake > 0 && this.hitstop <= 0) this.shake--;
    const held = this.hitstop > 0;
    const lead = held || this.done ? 0 : Math.min(this.sinceSnap, SNAP_TICKS + 1);
    this.stateT = this.snapStateT + lead;
    for (const f of this.fighters) {
      f.px = f.x;
      f.gloveP = { ...f.glove };
      if (held) continue;
      f.x += (f.target - f.x) * 0.5;
      // 걷기 리듬 · 몸 기울기 (원본 Fighter.move 의 그림 부분)
      f.walkPhase += Math.abs(f.vx) * 0.18;
      let leanTarget = Math.max(-2, Math.min(2, f.vx * 1.2));
      if (f.state === 'punch') leanTarget = f.facing * (f.punch.kind === 'power' ? 3 : 2);
      if (f.state === 'guard') leanTarget = -f.facing * 1;
      if (f.state === 'stun') leanTarget = -f.facing * 2;
      f.lean += (leanTarget - f.lean) * 0.3;
      if (f.punch) {
        const P = CONFIG.PUNCH[f.punch.kind];
        f.punch.t = Math.min(P.startup + P.active + P.recovery, f.punchBase + lead);
      }
      if (f.state === 'charge' && this.frame % 6 === 0) {
        this.particles.add(f.x + f.facing * 2 + (Math.random() * 8 - 4), CONFIG.RING.FLOOR_Y - 12, 0, -0.5, 16, C('9'), 1);
      }
      f.animateGloves(this);
    }
    for (const f of this.fighters) f.hpShown += (f.hp - f.hpShown) * 0.08;
    this.particles.update();
    if (this.caption) this.caption.t++;
  }

  /** 서버 사건 → 소리 · 효과 (원본 bout.js 의 resolveHit · knockout · decide 연출) */
  onEvent(ev) {
    const sfx = (name) => this.audio.sfx(name);
    switch (ev.type) {
      case 'cue':
        if (ev.name === 'koBell') {
          sfx('bell');
          this.ring.excite = 200;
        } else sfx(ev.name);
        break;
      case 'count':
        sfx('countdown');
        break;
      case 'dash': {
        const f = this.side(ev.side);
        sfx('dash');
        this.particles.burst(f.x - f.facing * 12, CONFIG.RING.FLOOR_Y - 2, 7, [C('k'), C('j')], 1, 14, 1);
        break;
      }
      case 'punch':
        sfx(ev.kind === 'power' ? 'whoosh' : 'swish');
        break;
      case 'hit':
        this.hitEffect(ev);
        break;
      case 'ko':
        this.shake = 16;
        this.ring.excite = 160;
        sfx('ko');
        break;
      case 'decision':
        this.ring.excite = 120;
        sfx('bell');
        break;
      case 'say':
        this.caption = { text: ev.text, t: 0, ai: ev.source === 'gemini' };
        break;
      default:
        break;
    }
  }

  hitEffect(ev) {
    const kind = ev.kind;
    const dir = this.mirror ? -ev.dir : ev.dir;
    const defX = this.mx(ev.x);
    const hx = Math.round(defX - dir * 9);
    const hy = CONFIG.RING.FLOOR_Y - Math.round((kind === 'power' ? 22 : 18) * CONFIG.SCALE); // 맞는 곳 = 턱 · 가슴 높이
    const sfx = (name) => this.audio.sfx(name);
    if (ev.slip) {
      // 슥! 피함 → 카운터 찬스
      this.particles.text(defX, hy - 22, '슥!', C('h'), { life: 36, kind: 'k', scale: 2 });
      this.particles.burst(defX, hy, 8, [C('h'), C('b')], 1.2, 14, 1);
      sfx('swish');
      return;
    }
    if (ev.counter) {
      // 빡! 카운터
      this.particles.text(hx, hy - 44, '빡!', C('9'), { life: 46, kind: 'k', scale: 2, vy: -0.2 });
      this.particles.text(hx, hy + 2, `카운터! ${ev.dmg}`, C('5'), { life: 46, kind: 'k', vy: 0.2 });
      this.particles.ring(hx, hy, 3, C('9'), 16);
      this.ring.excite = 90;
      this.flashScreen = 4;
    }
    if (ev.blocked) {
      this.particles.burst(hx, hy, 6, [C('h'), C('b')], 1, 10, 1);
      this.particles.text(hx, hy - 16, '가드!', C('h'), { life: 30, kind: 'k' });
      sfx('block');
    } else {
      this.shake = kind === 'power' || ev.counter ? 12 : 4;
      this.particles.burst(hx, hy, kind === 'power' ? 22 : 10, [C('9'), C('b'), C('8')], kind === 'power' ? 2.4 : 1.4, 18, kind === 'power' ? 2 : 1);
      this.particles.ring(hx, hy, kind === 'power' ? 2 : 1.4, C('b'), 10);
      if (!ev.counter) this.particles.text(hx, hy - 18, String(ev.dmg), kind === 'power' ? C('9') : C('a'), { life: 40, kind: 'k', scale: kind === 'power' ? 2 : 1 });
      sfx(kind === 'power' ? 'power' : 'hit');
      if (kind === 'power') {
        this.ring.excite = 50;
        this.flashScreen = 3;
      }
    }
  }

  // ---------------- 그리기 (원본 bout.js) ----------------
  renderScene(ctx, alpha) {
    ctx.save();
    if (this.shake > 0) {
      const m = Math.min(3, Math.ceil(this.shake / 4));
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    this.ring.renderBack(ctx, this.frame);
    // 다운된 선수는 뒤 · 펀치를 뻗는 선수는 앞 (글러브가 상대 몸에 가려지지 않게)
    const rank = (f) => (f.state === 'ko' ? -1 : f.state === 'punch' || f.state === 'charge' ? 1 : 0);
    const order = [...this.fighters].sort((a, b) => rank(a) - rank(b));
    order.forEach((f) => f.render(ctx, this, this.hitstop > 0 ? 1 : alpha));
    this.ring.renderFront(ctx, this.frame);
    this.particles.render(ctx);
    ctx.restore();
    if (this.flashScreen > 0) {
      ctx.fillStyle = 'rgba(255,248,252,0.35)';
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    }
  }

  render(ctx, alpha) {
    this.renderScene(ctx, alpha);
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
      KText.draw(ctx, f.name, left ? x + 25 : x + 109, 1, f.color, { font: 'b', align: left ? 'left' : 'right', outline: C('1') });
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

  // ---- 아래: 조작 바 (왼쪽 = 내 키 4개와 지금 뜻 · 오른쪽 = 상대 / 관전 표시) ----
  renderKeyBar(ctx) {
    const W = CONFIG.WIDTH;
    const y0 = 148;
    px(ctx, 0, y0, W, CONFIG.HEIGHT - y0, '1');
    px(ctx, 0, y0, W, 1, '9');
    px(ctx, W / 2, y0 + 3, 1, CONFIG.HEIGHT - y0 - 6, '3');
    this.fighters.forEach((f, i) => {
      const x0 = i === 0 ? 4 : W / 2 + 6;
      ctx.drawImage(f.spr.face, x0, y0 + 4);
      if (i === 1 || !this.opts.mine) {
        const big = KText.width(f.name, 'b') <= 60;
        KText.draw(ctx, f.name, x0 + 24, y0 + 9, f.color, { font: big ? 'b' : 'n', outline: C('1') });
        drawTag(ctx, x0 + 100, y0 + 8, 44, 14, '2', this.opts.mine ? '상대' : '관전 중', 'j', 'b');
        return;
      }
      const labels = ['<', 'SP', '>', 'v'];
      const held = this.opts.heldKeys ? this.opts.heldKeys() : [false, false, false, false];
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

  // 해설 자막 (원본 this.caption 자리). AI 가 쓴 줄에는 작은 "AI" 표시
  renderCaption(ctx, y) {
    const cap = this.caption;
    if (!cap || cap.t >= SAY_FRAMES) return;
    const W = CONFIG.WIDTH;
    const tw = KText.width(cap.text, 'b');
    const aiW = cap.ai ? 18 : 0;
    const w = tw + 14 + aiW;
    const x = Math.round(W / 2 - w / 2);
    drawBroadcastPanel(ctx, x, y, w, 16, '9');
    if (cap.ai) drawTag(ctx, x + 5, y + 2, 15, 12, '9', 'AI', '1', 'n');
    KText.draw(ctx, cap.text, x + 8 + aiW, y + 1, C('9'), { font: 'b' });
  }

  // ---- 가운데 연출 ----
  renderOverlay(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.stateT;
    if (this.state === 'fight') this.renderCaption(ctx, 32);
    if (this.state === 'intro') {
      // 홍코너 / 청코너 소개 카드
      this.introCard(ctx, this.red, t, 0);
      this.introCard(ctx, this.blue, t - 40, 1);
      if (t >= 86 && t < 128) {
        const label = this.opts.label || 'ROUND 1';
        const k = Math.min(1, (t - 86) / 6);
        drawBroadcastPanel(ctx, W / 2 - 80, 44, 160, 34, '9');
        KText.draw(ctx, label, W / 2, 44 + (1 - k) * 8, C('a'), { align: 'center', font: 'L', outline: C('1'), scale: 1 });
        KText.draw(ctx, '매직 파이트 나이트', W / 2, 62, C('9'), { align: 'center', font: 's', outline: C('1') });
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
    if (this.state === 'ko' && this.loser) {
      const end = COUNT_START + COUNT_STEP * 10;
      // 심판 + 카운트
      if (t >= COUNT_START - 10 && t < end + 20) {
        const ref = SPR.bouncer[((this.frame / 14) | 0) % 2];
        const rx = Math.round(this.loser.x + (this.loser.x < W / 2 ? 54 : -54));
        const cx = Math.max(40, Math.min(W - 40, rx));
        const fy = CONFIG.RING.FLOOR_Y - 2;
        const bob = (t - COUNT_START) % COUNT_STEP < 3 ? 2 : 0;
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
    if (showWin && this.winner) {
      const msg = `${this.winner.name} 승리! ${this.byKO ? 'KO' : '판정'}`;
      const w = KText.width(msg, 'b') + 30;
      drawBroadcastPanel(ctx, W / 2 - w / 2, 92, w, 20, this.winner.corner === 'red' ? '6' : 'g');
      ctx.drawImage(SPR.crown, W / 2 - w / 2 + 7, 99);
      KText.draw(ctx, msg, W / 2 + 6, 95, C('9'), { align: 'center', font: 'b', outline: C('1') });
    }
    // 경기 결과 해설은 승리 띠 아래에
    if (this.state === 'ko' || this.state === 'decision') this.renderCaption(ctx, 116);
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
