// 오디오 엔진 — Web Audio API 로 모든 소리를 코드에서 합성한다 (외부 파일 없음).
// master ─┬─ music (덕킹 가능)
//         └─ sfx
import { AUDIO } from '../config.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volumes = { master: AUDIO.MASTER, music: AUDIO.MUSIC, sfx: AUDIO.SFX };
    this._duck = 1;
    this._noise = null;
  }

  /** 첫 사용자 입력(클릭/키) 때 호출 — 브라우저 자동재생 정책 */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      // 칩튠이 너무 쨍하지 않게 살짝 컴프레서
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      this._applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolume(kind, v) {
    this.volumes[kind] = Math.max(0, Math.min(1, v));
    this._applyVolumes();
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyVolumes();
    return this.muted;
  }

  /** 배경음 볼륨 배율 (음성 인식 중 줄이기) */
  duck(level) {
    this._duck = level;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(this.volumes.music * level, this.ctx.currentTime, AUDIO.DUCK_TIME);
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.02);
    this.music.gain.setTargetAtTime(this.volumes.music * this._duck, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
  }

  /** 재사용하는 화이트 노이즈 버퍼 (박수/환호/드럼) */
  noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 2;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this._noise;
  }

  // ---------- 합성 기본 단위 ----------
  /**
   * 음 하나. type: square|triangle|sawtooth|sine
   * opts: { freq, to(끝 주파수), dur, vol, attack, out(출력 노드), detune, vibrato }
   */
  tone(time, { type = 'square', freq = 440, to = null, dur = 0.12, vol = 0.2, attack = 0.005, out, vibrato = 0 }) {
    if (!this.ctx) return;
    const c = this.ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 9;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(time);
      lfo.stop(time + dur + 0.05);
    }
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + attack);
    g.gain.setValueAtTime(vol, time + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    osc.connect(g).connect(out || this.sfx);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  /** 노이즈 한 방. filter: {type, freq, to, q} */
  noise(time, { dur = 0.1, vol = 0.2, filter = null, out, attack = 0.003 }) {
    if (!this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true; // 버퍼(2초)보다 긴 소리도 끊기지 않게
    const offset = Math.random() * 1.5;
    const g = c.createGain();
    let node = src;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.setValueAtTime(filter.freq || 1000, time);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, time + dur);
      f.Q.value = filter.q || 1;
      node.connect(f);
      node = f;
    }
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    node.connect(g).connect(out || this.sfx);
    src.start(time, offset, dur + 0.05);
  }
}
