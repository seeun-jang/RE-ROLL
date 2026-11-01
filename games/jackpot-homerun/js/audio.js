// =====================================================
// 칩튠 사운드 (Web Audio API로 직접 합성 — 외부 음원 없음)
// 효과음 + 카지노 스윙 재즈풍 배경음 시퀀서
// =====================================================
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
    [72, 0, 69, 72, 74, 0, 72, 0],
    [74, 0, 77, 74, 70, 0, 0, 0],
    [67, 70, 74, 0, 72, 70, 67, 0],
    [64, 67, 70, 72, 0, 70, 0, 0],
    [72, 0, 69, 72, 77, 0, 76, 0],
    [74, 0, 72, 69, 66, 0, 69, 0],
    [67, 0, 70, 0, 64, 0, 67, 0],
    [65, 0, 0, 0, 72, 74, 76, 77],
  ],
};

// 잭팟 대시 곡 (곧은 16분음표 · 8마디 반복) — 맵마다 한 곡
//  casino: A단조 Am | F | C | G | Am | F | G | E
//  hell  : D단조 Dm | Bb | C | A | Dm | Bb | Gm | A (톱니파 멜로디 · 16분 베이스로 더 무겁게)
const DASH_SONGS = {};
DASH_SONGS.casino = {
  lead: 'square',
  bass16: false,
  bass: [45, 41, 48, 43, 45, 41, 43, 40],
  chord: [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62], [57, 60, 64], [57, 60, 65], [55, 59, 62], [56, 59, 64]],
  melody: [
    [76, 0, 72, 76, 79, 0, 76, 72],
    [77, 0, 76, 72, 69, 0, 72, 0],
    [72, 0, 67, 72, 76, 0, 79, 76],
    [74, 0, 71, 67, 74, 76, 74, 0],
    [76, 0, 72, 76, 81, 0, 79, 76],
    [77, 76, 77, 79, 81, 0, 77, 0],
    [79, 0, 74, 71, 74, 0, 79, 0],
    [80, 0, 76, 80, 83, 0, 80, 0],
  ],
};
DASH_SONGS.hell = {
  lead: 'sawtooth',
  bass16: true,
  bass: [38, 34, 36, 33, 38, 34, 31, 33],
  chord: [[62, 65, 69], [62, 65, 70], [60, 64, 67], [61, 64, 69], [62, 65, 69], [62, 65, 70], [62, 67, 70], [61, 64, 69]],
  melody: [
    [74, 0, 74, 77, 76, 74, 72, 74],
    [70, 0, 70, 74, 72, 70, 69, 70],
    [72, 0, 72, 76, 79, 76, 72, 0],
    [73, 0, 76, 73, 69, 0, 73, 76],
    [74, 77, 81, 0, 79, 77, 76, 74],
    [77, 0, 74, 70, 74, 77, 82, 0],
    [79, 0, 74, 70, 67, 70, 74, 79],
    [81, 0, 79, 76, 73, 0, 69, 0],
  ],
};

const BGM_MODES = {
  lobby: { bpm: 126, melody: true, arp: false, drums: 1 },
  game: { bpm: 148, melody: true, arp: false, drums: 2 },
  boss: { bpm: 172, melody: false, arp: true, drums: 3 },
  result: { bpm: 120, melody: true, arp: true, drums: 1 },
  dash: { bpm: 135, straight: true }, // 실제 박자는 setDash 로 맵마다
};

