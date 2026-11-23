// ============================================================
//  오디오 엔진 — Web Audio 로 모든 소리를 실시간 합성 (외부 음원 파일 없음)
//  칩튠(펄스파/삼각파) + 리얼한 질감(필터 거친 노이즈)을 섞어 쓴다.
// ============================================================
import { AUDIO } from '../config.js';

// 듀티비가 다른 펄스파(패미컴 느낌)를 푸리에 급수로 만든다
function pulseWave(ctx, duty) {
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}

function noiseBuffer(ctx, seconds = 1) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlockListeners = [];
  }

  /** 브라우저 정책상 사용자 입력 후에만 소리를 켤 수 있다 — 첫 클릭/키 입력 때 호출 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      // 컴프레서: 폭발음 등 큰 소리가 겹쳐도 찢어지지 않게
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.MASTER;
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = AUDIO.SFX;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = AUDIO.MUSIC;
      this.musicBus.connect(this.master);
      this.noise = noiseBuffer(ctx, 1);
      this.waves = { pulse12: pulseWave(ctx, 0.125), pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) };
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const ls = this.unlockListeners;
    this.unlockListeners = [];
    ls.forEach((fn) => fn());
  }

  onUnlock(fn) {
    if (this.ctx) fn();
    else this.unlockListeners.push(fn);
  }

  get ready() {
    return !!this.ctx;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.MASTER, this.ctx.currentTime, 0.02);
  }

  setMusicLevel(level) {
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(AUDIO.MUSIC * level, this.ctx.currentTime, 0.05);
  }

  osc(type) {
    const o = this.ctx.createOscillator();
    if (this.waves[type]) o.setPeriodicWave(this.waves[type]);
    else o.type = type;
    return o;
  }

  /**
   * 톤 하나 재생
   * at: 절대 시각(초) — 없으면 now + start
   */
  tone({ type = 'square', freq = 440, freqEnd, at, start = 0, dur = 0.1, vol = 0.2, attack = 0.003, bus, vibrato = 0 }) {
    if (!this.ctx) return;
    const t0 = at ?? this.now + start;
    const o = this.osc(type);
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    if (vibrato) {
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 9;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  /** 필터 거친 노이즈 — 바람 소리, 칼 소리, 폭발, 드럼 */
  noiseBurst({ at, start = 0, dur = 0.1, vol = 0.2, filter = 'bandpass', freq = 1000, freqEnd, Q = 1, attack = 0.002, bus }) {
    if (!this.ctx) return;
    const t0 = at ?? this.now + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = Q;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(bus ?? this.sfxBus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
  }
}
