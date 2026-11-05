// =====================================================
// 곡 데이터: "잭팟 그루브" (A단조 카지노 펑크, 128 BPM, 38마디 ≈ 71초)
// 한 마디 = 16칸(16분음표). 악보 문자열 규칙:
//   'A4' = 그 칸에서 음 시작, '-' = 앞 음을 이어서 길게, '.' = 쉼표
// 노트(채보)는 이 멜로디에서 자동으로 만들어짐 → chart.js
// 멜로디만 고치면 채보도 같이 바뀜
// =====================================================
const SONG_GROOVE = {
  id: 'groove',
  title: '잭팟 그루브',
  artist: 'RE:ROLL 하우스 밴드',
  bpm: 128,

  // 마디에서 쓰는 화음 (근음 + 구성음, MIDI 번호)
  chords: {
    Am: { root: 45, notes: [57, 60, 64] },
    F: { root: 41, notes: [57, 60, 65] },
    G: { root: 43, notes: [55, 59, 62] },
    E: { root: 40, notes: [56, 59, 64] },
    Dm: { root: 38, notes: [57, 62, 65] },
    Em: { root: 40, notes: [55, 59, 64] },
  },

  // 멜로디 조각 (마디 단위)
  phrases: {
    // 인트로 훅
    i1: 'A4 . C5 . E5 . A5 - . G5 . E5 - . D5 .',
    i2: 'C5 - - - . . A4 . C5 . D5 . E5 - - -',
    i3: 'D5 . B4 . G4 . B4 . D5 - . E5 . D5 B4 .',
    i4: 'G#4 - - - B4 - - - E5 - - - - - - -',
    // 벌스
    v1: 'E4 . E4 . A4 . . C5 . B4 . A4 - . . .',
    v2: 'F4 . A4 . C5 . . A4 . C5 . D5 - . . .',
    v3: 'D5 . . B4 . G4 . B4 . D5 . E5 - . D5 .',
    v4: 'B4 - - . G#4 - - . E4 - - - . . . .',
    v6: 'F4 . A4 . C5 . . F5 . E5 . D5 . C5 . .',
    v7: 'B4 . D5 . G5 . . F5 . E5 . D5 . B4 . .',
    v8: 'E5 - - - D5 - - - B4 - - - G#4 - - -',
    // 프리코러스 (계단처럼 올라감)
    p1: 'D5 . F5 . A5 . F5 . D5 . F5 . A5 . F5 .',
    p2: 'E5 . G5 . B5 . G5 . E5 . G5 . B5 . G5 .',
    p3: 'F5 . A5 . C6 . A5 . F5 . A5 . C6 . A5 .',
    p4: 'B5 - - - . . . . G#5 . A5 . B5 . E6 .',
    // 코러스 (잭팟 타임!)
    c1: 'A5 . . A5 . . G5 . A5 . C6 . A5 . G5 .',
    c2: 'G5 - - . . . D5 . G5 . B5 . A5 . G5 .',
    c3: 'E5 . . E5 . . D5 . E5 . G5 . B5 - . .',
    c4: 'A5 - - - . . . . C6 . B5 . A5 . E5 .',
    c7: 'G#5 . . G#5 . . B5 . E6 - - - D6 . B5 .',
    c8: 'A5 - - - - - - - . . . . . . . .',
    // 브레이크 (롱노트 구간)
    b1: 'A4 - - - - - - - C5 - - - - - - -',
    b2: 'F4 - - - - - - - A4 - - - C5 - - -',
    b3: 'B4 - - - - - - - D5 - - - G5 - - -',
    b4: 'G#4 - - - B4 - - - E5 - - - G#5 - - -',
    // 아웃트로
    o1: 'F5 . . F5 . . E5 . . . . . . . . .',
    o2: 'A5 - - - - - - - - - - - - - - -',
  },

  // 구간: 이름, 멜로디 조각 목록, 화음 목록, 드럼 스타일
  //  drums: intro | verse | chorus | break | end
  //  fever: true 면 '잭팟 타임' 연출
  sections: [
    { name: 'intro', phrases: ['i1', 'i2', 'i3', 'i4'], chords: ['Am', 'F', 'G', 'E'], drums: 'intro' },
    { name: 'verse', phrases: ['v1', 'v2', 'v3', 'v4', 'v1', 'v6', 'v7', 'v8'], chords: ['Am', 'F', 'G', 'E', 'Am', 'F', 'G', 'E'], drums: 'verse' },
    { name: 'pre', phrases: ['p1', 'p2', 'p3', 'p4'], chords: ['Dm', 'Em', 'F', 'E'], drums: 'verse', build: true },
    { name: 'chorus', phrases: ['c1', 'c2', 'c3', 'c4', 'c1', 'c2', 'c7', 'c8'], chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'Am'], drums: 'chorus', fever: true },
    { name: 'break', phrases: ['b1', 'b2', 'b3', 'b4'], chords: ['Am', 'F', 'G', 'E'], drums: 'break' },
    { name: 'chorus2', phrases: ['c1', 'c2', 'c3', 'c4', 'c1', 'c2', 'c7', 'c8'], chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'Am'], drums: 'chorus', fever: true, arp: true },
    { name: 'outro', phrases: ['o1', 'o2'], chords: ['E', 'Am'], drums: 'end' },
  ],

  // 드럼 패턴 (16칸): K 킥, S 스네어, H 하이햇, O 오픈햇, C 심벌(마디 첫 박)
  drumPatterns: {
    intro: { K: 'x.......x.x.....', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
    verse: { K: 'x.....x.x.x.....', S: '....x.......x..x', H: 'x.xxx.xxx.xxx.xx' },
    chorus: { K: 'x...x...x...x...', S: '....x.......x...', H: 'xx.xxx.xxx.xxx.x', O: '..x...x...x...x.' },
    break: { K: 'x.......x.......', S: '................', H: 'x...x...x...x...' },
    end: { K: 'x...............', S: '................', H: '................' },
  },

  // 베이스 패턴 (16칸): R 근음, O 옥타브 위, F 5도 위, '.' 쉼
  bassPatterns: {
    intro: 'R..R..O.R..R.F.O',
    verse: 'R.OR..O.R.O..ROF',
    chorus: 'R.O.R.O.R.O.RFOR',
    break: 'R...............',
    end: 'R...............',
  },
};


