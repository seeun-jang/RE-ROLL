// =============================================================
// 소리 따라하기 — 화면 (멀티플레이)
//
// 진행·채점은 서버가 한다. 여기서는 서버 상태(net.snap)에 맞춰
//  - 제시 소리를 들려주고, 내 차례에는 마이크로 녹음해 서버로 보내고,
//  - 다른 사람의 녹음과 점수를 보여 준다.
// 무대·파형·글자 그리기는 원본의 gfx / engine 모듈을 쓴다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../shared/animals.js';
import { centeredGrid, sink } from '../../shared/chibi.js';
import { MicCapture, pcmToBase64 } from '../../shared/MicCapture.js';
import { MimicAudio } from './audio/MimicAudio.js';
import { VH, VW } from './config.js';
import { dither, frame, loadFonts, rect, text } from './engine/draw.js';
import { STAGE, Stage } from './gfx/Stage.js';
import { drawWave, peaks } from './gfx/Waveform.js';
import { C, GRADE_COLORS } from './palette.js';

const DIFF_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const REASON_TEXT = {
  silent: '소리가 감지되지 않았어요', noAudio: '녹음이 도착하지 않았어요', noMic: '마이크를 쓸 수 없어요',
  timeout: '채점이 너무 오래 걸렸어요', error: '채점 오류',
};
const WAVE = { x: 62, y: 44, w: 196, h: 28 };

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

