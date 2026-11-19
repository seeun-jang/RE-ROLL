// ============================================================
// Audio.js — Web Audio API 로 만드는 칩튠 효과음 + 배경음
// (외부 사운드 파일 없음. 브라우저 정책상 첫 키 입력/클릭 후에 소리가 난다)
// ============================================================

import { AUDIO } from '../config.js';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.bgm = new ChiptuneBGM(this);
    // 첫 사용자 입력에서 오디오 시작
    this._unlock = () => this.unlock();
    window.addEventListener('keydown', this._unlock);
    window.addEventListener('pointerdown', this._unlock);
  }

  /** 화면을 닫을 때: 소리를 멈추고 등록한 것을 모두 지운다 */
  destroy() {
    window.removeEventListener('keydown', this._unlock);
    window.removeEventListener('pointerdown', this._unlock);
    this.bgm.stop();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.MASTER;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = AUDIO.SFX;
      this.sfxBus.connect(this.master);
      this.bgmBus = this.ctx.createGain();
      this.bgmBus.gain.value = 0;
      this.bgmBus.connect(this.master);
      this._noise = this._makeNoiseBuffer();
      this.bgm.onContextReady();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : AUDIO.MASTER;
    return this.muted;
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 기본 음 하나: 사각파/삼각파 + 짧은 엔벨로프 (8비트 느낌)
  tone({ freq = 440, freqEnd = null, type = 'square', dur = 0.1, vol = 0.3, delay = 0, bus = null, attack = 0.004 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.setValueAtTime(vol, t0 + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // 노이즈 (휙 소리, 하이햇)
  noise({ dur = 0.1, vol = 0.2, delay = 0, filter = 3000, filterEnd = null, type = 'bandpass', bus = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t0);
    if (filterEnd) f.frequency.exponentialRampToValueAtTime(filterEnd, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------
  // 효과음 모음
  // ------------------------------------------------------------
  play(name, opt = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'syllable': { // 글자마다 음정이 올라가는 "삐"
        const i = opt.index ?? 0;
        const step = AUDIO.SYLLABLE_STEPS[Math.min(i, AUDIO.SYLLABLE_STEPS.length - 1)];
        const f = AUDIO.SYLLABLE_BASE_FREQ * Math.pow(2, step / 12);
        this.tone({ freq: f, type: 'square', dur: 0.09, vol: 0.18 });
        this.tone({ freq: f * 2, type: 'triangle', dur: 0.05, vol: 0.06 });
        break;
      }
      case 'turn': // 술래가 휙 돌아봄
        this.noise({ dur: 0.18, vol: 0.35, filter: 600, filterEnd: 4000 });
        this.tone({ freq: 880, freqEnd: 220, type: 'square', dur: 0.16, vol: 0.2 });
        this.tone({ freq: 110, type: 'triangle', dur: 0.35, vol: 0.35, delay: 0.05 });
        break;
      case 'fake': // 고개만 움찔
        this.noise({ dur: 0.08, vol: 0.2, filter: 1500, filterEnd: 3000 });
        this.tone({ freq: 330, freqEnd: 520, type: 'square', dur: 0.08, vol: 0.12 });
        break;
      case 'turnBack':
        this.noise({ dur: 0.12, vol: 0.12, filter: 3000, filterEnd: 800 });
        break;
      case 'catch': // 탈락
        this.tone({ freq: 660, freqEnd: 90, type: 'square', dur: 0.45, vol: 0.25 });
        this.tone({ freq: 640, freqEnd: 85, type: 'sawtooth', dur: 0.45, vol: 0.08 });
        this.noise({ dur: 0.25, vol: 0.3, filter: 800, type: 'lowpass' });
        break;
      case 'finish': { // 도착
        [72, 76, 79, 84].forEach((m, i) => this.tone({ freq: midiToFreq(m), type: 'square', dur: 0.1, vol: 0.18, delay: i * 0.07 }));
        this.tone({ freq: midiToFreq(88), type: 'triangle', dur: 0.3, vol: 0.15, delay: 0.28 });
        break;
      }
      case 'count': // 카운트다운 3,2,1
        this.tone({ freq: 440, type: 'square', dur: 0.12, vol: 0.2 });
        break;
      case 'go':
        this.tone({ freq: 880, type: 'square', dur: 0.35, vol: 0.22 });
        this.tone({ freq: 1320, type: 'triangle', dur: 0.35, vol: 0.1 });
        break;
      case 'ready': { // 플레이어 준비 완료 (플레이어마다 다른 음)
        const base = [60, 62, 64, 67, 69][opt.index ?? 0] ?? 60;
        this.tone({ freq: midiToFreq(base + 12), type: 'square', dur: 0.07, vol: 0.15 });
        this.tone({ freq: midiToFreq(base + 19), type: 'square', dur: 0.1, vol: 0.15, delay: 0.07 });
        break;
      }
      case 'blip': // 버튼/메뉴
        this.tone({ freq: 990, type: 'square', dur: 0.04, vol: 0.12 });
        break;
      case 'click':
        this.tone({ freq: 660, freqEnd: 990, type: 'square', dur: 0.07, vol: 0.15 });
        break;
      case 'reveal': // 순위표 한 줄 등장
        this.tone({ freq: midiToFreq(67 + (opt.index ?? 0) * 2), type: 'square', dur: 0.08, vol: 0.14 });
        break;
      case 'fanfare': { // 결과 발표
        const seq = [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.52], [79, 0.64], [84, 0.8]];
        seq.forEach(([m, d]) => this.tone({ freq: midiToFreq(m), type: 'square', dur: 0.13, vol: 0.18, delay: d }));
        this.tone({ freq: midiToFreq(48), type: 'triangle', dur: 0.8, vol: 0.25, delay: 0.8 });
        this.tone({ freq: midiToFreq(84), type: 'triangle', dur: 0.8, vol: 0.12, delay: 0.8 });
        break;
      }
      case 'timeUp':
        [0, 0.15, 0.3].forEach(d => this.tone({ freq: 523, freqEnd: 392, type: 'square', dur: 0.12, vol: 0.18, delay: d }));
        break;
      default:
        break;
    }
  }
}

// ------------------------------------------------------------
// 간단한 칩튠 시퀀서 (멜로디 + 베이스 + 하이햇)
// 술래가 돌아보면 pause() → 정적, 다시 뒤돌면 resume()
// ------------------------------------------------------------
class ChiptuneBGM {
  constructor(audio) {
    this.audio = audio;
    this.playing = false;
    this.paused = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    // 8분음표 32칸 (0 = 쉼표). 잔잔하고 경쾌한 오리지널 멜로디
    this.melody = [
      72, 0, 76, 0, 79, 0, 76, 74, 72, 0, 69, 0, 72, 0, 0, 0,
      74, 0, 76, 0, 79, 0, 81, 79, 76, 0, 74, 0, 72, 0, 0, 0,
      69, 0, 72, 0, 74, 0, 76, 0, 79, 0, 76, 0, 74, 72, 74, 0,
      76, 0, 79, 0, 81, 0, 79, 76, 74, 0, 76, 0, 72, 0, 0, 0,
    ];
    this.bass = [
      48, 0, 55, 0, 57, 0, 55, 0, 53, 0, 60, 0, 55, 0, 52, 0,
      50, 0, 57, 0, 55, 0, 53, 0, 48, 0, 55, 0, 48, 0, 43, 0,
      45, 0, 52, 0, 53, 0, 60, 0, 48, 0, 55, 0, 50, 0, 55, 0,
      53, 0, 60, 0, 55, 0, 52, 0, 50, 0, 55, 0, 48, 0, 48, 0,
    ];
  }

  onContextReady() {
    if (this.playing && !this.paused) this._run();
  }

  get stepDur() { return 60 / AUDIO.BGM_TEMPO / 2; }

  start() {
    this.playing = true;
    this.paused = false;
    this.step = 0;
    this._run();
  }

  stop() {
    this.playing = false;
    this._halt(0.15);
  }

  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    this._halt(0.04); // 빠르게 뚝 끊어서 정적
  }

  resume() {
    if (!this.playing || !this.paused) return;
    this.paused = false;
    this._run();
  }

  _run() {
    const a = this.audio;
    if (!a.ctx) return;
    const now = a.ctx.currentTime;
    a.bgmBus.gain.cancelScheduledValues(now);
    a.bgmBus.gain.setValueAtTime(a.bgmBus.gain.value, now);
    a.bgmBus.gain.linearRampToValueAtTime(AUDIO.BGM, now + 0.08);
    this.nextTime = now + 0.05;
    clearInterval(this.timer);
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
  }

  _halt(fade) {
    clearInterval(this.timer);
    this.timer = null;
    const a = this.audio;
    if (!a.ctx) return;
    const now = a.ctx.currentTime;
    a.bgmBus.gain.cancelScheduledValues(now);
    a.bgmBus.gain.setValueAtTime(a.bgmBus.gain.value, now);
    a.bgmBus.gain.linearRampToValueAtTime(0, now + fade);
  }

  // 0.12초 앞까지 미리 음을 예약 (look-ahead 스케줄링)
  _schedule() {
    const a = this.audio;
    if (!a.ctx) return;
    while (this.nextTime < a.ctx.currentTime + 0.12) {
      const delay = Math.max(0, this.nextTime - a.ctx.currentTime);
      const i = this.step % this.melody.length;
      const m = this.melody[i];
      const b = this.bass[i];
      const sd = this.stepDur;
      if (m) a.tone({ freq: midiToFreq(m), type: 'square', dur: sd * 0.9, vol: 0.12, delay, bus: a.bgmBus });
      if (b) a.tone({ freq: midiToFreq(b), type: 'triangle', dur: sd * 1.8, vol: 0.3, delay, bus: a.bgmBus });
      if (i % 2 === 1) a.noise({ dur: 0.03, vol: 0.06, filter: 8000, type: 'highpass', delay, bus: a.bgmBus });
      this.nextTime += sd;
      this.step++;
    }
  }
}