// =====================================================
// 곡 2: "달빛 칩스" (D단조 라운지, 96 BPM, 26마디 ≈ 65초) — 느긋한 밤 카지노 바
// =====================================================
const SONG_MOON = {
  id: 'moon',
  title: '달빛 칩스',
  artist: 'RE:ROLL 라운지 트리오',
  bpm: 96,
  chords: {
    Dm: { root: 38, notes: [57, 60, 65] },
    Gm: { root: 43, notes: [55, 58, 62] },
    C: { root: 36, notes: [55, 60, 64] },
    F: { root: 41, notes: [57, 60, 65] },
    A: { root: 45, notes: [57, 61, 64] },
  },
  phrases: {
    l1: 'D5 - - . F5 . A5 - - . G5 . F5 . E5 .',
    l2: 'D5 - - - . . C5 . D5 . F5 . A5 - - -',
    l3: 'G5 - - . F5 . D5 - - . C5 . A#4 . C5 .',
    l4: 'A4 - - - - - . . C#5 . E5 . A5 - - .',
    m1: 'F5 . E5 . D5 . . A4 . . D5 . F5 - . .',
    m2: 'G5 . F5 . E5 . . C5 . . E5 . G5 - . .',
    m3: 'A5 . G5 . F5 . . D5 . . F5 . A5 - C6 -',
    m4: 'A#5 - - - A5 - - - G5 - - - E5 - - -',
    s1: 'D6 . C6 . A5 . C6 . D6 - . F6 . D6 . C6',
    s2: 'A#5 . A5 . G5 . A5 . A#5 - . D6 . A#5 . A5',
    s3: 'C6 . A#5 . A5 . G5 . A5 - . C6 . E6 - -',
    s4: 'D6 - - - . . . . A5 . . . D6 - - -',
    b1: 'D5 - - - - - - - F5 - - - - - - -',
    b2: 'G5 - - - - - - - A#5 - - - A5 - - -',
    e1: 'F5 . E5 . D5 . . . A4 . . . D5 - - -',
    e2: 'D5 - - - - - - - . . . . . . . .',
  },
  sections: [
    { name: 'intro', phrases: ['l1', 'l2', 'l3', 'l4'], chords: ['Dm', 'F', 'Gm', 'A'], drums: 'intro' },
    { name: 'verse', phrases: ['m1', 'm2', 'm3', 'm4', 'm1', 'm2', 'm3', 'm4'], chords: ['Dm', 'C', 'F', 'Gm', 'Dm', 'C', 'F', 'A'], drums: 'verse' },
    { name: 'chorus', phrases: ['s1', 's2', 's3', 's4', 's1', 's2', 's3', 's4'], chords: ['Dm', 'Gm', 'C', 'Dm', 'Dm', 'Gm', 'A', 'Dm'], drums: 'chorus', fever: true },
    { name: 'break', phrases: ['b1', 'b2', 'b1', 'b2'], chords: ['Dm', 'Gm', 'Dm', 'A'], drums: 'break' },
    { name: 'outro', phrases: ['e1', 'e2'], chords: ['Dm', 'Dm'], drums: 'end' },
  ],
  drumPatterns: {
    intro: { K: 'x.......x.......', S: '....x.......x...', H: 'x.x.x.x.x.x.x.x.' },
    verse: { K: 'x.....x...x.....', S: '....x.......x...', H: 'x..xx..xx..xx..x' },
    chorus: { K: 'x...x...x...x...', S: '....x.......x..x', H: 'x.xxx.xxx.xxx.xx', O: '......x.......x.' },
    break: { K: 'x.......x.......', S: '................', H: 'x...x...x...x...' },
    end: { K: 'x...............', S: '................', H: '................' },
  },
  bassPatterns: {
    intro: 'R...O...R...F...',
    verse: 'R..R.O..R..F.O..',
    chorus: 'R.O.R.F.R.O.R.FO',
    break: 'R...............',
    end: 'R...............',
  },
};