class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgmMode = null;
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

    // 노이즈 버퍼 (폭발, 하이햇)
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (this.pendingBgm) this.playBgm(this.pendingBgm);
  }

  // 대시 곡 고르기 (맵 id · 박자)
  setDash(id, bpm) {
    this.dashSong = DASH_SONGS[id] || DASH_SONGS.casino;
    BGM_MODES.dash.bpm = bpm;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // 단음 하나 재생
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

  // 같은 효과음이 한 프레임에 수십 번 겹치지 않도록 제한
  sfx(name, value = 0) {
    if (!this.ctx || this.muted) return;
    this.lastCharge = value;
    const now = this.ctx.currentTime;
    const minGap = { crack: 0.05, mitt: 0.05, cheer: 0.4, jumpDash: 0.04, crash: 0.06, ring: 0.03, stepRun: 0.05, splash: 0.05, hop: 0.03, chalk: 0.04, step: 0.03, rifle: 0.02, casing: 0.03, ping: 0.02, popup: 0.05, shot: 0.07, coin: 0.04, hit: 0.03, tick: 0.03, explode: 0.05, clack: 0.03, thud: 0.05, charge: 0.05 }[name] || 0;
    if (this.lastPlay[name] && now - this.lastPlay[name] < minGap) return;
    this.lastPlay[name] = now;

    const T = (o) => this.tone(o);
    switch (name) {
      case 'shot':
        T({ freq: 1200, freqEnd: 700, dur: 0.04, vol: 0.025, type: 'pulse' });
        break;
      case 'hit':
        T({ freq: 260, freqEnd: 180, dur: 0.035, vol: 0.05 });
        break;
      case 'explode':
        this.noise({ dur: 0.25, vol: 0.22, filter: 1400 });
        T({ freq: 140, freqEnd: 40, dur: 0.2, vol: 0.12 });
        break;
      case 'bigExplode':
        this.noise({ dur: 0.9, vol: 0.35, filter: 900 });
        T({ freq: 90, freqEnd: 30, dur: 0.8, vol: 0.2, type: 'triangle' });
        break;
      case 'coin':
        T({ freq: 988, dur: 0.05, vol: 0.07 });
        T({ freq: 1319, dur: 0.12, vol: 0.07, when: now + 0.05 });
        break;
      case 'item':
        [523, 659, 784, 1047].forEach((f, i) => T({ freq: f, dur: 0.07, vol: 0.08, when: now + i * 0.05 }));
        break;
      case 'token':
        [784, 988, 784, 988].forEach((f, i) => T({ freq: f, dur: 0.05, vol: 0.07, type: 'pulse', when: now + i * 0.04 }));
        break;
      case 'tick':
        T({ freq: 1600, dur: 0.015, vol: 0.04 });
        break;
      case 'slotStop':
        T({ freq: 660, dur: 0.06, vol: 0.08, type: 'pulse' });
        break;
      case 'jackpot':
        for (let i = 0; i < 12; i++) {
          const f = [523, 659, 784, 1047][i % 4] * (i >= 8 ? 2 : 1);
          T({ freq: f, dur: 0.08, vol: 0.09, when: now + i * 0.06 });
        }
        break;
      case 'miss':
        T({ freq: 300, freqEnd: 150, dur: 0.25, vol: 0.08, type: 'triangle' });
        break;
      case 'bomb':
        this.noise({ dur: 0.5, vol: 0.25, filter: 3000, type: 'bandpass' });
        T({ freq: 200, freqEnd: 1600, dur: 0.3, vol: 0.08, type: 'sawtooth' });
        break;
      case 'hurt':
        T({ freq: 500, freqEnd: 80, dur: 0.3, vol: 0.12, type: 'sawtooth' });
        break;
      case 'bust':
        [392, 330, 262, 196].forEach((f, i) => T({ freq: f, dur: 0.14, vol: 0.1, type: 'pulse', when: now + i * 0.12 }));
        break;
      case 'warning':
        for (let i = 0; i < 6; i++) T({ freq: i % 2 ? 330 : 440, dur: 0.18, vol: 0.09, when: now + i * 0.2 });
        break;
      case 'select':
        T({ freq: 880, dur: 0.05, vol: 0.06, type: 'pulse' });
        break;
      case 'start':
        [523, 784, 1047, 1568].forEach((f, i) => T({ freq: f, dur: 0.1, vol: 0.08, when: now + i * 0.07 }));
        break;
      case 'pause':
        T({ freq: 660, dur: 0.06, vol: 0.06 });
        T({ freq: 440, dur: 0.08, vol: 0.06, when: now + 0.07 });
        break;
      case 'steal':
        [1200, 900, 1200, 900].forEach((f, i) => T({ freq: f, dur: 0.05, vol: 0.06, type: 'sawtooth', when: now + i * 0.05 }));
        break;
      case 'call':
        [660, 880].forEach((f, i) => T({ freq: f, dur: 0.08, vol: 0.08, type: 'pulse', when: now + i * 0.07 }));
        break;
      case 'countdown':
        T({ freq: 1046, dur: 0.07, vol: 0.08, type: 'square' });
        break;
      case 'lock':
        T({ freq: 440, dur: 0.05, vol: 0.08, type: 'pulse' });
        T({ freq: 330, dur: 0.12, vol: 0.08, type: 'pulse', when: now + 0.06 });
        break;
      case 'drop':
        T({ freq: 1800, freqEnd: 900, dur: 0.05, vol: 0.08 });
        T({ freq: 1400, freqEnd: 700, dur: 0.05, vol: 0.06, when: now + 0.09 });
        break;
      case 'chip':
        T({ freq: 1500, freqEnd: 1100, dur: 0.03, vol: 0.06, type: 'square' });
        T({ freq: 2200, dur: 0.02, vol: 0.04, type: 'square', when: now + 0.03 });
        break;
      case 'deal':
        this.noise({ dur: 0.06, vol: 0.12, filter: 4000, type: 'highpass' });
        break;
      case 'flip':
        this.noise({ dur: 0.05, vol: 0.14, filter: 3000, type: 'bandpass' });
        T({ freq: 880, dur: 0.05, vol: 0.05, type: 'pulse' });
        break;
      case 'double':
        [523, 784, 1047].forEach((f, i) => T({ freq: f, dur: 0.08, vol: 0.09, type: 'square', when: now + i * 0.05 }));
        break;
      case 'boost':
        T({ freq: 160, freqEnd: 900, dur: 0.18, vol: 0.09, type: 'sawtooth' });
        this.noise({ dur: 0.15, vol: 0.1, filter: 1800, type: 'bandpass' });
        break;
      case 'bump':
        T({ freq: 200, freqEnd: 60, dur: 0.16, vol: 0.18, type: 'square' });
        this.noise({ dur: 0.1, vol: 0.18, filter: 1200 });
        break;
      case 'tap':
        T({ freq: 300, freqEnd: 200, dur: 0.05, vol: 0.06, type: 'square' });
        break;
      case 'fall':
        T({ freq: 700, freqEnd: 90, dur: 0.6, vol: 0.1, type: 'triangle' });
        break;
      case 'ko':
        [784, 1047, 1319].forEach((f, i) => T({ freq: f, dur: 0.09, vol: 0.09, type: 'pulse', when: now + i * 0.06 }));
        break;
      case 'golden':
        for (let i = 0; i < 8; i++) T({ freq: [523, 659, 784, 1047][i % 4] * (i > 3 ? 2 : 1), dur: 0.08, vol: 0.09, when: now + i * 0.06 });
        break;
      case 'go':
        T({ freq: 1047, dur: 0.3, vol: 0.1, type: 'square' });
        break;
      case 'timeup':
        [523, 392, 262].forEach((f, i) => T({ freq: f, dur: 0.18, vol: 0.1, type: 'square', when: now + i * 0.14 }));
        break;
      case 'cue':
        T({ freq: 900, freqEnd: 500, dur: 0.05, vol: 0.14, type: 'square' });
        this.noise({ dur: 0.04, vol: 0.12, filter: 5000, type: 'highpass' });
        break;
      case 'thud':
        T({ freq: 140, freqEnd: 90, dur: 0.06, vol: 0.1, type: 'triangle' });
        break;
      case 'pocket':
        T({ freq: 300, freqEnd: 120, dur: 0.12, vol: 0.12, type: 'triangle' });
        T({ freq: 988, dur: 0.06, vol: 0.07, when: now + 0.1 });
        T({ freq: 1319, dur: 0.1, vol: 0.07, when: now + 0.16 });
        break;
      case 'charge':
        T({ freq: 400 + (this.lastCharge || 0) * 800, dur: 0.04, vol: 0.03, type: 'pulse' });
        break;
      case 'combo':
        [784, 988, 1175, 1568].forEach((f, i) => T({ freq: f, dur: 0.07, vol: 0.08, type: 'pulse', when: now + i * 0.05 }));
        break;
      case 'swish':
        this.noise({ dur: 0.07, vol: 0.1, filter: 3500, type: 'bandpass' });
        break;
      case 'whoosh':
        this.noise({ dur: 0.18, vol: 0.14, filter: 1500, type: 'bandpass' });
        break;
      case 'hit':
        T({ freq: 220, freqEnd: 90, dur: 0.08, vol: 0.16, type: 'square' });
        this.noise({ dur: 0.06, vol: 0.16, filter: 2000 });
        break;
      case 'power':
        T({ freq: 160, freqEnd: 40, dur: 0.25, vol: 0.22, type: 'square' });
        this.noise({ dur: 0.2, vol: 0.25, filter: 1200 });
        break;
      case 'block':
        T({ freq: 600, freqEnd: 500, dur: 0.05, vol: 0.08, type: 'triangle' });
        this.noise({ dur: 0.03, vol: 0.06, filter: 3000, type: 'highpass' });
        break;
      case 'dash':
        this.noise({ dur: 0.1, vol: 0.08, filter: 2500, type: 'bandpass' });
        break;
      case 'bell':
        [0, 0.35].forEach((d) => T({ freq: 1568, dur: 0.6, vol: 0.12, type: 'triangle', when: now + d }));
        break;
      case 'fight':
        [392, 523, 784].forEach((f, i) => T({ freq: f, dur: 0.12, vol: 0.1, type: 'square', when: now + i * 0.08 }));
        break;
      case 'ko':
        T({ freq: 120, freqEnd: 30, dur: 0.8, vol: 0.25, type: 'square' });
        this.noise({ dur: 1.4, vol: 0.18, filter: 900 });
        [784, 659, 523, 392].forEach((f, i) => T({ freq: f, dur: 0.15, vol: 0.08, type: 'pulse', when: now + 0.4 + i * 0.12 }));
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T({ freq: f, dur: 0.16, vol: 0.09, type: 'pulse', when: now + i * 0.12 }));
        break;
      // ---- 검도 ----
      case 'kiai':
        // 기합 소리: 짧게 꺾이는 외침 (value: 0 코테 / 1 멘 / 2 도 → 높이 다르게)
        T({ freq: [520, 440, 380][value] || 440, freqEnd: [380, 300, 260][value] || 300, dur: 0.16, vol: 0.07, type: 'sawtooth' });
        this.noise({ dur: 0.12, vol: 0.06, filter: 1800, type: 'bandpass' });
        break;
      case 'shinai':
        // 죽도가 맞는 '딱!' (대나무 소리)
        this.noise({ dur: 0.05, vol: 0.28, filter: 3200, type: 'bandpass' });
        T({ freq: 1400, freqEnd: 900, dur: 0.04, vol: 0.12, type: 'square' });
        T({ freq: 2600, dur: 0.02, vol: 0.06, type: 'square', when: now + 0.01 });
        break;
      case 'clack':
        // 막혔을 때 죽도끼리 '탁'
        this.noise({ dur: 0.04, vol: 0.18, filter: 4500, type: 'bandpass' });
        T({ freq: 1900, freqEnd: 1500, dur: 0.03, vol: 0.08, type: 'square' });
        break;
      case 'stomp':
        // 발구름 (후미코미)
        T({ freq: 120, freqEnd: 60, dur: 0.08, vol: 0.18, type: 'square' });
        this.noise({ dur: 0.05, vol: 0.1, filter: 900 });
        break;
      case 'taiko':
        T({ freq: 90, freqEnd: 45, dur: 0.35, vol: 0.3, type: 'sine' });
        this.noise({ dur: 0.12, vol: 0.12, filter: 600 });
        break;
      case 'ippon':
        // 한판! 북 두 번 + 잭팟 화음
        [0, 0.16].forEach((d) => {
          T({ freq: 95, freqEnd: 45, dur: 0.35, vol: 0.32, type: 'sine', when: now + d });
          this.noise({ dur: 0.1, vol: 0.12, filter: 700, when: now + d });
        });
        [523, 659, 784, 1047].forEach((f, i) => T({ freq: f, dur: 0.12, vol: 0.07, type: 'pulse', when: now + 0.3 + i * 0.06 }));
        break;
      case 'flag':
        this.noise({ dur: 0.12, vol: 0.12, filter: 2000, type: 'bandpass' });
        break;
      case 'aiuchi':
        [0, 0.05].forEach((d) => this.noise({ dur: 0.05, vol: 0.22, filter: 3200, type: 'bandpass', when: now + d }));
        T({ freq: 600, freqEnd: 400, dur: 0.15, vol: 0.06, type: 'triangle' });
        break;
      case 'hajime':
        [0, 0.12, 0.24].forEach((d, i) => T({ freq: i === 2 ? 110 : 90, freqEnd: 45, dur: 0.25, vol: 0.28, type: 'sine', when: now + d }));
        [392, 523, 784].forEach((f, i) => T({ freq: f, dur: 0.12, vol: 0.08, type: 'square', when: now + 0.3 + i * 0.08 }));
        break;
      // ---- 탁구 ----
      case 'pong':
        // 공이 탁구대에 '똑'
        T({ freq: 1250, freqEnd: 1050, dur: 0.035, vol: 0.12, type: 'square' });
        break;
      case 'paddle':
        // 라켓에 '딱' (value: 0 보통 / 1 스매시)
        T({ freq: value ? 700 : 900, freqEnd: value ? 300 : 600, dur: 0.05, vol: value ? 0.2 : 0.13, type: 'square' });
        this.noise({ dur: value ? 0.08 : 0.04, vol: value ? 0.2 : 0.1, filter: 3000, type: 'bandpass' });
        break;
      case 'net':
        this.noise({ dur: 0.15, vol: 0.12, filter: 900 });
        T({ freq: 300, freqEnd: 150, dur: 0.12, vol: 0.06, type: 'triangle' });
        break;
      case 'floor':
        T({ freq: 700, freqEnd: 500, dur: 0.03, vol: 0.06, type: 'square' });
        break;
      case 'swing':
        this.noise({ dur: 0.06, vol: 0.07, filter: 2500, type: 'bandpass' });
        break;
      case 'point':
        [784, 988, 1319].forEach((f, i) => T({ freq: f, dur: 0.08, vol: 0.08, type: 'pulse', when: now + i * 0.06 }));
        break;
      case 'smashReady':
        T({ freq: 1200, dur: 0.05, vol: 0.05, type: 'pulse' });
        break;
      // ---- 장애물 레이스 ----
      case 'splash': // 풍덩!
        this.noise({ dur: 0.35, vol: 0.22, filter: 1200 });
        T({ freq: 300, freqEnd: 90, dur: 0.25, vol: 0.08, type: 'triangle' });
        break;
      case 'stepRun': // 물 첨벙 / 달리는 발소리
        this.noise({ dur: 0.04, vol: 0.06, filter: 2400, type: 'bandpass' });
        break;
      case 'hop': // 점프
        T({ freq: 330, freqEnd: 660, dur: 0.09, vol: 0.07, type: 'pulse' });
        break;
      case 'land': // 착지
        T({ freq: 180, freqEnd: 120, dur: 0.05, vol: 0.08, type: 'square' });
        break;
      case 'grab': // 샌드백 / 로프 잡기
        T({ freq: 520, dur: 0.04, vol: 0.07, type: 'square' });
        T({ freq: 780, dur: 0.05, vol: 0.07, type: 'square', when: now + 0.05 });
        break;
      case 'whistle': // 출발 호루라기
        T({ freq: 2100, dur: 0.12, vol: 0.08, type: 'pulse' });
        T({ freq: 2300, dur: 0.35, vol: 0.08, type: 'pulse', when: now + 0.14 });
        break;
      case 'stage': // 다음 단계 통과
        [660, 990].forEach((f, i) => T({ freq: f, dur: 0.07, vol: 0.08, type: 'pulse', when: now + i * 0.07 }));
        break;
      // ---- 홈런 더비 ----
      case 'crack': // 방망이에 '딱!' (value: 정타일수록 더 맑고 큼)
        this.noise({ dur: 0.06, vol: 0.2 + value * 0.15, filter: 3800 + value * 2500, type: 'bandpass' });
        T({ freq: 1200 + value * 900, freqEnd: 500, dur: 0.06, vol: 0.12, type: 'square' });
        T({ freq: 2400, dur: 0.03, vol: 0.06 * value, type: 'square', when: now + 0.01 });
        break;
      case 'mitt': // 포수 미트 '펑'
        this.noise({ dur: 0.07, vol: 0.2, filter: 900 });
        T({ freq: 180, freqEnd: 90, dur: 0.07, vol: 0.12, type: 'square' });
        break;
      case 'umpire': // 심판 '스트라익!' 느낌의 두 음
        T({ freq: 330, freqEnd: 300, dur: 0.12, vol: 0.09, type: 'sawtooth' });
        T({ freq: 440, freqEnd: 380, dur: 0.22, vol: 0.09, type: 'sawtooth', when: now + 0.14 });
        break;
      case 'cheer': // 관중 함성 (커졌다 작아지는 소음)
        for (let i = 0; i < 6; i++) this.noise({ dur: 0.5, vol: 0.05 + i * 0.012, filter: 1400 + i * 200, type: 'bandpass', when: now + i * 0.12 });
        break;
      // ---- 잭팟 대시 ----
      case 'jumpDash': // 점프 '뿅'
        T({ freq: 520, freqEnd: 900, dur: 0.06, vol: 0.045, type: 'pulse' });
        break;
      case 'ring': // 공중 링
        T({ freq: 1319, dur: 0.05, vol: 0.07, type: 'pulse' });
        T({ freq: 1760, dur: 0.08, vol: 0.06, type: 'pulse', when: now + 0.04 });
        break;
      case 'pad': // 점프대 '뾰옹'
        T({ freq: 300, freqEnd: 1400, dur: 0.16, vol: 0.08, type: 'square' });
        break;
      case 'gate': // 로켓 / 달리기 바꿈
        T({ freq: 200, freqEnd: 1200, dur: 0.22, vol: 0.07, type: 'sawtooth' });
        this.noise({ dur: 0.2, vol: 0.08, filter: 2500, type: 'bandpass' });
        break;
      case 'crash': // 칩이 쾅! 흩어짐
        this.noise({ dur: 0.3, vol: 0.22, filter: 1600 });
        T({ freq: 400, freqEnd: 60, dur: 0.25, vol: 0.12, type: 'square' });
        [2400, 2000, 2600].forEach((f, i) => T({ freq: f, dur: 0.02, vol: 0.04, type: 'square', when: now + 0.08 + i * 0.05 }));
        break;
      case 'respawn':
        [660, 880, 1320].forEach((f, i) => T({ freq: f, dur: 0.05, vol: 0.05, type: 'pulse', when: now + i * 0.04 }));
        break;
      // ---- 교실 ----
      case 'chalk': // 분필 사각사각
        this.noise({ dur: 0.05, vol: 0.05, filter: 5000, type: 'highpass' });
        break;
      case 'ahem': // 선생님 '흠흠'
        T({ freq: 160, freqEnd: 120, dur: 0.12, vol: 0.09, type: 'square' });
        T({ freq: 150, freqEnd: 110, dur: 0.14, vol: 0.09, type: 'square', when: now + 0.18 });
        break;
      case 'turn': // 휙 돌아봄
        this.noise({ dur: 0.12, vol: 0.12, filter: 2200, type: 'bandpass' });
        break;
      case 'caught': // 딱 걸림!
        T({ freq: 880, dur: 0.08, vol: 0.12, type: 'square' });
        T({ freq: 660, dur: 0.08, vol: 0.12, type: 'square', when: now + 0.09 });
        T({ freq: 440, dur: 0.2, vol: 0.12, type: 'square', when: now + 0.18 });
        break;
      case 'chime': // 학교 종 (딩동댕동)
        [659, 523, 587, 392, 392, 587, 659, 523].forEach((f, i) => T({ freq: f, dur: 0.32, vol: 0.09, type: 'triangle', when: now + i * 0.34 }));
        break;
      case 'step': // 춤 스텝
        T({ freq: 520, dur: 0.03, vol: 0.04, type: 'pulse' });
        break;
      // ---- 사격장 ----
      case 'rifle': // 소총 한 발: 날카로운 파열음 + 낮은 울림
        this.noise({ dur: 0.12, vol: 0.32, filter: 3800 });
        this.noise({ dur: 0.35, vol: 0.16, filter: 700, when: now + 0.02 });
        T({ freq: 140, freqEnd: 50, dur: 0.12, vol: 0.14, type: 'square' });
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
  // startStep: 곡 중간부터 (대시 곡은 16분음표 단위 — 일시정지 후 이어서)
  playBgm(mode, startStep = 0) {
    if (!this.ctx) {
      this.pendingBgm = mode;
      return;
    }
    if (this.bgmMode === mode && !startStep) return;
    this.bgmMode = mode;
    this.step = startStep;
    this.nextTime = this.ctx.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 25);
  }

  stopBgm() {
    this.bgmMode = null;
    this.pendingBgm = null;
  }

  // 앞으로 0.15초 분량의 음을 미리 예약 (끊김 방지)
  _schedule() {
    if (!this.ctx || !this.bgmMode) return;
    const mode = BGM_MODES[this.bgmMode];
    const beat = 60 / mode.bpm;
    if (mode.straight) {
      while (this.nextTime < this.ctx.currentTime + 0.15) {
        this._playDash(this.step, this.nextTime, beat);
        this.step++;
        this.nextTime += beat / 4;
      }
      return;
    }
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this._playStep(this.step, this.nextTime, mode, beat);
      this.step = (this.step + 1) % 64; // 8마디 x 8분음표
      // 스윙: 정박은 길게, 엇박은 짧게 (2:1)
      this.nextTime += this.step % 2 === 1 ? beat * 0.62 : beat * 0.38;
    }
  }

  // 대시 곡: 0마디 = 카운트(딸깍 4번) → 1~8 베이스·드럼 → 9~ 멜로디 → 17~ 아르페지오까지 전부
  _playDash(step, t, beat) {
    const bus = this.musicBus;
    const bar = (step / 16) | 0;
    const s = step % 16;
    if (bar === 0) {
      if (s % 4 === 0) this.tone({ freq: s === 0 ? 1568 : 1175, dur: 0.05, vol: 0.09, type: 'pulse', when: t, bus });
      return;
    }
    const song = this.dashSong || DASH_SONGS.casino;
    const b = (bar - 1) % 8;
    const lvl = bar <= 8 ? 1 : bar <= 16 ? 2 : 3;
    // 베이스: 8분음표 옥타브 펌프 (지옥 곡은 16분음표로 몰아침)
    if (s % 2 === 0 || song.bass16) {
      const n = song.bass[b] + (s % 4 === 2 ? 12 : 0) + (song.bass16 ? 12 : 0);
      this.tone({ freq: midiToFreq(n), dur: beat * (song.bass16 ? 0.22 : 0.45), vol: 0.2, type: song.bass16 && s % 2 ? 'square' : 'triangle', when: t, bus });
    }
    // 코드: 엇박 찌르기
    if (s % 4 === 2) for (const n of song.chord[b]) this.tone({ freq: midiToFreq(n), dur: 0.07, vol: 0.03, type: 'pulse', when: t, bus });
    // 멜로디 (8분음표)
    if (lvl >= 2 && s % 2 === 0) {
      const n = song.melody[b][s / 2];
      if (n) this.tone({ freq: midiToFreq(n), dur: beat * 0.42, vol: song.lead === 'sawtooth' ? 0.04 : 0.055, type: song.lead, when: t, bus });
    }
    // 아르페지오 (16분음표)
    if (lvl >= 3) {
      const ch = song.chord[b];
      this.tone({ freq: midiToFreq(ch[s % 3] + 12), dur: 0.05, vol: 0.03, type: 'pulse', when: t, bus });
    }
    // 드럼: 쿵(정박) · 짝(2·4박) · 치(16분)
    if (s % 4 === 0) this.tone({ freq: 160, freqEnd: 45, dur: 0.12, vol: 0.24, type: 'sine', when: t, bus });
    if (lvl >= 2 && (s === 4 || s === 12)) this.noise({ dur: 0.09, vol: 0.1, filter: 2600, type: 'bandpass', when: t, bus });
    if (s % 2 === 1 || lvl >= 3) this.noise({ dur: 0.025, vol: s % 4 === 2 ? 0.06 : 0.035, filter: 8000, type: 'highpass', when: t, bus });
  }

  _playStep(step, t, mode, beat) {
    const bar = (step / 8) | 0;
    const e = step % 8;
    const bus = this.musicBus;

    // 워킹 베이스 (4분음표)
    if (e % 2 === 0) {
      const n = BGM_SONG.bass[bar][e / 2];
      this.tone({ freq: midiToFreq(n), dur: beat * 0.9, vol: 0.22, type: 'triangle', when: t, bus });
    }
    // 찰스턴 리듬 코드 (1박, 2박 엇박)
    if (e === 0 || e === 3) {
      for (const n of BGM_SONG.chord[bar]) {
        this.tone({ freq: midiToFreq(n), dur: 0.09, vol: 0.035, type: 'pulse', when: t, bus });
      }
    }
    // 멜로디
    if (mode.melody) {
      const n = BGM_SONG.melody[bar][e];
      if (n) this.tone({ freq: midiToFreq(n), dur: beat * 0.5, vol: 0.06, type: 'square', when: t, bus });
    }
    // 보스: 빠른 아르페지오
    if (mode.arp) {
      const ch = BGM_SONG.chord[bar];
      const n = ch[step % ch.length] + 12;
      this.tone({ freq: midiToFreq(n), dur: 0.06, vol: 0.04, type: 'pulse', when: t, bus });
    }
    // 드럼: 킥 + 하이햇 (+ 보스 스네어)
    if (e === 0 || e === 4) this.tone({ freq: 150, freqEnd: 45, dur: 0.12, vol: 0.2, type: 'sine', when: t, bus });
    if (mode.drums >= 1 && e % 2 === 1) this.noise({ dur: 0.03, vol: 0.05, filter: 7000, type: 'highpass', when: t, bus });
    if (mode.drums >= 2 && (e === 2 || e === 6)) this.noise({ dur: 0.08, vol: 0.08, filter: 2500, type: 'bandpass', when: t, bus });
    if (mode.drums >= 3 && e % 2 === 0) this.noise({ dur: 0.02, vol: 0.04, filter: 9000, type: 'highpass', when: t, bus });
  }
}
