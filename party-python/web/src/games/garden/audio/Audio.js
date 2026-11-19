// 8비트 효과음 — Web Audio API로 코드에서 직접 합성 (외부 파일 없음)
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = false;
    this.volume = 0.6;
    this.musicVolume = 0.32;
    this.lastPlayed = new Map();
    this.noiseBuffer = null;
    this.closed = false;
  }

  // 브라우저 정책상 사용자 입력 안에서 호출해야 소리가 난다
  unlock() {
    if (this.closed) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // 효과음이 겹칠 때 클리핑을 막는 컴프레서
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.1;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(comp);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.volume; this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicVolume; this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 1;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setMuted(m) {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.01);
  }

  close() {
    this.closed = true;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null; this.master = null; this.sfxGain = null; this.musicGain = null; this.noiseBuffer = null;
  }

  // 단일 톤: 주파수 f0→f1 램프, 게인 엔벨로프
  tone({ type = 'square', f0 = 440, f1 = null, dur = 0.1, vol = 0.2, delay = 0, attack = 0.005, release = null, dest = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t0);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    const rel = release ?? dur;
    g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(dest || this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // 노이즈: 필터 통과 백색 잡음
  noise({ dur = 0.1, vol = 0.2, delay = 0, filter = 'lowpass', freq = 1000, q = 0.7, dest = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // 효과음 사전. 같은 소리는 최소 간격을 두어 폭주를 막는다.
  play(name) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const minGap = MIN_GAP[name] ?? 0.03;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minGap) return;
    this.lastPlayed.set(name, now);
    const fn = SFX[name];
    if (fn) fn(this);
  }
}

const MIN_GAP = { hit: 0.04, shot_mg: 0.03, coin: 0.05, turretShot: 0.05, dust: 0.1, move: 0.05 };

const SFX = {
  shot_pistol: (a) => { a.tone({ type: 'square', f0: 900, f1: 180, dur: 0.09, vol: 0.22 }); a.noise({ dur: 0.05, vol: 0.12, filter: 'highpass', freq: 2500 }); },
  shot_shotgun: (a) => { a.noise({ dur: 0.24, vol: 0.5, filter: 'lowpass', freq: 1400 }); a.tone({ type: 'square', f0: 170, f1: 55, dur: 0.17, vol: 0.3 }); },
  shot_mg: (a) => { a.tone({ type: 'square', f0: 700, f1: 260, dur: 0.05, vol: 0.16 }); a.noise({ dur: 0.03, vol: 0.1, filter: 'highpass', freq: 3000 }); },
  shot_sniper: (a) => { a.tone({ type: 'sawtooth', f0: 1500, f1: 70, dur: 0.32, vol: 0.28 }); a.noise({ dur: 0.14, vol: 0.3, filter: 'bandpass', freq: 1800, q: 1.5 }); },
  dry: (a) => a.tone({ type: 'square', f0: 1300, f1: 900, dur: 0.025, vol: 0.1 }),
  reload: (a) => { a.tone({ type: 'triangle', f0: 520, dur: 0.03, vol: 0.18 }); a.tone({ type: 'triangle', f0: 760, dur: 0.03, vol: 0.18, delay: 0.14 }); a.noise({ dur: 0.04, vol: 0.08, delay: 0.14, filter: 'highpass', freq: 2000 }); },
  switch: (a) => a.tone({ type: 'square', f0: 620, f1: 960, dur: 0.05, vol: 0.14 }),
  unlock: (a) => [523, 659, 784, 1047].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.08, vol: 0.16, delay: i * 0.07 })),
  deny: (a) => a.tone({ type: 'square', f0: 220, f1: 140, dur: 0.14, vol: 0.18 }),
  ui: (a) => a.tone({ type: 'square', f0: 880, dur: 0.03, vol: 0.1 }),
  move: (a) => a.tone({ type: 'square', f0: 420, f1: 520, dur: 0.03, vol: 0.08 }),
  hit: (a) => { a.tone({ type: 'square', f0: 240, f1: 110, dur: 0.05, vol: 0.16 }); a.noise({ dur: 0.03, vol: 0.08, filter: 'lowpass', freq: 1200 }); },
  hitBoss: (a) => { a.tone({ type: 'square', f0: 130, f1: 60, dur: 0.08, vol: 0.24 }); },
  helmet: (a) => { a.tone({ type: 'triangle', f0: 1900, f1: 1300, dur: 0.07, vol: 0.2 }); a.noise({ dur: 0.05, vol: 0.14, filter: 'highpass', freq: 3500 }); },
  kill: (a) => { a.noise({ dur: 0.16, vol: 0.28, filter: 'lowpass', freq: 2200 }); a.tone({ type: 'square', f0: 320, f1: 50, dur: 0.14, vol: 0.22 }); },
  bossDie: (a) => { a.noise({ dur: 0.9, vol: 0.5, filter: 'lowpass', freq: 700 }); a.tone({ type: 'sawtooth', f0: 220, f1: 25, dur: 0.9, vol: 0.35 }); [392, 330, 262, 196].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.15, vol: 0.15, delay: 0.2 + i * 0.12 })); },
  coin: (a) => { a.tone({ type: 'square', f0: 988, dur: 0.05, vol: 0.14 }); a.tone({ type: 'square', f0: 1319, dur: 0.11, vol: 0.14, delay: 0.05 }); },
  pickup: (a) => { a.tone({ type: 'square', f0: 660, dur: 0.06, vol: 0.16 }); a.tone({ type: 'square', f0: 880, dur: 0.08, vol: 0.16, delay: 0.06 }); },
  heart: (a) => [523, 659, 784, 1047].forEach((f, i) => a.tone({ type: 'triangle', f0: f, dur: 0.1, vol: 0.2, delay: i * 0.08 })),
  bomb: (a) => { a.noise({ dur: 0.55, vol: 0.6, filter: 'lowpass', freq: 500 }); a.tone({ type: 'sawtooth', f0: 110, f1: 20, dur: 0.45, vol: 0.4 }); },
  place: (a) => { a.tone({ type: 'square', f0: 160, f1: 80, dur: 0.1, vol: 0.26 }); a.noise({ dur: 0.06, vol: 0.14, filter: 'lowpass', freq: 600 }); },
  turretBreak: (a) => { a.noise({ dur: 0.26, vol: 0.3, filter: 'lowpass', freq: 1500 }); a.tone({ type: 'square', f0: 200, f1: 70, dur: 0.22, vol: 0.2 }); },
  turretShot: (a) => a.tone({ type: 'square', f0: 1000, f1: 420, dur: 0.05, vol: 0.1 }),
  turretFrost: (a) => a.tone({ type: 'triangle', f0: 1500, f1: 2300, dur: 0.08, vol: 0.1 }),
  lifeLost: (a) => { a.tone({ type: 'sawtooth', f0: 440, f1: 100, dur: 0.4, vol: 0.28 }); [392, 330, 262].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.13, vol: 0.18, delay: 0.1 + i * 0.13 })); },
  waveStart: (a) => [392, 523, 659, 784].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.09, vol: 0.18, delay: i * 0.08 })),
  bossWave: (a) => { a.tone({ type: 'sawtooth', f0: 110, f1: 100, dur: 0.7, vol: 0.3 }); a.tone({ type: 'sawtooth', f0: 55, dur: 0.7, vol: 0.3 }); a.noise({ dur: 0.6, vol: 0.3, filter: 'lowpass', freq: 300 }); },
  bossIntro: (a) => { a.tone({ type: 'sawtooth', f0: 80, f1: 40, dur: 0.9, vol: 0.35 }); a.noise({ dur: 0.8, vol: 0.35, filter: 'lowpass', freq: 250 }); [196, 185, 175].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.25, vol: 0.2, delay: 0.3 + i * 0.25 })); },
  bossSummon: (a) => { a.tone({ type: 'square', f0: 300, f1: 520, dur: 0.1, vol: 0.18 }); a.tone({ type: 'square', f0: 300, f1: 520, dur: 0.1, vol: 0.18, delay: 0.12 }); },
  waveClear: (a) => [523, 659, 784, 1047].forEach((f, i) => a.tone({ type: 'square', f0: f, dur: 0.1, vol: 0.18, delay: i * 0.09 })),
  clear: (a) => { const seq = [[523, 0.12], [523, 0.12], [523, 0.12], [659, 0.3], [784, 0.3], [1047, 0.6]]; let t = 0; for (const [f, d] of seq) { a.tone({ type: 'square', f0: f, dur: d, vol: 0.2, delay: t }); a.tone({ type: 'triangle', f0: f / 2, dur: d, vol: 0.14, delay: t }); t += d; } },
  gameover: (a) => { [330, 311, 294, 262, 220].forEach((f, i) => { a.tone({ type: 'sawtooth', f0: f, dur: 0.32, vol: 0.2, delay: i * 0.3 }); a.tone({ type: 'square', f0: f / 2, dur: 0.32, vol: 0.12, delay: i * 0.3 }); }); },
  jump: (a) => a.tone({ type: 'square', f0: 300, f1: 760, dur: 0.12, vol: 0.12 }),
  land: (a) => a.noise({ dur: 0.06, vol: 0.14, filter: 'lowpass', freq: 800 }),
  gestureArm: (a) => { a.tone({ type: 'triangle', f0: 700, dur: 0.05, vol: 0.12 }); a.tone({ type: 'triangle', f0: 1000, dur: 0.06, vol: 0.12, delay: 0.05 }); },
  reveal: (a) => { a.tone({ type: 'square', f0: 440, dur: 0.06, vol: 0.14 }); a.tone({ type: 'square', f0: 660, dur: 0.1, vol: 0.14, delay: 0.06 }); },
  winner: (a) => { const seq = [659, 659, 659, 784, 988, 1319]; seq.forEach((f, i) => { a.tone({ type: 'square', f0: f, dur: i === seq.length - 1 ? 0.6 : 0.12, vol: 0.2, delay: i * 0.13 }); }); },
};