// =====================================================
// 곡 3: "네온 러시" (E단조 유로비트, 150 BPM, 38마디 ≈ 61초) — 빠르고 신나는 곡
// =====================================================
const SONG_NEON = {
  id: 'neon',
  title: '네온 러시',
  artist: 'RE:ROLL 하이퍼 밴드',
  bpm: 150,
  chords: {
    Em: { root: 40, notes: [55, 59, 64] },
    C: { root: 36, notes: [55, 60, 64] },
    D: { root: 38, notes: [57, 62, 66] },
    B: { root: 35, notes: [54, 59, 63] },
    Am: { root: 45, notes: [57, 60, 64] },
    G: { root: 43, notes: [55, 59, 62] },
  },
  phrases: {
    n1: 'E5 . E5 . G5 . E5 . B5 . A5 . G5 . F#5 .',
    n2: 'E5 . E5 . G5 . A5 . B5 - - . D6 . B5 .',
    n3: 'C6 . B5 . A5 . G5 . A5 . B5 . A5 . G5 .',
    n4: 'F#5 - - - D#5 - - - B4 - - - F#5 - - -',
    r1: 'B4 . . B4 . . E5 . . . G5 . F#5 . E5 .',
    r2: 'C5 . . C5 . . E5 . . . G5 . A5 . G5 .',
    r3: 'D5 . . D5 . . F#5 . . . A5 . G5 . F#5 .',
    r4: 'B4 - - - . . D#5 . F#5 . B5 - - - . .',
    u1: 'A4 . C5 . E5 . A5 . A4 . C5 . E5 . A5 .',
    u2: 'B4 . D5 . G5 . B5 . B4 . D5 . G5 . B5 .',
    u3: 'C5 . E5 . G5 . C6 . D5 . F#5 . A5 . D6 .',
    u4: 'B5 - - - B5 - - - D#6 - - - F#6 - - -',
    k1: 'E6 - . D6 . B5 . . G5 . A5 . B5 - . .',
    k2: 'C6 - . B5 . A5 . . E5 . G5 . A5 - . .',
    k3: 'D6 - . C6 . B5 . . F#5 . A5 . D6 - . .',
    k4: 'B5 . A5 . G5 . F#5 . G5 - - - F#5 - - -',
    k8: 'E6 - - - - - - - . . . . . . . .',
    z1: 'E5 - - - - - - - G5 - - - - - - -',
    z2: 'C5 - - - - - - - D5 - - - F#5 - - -',
    x1: 'E6 . . E6 . . B5 . . . . . . . . .',
    x2: 'E5 - - - - - - - - - - - - - - -',
  },
  sections: [
    { name: 'intro', phrases: ['n1', 'n2', 'n3', 'n4'], chords: ['Em', 'Em', 'C', 'B'], drums: 'intro' },
    { name: 'verse', phrases: ['r1', 'r2', 'r3', 'r4', 'r1', 'r2', 'r3', 'r4'], chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'B'], drums: 'verse' },
    { name: 'pre', phrases: ['u1', 'u2', 'u3', 'u4'], chords: ['Am', 'G', 'C', 'B'], drums: 'verse', build: true },
    { name: 'chorus', phrases: ['k1', 'k2', 'k3', 'k4', 'k1', 'k2', 'k3', 'k8'], chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'Em'], drums: 'chorus', fever: true },
    { name: 'break', phrases: ['z1', 'z2', 'z1', 'z2'], chords: ['Em', 'C', 'Em', 'C'], drums: 'break' },
    { name: 'chorus2', phrases: ['k1', 'k2', 'k3', 'k4', 'k1', 'k2', 'k3', 'k8'], chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'Em'], drums: 'chorus', fever: true, arp: true },
    { name: 'outro', phrases: ['x1', 'x2'], chords: ['Em', 'Em'], drums: 'end' },
  ],
  drumPatterns: {
    intro: { K: 'x...x...x...x...', S: '................', H: '..x...x...x...x.' },
    verse: { K: 'x...x...x...x...', S: '....x.......x...', H: '..x...x...x...x.' },
    chorus: { K: 'x...x...x...x...', S: '....x.......x...', H: 'xxxxxxxxxxxxxxxx', O: '..x...x...x...x.' },
    break: { K: 'x.......x.......', S: '................', H: 'x...x...x...x...' },
    end: { K: 'x...............', S: '................', H: '................' },
  },
  bassPatterns: {
    intro: 'R...R...R...R...',
    verse: 'R.O.R.O.R.O.R.F.',
    chorus: 'R.O.R.O.R.O.R.O.',
    break: 'R...............',
    end: 'R...............',
  },
};

