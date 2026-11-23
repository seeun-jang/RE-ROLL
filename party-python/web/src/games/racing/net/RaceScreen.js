// =============================================================
// 레이싱 — 화면 (멀티플레이)
//
// 차의 위치·바퀴 수·순위는 서버가 정한다. 여기서는
//  - 트랙과 모든 차를 픽셀 아트로 그리고(내 차를 따라가는 화면 + 미니맵),
//  - 손 제스처(핸들) 값을 서버로 보내고(카메라를 쓸 수 없을 때만 키보드),
//  - 내 차는 같은 식으로 바로 움직여 보이되 서버 위치 쪽으로 계속 끌어당긴다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../../shared/animals.js';
import { drawPixelText } from '../../../shared/pixelText.js';
import { DEFAULT_CONFIG } from '../sim/config.js';
import { LOGIC_FPS, detCos, detSin, nearest, stepCar } from '../sim/rules.js';
import { RaceAudio } from './RaceAudio.js';
import { CAR_HALF, buildCarSprites, buildMiniMap, buildWorldCanvas, carFrame } from './RaceWorld.js';
import { WheelGesture } from './WheelGesture.js';

const VW = 320;
const VH = 180;
const SKID_LIFE = 2.0;          // 타이어 자국이 남는 시간(초)
const SEND_EVERY = 0.05;        // 입력을 보내는 최소 간격(초)
const INK = '#181425';
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Space: 'drift' };
const PLACE = ['1st', '2nd', '3rd', '4th', '5th'];

const CSS = `
.rc-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #181425; overflow: hidden; }
.rc-wrap { position: relative; flex: none; }
.rc-wrap > canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.rc-ui { position: absolute; inset: 0; pointer-events: none; font-family: 'Galmuri9', 'Galmuri11', monospace; color: #fff; }
.rc-cam { position: absolute; right: 3em; bottom: 3em; display: flex; flex-direction: column; align-items: flex-end; gap: 2em; }
.rc-cam canvas { width: 64em; height: 36em; border: 1em solid #c0cbdc; image-rendering: pixelated; background: #262b44; }
.rc-cam span { font-size: 7em; line-height: 1.2; text-shadow: 1px 1px 0 #181425, -1px 0 0 #181425, 0 -1px 0 #181425, 1px 0 0 #181425; }
`;

const fmtTime = (t) => {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
};

