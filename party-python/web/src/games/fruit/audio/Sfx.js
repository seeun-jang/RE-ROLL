// ============================================================
//  효과음 — 상황마다 서로 다른 소리를 합성한다
//  (칼 휘두르기 / 과일 자르기 / 폭탄 베기 / 폭탄 폭발 / 아이템 자르기 / 아이템별 활성화 ...)
// ============================================================
import { midiToFreq } from './AudioEngine.js';

export class Sfx {
  constructor(engine) {
    this.a = engine;
  }

  // 칼 휘두르기: 바람 가르는 "휙" — 밴드패스 노이즈가 위로 쓸려 올라감
  swing() {
    const a = this.a;
    a.noiseBurst({ dur: 0.17, vol: 0.16, filter: 'bandpass', freq: 500, freqEnd: 2800, Q: 1.6, attack: 0.05 });
    a.noiseBurst({ dur: 0.08, vol: 0.04, filter: 'highpass', freq: 5000, start: 0.04 });
  }

  // 과일 자르기: "샥"(고음 노이즈) + "철퍽"(저음 과즙) + 칩튠 블립. 콤보가 이어질수록 음이 올라감
  sliceFruit(combo = 0) {
    const a = this.a;
    a.noiseBurst({ dur: 0.05, vol: 0.32, filter: 'highpass', freq: 3200 });
    a.noiseBurst({ dur: 0.15, vol: 0.28, filter: 'lowpass', freq: 1100, freqEnd: 260, start: 0.012, Q: 3 });
    const f = 520 * 2 ** (Math.min(combo, 12) / 12);
    a.tone({ type: 'pulse25', freq: f, freqEnd: f * 0.55, dur: 0.08, vol: 0.1 });
  }

  // 폭탄 베기: 쇠붙이 "깡!" — 비정수배 두 음 + 심지 치익
  sliceBomb() {
    const a = this.a;
    a.tone({ type: 'square', freq: 1245, dur: 0.14, vol: 0.14 });
    a.tone({ type: 'triangle', freq: 1813, dur: 0.18, vol: 0.18 });
    a.tone({ type: 'triangle', freq: 2637, dur: 0.1, vol: 0.08 });
    a.noiseBurst({ dur: 0.22, vol: 0.1, filter: 'highpass', freq: 6000 });
  }

  // 폭탄 폭발: 저음 쿵 + 거친 노이즈 감쇠 + 잔해 탁탁
  explode(delay = 0.07) {
    const a = this.a;
    a.tone({ type: 'sine', freq: 150, freqEnd: 36, start: delay, dur: 0.5, vol: 0.8, attack: 0.005 });
    a.tone({ type: 'pulse50', freq: 110, freqEnd: 40, start: delay, dur: 0.3, vol: 0.14 });
    a.noiseBurst({ start: delay, dur: 1.0, vol: 0.6, filter: 'lowpass', freq: 2200, freqEnd: 110, Q: 0.7 });
    for (let i = 0; i < 6; i++) {
      a.noiseBurst({ start: delay + 0.12 + Math.random() * 0.45, dur: 0.03, vol: 0.12, filter: 'highpass', freq: 2500 });
    }
  }

  // 아이템 자르기: 유리 같은 "띠링" 아르페지오 + 반짝이는 고음 노이즈
  sliceItem() {
    const a = this.a;
    a.noiseBurst({ dur: 0.05, vol: 0.25, filter: 'highpass', freq: 3500 });
    [84, 88, 91, 96].forEach((m, i) => {
      a.tone({ type: 'triangle', freq: midiToFreq(m), start: i * 0.03, dur: 0.16, vol: 0.18 });
    });
    a.noiseBurst({ dur: 0.3, vol: 0.05, filter: 'highpass', freq: 8000, start: 0.04 });
  }

