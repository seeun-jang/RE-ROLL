// ============================================================
// 칩튠 오디오 엔진 (Web Audio API 오실레이터로 모든 소리를 코드 생성)
//
//  master ─ compressor ─ destination
//    ├─ musicBus ─ duck   (주문을 "듣는 중"이면 duck 게인을 낮춘다)
//    └─ sfxBus
//
// 배경음은 낮게(CONFIG.AUDIO.MUSIC) 둔다 → 나중에 마이크로 재유입되어 오인식되는 것 방지
// 브라우저 정책상 첫 사용자 입력(클릭/키) 후 unlock() 해야 소리가 난다.
// ============================================================
import { CONFIG } from '../config.js';
import { TRACKS, noteFreq } from './music.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ducked = false;
    this.track = null;
    this._timer = 0;
    this._pendingTrack = null;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 사용자 제스처 안에서 호출 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this._pendingTrack && !this.track) this.playMusic(this._pendingTrack);
  }

  _buildGraph() {
    const c = this.ctx;
    const A = CONFIG.AUDIO;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : A.MASTER;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = A.MUSIC;
    this.duckGain = c.createGain();
    this.duckGain.gain.value = this.ducked ? CONFIG.AUDIO.DUCK_LEVEL : 1; // unlock 전에 기록된 덕킹 상태 반영
    this.musicBus.connect(this.duckGain).connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = A.SFX;
    this.sfxBus.connect(this.master);
    // 노이즈 버퍼 (1초 백색소음)
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : CONFIG.AUDIO.MASTER, this.ctx.currentTime, 0.02);
  }

  /** 배경음 덕킹 (듣는 중일 때 살짝 줄이기) */
  setDuck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (!this.duckGain || !this.ctx) return;
    const A = CONFIG.AUDIO;
    this.duckGain.gain.setTargetAtTime(on ? A.DUCK_LEVEL : 1, this.ctx.currentTime, on ? A.DUCK_ATTACK : A.DUCK_RELEASE);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ============================================================
  // 소리 합성 기본 단위
  // ============================================================
  _tone({ type = 'square', freq = 440, freqEnd = null, dur = 0.1, vol = 0.3, delay = 0, attack = 0.005, bus = null, vibrato = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 12;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  _noise({ dur = 0.2, vol = 0.3, delay = 0, filter = 'lowpass', freq = 2000, freqEnd = null, q = 1, bus = null }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _arp(notes, { type = 'square', step = 0.06, dur = 0.08, vol = 0.2, delay = 0 } = {}) {
    notes.forEach((n, i) => this._tone({ type, freq: noteFreq(n), dur, vol, delay: delay + i * step }));
  }

  // ============================================================
  // 효과음 목록
  // ============================================================
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = opts.power ?? 0.5;
    const big = 0.7 + p * 0.6; // 위력이 클수록 크고 길게
    switch (name) {
      case 'success':
        this._arp(['E6', 'B6'], { step: 0.05, dur: 0.07, vol: 0.12 });
        break;
      case 'fail':
        this._tone({ type: 'square', freq: 200, freqEnd: 110, dur: 0.18, vol: 0.12 });
        break;
      case 'nomana':
        this._tone({ type: 'triangle', freq: 220, dur: 0.1, vol: 0.25, vibrato: 10 });
        this._tone({ type: 'triangle', freq: 165, dur: 0.16, vol: 0.25, delay: 0.1, vibrato: 10 });
        break;
      case 'cast_fire':
        this._noise({ dur: 0.3 * big, vol: 0.32 * big, filter: 'bandpass', freq: 1400, freqEnd: 250, q: 0.8 });
        this._tone({ type: 'square', freq: 320, freqEnd: 70, dur: 0.22 * big, vol: 0.12 });
        break;
      case 'cast_water':
        [0, 0.05, 0.1].forEach((d, i) => this._tone({ type: 'sine', freq: 420 + i * 180, freqEnd: 900 + i * 200, dur: 0.07, vol: 0.25, delay: d }));
        this._noise({ dur: 0.2 * big, vol: 0.12, filter: 'lowpass', freq: 900 });
        break;
      case 'cast_lightning':
        this._arp(['C7', 'G6', 'C7', 'E7'], { step: 0.025, dur: 0.04, vol: 0.1 });
        this._noise({ dur: 0.08, vol: 0.2, filter: 'highpass', freq: 4000 });
        break;
      case 'thunder':
        this._noise({ dur: 0.55 * big, vol: 0.45 * big, filter: 'lowpass', freq: 4000, freqEnd: 200 });
        this._tone({ type: 'square', freq: 90, freqEnd: 40, dur: 0.35, vol: 0.16 });
        break;
      case 'cast_wind':
        this._noise({ dur: 0.28 * big, vol: 0.3 * big, filter: 'bandpass', freq: 400, freqEnd: 2600, q: 3 });
        break;
      case 'cast_ice':
        this._arp(['C7', 'G6', 'E7', 'B6'], { type: 'triangle', step: 0.04, dur: 0.12, vol: 0.18 });
        break;
      case 'cast_heal':
        this._arp(['C5', 'E5', 'G5', 'C6', 'E6'], { type: 'triangle', step: 0.06, dur: 0.14, vol: 0.2 });
        break;
      case 'hit':
        this._noise({ dur: 0.12 + p * 0.15, vol: 0.3 + p * 0.25, filter: 'lowpass', freq: 3000, freqEnd: 300 });
        this._tone({ type: 'square', freq: 240, freqEnd: 55, dur: 0.12 + p * 0.1, vol: 0.18 });
        break;
      case 'hurt':
        this._tone({ type: 'sawtooth', freq: 330, freqEnd: 90, dur: 0.2, vol: 0.16 });
        this._noise({ dur: 0.15, vol: 0.25, filter: 'bandpass', freq: 1200 });
        break;
      case 'block':
        this._tone({ type: 'triangle', freq: 1400, freqEnd: 900, dur: 0.15, vol: 0.22 });
        this._noise({ dur: 0.06, vol: 0.15, filter: 'highpass', freq: 3000 });
        break;
      case 'shieldBreak':
        this._noise({ dur: 0.35, vol: 0.3, filter: 'bandpass', freq: 3000, freqEnd: 600, q: 2 });
        this._arp(['E7', 'C7', 'A6', 'E6'], { type: 'triangle', step: 0.04, dur: 0.08, vol: 0.12 });
        break;
      case 'clash':
        this._noise({ dur: 0.18, vol: 0.32, filter: 'bandpass', freq: 1800, freqEnd: 400, q: 1.5 });
        this._tone({ type: 'square', freq: 520, freqEnd: 120, dur: 0.14, vol: 0.12 });
        break;
      case 'combo': {
        const n = Math.min(5, opts.combo || 2);
        const scale = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'];
        this._arp(scale.slice(0, n + 1), { step: 0.04, dur: 0.06, vol: 0.12 });
        break;
      }
      case 'telegraph':
        if (opts.big) this._tone({ type: 'triangle', freq: 110, freqEnd: 330, dur: 0.6, vol: 0.28 });
        else this._tone({ type: 'square', freq: 620, dur: 0.05, vol: 0.06 });
        break;
      case 'phase':
        this._noise({ dur: 0.8, vol: 0.3, filter: 'lowpass', freq: 400 });
        this._tone({ type: 'sawtooth', freq: 60, freqEnd: 45, dur: 0.8, vol: 0.15 });
        break;
      case 'ko':
        this._noise({ dur: 0.7, vol: 0.45, filter: 'lowpass', freq: 2500, freqEnd: 100 });
        this._tone({ type: 'square', freq: 200, freqEnd: 40, dur: 0.6, vol: 0.2 });
        break;
      case 'win':
        this._arp(['C5', 'E5', 'G5', 'C6'], { step: 0.12, dur: 0.14, vol: 0.18 });
        this._tone({ type: 'square', freq: noteFreq('E6'), dur: 0.6, vol: 0.16, delay: 0.5, vibrato: 6 });
        this._tone({ type: 'triangle', freq: noteFreq('C4'), dur: 1.0, vol: 0.3, delay: 0.5 });
        break;
      case 'draw':
        this._arp(['E5', 'D5', 'E5'], { type: 'triangle', step: 0.18, dur: 0.2, vol: 0.25 });
        break;
      case 'lose':
        this._arp(['G4', 'E4', 'C4'], { type: 'triangle', step: 0.25, dur: 0.3, vol: 0.3 });
        this._tone({ type: 'square', freq: noteFreq('B3'), freqEnd: noteFreq('G3'), dur: 0.9, vol: 0.1, delay: 0.75, vibrato: 4 });
        break;
      case 'select':
        this._tone({ type: 'square', freq: 880, dur: 0.035, vol: 0.06 });
        break;
      case 'confirm':
        this._arp(['A5', 'E6'], { step: 0.05, dur: 0.06, vol: 0.1 });
        break;
      case 'type':
        this._tone({ type: 'square', freq: 600 + Math.random() * 200, dur: 0.02, vol: 0.03 });
        break;
      case 'countdown':
        this._tone({ type: 'square', freq: opts.go ? 1046 : 523, dur: opts.go ? 0.3 : 0.12, vol: 0.12 });
        break;
      default:
        break;
    }
  }

  // ============================================================
  // 배경음 시퀀서 (lookahead 스케줄링)
  // ============================================================
  playMusic(id) {
    if (this.track?.id === id) return;
    this.stopMusic();
    this._pendingTrack = id;
    if (!this.ctx) return; // unlock 후 재생
    const data = TRACKS[id];
    if (!data) return;
    this.track = { id, data, step: 0, next: this.ctx.currentTime + 0.1 };
    this._timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    clearInterval(this._timer);
    this._timer = 0;
    this.track = null;
    this._pendingTrack = null;
  }

  _schedule() {
    const tr = this.track;
    if (!tr || !this.ctx) return;
    if (this.ctx.state !== 'running') {
      tr.next = this.ctx.currentTime + 0.1;
      return;
    }
    const stepDur = 60 / tr.data.bpm / 4;
    while (tr.next < this.ctx.currentTime + 0.12) {
      this._playStep(tr, tr.step, tr.next, stepDur);
      tr.step++;
      tr.next += stepDur;
    }
  }

  _noteLen(seq, i) {
    let n = 1;
    while (seq[(i + n) % seq.length] === '-' && n < seq.length) n++;
    return n;
  }

  _playStep(tr, step, time, stepDur) {
    const { lead, bass, drums } = tr.data;
    const delay = Math.max(0, time - this.ctx.currentTime);
    const li = step % lead.length;
    const ln = lead[li];
    if (ln !== '-' && ln !== '.') {
      this._tone({ type: 'square', freq: noteFreq(ln), dur: this._noteLen(lead, li) * stepDur * 0.92, vol: 0.22, delay, bus: this.musicBus });
    }
    const bi = step % bass.length;
    const bn = bass[bi];
    if (bn !== '-' && bn !== '.') {
      this._tone({ type: 'triangle', freq: noteFreq(bn), dur: this._noteLen(bass, bi) * stepDur * 0.9, vol: 0.45, delay, bus: this.musicBus });
    }
    const d = drums[step % drums.length];
    if (d === 'k') this._tone({ type: 'sine', freq: 140, freqEnd: 45, dur: 0.12, vol: 0.5, delay, bus: this.musicBus });
    else if (d === 's') this._noise({ dur: 0.1, vol: 0.25, filter: 'bandpass', freq: 1800, delay, bus: this.musicBus });
    else if (d === 'h') this._noise({ dur: 0.03, vol: 0.12, filter: 'highpass', freq: 7000, delay, bus: this.musicBus });
  }

  destroy() {
    this.stopMusic();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.master = this.musicBus = this.sfxBus = this.duckGain = null;
  }
}
