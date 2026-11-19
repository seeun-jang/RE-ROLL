// 효과음 모음 — 칩튠(사각파/삼각파) + 리얼 계열(노이즈로 만든 박수·환호·탄식)

export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sfx {
  /** @param {import('./AudioEngine.js').AudioEngine} audio */
  constructor(audio) {
    this.a = audio;
  }

  get t() {
    return this.a.now + 0.01;
  }

  // ----- UI -----
  move() {
    this.a.tone(this.t, { type: 'square', freq: 990, dur: 0.04, vol: 0.06 });
  }
  select() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(76), dur: 0.06, vol: 0.08 });
    this.a.tone(t + 0.06, { type: 'square', freq: midi(83), dur: 0.09, vol: 0.08 });
  }
  back() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(79), dur: 0.06, vol: 0.07 });
    this.a.tone(t + 0.06, { type: 'square', freq: midi(72), dur: 0.08, vol: 0.07 });
  }
  pause() {
    const t = this.t;
    [84, 79, 84, 79].forEach((m, i) => this.a.tone(t + i * 0.07, { type: 'square', freq: midi(m), dur: 0.06, vol: 0.06 }));
  }

  // ----- 진행 -----
  /** 문제 등장 "띵-동" */
  questionIntro() {
    const t = this.t;
    this.a.tone(t, { type: 'triangle', freq: midi(81), dur: 0.35, vol: 0.28 });
    this.a.tone(t, { type: 'square', freq: midi(81), dur: 0.12, vol: 0.05 });
    this.a.tone(t + 0.3, { type: 'triangle', freq: midi(77), dur: 0.55, vol: 0.28 });
    this.a.tone(t + 0.3, { type: 'square', freq: midi(77), dur: 0.12, vol: 0.05 });
  }
  /** 버저 오픈 "GO!" */
  go() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(72), to: midi(84), dur: 0.14, vol: 0.1 });
    this.a.tone(t + 0.12, { type: 'square', freq: midi(84), dur: 0.12, vol: 0.09 });
  }
  countdown(final = false) {
    this.a.tone(this.t, { type: 'square', freq: final ? midi(81) : midi(69), dur: final ? 0.3 : 0.12, vol: 0.1 });
  }
  /** 째깍 — 급할수록 높고 크게 */
  tick(urgent = false, small = false) {
    const t = this.t;
    const vol = small ? 0.08 : urgent ? 0.2 : 0.13;
    this.a.tone(t, { type: 'triangle', freq: urgent ? 1760 : 1320, dur: 0.035, vol });
    this.a.noise(t, { dur: 0.025, vol: vol * 0.6, filter: { type: 'highpass', freq: 4000 } });
  }
  /** 힌트 아이템 등장 — 반짝 */
  hint() {
    const t = this.t;
    [79, 84, 88, 91, 96].forEach((m, i) => this.a.tone(t + i * 0.045, { type: 'triangle', freq: midi(m), dur: 0.12, vol: 0.12 }));
    this.a.tone(t + 0.25, { type: 'square', freq: midi(96), dur: 0.2, vol: 0.04, vibrato: 30 });
  }

  // ----- 버저/정답/오답 -----
  /** 버저 "삐익!" — 팀마다 음높이가 다르다 */
  buzz(player) {
    const t = this.t;
    const base = player === 0 ? 62 : 67;
    this.a.tone(t, { type: 'sawtooth', freq: midi(base), dur: 0.32, vol: 0.14, vibrato: 18 });
    this.a.tone(t, { type: 'square', freq: midi(base + 12), dur: 0.32, vol: 0.07 });
    this.a.noise(t, { dur: 0.06, vol: 0.15, filter: { type: 'bandpass', freq: 2500, q: 0.8 } });
  }
  /** 정답 "딩동댕~" + 환호 */
  correct() {
    const t = this.t;
    [72, 76, 79, 84].forEach((m, i) => {
      this.a.tone(t + i * 0.08, { type: 'square', freq: midi(m), dur: 0.14, vol: 0.1 });
      this.a.tone(t + i * 0.08, { type: 'triangle', freq: midi(m - 12), dur: 0.16, vol: 0.14 });
    });
    this.a.tone(t + 0.34, { type: 'square', freq: midi(88), dur: 0.4, vol: 0.08, vibrato: 12 });
    this.cheer(t + 0.15);
    this.applause(t + 0.2, 1.6);
  }
  /** 오답 "뿌-뿡" + 탄식 */
  wrong() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(55), dur: 0.2, vol: 0.12 });
    this.a.tone(t + 0.2, { type: 'square', freq: midi(49), to: midi(43), dur: 0.45, vol: 0.12, vibrato: 6 });
    this.a.tone(t, { type: 'sawtooth', freq: midi(31), dur: 0.6, vol: 0.08 });
    this.aww(t + 0.15);
  }
  /** 음성 오인식 — "다시 한 번?" */
  retry() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(72), dur: 0.08, vol: 0.07 });
    this.a.tone(t + 0.1, { type: 'square', freq: midi(76), to: midi(79), dur: 0.15, vol: 0.07 });
  }
  /** 두 팀 다 틀려 기회 리셋 */
  reset() {
    const t = this.t;
    [67, 71, 74, 79].forEach((m, i) => this.a.tone(t + i * 0.05, { type: 'square', freq: midi(m), dur: 0.07, vol: 0.06 }));
  }
  /** 시간 종료 — 징 */
  timeUp() {
    const t = this.t;
    this.a.tone(t, { type: 'square', freq: midi(76), to: midi(52), dur: 0.5, vol: 0.1 });
    this.a.tone(t, { type: 'sine', freq: 110, to: 98, dur: 1.4, vol: 0.25 });
    this.a.noise(t, { dur: 1.0, vol: 0.08, filter: { type: 'bandpass', freq: 600, to: 300, q: 2 } });
    this.aww(t + 0.2, 0.6);
  }
  /** 우승 팡파레 */
  fanfare() {
    const t = this.t;
    const seq = [
      [72, 0, 0.12], [72, 0.13, 0.12], [72, 0.26, 0.12], [76, 0.39, 0.4],
      [74, 0.8, 0.12], [77, 0.93, 0.12], [76, 1.06, 0.12], [79, 1.2, 0.8],
    ];
    seq.forEach(([m, dt, d]) => {
      this.a.tone(t + dt, { type: 'square', freq: midi(m), dur: d, vol: 0.1 });
      this.a.tone(t + dt, { type: 'triangle', freq: midi(m - 12), dur: d, vol: 0.15 });
    });
    this.cheer(t + 1.1, 1.4);
    this.applause(t + 1.0, 3);
  }

  // ----- 리얼 계열 (노이즈 합성) -----
  /** 관객 환호 "와아~" — 대역 노이즈의 필터를 올렸다 내림 */
  cheer(t = this.t, vol = 1) {
    this.a.noise(t, { dur: 1.2, vol: 0.12 * vol, attack: 0.15, filter: { type: 'bandpass', freq: 700, to: 1400, q: 0.7 } });
    this.a.noise(t + 0.05, { dur: 1.0, vol: 0.06 * vol, attack: 0.2, filter: { type: 'bandpass', freq: 1800, to: 2600, q: 1.2 } });
  }
  /** 박수 — 짧은 노이즈 클릭을 불규칙하게 */
  applause(t = this.t, seconds = 1.5) {
    const n = Math.floor(seconds * 38);
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * seconds;
      const fade = 1 - (at - t) / seconds;
      this.a.noise(at, { dur: 0.02 + Math.random() * 0.02, vol: 0.05 * fade + 0.01, filter: { type: 'bandpass', freq: 1200 + Math.random() * 2000, q: 1.5 } });
    }
  }
  /** 관객 탄식 "아~" — 필터가 아래로 */
  aww(t = this.t, vol = 1) {
    this.a.noise(t, { dur: 0.9, vol: 0.1 * vol, attack: 0.1, filter: { type: 'bandpass', freq: 900, to: 380, q: 3 } });
  }
}
