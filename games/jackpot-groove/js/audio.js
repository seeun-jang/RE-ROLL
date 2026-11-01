// =====================================================
// 칩튠 사운드 (Web Audio API로 직접 합성 — 외부 음원 없음)
//  - AudioManager : 오디오 켜기, 효과음
//  - MusicPlayer  : 곡(song.js)을 오디오 시계에 맞춰 미리 예약 재생
//  - SongClock    : 지금이 곡의 몇 초인지 (판정 기준 시계)
// =====================================================
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastPlay = {};
    this.listeners = [];
  }

  // 브라우저 정책상 첫 키 입력 이후에만 오디오 시작 가능
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.holdSuspend) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    // 소리가 겹쳐도 깨지지 않게 컴프레서
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);

    // 멜로디용 메아리 (카지노 홀 울림)
    this.echoBus = this.ctx.createGain();
    this.echoBus.gain.value = 1;
    const delay = this.ctx.createDelay(1);
    this.echoDelay = delay;
    delay.delayTime.value = (60 / SONG.bpm) * 0.75;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.32;
    this.echoBus.connect(this.musicBus);
    this.echoBus.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.musicBus);

    // 25% / 12.5% 듀티 펄스파 (패미컴 느낌)
    const pulse = (duty) => {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      return this.ctx.createPeriodicWave(real, imag);
    };
    this.pulse25 = pulse(0.25);
    this.pulse12 = pulse(0.125);

    // 노이즈 버퍼 (드럼)
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.listeners.forEach((fn) => fn());
  }

  // 오디오가 켜지면 실행할 함수 등록
  onReady(fn) {
    if (this.ctx) fn();
    else this.listeners.push(fn);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // 단음 하나 (attack → sustain → release 엔벨로프)
  tone({ freq, freqEnd = null, dur = 0.1, vol = 0.1, type = 'square', when = 0, bus = null, sustain = false, vibrato = 0 }) {
    if (!this.ctx) return;
    const t = Math.max(when || 0, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (type === 'pulse') osc.setPeriodicWave(this.pulse25);
    else if (type === 'pulse12') osc.setPeriodicWave(this.pulse12);
    else osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    if (vibrato && dur > 0.3) {
      // 긴 음은 살짝 떨림
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(freq * vibrato, t + 0.25);
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    if (sustain) {
      g.gain.setValueAtTime(vol * 0.75, t + 0.05);
      g.gain.setValueAtTime(vol * 0.75, t + Math.max(0.06, dur - 0.04));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.2, when = 0, filter = 2000, bus = null, type = 'lowpass' }) {
    if (!this.ctx) return;
    const t = Math.max(when || 0, this.ctx.currentTime);
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
    const now = this.ctx.currentTime;
    const minGap = { tap: 0.025, hit: 0.03, miss: 0.08, combo: 0.2 }[name] || 0;
    const key = name + (name === 'tap' ? value : '');
    if (this.lastPlay[key] && now - this.lastPlay[key] < minGap) return;
    this.lastPlay[key] = now;
    const T = (o) => this.tone(o);
    switch (name) {
      case 'tap':
        // 빈 레인 누름: 레인마다 다른 높이의 짧은 클릭
        T({ freq: [1320, 1760, 2093][value] || 1500, dur: 0.025, vol: 0.025, type: 'triangle' });
        break;
      case 'hit':
        this.noise({ dur: 0.03, vol: 0.06, filter: 6000, type: 'highpass' });
        break;
      case 'miss':
        T({ freq: 220, freqEnd: 110, dur: 0.12, vol: 0.05, type: 'triangle' });
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
      case 'combo':
        [784, 988, 1175, 1568].forEach((f, i) => T({ freq: f, dur: 0.06, vol: 0.05, type: 'pulse', when: now + i * 0.04 }));
        break;
      case 'fever':
        for (let i = 0; i < 8; i++) T({ freq: [1047, 1319, 1568, 2093][i % 4], dur: 0.06, vol: 0.05, type: 'pulse', when: now + i * 0.035 });
        break;
      case 'clear':
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T({ freq: f, dur: 0.16, vol: 0.09, type: 'pulse', when: now + i * 0.11 }));
        break;
      case 'fullcombo':
        for (let i = 0; i < 12; i++) T({ freq: [523, 659, 784, 1047][i % 4] * (i >= 8 ? 2 : 1), dur: 0.08, vol: 0.08, when: now + i * 0.06 });
        break;
      case 'stamp':
        T({ freq: 160, freqEnd: 50, dur: 0.18, vol: 0.18, type: 'square' });
        this.noise({ dur: 0.12, vol: 0.14, filter: 1500 });
        break;
      case 'drum':
        T({ freq: 200 + value * 40, freqEnd: 60, dur: 0.1, vol: 0.12, type: 'square' });
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------
// 곡 재생기: 곡의 [fromBar, toBar) 구간을 오디오 시계 기준으로 예약 재생
//  startAt: 곡 0초(=fromBar 첫 박)가 울릴 오디오 시각
//  countIn: true 면 시작 전 한 마디 카운트 (스틱 소리 4번)
//  loop   : 타이틀/결과 화면 배경음처럼 반복
// ---------------------------------------------------
class MusicPlayer {
  constructor(audio) {
    this.audio = audio;
    this.song = expandSong();
    this.playing = false;
    this.timer = null;
    this.vol = 1;
    // 칸 번호 → 그 칸에서 시작하는 멜로디 음
    this.melodyAt = new Map();
    for (const m of this.song.melody) {
      if (!this.melodyAt.has(m.step)) this.melodyAt.set(m.step, []);
      this.melodyAt.get(m.step).push(m);
    }
  }

  play({ startAt, fromBar = 0, toBar = null, loop = false, countIn = false, vol = 1 }) {
    this.stop();
    if (!this.audio.ctx) return;
    if (this.audio.echoDelay) this.audio.echoDelay.delayTime.value = (60 / SONG.bpm) * 0.75; // 곡마다 박자가 달라서
    this.fromBar = fromBar;
    this.toBar = toBar === null ? this.song.bars.length : toBar;
    this.loop = loop;
    this.vol = vol;
    this.startAt = startAt;
    this.step = countIn ? -16 : 0; // 구간 시작 기준 16분음표 번호
    this.playing = true;
    this.out = this.audio.ctx.createGain();
    this.out.gain.value = vol;
    this.out.connect(this.audio.musicBus);
    this.echoIn = this.audio.ctx.createGain();
    this.echoIn.gain.value = vol;
    this.echoIn.connect(this.audio.echoBus);
    this._schedule();
    this.timer = setInterval(() => this._schedule(), 25);
  }

  // 페이드 아웃 후 정지
  stop(fade = 0) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    if (this.out && this.audio.ctx) {
      const t = this.audio.ctx.currentTime;
      const outs = [this.out, this.echoIn];
      for (const o of outs) {
        o.gain.cancelScheduledValues(t);
        o.gain.setValueAtTime(o.gain.value, t);
        o.gain.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
        setTimeout(() => o.disconnect(), (fade + 0.1) * 1000 + 50);
      }
    }
    this.out = null;
    this.echoIn = null;
  }

  // 앞으로 0.2초 분량을 미리 예약 (끊김 방지)
  _schedule() {
    const ctx = this.audio.ctx;
    if (!ctx || !this.playing) return;
    const st = this.song.stepSec;
    const len = (this.toBar - this.fromBar) * 16;
    while (this.startAt + this.step * st < ctx.currentTime + 0.2) {
      const t = this.startAt + this.step * st;
      if (this.step < 0) {
        // 카운트인: 4분음표마다 스틱
        if (this.step % 4 === 0) this.audio.tone({ freq: this.step === -4 ? 1760 : 1320, dur: 0.05, vol: 0.12, type: 'square', when: t, bus: this.out });
      } else if (this.step < len || this.loop) {
        const local = this.step % len;
        if (t > ctx.currentTime - 0.05) this._playStep(this.fromBar * 16 + local, t);
      } else {
        this.playing = false;
        clearInterval(this.timer);
        this.timer = null;
        return;
      }
      this.step++;
    }
  }

  _playStep(gStep, t) {
    const A = this.audio;
    const song = this.song;
    const bar = song.bars[(gStep / 16) | 0];
    const s = gStep % 16;
    const bus = this.out;
    const st = song.stepSec;

    // 멜로디 (리드: 펄스파 + 메아리)
    for (const m of this.melodyAt.get(gStep) || []) {
      const dur = m.dur * st;
      A.tone({ freq: midiToFreq(m.midi), dur: Math.max(0.09, dur * 0.95), vol: 0.07, type: 'pulse', when: t, bus: this.echoIn, sustain: true, vibrato: 0.012 });
      // 한 옥타브 아래 겹쳐서 두툼하게
      A.tone({ freq: midiToFreq(m.midi - 12), dur: Math.max(0.09, dur * 0.95), vol: 0.025, type: 'triangle', when: t, bus, sustain: true });
    }

    // 베이스
    const bp = SONG.bassPatterns[bar.drums] || SONG.bassPatterns.verse;
    const bk = bp[s];
    if (bk !== '.') {
      const r = bar.chord.root;
      const n = bk === 'O' ? r + 12 : bk === 'F' ? r + 7 : r;
      const long = bar.drums === 'break' || bar.drums === 'end';
      A.tone({ freq: midiToFreq(n), dur: long ? st * 15 : st * 1.6, vol: 0.2, type: 'triangle', when: t, bus, sustain: long });
      A.tone({ freq: midiToFreq(n), dur: long ? st * 6 : st * 0.9, vol: 0.035, type: 'pulse12', when: t, bus });
    }

    // 화음 스탭 (엇박 펑크 리듬) / 브레이크는 길게 깔기
    if (bar.drums === 'break' || bar.drums === 'end') {
      if (s === 0) for (const n of bar.chord.notes) A.tone({ freq: midiToFreq(n), dur: st * 15, vol: 0.022, type: 'pulse12', when: t, bus, sustain: true });
    } else if ([2, 6, 10, 14].includes(s) || (bar.drums === 'chorus' && s === 7)) {
      for (const n of bar.chord.notes) A.tone({ freq: midiToFreq(n), dur: st * 0.8, vol: 0.026, type: 'pulse', when: t, bus });
    }

    // 2번째 코러스: 반짝이는 아르페지오
    if (bar.arp) {
      const ch = bar.chord.notes;
      const n = ch[s % 3] + 24 - (s % 6 >= 3 ? 12 : 0);
      A.tone({ freq: midiToFreq(n), dur: st * 0.7, vol: 0.016, type: 'square', when: t, bus });
    }
    // 프리코러스 마지막 마디: 올라가는 스윕 (긴장감)
    if (bar.build && bar.index % 4 === 3 && s === 8) {
      A.noise({ dur: st * 8, vol: 0.07, filter: 4000, type: 'bandpass', when: t, bus });
    }
    // 코러스 시작: 잭팟 벨
    if (bar.fever && bar.firstOfSection && s === 0) {
      [1047, 1319, 1568, 2093].forEach((f, i) => A.tone({ freq: f, dur: 0.25, vol: 0.04, type: 'triangle', when: t + i * 0.03, bus }));
    }

    // 드럼
    const dp = SONG.drumPatterns[bar.drums];
    if (dp.K && dp.K[s] === 'x') A.tone({ freq: 160, freqEnd: 42, dur: 0.14, vol: 0.32, type: 'sine', when: t, bus });
    if (dp.S && dp.S[s] === 'x') {
      A.noise({ dur: 0.12, vol: 0.13, filter: 2400, type: 'bandpass', when: t, bus });
      A.tone({ freq: 240, freqEnd: 140, dur: 0.06, vol: 0.07, type: 'triangle', when: t, bus });
    }
    if (dp.H && dp.H[s] === 'x') A.noise({ dur: 0.025, vol: 0.045, filter: 8000, type: 'highpass', when: t, bus });
    if (dp.O && dp.O[s] === 'x') A.noise({ dur: 0.12, vol: 0.035, filter: 7000, type: 'highpass', when: t, bus });
    if (s === 0 && bar.firstOfSection && bar.index > 0) A.noise({ dur: 0.8, vol: 0.06, filter: 5000, type: 'highpass', when: t, bus });
  }
}

// ---------------------------------------------------
// 곡 시계: 판정·노트 위치의 기준
//  - 오디오가 켜져 있으면 오디오 시계(실제 소리)에 맞춤
//  - 오디오가 없으면 performance.now() 로 대체
//  - 오디오 시계는 띄엄띄엄 갱신되므로 performance 시계로 부드럽게 보간
// ---------------------------------------------------
class SongClock {
  constructor(audio) {
    this.audio = audio;
    this.offset = 0;    // 사용자 싱크 보정 (초)
    this.paused = false;
    this.started = false;
  }

  // songTime0 = 지금 곡 시간, audioStart = 곡 0초가 울릴 오디오 시각
  start(songTimeNow, audioStart) {
    this.started = true;
    this.audioStart = audioStart;
    this.base = songTimeNow;
    this.perfBase = performance.now();
    this.paused = false;
  }

  // 출력 지연 (스피커까지 걸리는 시간)
  get latency() {
    const c = this.audio.ctx;
    if (!c) return 0;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }

  // perfMs 시점의 곡 시간 (키 입력 시각을 그대로 넣으면 정확한 판정)
  timeAt(perfMs = performance.now()) {
    if (!this.started) return -999;
    if (this.paused) return this.base - this.offset;
    return this.base + (perfMs - this.perfBase) / 1000 - this.offset;
  }

  get time() {
    return this.timeAt();
  }

  // 매 프레임: 오디오 시계와 어긋났으면 살살 맞춤
  sync() {
    const c = this.audio.ctx;
    if (!this.started || this.paused || !c || c.state !== 'running') return;
    const now = performance.now();
    const audioSong = c.currentTime - this.audioStart - this.latency;
    const est = this.base + (now - this.perfBase) / 1000;
    const diff = audioSong - est;
    if (Math.abs(diff) > 0.06) {
      this.base = audioSong;
      this.perfBase = now;
    } else {
      this.base += diff * 0.08;
    }
  }

  pause() {
    if (this.paused) return;
    this.base = this.base + (performance.now() - this.perfBase) / 1000;
    this.paused = true;
    if (this.audio.ctx) {
      this.audio.holdSuspend = true;
      this.audio.ctx.suspend();
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.perfBase = performance.now();
    if (this.audio.ctx) {
      this.audio.holdSuspend = false;
      this.audio.ctx.resume();
    }
  }
}