// 곡 목록 (타이틀에서 고름) · 지금 곡은 SONG
const SONGS = { groove: SONG_GROOVE, moon: SONG_MOON, neon: SONG_NEON };
const SONG_ORDER = ['groove', 'moon', 'neon'];
let SONG = SONG_GROOVE;
function useSong(id) {
  SONG = SONGS[id] || SONG_GROOVE;
  return SONG;
}

const NOTE_NAMES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

// 'A4' → MIDI 번호 69
function noteToMidi(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return null;
  return NOTE_NAMES[m[1]] + (+m[2] + 1) * 12;
}

// 곡을 펼쳐서 시간순 이벤트 목록으로 만듦 (한 번만 계산)
//  bars[]: { index, section, chord, drums, fever, arp, build }
//  melody[]: { step(곡 전체 16분음표 번호), dur(칸 수), midi, bar, section }
function expandSong(song = SONG) {
  if (song._expanded) return song._expanded;
  const bars = [];
  const melody = [];
  for (const sec of song.sections) {
    sec.phrases.forEach((pk, i) => {
      const bar = bars.length;
      bars.push({
        index: bar,
        section: sec.name,
        chord: song.chords[sec.chords[i]],
        chordName: sec.chords[i],
        drums: sec.drums,
        fever: !!sec.fever,
        arp: !!sec.arp,
        build: !!sec.build,
        firstOfSection: i === 0,
      });
      const tokens = song.phrases[pk].trim().split(/\s+/);
      if (tokens.length !== 16) console.warn('멜로디 칸 수가 16이 아님:', pk, tokens.length);
      let cur = null;
      tokens.forEach((tk, s) => {
        if (tk === '-') {
          if (cur) cur.dur++;
          return;
        }
        cur = null;
        if (tk === '.') return;
        const midi = noteToMidi(tk);
        if (midi === null) return;
        cur = { step: bar * 16 + s, dur: 1, midi, bar, section: sec.name };
        melody.push(cur);
      });
    });
  }
  const stepSec = 60 / song.bpm / 4;
  song._expanded = {
    bars,
    melody,
    stepSec,
    barSec: stepSec * 16,
    beatSec: stepSec * 4,
    totalSteps: bars.length * 16,
    duration: bars.length * 16 * stepSec,
  };
  return song._expanded;
}
