// 노래와 채보(노트 배치)를 만드는 파일입니다.
// 노래는 파일 없이 "언제 어떤 소리를 낼지" 목록으로 만들고, audio.js 가 그 목록대로 소리를 냅니다.
// 채보는 멜로디를 따라 자동으로 만들어져서 음악과 노트가 항상 딱 맞아요.

import { LANES } from './config.js';

export const BPM = 128;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // 16분음표
const BAR = BEAT * 4;
const COUNT_IN_BARS = 2;
const COUNT_IN = BAR * COUNT_IN_BARS;

// 프리지안 도미넌트 음계 (D) — 고대 그리스/지중해 느낌
const SCALE = [62, 63, 66, 67, 69, 70, 72, 74, 75, 78];
// 마디마다 바뀌는 베이스 근음: D → B♭ → C → D
const ROOTS = [38, 34, 36, 38];

// [16분음표 위치, 음계 번호]
const MOTIF = {
  A: [[0, 0], [3, 1], [6, 2], [8, 3], [10, 2], [12, 1], [14, 0]],
  B: [[0, 4], [2, 3], [4, 2], [6, 3], [8, 4], [11, 5], [12, 4], [14, 3]],
  E: [[0, 0], [2, 1], [4, 2], [6, 3], [8, 4], [10, 5], [12, 6], [14, 7]],
  C: [[0, 7], [2, 6], [4, 5], [6, 4], [8, 5], [10, 4], [12, 3], [14, 2]],
  D: [[0, 4], [1, 5], [2, 4], [4, 3], [6, 2], [8, 3], [10, 4], [12, 7], [14, 7]],
  F: [[0, 7], [1, 8], [2, 7], [4, 6], [6, 5], [7, 6], [8, 7], [10, 9], [12, 8], [13, 7], [14, 6]],
};

// 구간: [시작 마디, 끝 마디(제외), 이름]
const SECTIONS = [
  [0, 4, 'intro'],
  [4, 12, 'verse'],
  [12, 16, 'build'],
  [16, 24, 'chorus'],
  [24, 28, 'bridge'],
  [28, 32, 'final'],
];
const TOTAL_BARS = 32;

const DRUMS = {
  intro: { kick: [0, 4, 8, 12], snare: [], hat: [], tom: [10, 14] },
  verse: { kick: [0, 4, 8, 10, 12], snare: [4, 12], hat: [2, 6, 10, 14], tom: [] },
  build: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], tom: [14] },
  chorus: { kick: [0, 3, 4, 8, 11, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], tom: [7, 15] },
  bridge: { kick: [0, 8], snare: [12], hat: [4, 12], tom: [6, 14] },
  final: { kick: [0, 3, 4, 6, 8, 11, 12, 14], snare: [4, 12, 14], hat: [0, 1, 2, 4, 6, 8, 9, 10, 12, 14], tom: [7, 15] },
};

function sectionOf(bar) {
  return SECTIONS.find(([s, e]) => bar >= s && bar < e)[2];
}

function motifFor(section, bar) {
  const odd = bar % 2 === 1;
  switch (section) {
    case 'verse':
      return odd ? MOTIF.B : MOTIF.A;
    case 'build':
      return MOTIF.E;
    case 'chorus':
      return odd ? MOTIF.D : MOTIF.C;
    case 'bridge':
      return MOTIF.A;
    case 'final':
      return odd ? MOTIF.D : MOTIF.F;
    default:
      return null;
  }
}

export function buildSong() {
  const music = []; // { kind, t, midi?, dur? }
  const notes = []; // { t, lane }

  // 카운트인: 막대기 소리 8번
  for (let i = 0; i < COUNT_IN_BARS * 4; i++) {
    music.push({ kind: 'stick', t: i * BEAT, accent: i >= 4 });
  }

  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const section = sectionOf(bar);
    const t0 = COUNT_IN + bar * BAR;
    const root = ROOTS[bar % ROOTS.length];
    const drums = DRUMS[section];

    for (const s of drums.kick) music.push({ kind: 'kick', t: t0 + s * STEP });
    for (const s of drums.snare) music.push({ kind: 'snare', t: t0 + s * STEP });
    for (const s of drums.hat) music.push({ kind: 'hat', t: t0 + s * STEP });
    for (const s of drums.tom) music.push({ kind: 'tom', t: t0 + s * STEP });
    // 빌드업 마지막 마디는 스네어 연타
    if (section === 'build' && bar === 15) {
      for (let s = 0; s < 16; s++) music.push({ kind: 'snare', t: t0 + s * STEP, soft: s < 8 });
    }

    // 베이스
    if (section === 'intro' || section === 'bridge') {
      music.push({ kind: 'bass', t: t0, midi: root, dur: BAR * 0.9 });
    } else {
      for (const s of [0, 6, 8, 12, 14]) {
        music.push({ kind: 'bass', t: t0 + s * STEP, midi: s === 8 ? root + 12 : root, dur: STEP * 1.8 });
      }
    }

    // 웅장한 나팔 화음
    if (section === 'chorus' || section === 'final' || section === 'build') {
      music.push({ kind: 'horn', t: t0, midi: root + 24, dur: BAR * 0.95 });
    }

    // 멜로디 + 채보
    const motif = motifFor(section, bar);
    if (motif) {
      for (const [s, deg] of motif) {
        const t = t0 + s * STEP;
        music.push({ kind: 'lead', t, midi: SCALE[deg], dur: STEP * 1.6 });
        notes.push({ t, lane: deg % LANES });
        // 후렴 첫 박은 양손 동시 노트
        if (s === 0 && (section === 'chorus' || section === 'final')) {
          notes.push({ t, lane: (deg + 2) % LANES });
        }
      }
    } else {
      // 인트로: 북소리에 맞춰 쉬운 노트
      const pattern = [0, 3, 1, 2];
      [0, 4, 8, 12].forEach((s, i) => notes.push({ t: t0 + s * STEP, lane: pattern[(bar + i) % LANES] }));
    }
  }

  // 마지막 한 방
  const end = COUNT_IN + TOTAL_BARS * BAR;
  music.push({ kind: 'kick', t: end });
  music.push({ kind: 'tom', t: end });
  music.push({ kind: 'horn', t: end, midi: 62, dur: BAR * 1.2 });
  music.push({ kind: 'horn', t: end, midi: 50, dur: BAR * 1.2 });
  notes.push({ t: end, lane: 0 }, { t: end, lane: 3 });

  // 아주 짧은 간격으로 같은 레인이 연속되면 옆 레인으로
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1];
    if (notes[i].lane === prev.lane && notes[i].t - prev.t < STEP * 1.5 && notes[i].t !== prev.t) {
      notes[i].lane = (notes[i].lane + 1) % LANES;
    }
  }

  const sectionTimes = SECTIONS.map(([s, e, name]) => ({
    name,
    start: COUNT_IN + s * BAR,
    end: COUNT_IN + e * BAR,
  }));

  return {
    bpm: BPM,
    beat: BEAT,
    countIn: COUNT_IN,
    end,
    duration: end + BAR * 0.6,
    finalStart: sectionTimes.find((s) => s.name === 'final').start,
    sections: sectionTimes,
    music,
    notes,
  };
}
