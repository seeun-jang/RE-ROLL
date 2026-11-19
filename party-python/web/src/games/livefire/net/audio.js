// =============================================================
// 칩튠 사운드 (Web Audio API 로 직접 합성 — 외부 음원 없음) — 원본 js/audio.js 에서 이 게임이 쓰는 것만 옮김.
// 효과음 + 스윙 재즈풍 배경음 시퀀서. AudioContext 는 unlock() 이 불릴 때(첫 입력) 만든다.
// =============================================================
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 8마디 스윙 진행: F | Bb | Gm | C7 | F | D7 | Gm C7 | F
const BGM_SONG = {
  bass: [
    [41, 45, 48, 50], [46, 50, 53, 55], [43, 46, 50, 53], [48, 52, 55, 58],
    [41, 45, 48, 45], [50, 54, 57, 54], [43, 46, 48, 52], [41, 48, 41, 40],
  ],
  chord: [
    [57, 60, 65], [58, 62, 65], [55, 58, 62], [55, 58, 64],
    [57, 60, 65], [54, 57, 60], [55, 58, 64], [57, 60, 65],
  ],
  melody: [
    [72, 0, 69, 72, 74, 0, 72, 0], [74, 0, 77, 74, 70, 0, 0, 0], [67, 70, 74, 0, 72, 70, 67, 0],
    [64, 67, 70, 72, 0, 70, 0, 0], [72, 0, 69, 72, 77, 0, 76, 0], [74, 0, 72, 69, 66, 0, 69, 0],
    [67, 0, 70, 0, 64, 0, 67, 0], [65, 0, 0, 0, 72, 74, 76, 77],
  ],
};

