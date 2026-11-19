// ============================================================
//  배경음악 — 신나는 칩튠 스텝 시퀀서 (C 장조, I–vi–IV–V 진행, 8마디 반복)
//  채널: 리드(펄스25%) / 아르페지오(펄스12.5%) / 베이스(삼각파) / 드럼(노이즈)
// ============================================================
import { AUDIO } from '../config.js';
import { midiToFreq } from './AudioEngine.js';

const _ = null; // 이전 음 지속
const R = 0; // 쉼표

// 리드 멜로디 — 마디당 16스텝(16분음표)
const LEAD = [
  [79, _, 76, _, 72, _, 76, 79, 84, _, 79, _, 76, _, _, R],
  [81, _, 76, _, 72, _, 76, 81, 84, _, 81, _, 79, _, _, R],
  [77, _, 81, _, 84, _, 81, 77, 76, _, 77, _, 81, _, 79, _],
  [79, _, 74, _, 71, _, 74, 79, 83, _, 86, _, 83, _, 79, R],
  [84, _, _, 83, 84, _, 79, _, 76, _, 79, _, 84, _, 86, _],
  [88, _, _, 86, 84, _, 81, _, 76, _, 81, _, 84, _, 83, _],
  [81, _, 84, _, 89, _, 88, _, 86, _, 84, _, 81, _, 84, _],
  [86, _, _, _, 83, _, 79, _, 74, _, 79, _, 83, _, 86, R],
];

// 코드(아르페지오용)와 베이스 루트
const CHORDS = [
  [60, 64, 67, 72], // C
  [57, 60, 64, 69], // Am
  [53, 57, 60, 65], // F
  [55, 59, 62, 67], // G
];
const ROOTS = [48, 45, 41, 43];
// 베이스: 루트/옥타브를 통통 튀게 (null = 쉼)
const BASS = [0, _, 12, _, 0, _, 12, 7, 0, _, 12, _, 0, 7, 12, _];

export class Music {
  constructor(engine) {
    this.a = engine;
    this.playing = false;
    this.mode = 'play';
    this.bpm = AUDIO.BPM;
    this.step = 0;
    this.timer = null;
    this.pendingMode = null;
  }

  get stepDur() {
    return 60 / this.bpm / 4;
  }

  /** mode: 'title'(잔잔) | 'play'(풀 편성) */
  play(mode = 'play') {
    this.mode = mode;
    this.bpm = mode === 'title' ? AUDIO.BPM - 18 : AUDIO.BPM;
    if (!this.a.ready) {
      // 오디오가 아직 잠겨 있으면 첫 입력 때 시작
      if (!this.pendingMode) this.a.onUnlock(() => this.pendingMode && this.play(this.pendingMode));
      this.pendingMode = mode;
      return;
    }
    this.pendingMode = null;
    this.a.setMusicLevel(1);
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.a.now + 0.06;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.pendingMode = null;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  setHurry(on) {
    if (this.mode === 'play') this.bpm = on ? AUDIO.BPM_HURRY : AUDIO.BPM;
  }

  // 일시정지 시 음악을 작게
  setDucked(on) {
    if (this.a.ready) this.a.setMusicLevel(on ? 0.25 : 1);
  }

  // 미리 LOOKAHEAD 초만큼 음을 예약해 두는 방식 (타이밍이 흔들리지 않음)
  schedule() {
    if (!this.playing) return;
    const ahead = this.a.now + AUDIO.LOOKAHEAD;
    if (this.nextTime < this.a.now - 0.25) this.nextTime = this.a.now + 0.02; // 탭 전환 후 밀린 박자 버림
    while (this.nextTime < ahead) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % (16 * LEAD.length);
    }
  }

  playStep(s, t) {
    const a = this.a;
    const bus = a.musicBus;
    const bar = Math.floor(s / 16);
    const pos = s % 16;
    const ci = bar % 4;
    const sd = this.stepDur;
    const full = this.mode === 'play';

    // 리드
    const note = LEAD[bar][pos];
    if (note) {
      let len = 1;
      while (pos + len < 16 && LEAD[bar][pos + len] === _) len++;
      a.tone({ type: 'pulse25', freq: midiToFreq(note), at: t, dur: len * sd * 0.92, vol: full ? 0.085 : 0.06, bus, vibrato: len >= 3 ? 6 : 0 });
    }

    // 베이스
    const b = BASS[pos];
    if (b !== _) {
      a.tone({ type: 'triangle', freq: midiToFreq(ROOTS[ci] + b), at: t, dur: sd * 1.7, vol: 0.24, bus });
    }

    // 아르페지오 (플레이 중에만)
    if (full) {
      const ch = CHORDS[ci];
      a.tone({ type: 'pulse12', freq: midiToFreq(ch[pos % 4] + 12), at: t, dur: sd * 0.7, vol: 0.03, bus });
    }

    // 드럼
    const hurry = this.bpm >= AUDIO.BPM_HURRY;
    if (full && (pos === 0 || pos === 8 || (bar >= 4 && pos === 10) || (hurry && pos === 14))) {
      a.tone({ type: 'sine', freq: 150, freqEnd: 42, at: t, dur: 0.14, vol: 0.55, bus });
    }
    if (full && (pos === 4 || pos === 12)) {
      a.noiseBurst({ at: t, dur: 0.12, vol: 0.2, filter: 'highpass', freq: 1400, bus });
      a.tone({ type: 'triangle', freq: 210, freqEnd: 150, at: t, dur: 0.06, vol: 0.14, bus });
    }
    if (pos % 2 === 0 || (hurry && full)) {
      a.noiseBurst({ at: t, dur: pos % 4 === 2 ? 0.06 : 0.025, vol: full ? 0.06 : 0.035, filter: 'highpass', freq: 7500, bus });
    }
  }
}
