// =============================================================
// 가든 디펜스 — 화면 (멀티플레이)
//
// 좀비·총알·점수는 서버가 진행한다(참가자마다 정원 하나). 여기서는
//  - 서버가 보내 주는 내 정원 상태(net.snap.me)를 그리고(위치는 속도로 이어 그린다),
//  - 키보드(W/S·↑/↓, Space)와 손 제스처(총 모양)로 정한 "레인 / 쏘는 중" 을 서버로 보낸다.
// 배경·스프라이트·글자·효과·소리·제스처 인식은 원본 모듈을 그대로 쓴다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../../shared/animals.js';
import { centeredGrid } from '../../../shared/chibi.js';
import { AudioEngine } from '../audio/Audio.js';
import { Music } from '../audio/Music.js';
import { CONFIG } from '../game/config.js';
import { Enemy } from '../game/Enemy.js';
import { Grid } from '../game/Grid.js';
import { FloatingTexts, ParticleSystem } from '../game/Particles.js';
import { GunGesture } from '../gesture/GunGesture.js';
import { Background } from '../render/Background.js';
import { KoFont, PixelFont, drawName } from '../render/Font.js';
import { Renderer } from '../render/Renderer.js';
import { createSpriteBank } from '../render/Sprites.js';
import { DEFAULT_CONFIG } from '../sim/config.js';

const TYPES = DEFAULT_CONFIG.ENEMY_TYPES;
const L = CONFIG.layout;
const W = CONFIG.base.width;
const H = CONFIG.base.height;
const UP_KEYS = ['KeyW', 'ArrowUp'];
const DOWN_KEYS = ['KeyS', 'ArrowDown'];
const MODS = { hpMul: 1, speedMul: 1 };

const CSS = `
.gd-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #181425; overflow: hidden; }
.gd-wrap { position: relative; flex: none; }
.gd-ui { position: absolute; inset: 0; pointer-events: none; }
.gd-ui .pgd-gesture { position: absolute; right: 3em; top: 2em; height: 26em; padding: 0; gap: 3em; border: none; box-shadow: none; background: transparent; align-items: center; flex-direction: row-reverse; }
.gd-ui .pgd-gesture-cam { width: 44em; height: 24.75em; border: 1em solid #3a4466; }
.gd-ui .pgd-gesture[data-status="armed"] .pgd-gesture-cam { border-color: #fee761; }
.gd-ui .pgd-gesture[data-status="fire"] .pgd-gesture-cam { border-color: #ff0044; }
.gd-ui .pgd-gesture-side { width: 50em; gap: 0; }
.gd-ui .pgd-gesture-title, .gd-ui .pgd-gesture-icons, .gd-ui .pgd-gesture-sub, .gd-ui .pgd-gesture-lane { display: none; }
.gd-ui .pgd-gesture[data-status="error"] .pgd-gesture-cam, .gd-ui .pgd-gesture[data-status="off"] .pgd-gesture-cam { display: none; }
.gd-ui .pgd-gesture-status { font-size: 7em; min-height: 0; text-align: right; line-height: 1.2; word-break: keep-all; }
`;