  // 점수 2배 활성화: 반짝이는 상승 팡파레 (펄스 25%) + 비브라토 긴 끝음
  activateDouble() {
    const a = this.a;
    [79, 84, 88, 91].forEach((m, i) => {
      a.tone({ type: 'pulse25', freq: midiToFreq(m), start: i * 0.065, dur: 0.1, vol: 0.13 });
    });
    a.tone({ type: 'pulse25', freq: midiToFreq(96), start: 0.26, dur: 0.42, vol: 0.13, vibrato: 18 });
    a.tone({ type: 'triangle', freq: midiToFreq(60), start: 0.26, dur: 0.4, vol: 0.2 });
  }

  // 과일 세배 활성화: "빠-빠-빠암!" 세 번 올라가는 화음 + 휘익 상승 스윕
  activateTriple() {
    const a = this.a;
    const chords = [[72, 76, 79], [74, 78, 81], [76, 80, 83]];
    chords.forEach((ch, i) => {
      const last = i === 2;
      ch.forEach((m) => a.tone({ type: 'pulse12', freq: midiToFreq(m), start: i * 0.1, dur: last ? 0.45 : 0.08, vol: 0.075, vibrato: last ? 10 : 0 }));
      a.tone({ type: 'triangle', freq: midiToFreq(ch[0] - 24), start: i * 0.1, dur: last ? 0.45 : 0.08, vol: 0.2 });
    });
    a.noiseBurst({ dur: 0.4, vol: 0.08, filter: 'bandpass', freq: 400, freqEnd: 5000, Q: 2 });
  }

  combo(n) {
    const a = this.a;
    const base = 76 + Math.min(n, 10);
    a.tone({ type: 'triangle', freq: midiToFreq(base), dur: 0.1, vol: 0.2 });
    a.tone({ type: 'triangle', freq: midiToFreq(base + 7), start: 0.07, dur: 0.18, vol: 0.2 });
  }

  countdown() {
    this.a.tone({ type: 'pulse50', freq: midiToFreq(76), dur: 0.14, vol: 0.12 });
  }

  go() {
    const a = this.a;
    a.tone({ type: 'pulse50', freq: midiToFreq(88), dur: 0.35, vol: 0.13 });
    a.tone({ type: 'pulse25', freq: midiToFreq(83), dur: 0.35, vol: 0.08 });
  }

  tick() {
    this.a.tone({ type: 'triangle', freq: 1760, dur: 0.04, vol: 0.14 });
  }

  timeUp() {
    const a = this.a;
    a.tone({ type: 'pulse25', freq: midiToFreq(88), freqEnd: midiToFreq(76), dur: 0.45, vol: 0.12 });
    a.tone({ type: 'triangle', freq: midiToFreq(64), start: 0.1, dur: 0.5, vol: 0.2 });
  }

  clear() {
    const a = this.a;
    [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => {
      a.tone({ type: 'pulse25', freq: midiToFreq(m), start: i * 0.09, dur: i === 6 ? 0.6 : 0.1, vol: 0.12, vibrato: i === 6 ? 14 : 0 });
    });
    a.tone({ type: 'triangle', freq: midiToFreq(48), start: 0.54, dur: 0.6, vol: 0.22 });
  }

  gameOver() {
    const a = this.a;
    [67, 64, 60, 55].forEach((m, i) => {
      a.tone({ type: 'pulse50', freq: midiToFreq(m), start: i * 0.2, dur: i === 3 ? 0.7 : 0.18, vol: 0.12, vibrato: i === 3 ? 6 : 0 });
    });
    a.tone({ type: 'triangle', freq: midiToFreq(43), start: 0.6, dur: 0.8, vol: 0.2 });
  }

  uiClick() {
    this.a.tone({ type: 'pulse50', freq: 880, freqEnd: 1320, dur: 0.05, vol: 0.08 });
  }

  pause() {
    const a = this.a;
    a.tone({ type: 'pulse25', freq: midiToFreq(81), dur: 0.06, vol: 0.1 });
    a.tone({ type: 'pulse25', freq: midiToFreq(76), start: 0.07, dur: 0.08, vol: 0.1 });
  }
}