const BGM_MODES = {
  game: { bpm: 148, melody: true, arp: false, drums: 2 },
  result: { bpm: 120, melody: true, arp: true, drums: 1 },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgmMode = null;
    this.pendingBgm = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.lastPlay = {};
  }

  // 브라우저 정책상 첫 키 입력 이후에만 오디오 시작 가능
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);
    // 25% 듀티 펄스파 (패미컴 느낌)
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * 0.25);
    this.pulse25 = this.ctx.createPeriodicWave(real, imag);
    // 노이즈 버퍼
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.pendingBgm) this.playBgm(this.pendingBgm);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** 화면을 닫을 때: 배경음 시퀀서를 멈추고 오디오를 닫는다 */
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.bgmMode = null;
    this.pendingBgm = null;
    if (this.ctx) {
      try { this.ctx.close(); } catch (e) { /* 이미 닫힘 */ }
    }
    this.ctx = null;
  }

  tone({ freq, freqEnd = null, dur = 0.1, vol = 0.1, type = 'square', when = 0, bus = null }) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (type === 'pulse') osc.setPeriodicWave(this.pulse25);
    else osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.2, when = 0, filter = 2000, bus = null, type = 'lowpass' }) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const minGap = { rifle: 0.02, far: 0.04, casing: 0.03, ping: 0.02, popup: 0.05 }[name] || 0;
    if (this.lastPlay[name] && now - this.lastPlay[name] < minGap) return;
    this.lastPlay[name] = now;
    const T = (o) => this.tone(o);
    switch (name) {
      case 'select':
        T({ freq: 880, dur: 0.05, vol: 0.06, type: 'pulse' });
        break;
      case 'lock': // 조정간 딸깍
        T({ freq: 440, dur: 0.05, vol: 0.08, type: 'pulse' });
        T({ freq: 330, dur: 0.12, vol: 0.08, type: 'pulse', when: now + 0.06 });
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T({ freq: f, dur: 0.16, vol: 0.09, type: 'pulse', when: now + i * 0.12 }));
        break;
      case 'rifle': // 소총 한 발: 날카로운 파열음 + 낮은 울림
        this.noise({ dur: 0.12, vol: 0.32, filter: 3800 });
        this.noise({ dur: 0.35, vol: 0.16, filter: 700, when: now + 0.02 });
        T({ freq: 140, freqEnd: 50, dur: 0.12, vol: 0.14, type: 'square' });
        break;
      case 'far': // 옆 사로의 총소리 (작게) — 여러 명이 함께 쏘므로 원본 총소리를 줄였다
        this.noise({ dur: 0.1, vol: 0.07, filter: 1800 });
        T({ freq: 120, freqEnd: 60, dur: 0.08, vol: 0.03, type: 'square' });
        break;
      case 'casing': // 탄피가 바닥에 떨어지는 소리
        T({ freq: 2600, dur: 0.02, vol: 0.03, type: 'square', when: now + 0.25 });
        T({ freq: 3100, dur: 0.02, vol: 0.025, type: 'square', when: now + 0.33 });
        break;
      case 'ping': // 명중: 표적 맞는 '탁'
        T({ freq: 900, freqEnd: 500, dur: 0.06, vol: 0.09, type: 'pulse', when: now + 0.08 });
        break;
      case 'popup': // 표적 올라오는 모터 소리
        T({ freq: 90, freqEnd: 160, dur: 0.18, vol: 0.06, type: 'square' });
        break;
      case 'radio': // 통제탑 방송 '삐-'
        T({ freq: 1000, dur: 0.06, vol: 0.06, type: 'pulse' });
        this.noise({ dur: 0.1, vol: 0.05, filter: 2500, when: now + 0.06 });
        break;
      case 'reload': // 탄알집 빼고 끼우기
        T({ freq: 300, dur: 0.04, vol: 0.1, type: 'square' });
        T({ freq: 520, dur: 0.05, vol: 0.1, type: 'square', when: now + 0.35 });
        T({ freq: 700, dur: 0.04, vol: 0.1, type: 'square', when: now + 0.5 });
        break;
      case 'dry': // 탄이 없음 '찰칵'
        T({ freq: 1800, dur: 0.02, vol: 0.06, type: 'square' });
        break;
      default:
        break;
    }
  }

  // ---------------- 배경음 ----------------
  playBgm(mode) {
    if (!this.ctx) {
      this.pendingBgm = mode;
      return;
    }
    if (this.bgmMode === mode) return;
    this.bgmMode = mode;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 25);
  }

  // 앞으로 0.15초 분량의 음을 미리 예약 (끊김 방지)
  _schedule() {
    if (!this.ctx || !this.bgmMode) return;
    const mode = BGM_MODES[this.bgmMode];
    const beat = 60 / mode.bpm;
    if (this.nextTime < this.ctx.currentTime - 1) this.nextTime = this.ctx.currentTime + 0.05; // 탭이 쉬다 돌아왔을 때
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this._playStep(this.step, this.nextTime, mode, beat);
      this.step = (this.step + 1) % 64; // 8마디 x 8분음표
      this.nextTime += this.step % 2 === 1 ? beat * 0.62 : beat * 0.38; // 스윙 2:1
    }
  }

  _playStep(step, t, mode, beat) {
    const bar = (step / 8) | 0;
    const e = step % 8;
    const bus = this.musicBus;
    if (e % 2 === 0) this.tone({ freq: midiToFreq(BGM_SONG.bass[bar][e / 2]), dur: beat * 0.9, vol: 0.22, type: 'triangle', when: t, bus });
    if (e === 0 || e === 3) {
      for (const n of BGM_SONG.chord[bar]) this.tone({ freq: midiToFreq(n), dur: 0.09, vol: 0.035, type: 'pulse', when: t, bus });
    }
    if (mode.melody) {
      const n = BGM_SONG.melody[bar][e];
      if (n) this.tone({ freq: midiToFreq(n), dur: beat * 0.5, vol: 0.06, type: 'square', when: t, bus });
    }
    if (mode.arp) {
      const ch = BGM_SONG.chord[bar];
      this.tone({ freq: midiToFreq(ch[step % ch.length] + 12), dur: 0.06, vol: 0.04, type: 'pulse', when: t, bus });
    }
    if (e === 0 || e === 4) this.tone({ freq: 150, freqEnd: 45, dur: 0.12, vol: 0.2, type: 'sine', when: t, bus });
    if (mode.drums >= 1 && e % 2 === 1) this.noise({ dur: 0.03, vol: 0.05, filter: 7000, type: 'highpass', when: t, bus });
    if (mode.drums >= 2 && (e === 2 || e === 6)) this.noise({ dur: 0.08, vol: 0.08, filter: 2500, type: 'bandpass', when: t, bus });
  }
}
