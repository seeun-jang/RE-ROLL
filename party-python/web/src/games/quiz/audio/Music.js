// 칩튠 배경음 시퀀서 — 16분음표 단위 스텝, 미리 스케줄링(look-ahead) 방식.
// 곡은 코드로 정의: 리드(사각파) / 베이스(삼각파) / 드럼(노이즈) / 아르페지오
import { AUDIO } from '../config.js';
import { midi } from './Sfx.js';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.2;
const MAX_LAG = 0.05; // 이보다 많이 밀리면 밀린 음은 건너뛴다 (한꺼번에 몰아 재생 방지)

// 음표 문자열 파서: "C5 . E5 G5 - ..." ( . = 쉼, - = 앞 음 연장 )
const NOTE_IDX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function parse(str) {
  return str
    .trim()
    .split(/\s+/)
    .map((tok) => {
      if (tok === '.' || tok === '-') return tok;
      const m = tok.match(/^([A-G]#?)(\d)$/);
      return m ? 12 * (Number(m[2]) + 1) + NOTE_IDX[m[1]] : '.';
    });
}

// ---------- 곡 데이터 ----------
// 신나는 C - Am - F - G 진행 (각 마디 16스텝)
const CHORDS = {
  C: [60, 64, 67],
  Am: [57, 60, 64],
  F: [53, 57, 60],
  G: [55, 59, 62],
  Em: [52, 55, 59],
  Dm: [50, 53, 57],
};

const SONGS = {
  play: {
    bpm: AUDIO.BPM_PLAY,
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
    lead: parse(`
      E5 . G5 . C6 . G5 . A5 - G5 . E5 . D5 .
      C5 . E5 . A5 . E5 . G5 - E5 . C5 . . .
      F5 . A5 . C6 . A5 . G5 . F5 . E5 . D5 .
      D5 . G5 . B5 . G5 . D6 - B5 . G5 . . .
      E5 . G5 . C6 . G5 . E6 - D6 . C6 . G5 .
      A5 . C6 . E6 . C6 . A5 - G5 . E5 . . .
      F5 . . F5 A5 . F5 . D5 . F5 . A5 . C6 .
      B5 - - - G5 - - - D6 - - - . . . .`),
    drums: 'k.h.s.h.k.k.s.h.', // k=킥 s=스네어 h=하이햇
    arp: true,
  },
  title: {
    bpm: AUDIO.BPM_TITLE,
    chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
    lead: parse(`
      A5 - - . G5 . F5 . G5 - - - . . . .
      B5 - - . A5 . G5 . A5 - - - E5 . . .
      G5 - - . F5 . E5 . B4 - - - . . . .
      C5 . E5 . A5 . . . G5 - - - . . . .
      A5 - - . G5 . F5 . C6 - - - A5 . . .
      B5 - - . A5 . G5 . D6 - - - B5 . . .
      C6 . . G5 . . E5 . G5 . . C6 . . E6 .
      D6 - - - C6 - - - . . . . . . . .`),
    drums: 'k...s...k.k.s...',
    arp: false,
  },
  result: {
    bpm: 120,
    chords: ['C', 'F', 'G', 'C'],
    lead: parse(`
      C5 . E5 . G5 . C6 . . . G5 . C6 - - -
      A5 . . . F5 . A5 . C6 - - - . . . .
      B5 . . . G5 . B5 . D6 - - - B5 . G5 .
      C6 - - - - - - - . . . . . . . .`),
    drums: 'k.......s.......',
    arp: true,
  },
};

export class Music {
  /** @param {import('./AudioEngine.js').AudioEngine} audio */
  constructor(audio) {
    this.a = audio;
    this.song = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.beat = 0; // 화면 연출(관객 들썩임)용 박자 카운터
  }

  play(name) {
    if (!this.a.ctx) return;
    if (this.song === SONGS[name] && this.timer) return;
    this.stop();
    this.song = SONGS[name];
    this.step = 0;
    this.nextTime = this.a.now + 0.08;
    this.timer = setInterval(() => this._schedule(), LOOKAHEAD_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  _schedule() {
    const s = this.song;
    if (!s || !this.a.ctx) return;
    const stepDur = 60 / s.bpm / 4;
    // 메인 스레드가 멈췄다 돌아오면(모델 로딩, 탭 숨김 등) 지나간 스텝은 버리고 박자만 맞춘다
    const now = this.a.now;
    if (this.nextTime < now - MAX_LAG) {
      const skip = Math.ceil((now - this.nextTime) / stepDur);
      this.step = (this.step + skip) % s.lead.length;
      this.nextTime += skip * stepDur;
    }
    while (this.nextTime < this.a.now + SCHEDULE_AHEAD) {
      this._playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % s.lead.length;
    }
  }

  _playStep(step, t, stepDur) {
    const s = this.song;
    const out = this.a.music;
    const bar = Math.floor(step / 16) % s.chords.length;
    const inBar = step % 16;
    const chord = CHORDS[s.chords[bar]];
    if (inBar % 4 === 0) this.beat++;

    // 리드: 다음 칸이 '-' 이면 길게
    const note = s.lead[step];
    if (typeof note === 'number') {
      let len = 1;
      while (s.lead[(step + len) % s.lead.length] === '-' && len < 8) len++;
      this.a.tone(t, { type: 'square', freq: midi(note), dur: stepDur * len * 0.92, vol: 0.075, out });
      // 살짝 어긋난 메아리 (리버브 느낌)
      this.a.tone(t + stepDur * 1.5, { type: 'square', freq: midi(note), dur: stepDur * 0.8, vol: 0.018, out });
    }

    // 베이스: 8분음표 근음-옥타브 바운스
    if (inBar % 2 === 0) {
      const root = chord[0] - 24 + (inBar % 4 === 2 ? 12 : 0);
      this.a.tone(t, { type: 'triangle', freq: midi(root), dur: stepDur * 1.8, vol: 0.2, out });
    }

    // 아르페지오: 16분음표로 코드 구성음 순환
    if (s.arp) {
      const m = chord[inBar % 3] + 12;
      this.a.tone(t, { type: 'square', freq: midi(m), dur: stepDur * 0.5, vol: 0.022, out });
    }

    // 드럼
    const d = s.drums[inBar];
    if (d === 'k') {
      this.a.tone(t, { type: 'sine', freq: 140, to: 45, dur: 0.14, vol: 0.38, out });
    } else if (d === 's') {
      this.a.noise(t, { dur: 0.12, vol: 0.13, filter: { type: 'bandpass', freq: 1800, q: 0.7 }, out });
      this.a.tone(t, { type: 'triangle', freq: 220, to: 160, dur: 0.07, vol: 0.08, out });
    } else if (d === 'h') {
      this.a.noise(t, { dur: 0.03, vol: 0.05, filter: { type: 'highpass', freq: 7000 }, out });
    }
  }
}