/** 동물 그림(글자 격자) → 캔버스 */
function bakeAnimal(grid, palette) {
  const cv = document.createElement('canvas');
  cv.width = grid[0].length;
  cv.height = grid.length;
  const g = cv.getContext('2d');
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const color = palette[grid[y][x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

export class GardenScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.duration = this.opt.duration ?? 120;
    this.countdown = this.opt.countdown ?? 3;
    this.waves = this.opt.waves || [];
    this.bulletSpeed = this.opt.bulletSpeed ?? 280;
    this.meId = me ? me.id : null;
    this.players = players.map((p) => ({ id: p.id, name: p.name, isMe: p.id === this.meId }));
    const mine = players.find((p) => p.id === this.meId) || players[0] || {};
    const animal = ANIMALS[mine.character] || animalForIndex(mine.index ?? 0);
    this.animalImg = bakeAnimal(centeredGrid(animal), animal.palette);

    this._buildDom();
    this.sprites = createSpriteBank();
    this.renderer = new Renderer(this.canvas, CONFIG, this.sprites);
    this.font = new PixelFont(this.sprites.colors);
    this.ko = new KoFont(this.sprites.colors);
    this.renderer.font = this.font;
    this.background = new Background(CONFIG, this.renderer);
    this.grid = new Grid(CONFIG);
    this.particles = new ParticleSystem();
    this.texts = new FloatingTexts(this.font);
    this.audio = new AudioEngine();
    this.music = new Music(this.audio);
    this.gesture = new GunGesture({ cfg: CONFIG.gesture, host: this.ui, sprites: this.sprites, audio: this.audio });

    // 내 정원(서버 상태를 화면용으로 옮겨 둔 것)
    this.me = null;              // 가장 최근의 snap.me
    this.meAt = 0;               // 그 상태의 서버 시각
    this.lastSnap = null;
    this.views = new Map();      // 좀비 id → 화면용 Enemy
    this.bullets = [];           // [{ id, lane, x }]
    this.seenBullets = new Set();
    this.maxBulletId = 0;

    // 내 입력
    this.lane = Math.floor(L.lanes / 2);
    this.keyFire = false;
    this.sent = { lane: null, fire: null };
    this.playerY = this.grid.laneBottom(this.lane) - this.animalImg.height;

    this.time = 0;
    this.recoil = 0;
    this.muzzle = 0;
    this.comboBump = 0;
    this.damageFlash = 0;
    this.banner = null;
    this.waveIndex = -1;
    this.done = new Set();
    this._destroyed = false;

    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      const code = e.code;
      if (UP_KEYS.includes(code) || DOWN_KEYS.includes(code) || code === 'Space') e.preventDefault();
      if (code === 'KeyM' && !e.repeat) this.audio.setMuted(!this.audio.muted);
      if (!this.meId) return;
      if (code === 'Space') this.keyFire = true;
      if (e.repeat) return;
      if (UP_KEYS.includes(code)) this._moveLane(this.lane - 1);
      if (DOWN_KEYS.includes(code)) this._moveLane(this.lane + 1);
    };
    this._onKeyUp = (e) => {
      if (e.code === 'Space') this.keyFire = false;
    };
    this._onBlur = () => { this.keyFire = false; };
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
    if (this.meId) this.gesture.start();       // 실패해도 키보드로 할 수 있다

    this._last = performance.now();
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(CONFIG.base.maxFrameDt, (ts - this._last) / 1000);
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
    this.music.stop();
    this.audio.close();
    this.root.remove();
    this.styleEl.remove();
  }

  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'gd-root';
    this.wrap = document.createElement('div');
    this.wrap.className = 'gd-wrap';
    this.canvas = document.createElement('canvas');
    this.ui = document.createElement('div');
    this.ui.className = 'gd-ui';
    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.ui);
    this.root.appendChild(this.wrap);
    this.container.appendChild(this.root);
    this.autoHeight = this.container.clientHeight === 0;
  }

  _fit() {
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? W * 2 : this.root.clientHeight || H * 2;
    this.renderer.resize(w, this.autoHeight ? Infinity : h);
    this.ui.style.fontSize = `${this.renderer.scale}px`;      // 1em = 논리 픽셀 1칸
    if (this.autoHeight) this.root.style.height = this.canvas.style.height;
  }

  _once(key, fn) {
    if (this.done.has(key)) return;
    this.done.add(key);
    fn();
  }

  // ---------------- 입력 ----------------
  _moveLane(lane) {
    const next = Math.max(0, Math.min(L.lanes - 1, lane));
    if (next === this.lane) return;
    this.lane = next;
    this.audio.play('move');
  }

  _sendInput(playing) {
    if (!this.meId || !playing) return;
    const fire = this.keyFire || this.gestureFire;
    if (this.sent.lane === this.lane && this.sent.fire === fire) return;
    this.sent = { lane: this.lane, fire };
    this.net.input(this.lane, fire);
  }

  // ---------------- 서버 상태 → 화면 ----------------
  _applyMe(me, at) {
    const first = !this.me;
    this.me = me;
    this.meAt = at;
    if (first && typeof me.lane === 'number' && this.sent.lane === null) this.lane = me.lane;   // 다시 접속했을 때

    const alive = new Set();
    for (const row of me.enemies) {
      const [id, typeIdx, lane, x, hp, maxHp, helmetHp, maxHelmet, eating, speed] = row;
      alive.add(id);
      let v = this.views.get(id);
      if (!v) {
        v = new Enemy(TYPES[typeIdx], lane, x, CONFIG, MODS, { id, animOffset: Math.random() * 3 });
        v.maxHp = maxHp;
        v.maxHelmet = maxHelmet;
        v.hp = hp;
        v.helmetHp = helmetHp;
        this.views.set(id, v);
        if (v.isBoss && !first) {
          this.renderer.shake(CONFIG.fx.shakeBoss, 0.6);
          this.audio.play('bossIntro');
          this.banner = { text: 'BOSS!', t: 1.4, max: 1.4, boss: true };
        }
      }
      if (hp < v.hp || helmetHp < v.helmetHp) {
        v.flash = CONFIG.fx.hitFlash;
        this.audio.play(v.isBoss ? 'hitBoss' : 'hit');
        this.particles.burst(Math.round(x + v.hitL), this.grid.laneBottom(lane) - 13, [11, 19], 2, { speed: 40, up: 20, life: 0.2, spread: 1.2 });
      }
      if (lane !== v.lane) {       // 보스가 옆 레인으로 옮김
        v.laneFromY = this.grid.laneBottom(v.lane);
        v.lane = lane;
        v.laneTween = 0.5;
        v.laneTweenDur = 0.5;
        this.texts.add('!', x + 16, this.grid.laneTop(lane) - 2, { color: 26, life: 0.5, scale: 2 });
      }
      v.hp = hp;
      v.helmetHp = helmetHp;
      v.state = eating ? 'eat' : 'walk';
      v.netX = x;
      v.netSpeed = speed;
    }
    for (const id of [...this.views.keys()]) if (!alive.has(id)) this.views.delete(id);

    this.bullets = me.bullets.map(([id, lane, x]) => ({ id, lane, x }));
    let shot = false;
    for (const b of this.bullets) {
      if (b.id > this.maxBulletId) {
        this.maxBulletId = b.id;
        shot = true;
      }
    }
    if (shot && !first) {
      this.audio.play('shot_pistol');
      this.recoil = CONFIG.player.recoilTime;
      this.muzzle = CONFIG.player.muzzleTime;
      this.particles.shell(L.playerX + 10, this.playerY + 12);
    }
  }

  _handleEvent(e) {
    const top = this.grid.laneTop(e.lane ?? 0);
    const bottom = this.grid.laneBottom(e.lane ?? 0);
    if (e.type === 'kill') {
      const base = CONFIG.enemies[e.etype] || CONFIG.enemies.normal;
      const boss = e.etype === 'boss';
      const cx = Math.round(e.x + base.w / 2);
      const cy = bottom - (base.h >> 1);
      this.texts.add(`+${e.pts}`, cx, top + 2, { color: e.mul >= 2 ? 11 : 19, scale: boss ? 2 : 1, life: boss ? 1.6 : 0.8 });
      const colors = this.sprites.colorsOf(base.sprite, base.swap || null);
      this.particles.burst(cx, cy, colors, boss ? 60 : 12, { speed: boss ? 120 : 70, up: 60, life: boss ? 1.2 : 0.6, size: boss ? 2 : 1 });
      this.renderer.shake(boss ? CONFIG.fx.shakeBoss : CONFIG.fx.shakeKill, boss ? 0.5 : 0.12);
      this.audio.play(boss ? 'bossDie' : 'kill');
      this.comboBump = 0.15;
    } else if (e.type === 'helmet') {
      this.particles.burst(e.x + 8, bottom - 22, [20, 21, 23], 10, { speed: 70, up: 50, life: 0.5 });
      this.texts.add('CRACK!', e.x + 8, bottom - 28, { color: 20, life: 0.6 });
      this.audio.play('helmet');
    } else if (e.type === 'breach') {
      this.damageFlash = 0.35;
      this.renderer.shake(e.boss ? CONFIG.fx.shakeBoss : CONFIG.fx.shakeLife, 0.3);
      this.audio.play('lifeLost');
      this.texts.add(e.boss ? `BOSS AT THE DOOR! -${e.lost}` : `-${e.lost}`, e.boss ? 90 : 30, top + 8, { color: 26, life: 1 });
      this.particles.burst(L.exitX, top + 14, [8, 7, 3], 10, { speed: 60, up: 40, life: 0.5 });
    } else if (e.type === 'summon') {
      this.texts.add('SUMMON!', e.x + 16, top - 4, { color: 28, life: 0.9 });
      this.audio.play('bossSummon');
      this.renderer.shake(2, 0.2);
    }
  }

  // ---------------- 매 프레임 ----------------
  _update(dt) {
    this.time += dt;
    const s = this.net.snap;
    if (s && s !== this.lastSnap) {
      this.lastSnap = s;
      if (s.me) this._applyMe(s.me, s.now);
    }
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    const now = this.net.now();
    this.gt = s ? now - s.startAt : -999;
    const gt = this.gt;
    const playing = !!s && gt >= 0 && gt < this.duration;

    // 손 제스처
    this.gesture.update(dt);
    const g = this.gesture.pollActions();
    this.gestureFire = !!(g && g.firing);
    if (g && g.laneChanged && g.lane !== null && this.meId) this._moveLane(g.lane);
    this.gesture.render();
    this._sendInput(playing);

    // 진행에 따른 소리·배너
    if (s) {
      if (gt >= -this.countdown && gt < 0) {
        const n = Math.ceil(-gt);
        if (n !== this.shownCount) {
          this.shownCount = n;
          this.audio.play('ui');
        }
      } else if (playing) {
        let idx = -1;
        this.waves.forEach((w, i) => { if (gt >= w.start) idx = i; });
        if (idx !== this.waveIndex) {
          this.waveIndex = idx;
          const w = this.waves[idx];
          if (w) {
            if (gt - w.start < 2) {
              this.banner = { text: w.name, t: CONFIG.bannerTime, max: CONFIG.bannerTime, boss: !!w.boss };
              this.audio.play(w.boss ? 'bossWave' : 'waveStart');
            }
            this.music.setMode(w.boss ? 'boss' : 'play');
          }
        }
        const left = Math.ceil(this.duration - gt);
        if (left <= 10 && left > 0 && left !== this.lastTick) {
          this.lastTick = left;
          this.audio.play('ui');
        }
      } else if (gt >= this.duration) {
        this._once('timeup', () => {
          this.music.setMode('none');
          if (gt < this.duration + 2) this.audio.play('waveClear');
        });
        if (s.results) this._once('final', () => this.audio.play('winner'));
      }
    }

    // 화면용 좀비·총알 위치 (마지막 서버 상태에서 속도만큼 이어 그린다)
    const age = Math.max(0, Math.min(0.25, now - this.meAt));
    const frozen = !playing;
    for (const v of this.views.values()) {
      v.anim += dt;
      if (v.flash > 0) v.flash -= dt;
      if (v.laneTween > 0) v.laneTween -= dt;
      const target = v.netX - (v.state === 'walk' && !frozen ? v.netSpeed * age : 0);
      v.x = Math.abs(target - v.x) > 6 ? target : v.x + (target - v.x) * Math.min(1, dt * 20);
    }
    for (const b of this.bullets) b.drawX = b.x + (frozen ? 0 : this.bulletSpeed * age);

    // 내 캐릭터
    const yTarget = this.grid.laneBottom(this.lane) - this.animalImg.height;
    const dy = yTarget - this.playerY;
    const step = CONFIG.player.laneMoveSpeed * dt;
    this.playerY = Math.abs(dy) <= step ? yTarget : this.playerY + Math.sign(dy) * step;
    if (this.recoil > 0) this.recoil -= dt;
    if (this.muzzle > 0) this.muzzle -= dt;
    if (this.comboBump > 0) this.comboBump -= dt;
    if (this.damageFlash > 0) this.damageFlash -= dt;
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
    this.particles.update(dt);
    this.texts.update(dt);
    this.background.update(dt);
    this.renderer.update(dt);
  }

  // ---------------- 그리기 ----------------
  _render() {
    const r = this.renderer;
    const ctx = r.ctx;
    const s = this.net.snap;
    const gt = this.gt;
    r.begin();
    this.background.drawSky(ctx);
    this.background.drawField(ctx);

    // 좀비: 위 레인부터, 같은 레인은 오른쪽(먼 것)부터
    const list = [...this.views.values()].sort((a, b) => a.lane - b.lane || b.x - a.x);
    for (const v of list) v.draw(r, this.sprites, this.grid, this.time);

    this._drawPlayer(r);
    for (const b of this.bullets) {
      const y = this.grid.laneBottom(b.lane) - 13;
      r.rect(b.drawX, y, 3, 1, 11);
      r.rect(b.drawX - 2, y, 1, 1, 9);
    }
    this.particles.draw(r);

    // 밤이 깊어지는 오버레이
    const na = this.waves.length > 1 ? (CONFIG.night.maxAlpha * Math.max(0, this.waveIndex)) / (this.waves.length - 1) : 0;
    if (na > 0) {
      ctx.fillStyle = `rgba(24,20,37,${na.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255,0,68,${(this.damageFlash * 0.5).toFixed(2)})`;
      ctx.fillRect(0, L.laneTop, 6, H - L.laneTop);
      ctx.fillRect(W - 6, L.laneTop, 6, H - L.laneTop);
      ctx.fillRect(0, L.laneTop, W, 3);
      ctx.fillRect(0, H - 3, W, 3);
    }
    this.texts.draw(r, this.ko);
    this._drawHud(r, s, gt);
    this._drawBoard(r, s);

    if (this.banner) {
      const p = this.banner.t / this.banner.max;
      if (p > 0.08 || Math.floor(this.banner.t * 20) % 2 === 0) {
        ctx.fillStyle = 'rgba(24,20,37,0.7)';
        ctx.fillRect(0, 74, W, 27);
        this.font.draw(ctx, this.banner.text, 160, 80, { color: this.banner.boss ? 26 : 11, scale: 3, align: 'center', shadow: 25 });
      }
    }

    if (!s) {
      this._panel(r, 70, 76, 180, 28);
      this.ko.draw(ctx, '서버를 기다리는 중…', 160, 84, { color: 20, align: 'center' });
    } else if (gt < -this.countdown) {
      this._drawIntro(r);
    } else if (gt < 0) {
      this.font.draw(ctx, String(Math.ceil(-gt)), 160, 76, { color: 11, scale: 6, align: 'center', shadow: 25 });
    } else if (s.results) {
      this._drawFinal(r, s.results);
    } else if (gt >= this.duration) {
      ctx.fillStyle = 'rgba(24,20,37,0.7)';
      ctx.fillRect(0, 70, W, 34);
      this.font.draw(ctx, 'TIME UP!', 160, 78, { color: 11, scale: 4, align: 'center', shadow: 25 });
    }
    r.end();
  }

  _drawPlayer(r) {
    if (!this.meId) return;
    const x = 6 - (this.recoil > 0 ? 1 : 0);
    const y = Math.round(this.playerY);
    const img = this.animalImg;
    r.rect(x + 4, y + img.height - 1, img.width - 8, 1, 15);     // 그림자
    r.sprite(img, x, y);
    // 총 (총구가 총알이 나오는 자리에 오도록)
    const gy = y + img.height - 14;
    r.rect(x + 17, gy, 8, 2, 23);
    r.rect(x + 17, gy - 1, 6, 1, 21);
    r.rect(x + 18, gy + 2, 2, 3, 24);
    if (this.muzzle > 0) {
      const mf = this.muzzle > CONFIG.player.muzzleTime * 0.5 ? 0 : 1;
      r.sprite(this.sprites.get('muzzle', mf), L.playerX + 16, gy - 2);
    }
  }

  _panel(r, x, y, w, h, opts) {
    r.box(x, y, w, h, opts);
  }

  _drawHud(r, s, gt) {
    const ctx = r.ctx;
    const font = this.font;
    ctx.fillStyle = 'rgba(24,20,37,0.78)';
    ctx.fillRect(0, 0, W, L.hudH);
    r.rect(0, L.hudH - 1, W, 1, 23);
    const me = this.me;
    const score = me ? me.score : 0;
    font.draw(ctx, 'SCORE', 4, 3, { color: 21 });
    font.draw(ctx, String(score).padStart(5, '0'), 4, 11, { color: 19, scale: 2 });

    font.draw(ctx, `KILL ${me ? me.kills : 0}`, 54, 3, { color: 12 });
    font.draw(ctx, `BREACH ${me ? me.breaches : 0}`, 54, 11, { color: me && me.breaches ? 26 : 21 });
    if (me && me.combo >= 2) {
      const mul = Number(me.mul).toFixed(1);
      font.draw(ctx, `${me.combo} HIT x${mul}`, 54, this.comboBump > 0 ? 18 : 19, { color: me.mul >= 3 ? 26 : 10 });
      r.rect(54, 26, Math.round((44 * me.comboLeft) / DEFAULT_CONFIG.COMBO.WINDOW), 1, 9);
    }

    const left = s ? Math.max(0, Math.min(this.duration, Math.ceil(this.duration - Math.max(0, gt)))) : this.duration;
    font.draw(ctx, 'TIME', 112, 3, { color: 21 });
    font.draw(ctx, String(left), 112, 11, { color: left <= 10 && gt >= 0 ? 26 : 19, scale: 2 });

    const w = this.waves[this.waveIndex];
    if (w) {
      const next = this.waves[this.waveIndex + 1];
      const end = next ? next.start : this.duration;
      font.draw(ctx, w.name, 150, 3, { color: w.boss ? 26 : 19 });
      r.rect(150, 11, 58, 5, 24);
      r.rect(151, 12, 56, 3, 25);
      const prog = Math.round(56 * Math.max(0, Math.min(1, (gt - w.start) / Math.max(0.1, end - w.start))));
      if (prog > 0) r.rect(151, 12, prog, 3, w.boss ? 26 : 12);
      let boss = null;
      for (const v of this.views.values()) if (v.isBoss) boss = v;
      if (boss) {
        font.draw(ctx, 'BOSS', 150, 20, { color: 26 });
        r.rect(170, 20, 38, 5, 24);
        r.rect(171, 21, 36, 3, 25);
        r.rect(171, 21, Math.ceil((36 * boss.hp) / boss.maxHp), 3, 26);
      }
    } else {
      font.draw(ctx, 'READY', 150, 3, { color: 19 });
    }
    if (this.audio.muted) font.draw(ctx, 'MUTE', 190, 20, { color: 21 });
  }

  /** 맨 아래 줄: 모두의 점수 (높은 순) */
  _drawBoard(r, s) {
    const ctx = r.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.78)';
    ctx.fillRect(0, 170, W, 10);
    const rows = this.players.map((p) => ({
      p, score: p.isMe && this.me ? this.me.score : ((s && s.players && s.players[p.id]) || {}).score || 0,
    }));
    rows.sort((a, b) => b.score - a.score);
    const slot = W / Math.max(1, rows.length);
    rows.forEach((row, i) => {
      const x = Math.round(i * slot) + 3;
      const color = row.p.isMe ? 11 : 20;
      this.font.draw(ctx, `${i + 1}.`, x, 173, { color: 21 });
      const name = row.p.name.length > 5 ? `${row.p.name.slice(0, 5)}` : row.p.name;
      drawName(this.font, this.ko, ctx, name, x + 9, 173, { color });
      this.font.draw(ctx, String(row.score), Math.round((i + 1) * slot) - 4, 173, { color, align: 'right' });
    });
  }

  _drawIntro(r) {
    const ctx = r.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.6)';
    ctx.fillRect(0, L.hudH, W, H - L.hudH - 10);
    this._panel(r, 36, 38, 248, 124);
    this.ko.draw(ctx, '가든 디펜스', 160, 43, { color: 11, size: 18, align: 'center', shadow: 25 });
    const lines = [
      [`${this.duration}초 동안 몰려오는 좀비를 총으로 막으세요`, 20],
      ['W/S 또는 ↑/↓ : 레인 이동   SPACE(꾹) : 사격', 19],
      ['손 제스처 : ㄱ자 손(검지+엄지)으로 조준, 검지를 구부리면 발사', 19],
      ['손 높이로 레인을 옮깁니다 · 카메라가 없으면 키보드로', 21],
      [`연속으로 잡으면 콤보(최대 4배) · 좀비가 집에 닿으면 -${this.opt.penalty ?? 30}점`, 20],
      ['모두에게 같은 좀비가 나옵니다 · 뒤로 갈수록 몰려옵니다', 10],
    ];
    lines.forEach(([line, color], i) => this.ko.draw(ctx, line, 160, 68 + i * 15, { color, align: 'center' }));
  }

  _drawFinal(r, results) {
    const ctx = r.ctx;
    ctx.fillStyle = 'rgba(24,20,37,0.75)';
    ctx.fillRect(0, L.hudH, W, H - L.hudH - 10);
    const h = 34 + results.length * 14;
    const y0 = Math.round(100 - h / 2);
    this._panel(r, 36, y0, 248, h, { border: 11 });
    const winners = results.filter((x) => x.isWinner);
    this.ko.draw(ctx, winners.length === 1 ? `${winners[0].name} 우승!` : '공동 우승!', 160, y0 + 5, { color: 11, size: 18, align: 'center', shadow: 25 });
    results.forEach((row, i) => {
      const y = y0 + 30 + i * 14;
      const color = row.isWinner ? 11 : row.playerId === this.meId ? 12 : 20;
      const st = row.stats || {};
      this.ko.draw(ctx, `${row.rank}위`, 46, y, { color });
      this.ko.draw(ctx, row.playerId === this.meId ? `${row.name} (나)` : row.name, 70, y, { color });
      this.ko.draw(ctx, `처치 ${st.kills ?? 0} · 뚫림 ${st.breaches ?? 0}${st.bossKilled ? ' · 보스' : ''}`, 224, y, { color: 21, align: 'right' });
      this.ko.draw(ctx, `${row.score}점`, 274, y, { color, align: 'right' });
    });
  }
}