export class MimicScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.flow = this.opt.flow || {};
    this.grades = this.opt.grades || [['S', 90], ['A', 75], ['B', 60], ['C', 0]];
    this.meId = me ? me.id : null;
    const order = this.opt.order || players.map((p) => p.id);
    const byId = new Map(players.map((p) => [p.id, p]));
    // 무대에 서는 순서 = 첫 라운드의 차례 순서
    this.players = order.filter((id) => byId.has(id)).map((id, i) => {
      const p = byId.get(id);
      const animal = ANIMALS[p.character] || animalForIndex(p.index ?? i);
      const base = centeredGrid(animal);
      return {
        id: p.id, name: p.name, color: animal.color, isMe: p.id === this.meId,
        frames: [0, 1, 2].map((n) => bakeAnimal(sink(base, n), animal.palette)),
        shown: 0,       // 화면에 보이는 합계(올라가는 연출)
        pop: 0,
      };
    });
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    const n = this.players.length;
    this.players.forEach((p, i) => {
      p.x = Math.round(n === 1 ? 160 : 76 + (i * 168) / (n - 1));
    });

    this._buildDom();
    this.stage = new Stage();
    this.audio = new MimicAudio();
    this.mic = new MicCapture({ RAW: true });
    this.time = 0;
    this.keyDone = new Set();      // 이미 처리한 "한 번만 할 일"
    this.refPeaks = new Map();     // 소리 id → 파형
    this.recPeaks = null;          // 방금 들려준 녹음의 파형
    this.reveal = null;            // { playerId, score, valid, grade, reason, at, playFor }
    this.recording = false;
    this.finalShown = false;
    this._destroyed = false;

    this._onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      if (e.code === 'KeyM' && !e.repeat) this.audio.toggleMute();
    };
    this._onPointer = () => this.audio.unlock();
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('pointerdown', this._onPointer);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    loadFonts();
    try { this.audio.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
    for (const s of this.opt.sounds || []) this.audio.load(s.id);
    if (this.meId) this.mic.start();

    this._last = performance.now();
    const loop = (t) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this._last) / 1000);
      this._last = t;
      this._update(dt);
      this._render(this.ctx);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.mic.stop();
    this.audio.destroy();
    this.root.remove();
  }

  _buildDom() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: C.bgDeep, overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    canvas.width = VW;
    canvas.height = VH;
    canvas.style.setProperty('image-rendering', 'crisp-edges');
    canvas.style.setProperty('image-rendering', 'pixelated');
    canvas.style.display = 'block';
    root.appendChild(canvas);
    this.container.appendChild(root);
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = this.container.clientHeight === 0;
  }

  _fit() {
    const w = this.root.clientWidth || VW * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / VW, h / VH))));
    this.canvas.style.width = `${VW * s}px`;
    this.canvas.style.height = `${VH * s}px`;
    if (this.autoHeight) this.root.style.height = `${VH * s}px`;
  }

  // ------------------------------------------------------------
  /** key 에 해당하는 일을 이 판에서 한 번만 한다 */
  _once(key, fn) {
    if (this.keyDone.has(key)) return;
    this.keyDone.add(key);
    fn();
  }

  _peaksOf(id) {
    if (!this.refPeaks.has(id)) {
      const buf = this.audio.buffers.get(id);
      if (!buf) return null;
      this.refPeaks.set(id, peaks(buf.getChannelData(0), WAVE.w));
    }
    return this.refPeaks.get(id);
  }

  _gradeOf(score) {
    for (const [name, lo] of this.grades) if (score >= lo) return name;
    return 'C';
  }

  _handleEvent(e) {
    if (e.type !== 'reveal') return;
    let playFor = 0;
    this.recPeaks = null;
    if (e.pcm) {
      const data = this.audio.playPcm(e.pcm, e.rate || 16000);
      this.recPeaks = peaks(data, WAVE.w);
      playFor = data.length / (e.rate || 16000);
    } else {
      this.audio.sfx('error');
    }
    this.reveal = { ...e, at: this.time, playFor, sfxDone: false };
  }

  /** 서버 진행 단계에 맞춰 소리를 내고, 내 차례면 녹음한다 */
  _drive(s) {
    const F = this.flow;
    const now = this.net.now();
    const el = now - s.since;                    // 이 단계가 시작된 뒤 흐른 시간
    const tag = `${s.round}:${s.turn}:${s.phase}`;
    const sound = s.sound;
    const myTurn = !!this.meId && s.current === this.meId;

    if (s.phase === 'listen' && sound) {
      this._once(`${tag}:banner`, () => {
        this.audio.sfx('select');
        this.reveal = null;
      });
      const reps = F.LISTEN_REPEATS || 2;
      for (let i = 0; i < reps; i++) {
        const at = (F.ROUND_LEAD || 1.5) + i * (sound.duration + (F.LISTEN_GAP || 0.8));
        if (el >= at && el < at + 0.5) this._once(`${tag}:play${i}`, () => this.audio.playPrompt(sound.id));
      }
    } else if (s.phase === 'turn') {
      this._once(tag, () => {
        this.audio.sfx('turn');
        this.reveal = null;
        this.recPeaks = null;
      });
    } else if (s.phase === 'cue' && sound) {
      if (el < 0.5) this._once(tag, () => this.audio.playPrompt(sound.id));
    } else if (s.phase === 'count') {
      const beeps = F.COUNT_BEEPS || 3;
      const interval = F.BEEP_INTERVAL || 0.7;
      for (let i = 0; i < beeps; i++) {
        if (el >= i * interval && el < i * interval + 0.3) this._once(`${tag}:beep${i}`, () => this.audio.sfx(i === beeps - 1 ? 'beepLast' : 'beep'));
      }
    } else if (s.phase === 'record') {
      this._once(tag, () => {
        this.audio.stopAll();          // 녹음 중에는 아무 소리도 내지 않는다
        if (!myTurn) return;
        if (this.mic.status !== 'ready') {
          this.net.noMic();
          return;
        }
        this.recording = true;
        const ms = Math.max(300, (s.until - now) * 1000 - 60);
        this.mic.record(ms).then((take) => {
          this.recording = false;
          if (this._destroyed) return;
          if (take) this.net.audio(pcmToBase64(take.pcm), take.rate);
          else this.net.noMic();
        });
      });
    } else if (s.phase === 'scoring') {
      this._once(tag, () => this.audio.sfx('recEnd'));
      if (el >= 0.45) this._once(`${tag}:roll`, () => this.audio.sfx('analyze'));
    } else if (s.phase === 'roundEnd') {
      this._once(tag, () => {
        this.audio.sfx('select');
        this.reveal = null;
      });
    } else if ((s.phase === 'final' || s.phase === 'done') && s.results) {
      this._once('final', () => this.audio.sfx('fanfare'));
    }
  }

  _update(dt) {
    this.time += dt;
    const s = this.net.snap;
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    if (!s) return;
    this._drive(s);
    this.stage.update(dt, (this.time * 2) % 1);
    this.stage.setPaused(s.phase === 'record');

    // 점수 공개: 녹음을 다 들려준 뒤 등급 소리
    const r = this.reveal;
    if (r && !r.sfxDone && this.time - r.at >= r.playFor) {
      r.sfxDone = true;
      if (r.valid) this.audio.sfx(`grade${this._gradeOf(r.score)}`);
      const p = this.byId.get(r.playerId);
      if (p) p.pop = 0.4;
    }
    // 합계가 올라가는 연출 (공개가 끝난 점수만 반영)
    for (const p of this.players) {
      let target = s.totals ? s.totals[p.id] || 0 : 0;
      if (r && !r.sfxDone && r.playerId === p.id) target -= r.score;
      if (p.shown < target) p.shown = Math.min(target, p.shown + Math.max(1, Math.ceil((target - p.shown) * dt * 6)));
      else p.shown = target;
      if (p.pop > 0) p.pop -= dt;
    }
  }

  // ------------------------------------------------------------
  _render(ctx) {
    const s = this.net.snap;
    ctx.imageSmoothingEnabled = false;
    if (!s) {
      rect(ctx, 0, 0, VW, VH, C.bgDeep);
      text(ctx, '서버를 기다리는 중…', 160, 84, { align: 'center' });
      return;
    }
    const cur = this.byId.get(s.current);
    const acting = ['turn', 'cue', 'count', 'record', 'scoring', 'reveal'].includes(s.phase);
    this.stage.draw(ctx, { dim: acting, spotX: acting && cur ? cur.x : null, still: s.phase === 'record' });

    this._renderPlayers(ctx, s, cur);
    const final = (s.phase === 'final' || s.phase === 'done') && s.results;
    if (s.phase === 'intro') this._renderIntro(ctx, s);
    else if (final) this._renderFinal(ctx, s);
    else {
      this._renderTop(ctx, s);
      this._renderWave(ctx, s);
      this._renderMessage(ctx, s, cur);
    }
    if (this.audio.muted) text(ctx, '음소거', 36, 14, { font: 'small', color: C.textDim, outline: C.outline });
  }

  _renderPlayers(ctx, s, cur) {
    const footY = STAGE.spotFloorY;
    const r = this.reveal;
    for (const p of this.players) {
      const isCur = cur && cur.id === p.id && s.phase !== 'listen' && s.phase !== 'roundEnd';
      let img = p.frames[Math.floor(this.time * 2 + p.x) % 2];
      let lift = 0;
      if (isCur && s.phase === 'record') img = p.frames[Math.floor(this.time * 8) % 2];
      if (r && r.sfxDone && r.playerId === p.id) {
        if (r.valid && r.score >= 75) lift = Math.round(Math.abs(Math.sin((this.time - r.at) * 9)) * 3);
        else if (!r.valid || r.score < 40) img = p.frames[2];
      }
      const x = p.x - Math.floor(img.width / 2);
      const y = footY - img.height - lift;
      dither(ctx, p.x - 7, footY - 1, 14, 2, C.outline);
      ctx.drawImage(img, x, y);
      // 이름·합계
      const top = footY - p.frames[0].height;
      text(ctx, p.isMe ? `${p.name}(나)` : p.name, p.x, top - 22, { font: 'small', color: p.color, outline: C.outline, align: 'center' });
      text(ctx, `${p.shown}`, p.x, top - 12 - (p.pop > 0 ? 1 : 0), { color: p.pop > 0 ? C.accent2 : C.text, outline: C.outline, align: 'center' });
      // 라운드별 점수
      const rounds = (s.scores && s.scores[p.id]) || [];
      const hide = r && !r.sfxDone && r.playerId === p.id ? r.round - 1 : -1;
      const parts = rounds.map((e, i) => (e && i !== hide ? String(e.score) : '-')).join(' ');
      text(ctx, parts, p.x, footY + 4, { font: 'small', color: C.textDim, outline: C.outline, align: 'center' });
    }
  }

  _renderTop(ctx, s) {
    if (!s.sound) return;
    frame(ctx, 44, 14, 232, 24);
    text(ctx, `ROUND ${s.round}/${s.rounds}`, 52, 20, { color: C.accent });
    text(ctx, s.sound.name, 160, 20, { align: 'center' });
    text(ctx, DIFF_LABEL[s.sound.difficulty] || '', 268, 20, { align: 'right', color: C.textDim });
  }

  _renderWave(ctx, s) {
    const { x, y, w, h } = WAVE;
    frame(ctx, x - 4, y - 3, w + 8, h + 6, { fill: C.bgDeep });
    const sound = s.sound;
    if (!sound) return;
    const now = this.net.now();
    const el = now - s.since;
    const F = this.flow;
    const pk = this._peaksOf(sound.id);
    let progress = null;
    if (s.phase === 'listen') {
      const reps = F.LISTEN_REPEATS || 2;
      for (let i = 0; i < reps; i++) {
        const at = (F.ROUND_LEAD || 1.5) + i * (sound.duration + (F.LISTEN_GAP || 0.8));
        if (el >= at && el <= at + sound.duration) progress = (el - at) / sound.duration;
      }
    } else if (s.phase === 'cue' && el <= sound.duration) progress = el / sound.duration;

    const r = this.reveal;
    if (s.phase === 'record') {
      // 녹음 중: 남은 시간 막대 (+ 내 차례면 마이크 소리 크기)
      const total = Math.max(0.1, s.until - s.since);
      const k = Math.max(0, Math.min(1, el / total));
      rect(ctx, x, y + h - 4, w, 3, C.meterOff);
      rect(ctx, x, y + h - 4, Math.round(w * k), 3, C.danger);
      if (this.recording) {
        const lv = Math.min(1, this.mic.level * 5);
        const bars = 28;
        for (let i = 0; i < bars; i++) {
          const on = i / bars < lv;
          rect(ctx, x + 8 + i * 6.5, y + 4, 4, h - 14, on ? (i > bars * 0.8 ? C.meterHot : C.meterOk) : C.meterOff);
        }
      } else {
        const dots = '.'.repeat(1 + (Math.floor(this.time * 3) % 3));
        text(ctx, `녹음 중${dots}`, 160, y + 6, { align: 'center', color: C.danger });
      }
    } else if (r && this.recPeaks && s.phase === 'reveal') {
      // 공개: 원본(옅게) 위에 녹음 파형
      if (pk) drawWave(ctx, pk, x, y, w, h, C.waveRef, { dither: true });
      const p = r.playFor > 0 ? Math.min(1, (this.time - r.at) / r.playFor) : null;
      drawWave(ctx, this.recPeaks, x, y, w, h, C.waveRec, { progress: p !== null && p < 1 ? p : null });
    } else if (pk) {
      drawWave(ctx, pk, x, y, w, h, C.waveRef, { progress });
    } else {
      text(ctx, '소리를 불러오는 중…', 160, y + 8, { align: 'center', color: C.textDim, font: 'small' });
    }
  }

  _renderMessage(ctx, s, cur) {
    const y = 80;
    const name = cur ? cur.name : '';
    const mine = cur && cur.isMe;
    const big = (str, color = C.text, mult = 1) => text(ctx, str, 160, y, { align: 'center', color, outline: C.outline, mult });
    const sub = (str, color = C.textDim) => text(ctx, str, 160, y + 15, { align: 'center', color, outline: C.outline, font: 'small' });
    switch (s.phase) {
      case 'listen':
        big('잘 들어 보세요!', C.accent2);
        sub('곧 한 명씩 차례로 따라 합니다');
        break;
      case 'turn':
        big(mine ? '내 차례!' : `${name} 차례`, cur ? cur.color : C.text);
        sub(mine && this.mic.status !== 'ready' ? '마이크를 쓸 수 없어요 — 이번 차례는 0점 처리됩니다' : '원본을 한 번 더 들려줍니다', mine && this.mic.status !== 'ready' ? C.warn : C.textDim);
        break;
      case 'cue':
        big(mine ? '잘 듣고 준비!' : `${name} 준비 중`, C.text);
        break;
      case 'count': {
        const interval = this.flow.BEEP_INTERVAL || 0.7;
        const beeps = this.flow.COUNT_BEEPS || 3;
        const n = Math.max(1, beeps - Math.floor((this.net.now() - s.since) / interval));
        text(ctx, String(n), 160, y - 4, { align: 'center', color: C.accent2, outline: C.outline, mult: 2 });
        break;
      }
      case 'record':
        big(mine ? '지금! 따라 하세요!' : `${name} 녹음 중 — 조용히!`, C.danger);
        break;
      case 'scoring':
        big('채점 중…', C.accent);
        break;
      case 'reveal': {
        const r = this.reveal || s.last;
        if (!r) break;
        const who = (this.byId.get(r.playerId) || {}).name || '';
        if (this.reveal && !this.reveal.sfxDone) {
          big(`${who}의 소리`, C.waveRec);
        } else if (r.valid) {
          const g = r.grade || this._gradeOf(r.score);
          text(ctx, `${r.score}점`, 150, y - 4, { align: 'center', color: C.text, outline: C.outline, mult: 2 });
          text(ctx, g, 196, y - 4, { color: GRADE_COLORS[g] || C.text, outline: C.outline, mult: 2 });
        } else {
          big('0점', C.danger);
          sub(REASON_TEXT[r.reason] || '', C.warn);
        }
        break;
      }
      case 'roundEnd':
        big(s.round < s.rounds ? `ROUND ${s.round} 끝!` : '모든 라운드 끝!', C.accent2);
        break;
      default:
        break;
    }
    if (s.scorer === 'sim') text(ctx, '시험용 모드: 점수는 임의 값입니다', 160, 170, { align: 'center', font: 'small', color: C.warn, outline: C.outline });
  }

  _renderIntro(ctx, s) {
    frame(ctx, 44, 24, 232, 84);
    text(ctx, '소리 따라하기', 160, 32, { align: 'center', color: C.accent2, mult: 2 });
    const lines = [
      '제시되는 소리를 듣고 입으로 똑같이 따라 하세요',
      `소리 ${s.rounds}개 · 한 명씩 차례로 녹음합니다`,
      '다른 사람이 녹음할 때는 조용히!',
    ];
    lines.forEach((line, i) => text(ctx, line, 160, 62 + i * 12, { align: 'center', font: 'small', color: i === 2 ? C.warn : C.text }));
    const mic = this.mic.status;
    const label = !this.meId ? '관전 중' : mic === 'ready' ? '마이크 준비됨' : mic === 'starting' ? '마이크 연결 중… (권한을 허용해 주세요)' : '마이크를 쓸 수 없어요 (localhost 또는 https 주소에서만 됩니다)';
    text(ctx, label, 160, 98, { align: 'center', font: 'small', color: mic === 'ready' ? C.ok : C.warn });
  }

  _renderFinal(ctx, s) {
    const rows = s.results;
    const h = 30 + rows.length * 12;
    frame(ctx, 50, 16, 220, h);
    const winners = rows.filter((r) => r.isWinner);
    text(ctx, winners.length === 1 ? `${winners[0].name} 우승!` : '공동 우승!', 160, 22, { align: 'center', color: C.accent2, mult: 1 });
    rows.forEach((r, i) => {
      const y = 40 + i * 12;
      const p = this.byId.get(r.playerId) || {};
      const color = r.isWinner ? C.accent2 : p.isMe ? C.ok : C.text;
      text(ctx, `${r.rank}위`, 58, y, { font: 'small', color });
      text(ctx, r.name, 82, y, { font: 'small', color: p.color || color });
      text(ctx, ((r.stats && r.stats.rounds) || []).join(' + '), 214, y, { font: 'small', color: C.textDim, align: 'right' });
      text(ctx, `${r.score}점`, 262, y, { font: 'small', color, align: 'right' });
    });
  }
}