export class RaceScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.meId = me ? me.id : null;
    this.laps = this.opt.laps ?? 3;
    this.countdown = this.opt.countdown ?? 3;
    this.world = this.opt.world || DEFAULT_CONFIG.WORLD;
    // 서버가 보낸 트랙(가운데 선) → 내 차를 미리 움직여 볼 때 쓰는 트랙 정보
    const tx = this.opt.track.x;
    const ty = this.opt.track.y;
    this.track = {
      x: tx, y: ty, n: tx.length, half: this.opt.track.half, limit: this.opt.track.limit, search: DEFAULT_CONFIG.TRACK.SEARCH,
      len: tx.map((_, i) => Math.hypot(tx[(i + 1) % tx.length] - tx[i], ty[(i + 1) % tx.length] - ty[i])),
    };
    this.players = players.map((p) => {
      const animal = ANIMALS[p.character] || animalForIndex(p.index ?? 0);
      return { id: p.id, name: p.name, color: animal.color, isMe: p.id === this.meId, sprites: buildCarSprites(animal.color), view: null };
    });
    this.byId = new Map(this.players.map((p) => [p.id, p]));

    this._buildDom();
    this.worldCanvas = buildWorldCanvas(this.world, this.track);
    this.mini = buildMiniMap(this.world, this.track, 70, 44);
    this.audio = new RaceAudio();
    this.gesture = new WheelGesture(this.ui);

    this.keys = { up: false, down: false, left: false, right: false, drift: false };
    this.input = { steer: 0, throttle: 0, drift: 0 };
    this.sent = { steer: null, throttle: null, drift: null, at: 0 };
    this.myCar = null;            // 내 차(미리 움직여 보는 것)
    this.acc = 0;
    this.skids = [];              // { x, y, until }
    this.lastSnap = null;
    this.camX = 0;
    this.camY = 0;
    this.time = 0;
    this.notice = null;           // { text, color, until }
    this.done = new Set();
    this._destroyed = false;

    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      const k = KEYS[e.code];
      if (k) {
        this.keys[k] = true;
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyM') this.audio.toggleMute();
      if (e.code === 'KeyR') this.gesture.recalibrate();        // 손 크기 기준 다시 잡기
      if (e.code === 'KeyI') this.gesture.invert = !this.gesture.invert;   // 조향 방향 뒤집기
    };
    this._onKeyUp = (e) => {
      const k = KEYS[e.code];
      if (k) this.keys[k] = false;
    };
    this._onBlur = () => { for (const k of Object.keys(this.keys)) this.keys[k] = false; };
    this._onPointer = () => this.audio.unlock();
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointerdown', this._onPointer);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    try { this.audio.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
    if (this.meId) this.gesture.start();

    this._last = performance.now();
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (ts - this._last) / 1000);
      this._last = ts;
      this._update(dt);
      this._render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.gesture.destroy();
    this.audio.destroy();
    this.root.remove();
    this.styleEl.remove();
  }

  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'rc-root';
    this.wrap = document.createElement('div');
    this.wrap.className = 'rc-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = VW;
    this.canvas.height = VH;
    this.ui = document.createElement('div');
    this.ui.className = 'rc-ui';
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.ui);
    this.root.appendChild(this.wrap);
    this.container.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.autoHeight = this.container.clientHeight === 0;
  }

  _fit() {
    const w = this.root.clientWidth || VW * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / VW, h / VH))));
    this.wrap.style.width = `${VW * s}px`;
    this.wrap.style.height = `${VH * s}px`;
    this.ui.style.fontSize = `${s}px`;
    if (this.autoHeight) this.root.style.height = `${VH * s}px`;
  }

  _once(key, fn) {
    if (this.done.has(key)) return;
    this.done.add(key);
    fn();
  }

  // ---------------- 입력 ----------------
  /** 손 제스처가 되면 손으로만, 카메라를 쓸 수 없을 때만 키보드로 */
  _readInput() {
    const g = this.gesture;
    if (g.usable) {
      this.mode = 'hand';
      this.input = { steer: g.steer, throttle: g.throttle, drift: g.drift };
    } else if (g.failed) {
      this.mode = 'keys';
      const K = this.keys;
      this.input = { steer: (K.right ? 1 : 0) - (K.left ? 1 : 0), throttle: K.up ? 1 : K.down ? -1 : 0, drift: K.drift ? 1 : 0 };
    } else {
      this.mode = 'wait';
      this.input = { steer: 0, throttle: 0, drift: 0 };
    }
  }

  _sendInput(racing) {
    if (!this.meId || !racing) return;
    const r = (v) => Math.round(v * 100) / 100;
    const cur = { steer: r(this.input.steer), throttle: r(this.input.throttle), drift: r(this.input.drift) };
    const s = this.sent;
    if (cur.steer === s.steer && cur.throttle === s.throttle && cur.drift === s.drift) return;
    if (this.time - s.at < SEND_EVERY) return;
    this.sent = { ...cur, at: this.time };
    this.net.input(cur.steer, cur.throttle, cur.drift);
  }

  // ---------------- 서버 상태 ----------------
  _applySnapshot(s) {
    for (const p of this.players) {
      const c = s.cars[p.id];
      if (!c) continue;
      const sv = { x: c[0], y: c[1], a: c[2], vx: c[3], vy: c[4], drifting: !!c[5], lap: c[6], progress: c[7], place: c[8], finished: !!c[9], finishTime: c[10], at: s.now };
      if (!p.view) p.view = { x: sv.x, y: sv.y, a: sv.a };
      p.server = sv;
    }
    const mine = this.meId && this.byId.get(this.meId).server;
    if (!mine) return;
    if (!this.myCar) {
      const [seg, t] = nearest({ ...this.track, search: this.track.n }, mine.x, mine.y, 0);
      this.myCar = { x: mine.x, y: mine.y, a: mine.a, vx: mine.vx, vy: mine.vy, seg, prog: seg + t, total: 0, drifting: false, hit: 0, steer: 0, throttle: 0, drift: 0 };
      return;
    }
    // 내 차: 미리 움직여 본 위치를 서버 위치 쪽으로 끌어당긴다(많이 벌어지면 바로 맞춘다)
    const car = this.myCar;
    const dx = mine.x - car.x;
    const dy = mine.y - car.y;
    if (s.phase !== 'race' || mine.finished || Math.hypot(dx, dy) > 36) {
      Object.assign(car, { x: mine.x, y: mine.y, a: mine.a, vx: mine.vx, vy: mine.vy });
    } else {
      const k = 0.12;
      car.x += dx * k;
      car.y += dy * k;
      car.vx += (mine.vx - car.vx) * k;
      car.vy += (mine.vy - car.vy) * k;
      let da = mine.a - car.a;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      car.a += da * k;
    }
  }

  _handleEvent(e) {
    const p = this.byId.get(e.playerId);
    if (!p) return;
    if (e.type === 'wall') {
      if (p.isMe) this.audio.bump();
    } else if (e.type === 'lap') {
      if (p.isMe && e.lap < this.laps) {
        this.audio.lap();
        this.notice = { text: e.lap === this.laps - 1 ? '마지막 바퀴!' : `${e.lap + 1}바퀴째`, color: '#fee761', until: this.time + 1.6 };
      }
    } else if (e.type === 'finish') {
      if (p.isMe) {
        this.audio.finish();
        this.notice = { text: `도착! ${e.place}등`, color: '#fee761', until: this.time + 4 };
      } else if (e.place === 1) {
        this.audio.lap();
        this.notice = { text: `${p.name} 1등 도착 — 30초 안에 들어오세요`, color: '#f6757a', until: this.time + 3 };
      }
    }
  }

  // ---------------- 매 프레임 ----------------
  _update(dt) {
    this.time += dt;
    const s = this.net.snap;
    if (s && s !== this.lastSnap) {
      this.lastSnap = s;
      this._applySnapshot(s);
    }
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    const now = this.net.now();
    this.gt = s ? now - s.startAt : -999;
    const racing = !!s && s.phase === 'race';
    const me = this.meId ? this.byId.get(this.meId) : null;

    this.gesture.update();
    this._readInput();
    this._sendInput(racing && me && me.server && !me.server.finished);

    // 내 차 미리 움직이기 (서버와 같은 식, 1/60초 단위)
    if (this.myCar && racing && me.server && !me.server.finished && this.gt >= 0) {
      Object.assign(this.myCar, this.input);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= 1 / LOGIC_FPS && steps < 6) {
        stepCar(this.myCar, DEFAULT_CONFIG, this.track, 1 / LOGIC_FPS);
        this.acc -= 1 / LOGIC_FPS;
        steps++;
      }
      if (steps >= 6) this.acc = 0;
    }

    // 화면에 그릴 위치
    for (const p of this.players) {
      const sv = p.server;
      if (!sv) continue;
      if (p.isMe && this.myCar) {
        p.view = { x: this.myCar.x, y: this.myCar.y, a: this.myCar.a };
        p.drifting = racing && this.myCar.drifting;
        continue;
      }
      // 다른 차: 마지막 서버 상태에서 속도만큼 이어 그린다
      const age = racing ? Math.max(0, Math.min(0.12, now - sv.at)) : 0;
      const tx = sv.x + sv.vx * age;
      const ty = sv.y + sv.vy * age;
      const k = Math.min(1, dt * 18);
      p.view.x += (tx - p.view.x) * k;
      p.view.y += (ty - p.view.y) * k;
      let da = sv.a - p.view.a;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      p.view.a += da * k;
      p.drifting = racing && sv.drifting;
    }

    // 타이어 자국 (2초 뒤 사라진다)
    this.skidTick = (this.skidTick || 0) + dt;
    if (this.skidTick >= 1 / 30) {
      this.skidTick = 0;
      for (const p of this.players) {
        if (!p.drifting || !p.view) continue;
        const fx = detCos(p.view.a);
        const fy = detSin(p.view.a);
        for (const side of [-1, 1]) {
          this.skids.push({ x: p.view.x - fx * 5 - fy * 3 * side, y: p.view.y - fy * 5 + fx * 3 * side, until: this.time + SKID_LIFE });
        }
        if (p.isMe && Math.random() < 0.3) this.audio.skid();
      }
    }
    while (this.skids.length && this.skids[0].until <= this.time) this.skids.shift();

    // 진행에 따른 소리
    if (s) {
      if (this.gt >= -this.countdown && this.gt < 0) {
        const n = Math.ceil(-this.gt);
        if (n !== this.shownCount) {
          this.shownCount = n;
          this.audio.beep();
        }
      } else if (racing) {
        this._once('go', () => { if (this.gt < 1.5) this.audio.go(); });
      }
      if (s.results) this._once('final', () => this.audio.finish());
    }
    const speed = this.myCar ? Math.hypot(this.myCar.vx, this.myCar.vy) / DEFAULT_CONFIG.CAR.MAX_SPEED : 0;
    this.audio.engine(Math.min(1, speed), racing && !!me && !!me.server && !me.server.finished);

    // 화면이 따라갈 차: 내 차, 관전이면 1등
    let focus = me && me.view ? me.view : null;
    if (!focus && s && s.order) {
      const lead = this.byId.get(s.order[0]);
      focus = lead && lead.view;
    }
    if (focus) {
      this.camX = Math.max(0, Math.min(this.world.W - VW, focus.x - VW / 2));
      this.camY = Math.max(0, Math.min(this.world.H - VH, focus.y - VH / 2));
    }
  }

  // ---------------- 그리기 ----------------
  _render() {
    const ctx = this.ctx;
    const s = this.net.snap;
    ctx.imageSmoothingEnabled = false;
    const cx = Math.round(this.camX);
    const cy = Math.round(this.camY);
    ctx.drawImage(this.worldCanvas, cx, cy, VW, VH, 0, 0, VW, VH);

    // 타이어 자국: 오래될수록 옅게
    for (const k of this.skids) {
      const left = (k.until - this.time) / SKID_LIFE;
      ctx.globalAlpha = left > 0.66 ? 0.6 : left > 0.33 ? 0.4 : 0.2;
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(k.x - cx), Math.round(k.y - cy), 2, 2);
    }
    ctx.globalAlpha = 1;

    // 차 (내 차를 맨 위에)
    const list = this.players.filter((p) => p.view).sort((a, b) => (a.isMe ? 1 : 0) - (b.isMe ? 1 : 0));
    for (const p of list) {
      const x = Math.round(p.view.x - cx);
      const y = Math.round(p.view.y - cy);
      if (x < -20 || y < -20 || x > VW + 20 || y > VH + 20) continue;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = INK;
      ctx.fillRect(x - 7, y + 4, 14, 4);            // 그림자
      ctx.globalAlpha = p.isMe || !this.meId ? 1 : 0.85;
      ctx.drawImage(carFrame(p.sprites, p.view.a), x - CAR_HALF, y - CAR_HALF);
      ctx.globalAlpha = 1;
      drawPixelText(ctx, p.isMe ? '나' : p.name, x, y - 22, { color: p.isMe ? '#fee761' : '#ffffff', outline: INK, align: 'center' });
    }

    if (!s) {
      this._panel(60, 74, 200, 30);
      drawPixelText(ctx, '서버를 기다리는 중…', 160, 83, { align: 'center' });
      return;
    }
    this._drawHud(s);
    if (this.gt < -this.countdown) this._drawIntro();
    else if (this.gt < 0) {
      this._bigText(String(Math.ceil(-this.gt)), '#fee761');
    } else if (s.results) this._drawFinal(s.results);
    else if (s.phase === 'ending') this._bigText('경기 끝!', '#fee761');
    else if (this.gt < 1.2) this._bigText('출발!', '#63c74d');
    else if (this.notice && this.notice.until > this.time) {
      drawPixelText(ctx, this.notice.text, 160, 46, { color: this.notice.color, outline: INK, align: 'center' });
    }
  }

  _panel(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#262b44';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  _bigText(text, color) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.6)';
    ctx.fillRect(0, 66, VW, 34);
    drawPixelText(ctx, text, 160, 70, { color, outline: INK, align: 'center', size: 20 });
  }

  _drawHud(s) {
    const ctx = this.ctx;
    const me = this.meId ? this.byId.get(this.meId) : null;
    const sv = me && me.server;
    // 왼쪽 위: 바퀴 수 · 순위 · 시간
    ctx.fillStyle = 'rgba(24,20,37,0.7)';
    ctx.fillRect(2, 2, 74, sv ? 38 : 14);
    const t = Math.max(0, Math.min(this.gt, s.frame ? s.frame / LOGIC_FPS : 0));
    drawPixelText(ctx, fmtTime(s.phase === 'race' ? Math.max(0, this.gt) : t), 5, 3, { color: '#c0cbdc' });
    if (sv) {
      drawPixelText(ctx, `${sv.lap}/${this.laps} 바퀴`, 5, 15, { color: '#ffffff' });
      drawPixelText(ctx, `${sv.place}등 / ${this.players.length}명`, 5, 27, { color: sv.place === 1 ? '#fee761' : '#ffffff' });
    }
    // 1등이 들어온 뒤 남은 시간
    if (s.deadline !== null && s.deadline !== undefined && s.phase === 'race') {
      const left = Math.max(0, Math.ceil(s.deadline - this.gt));
      drawPixelText(ctx, `마감까지 ${left}초`, 160, 3, { color: left <= 10 ? '#e43b44' : '#fee761', outline: INK, align: 'center' });
    }
    // 오른쪽 위: 미니맵
    const mx = VW - this.mini.canvas.width - 2;
    ctx.drawImage(this.mini.canvas, mx, 2);
    for (const p of this.players) {
      if (!p.view) continue;
      const x = Math.round(mx + 2 + p.view.x * this.mini.sx);
      const y = Math.round(4 + p.view.y * this.mini.sy);
      if (p.isMe) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 2, 5, 5);
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
    // 왼쪽 아래: 순위표
    const order = s.order || [];
    const y0 = VH - 4 - order.length * 11;
    ctx.fillStyle = 'rgba(24,20,37,0.7)';
    ctx.fillRect(2, y0 - 2, 82, order.length * 11 + 4);
    order.forEach((id, i) => {
      const p = this.byId.get(id);
      if (!p) return;
      const y = y0 + i * 11;
      ctx.fillStyle = p.color;
      ctx.fillRect(5, y + 3, 5, 5);
      const done = p.server && p.server.finished;
      drawPixelText(ctx, `${i + 1} ${p.name.length > 6 ? p.name.slice(0, 6) : p.name}${done ? ' ✓' : ''}`, 13, y, { color: p.isMe ? '#fee761' : '#ffffff' });
    });
    // 속도 막대 + 조작 안내
    if (this.myCar) {
      const v = Math.min(1, Math.hypot(this.myCar.vx, this.myCar.vy) / DEFAULT_CONFIG.CAR.MAX_SPEED);
      ctx.fillStyle = INK;
      ctx.fillRect(90, VH - 9, 62, 6);
      ctx.fillStyle = v > 0.85 ? '#e43b44' : '#63c74d';
      ctx.fillRect(91, VH - 8, Math.round(60 * v), 4);
    }
    if (this.mode === 'keys' && this.meId) {
      drawPixelText(ctx, '↑가속 ↓감속 ←→방향 Space 드리프트', 318, VH - 26, { color: '#c0cbdc', outline: INK, align: 'right' });
    }
    if (this.audio.muted) drawPixelText(ctx, '음소거', 160, 15, { color: '#8b9bb4', outline: INK, align: 'center' });
  }

  _drawIntro() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.55)';
    ctx.fillRect(0, 0, VW, VH);
    this._panel(30, 16, 260, 134);
    drawPixelText(ctx, '레이싱', 160, 20, { color: '#fee761', align: 'center', size: 20 });
    const g = this.gesture;
    const lines = [
      [`${this.laps}바퀴를 먼저 도는 순서로 순위를 정합니다`, '#ffffff'],
      ['두 손을 핸들처럼 들고 기울이면 방향이 바뀝니다', '#ffffff'],
      ['두 손을 카메라 쪽으로 밀면 가속, 당기면 감속', '#ffffff'],
      ['핸들을 끝까지 꺾으면 드리프트 · 잔디로는 못 나갑니다', '#c0cbdc'],
      ['1등이 들어오면 30초 뒤에 끝납니다 · 차끼리는 안 부딪힙니다', '#c0cbdc'],
    ];
    lines.forEach(([line, color], i) => drawPixelText(ctx, line, 160, 46 + i * 13, { color, align: 'center' }));
    let status;
    let color = '#fee761';
    if (!this.meId) status = '관전 중';
    else if (g.failed) { status = '카메라를 쓸 수 없습니다 → 키보드(↑↓←→, Space)로 조종'; color = '#f6757a'; }
    else if (!g.usable) status = '손 인식 준비 중… (카메라 권한을 허용해 주세요)';
    else if (!g.calibrated) status = '두 손을 편한 자리에 들고 계세요 — 기준을 잡는 중';
    else { status = '준비 완료! (R: 기준 다시 잡기 · I: 방향 뒤집기)'; color = '#63c74d'; }
    drawPixelText(ctx, status, 160, 46 + lines.length * 13 + 6, { color, align: 'center' });
    const left = Math.max(0, Math.ceil(-this.gt - this.countdown));
    drawPixelText(ctx, `${left}초 뒤 출발 신호`, 160, 134, { color: '#8b9bb4', align: 'center' });
  }

  _drawFinal(results) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.65)';
    ctx.fillRect(0, 0, VW, VH);
    const h = 38 + results.length * 14;
    const y0 = Math.round(90 - h / 2);
    this._panel(26, y0, 268, h);
    const winners = results.filter((r) => r.isWinner);
    drawPixelText(ctx, winners.length === 1 ? `${winners[0].name} 우승!` : '공동 우승!', 160, y0 + 5, { color: '#fee761', align: 'center', size: 20 });
    results.forEach((r, i) => {
      const y = y0 + 32 + i * 14;
      const p = this.byId.get(r.playerId);
      const color = r.isWinner ? '#fee761' : r.playerId === this.meId ? '#63c74d' : '#ffffff';
      const st = r.stats || {};
      ctx.fillStyle = p ? p.color : '#fff';
      ctx.fillRect(34, y + 3, 5, 5);
      drawPixelText(ctx, `${r.rank}등`, 43, y, { color });
      drawPixelText(ctx, r.playerId === this.meId ? `${r.name} (나)` : r.name, 68, y, { color });
      const detail = st.finished ? fmtTime(st.time) : `${Math.floor((st.progress ?? 0) * 100) / 100}바퀴에서 끝`;
      drawPixelText(ctx, detail, 232, y, { color: '#c0cbdc', align: 'right' });
      drawPixelText(ctx, `${r.score}점`, 286, y, { color, align: 'right' });
    });
  }
}
