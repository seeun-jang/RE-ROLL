// 레이싱 소리 — Web Audio 로 바로 합성한다(음원 파일 없음): 엔진음, 출발 신호, 바퀴 수 알림, 벽 충돌, 미끄러짐.
export class RaceAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
      // 엔진: 낮은 톱니파 두 개. 속도에 따라 높이와 크기가 바뀐다
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      this.engineGain.connect(lp);
      lp.connect(this.master);
      this.osc = [0, 1].map((i) => {
        const o = this.ctx.createOscillator();
        o.type = i ? 'square' : 'sawtooth';
        o.frequency.value = 50;
        o.connect(this.engineGain);
        o.start();
        return o;
      });
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
  }

  /** speed: 0~1 */
  engine(speed, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 45 + speed * 120;
    this.osc[0].frequency.setTargetAtTime(f, t, 0.05);
    this.osc[1].frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + speed * 0.07 : 0, t, 0.08);
  }

  tone(freq, dur, vol = 0.2, type = 'square', delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noise(dur, vol, freq) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  beep() { this.tone(440, 0.15, 0.2); }

  go() { this.tone(880, 0.4, 0.25); }

  lap() { this.tone(660, 0.1, 0.18); this.tone(990, 0.16, 0.18, 'square', 0.1); }

  finish() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.5 : 0.12, 0.2, 'square', i * 0.12)); }

  bump() { this.noise(0.15, 0.35, 220); }

  skid() { this.noise(0.08, 0.06, 1800); }

  destroy() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
