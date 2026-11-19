// =============================================================
// Music — 운동회 행진곡 루프 (직접 작곡한 원곡, 8마디 = 32박, 4/4, C장조)
// 박자 시계(BeatJudge)에 맞춰 Game 이 한 박씩 미리 예약한다:
//   music.scheduleBeat(beatIndex, delay, interval, { mode, fever })
// 한 박 = 16분음표 4칸. 곡 데이터는 16분음표 단위 배열(128칸)이다.
// 모든 소리는 audio.musicBus 로 보낸다. 외부 음원 파일 없음.
// =============================================================

const BEATS_PER_LOOP = 32;      // 루프 길이 (박)
const STEPS_PER_BEAT = 4;       // 한 박의 16분음표 칸 수
const STEPS_PER_BAR = 16;       // 한 마디 칸 수
const MIN_GAIN = 0.0001;        // 지수 램프 목표값
const STOP_PAD = 0.03;          // 엔벨로프 뒤 소스 정지 여유 (초)
const NOISE_SECONDS = 1;        // 드럼용 노이즈 버퍼 길이 (초)
const PULSE_HARMONICS = 48;     // 리드용 펄스파 배음 수

// 파트별 음량 (musicBus 기준 상대값)
const VOL = Object.freeze({
  lead: 0.2,          // 리드 (사각파 25%)
  harmony: 0.09,      // 피버 하모니 (사각파 12.5%)
  bass: 0.42,         // 베이스 (삼각파)
  kick: 0.5,          // 킥 블립
  snare: 0.2,         // 노이즈 스네어
  hat: 0.06,          // 피버 하이햇
  menuScale: 0.6,     // 메뉴 모드에서 리드·베이스 음량 배율 (차분하게)
});

// 음 길이 비율 — 행진곡 느낌을 위해 살짝 끊어 친다 (스타카토)
const GATE = Object.freeze({ play: 0.82, menu: 0.6 });

/** 'C5' 'F#4' 'Bb3' → MIDI 번호 */
function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

const C_MAJOR = Object.freeze([0, 2, 4, 5, 7, 9, 11]);   // C장조 음계 (반음 단위)

/** C장조 안에서 3도 아래 음 (피버 하모니용). 음계 밖 음이면 단3도 아래 */
function thirdBelow(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const deg = C_MAJOR.indexOf(pc);
  if (deg < 0) return midi - 3;
  const octave = Math.floor(midi / 12);
  const target = deg - 2;
  return target >= 0 ? octave * 12 + C_MAJOR[target] : (octave - 1) * 12 + C_MAJOR[target + 7];
}

/** MIDI → Hz */
function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * 마디 문자열 배열 → 16분음표 칸 배열.
 * 토큰: 음이름 = 새 음 시작, '-' = 앞 음 이어서, '.' = 쉼
 * 결과 원소: { midi, len } (음 시작 칸) | null (이음/쉼)
 */
function parseMelody(bars) {
  const tokens = bars.join(' ').trim().split(/\s+/);
  const out = new Array(tokens.length).fill(null);
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === '-' || tk === '.') continue;
    let len = 1;
    while (i + len < tokens.length && tokens[i + len] === '-') len++;
    out[i] = Object.freeze({ midi: noteToMidi(tk), len });
  }
  return Object.freeze(out);
}

// ---------- 곡 데이터 (직접 작곡: '마을 운동회 행진곡') ----------
// 리드 멜로디 — 8마디, 마디마다 16칸 (점음표 리듬으로 씩씩하게)
const LEAD_BARS = [
  'G4 - . C5  C5 - . E5  G5 - - .  E5 - C5 .',   // 1  C
  'D5 - . E5  F5 - . D5  E5 - - .  C5 - - .',    // 2  G → C
  'A5 - . A5  G5 - . E5  F5 - . D5  E5 - - .',   // 3  F → C
  'D5 - . C5  B4 - . A4  G4 - - -  . . . .',     // 4  G (반종지)
  'G4 - . C5  E5 - . G5  C6 - - .  A5 - G5 .',   // 5  C → Am
  'F5 - . A5  G5 - . F5  E5 - - .  C5 - - .',    // 6  F → C
  'D5 - . D5  F5 - . A5  G5 - . E5  D5 - B4 .',  // 7  Dm → G
  'C5 - . G4  C5 - . E5  C5 - - -  . . . .',     // 8  C (완전종지)
];
const LEAD = parseMelody(LEAD_BARS);

// 화음 근음 — 반 마디(2박)마다 하나, 총 16개 (베이스 '쿵-짝' 용)
const CHORD_ROOTS = Object.freeze([
  'C3', 'C3', 'G2', 'C3', 'F2', 'C3', 'G2', 'G2',
  'C3', 'A2', 'F2', 'C3', 'D3', 'G2', 'C3', 'C3',
].map(noteToMidi));

// 드럼 — 마디 16칸. K = 킥(1·3박), S = 스네어(2·4박), '.' = 없음
const DRUM_BAR = 'K...S...K...S...';
const DRUM_FILL = 'K...S...K.K.SSSS';   // 8마디째: 다음 루프로 넘어가는 필인
const DRUMS = Object.freeze(
  Array.from({ length: BEATS_PER_LOOP * STEPS_PER_BEAT }, (_, i) => {
    const bar = Math.floor(i / STEPS_PER_BAR);
    const pat = bar === 7 ? DRUM_FILL : DRUM_BAR;
    return pat[i % STEPS_PER_BAR];
  }),
);

/** 듀티비 d 펄스파 PeriodicWave */
function buildPulseWave(ctx, duty) {
  const real = new Float32Array(PULSE_HARMONICS + 1);
  const imag = new Float32Array(PULSE_HARMONICS + 1);
  for (let n = 1; n <= PULSE_HARMONICS; n++) {
    const k = n * Math.PI;
    real[n] = Math.sin(2 * k * duty) / k;
    imag[n] = (1 - Math.cos(2 * k * duty)) / k;
  }
  return ctx.createPeriodicWave(real, imag);
}

function safeDisconnect(node) {
  if (!node) return;
  try { node.disconnect(); } catch (e) { /* 무시 */ }
}

export class Music {
  constructor(audio, config) {
    this.audio = audio;
    this.config = config || {};
    this._active = new Map();    // 예약된 소스 노드 → 함께 정리할 노드 배열
    this._cacheCtx = null;       // 파형/노이즈 캐시를 만든 ctx
    this._wave25 = null;
    this._wave12 = null;
    this._noiseBuf = null;
  }

  /** ctx 별 파형·노이즈 캐시 (ctx 가 바뀌면 다시 만든다) */
  _ensureCache(ctx) {
    if (this._cacheCtx === ctx) return;
    this._cacheCtx = ctx;
    this._wave25 = buildPulseWave(ctx, 0.25);
    this._wave12 = buildPulseWave(ctx, 0.125);
    const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  }

  /**
   * 박 beatIndex 가 지금부터 delay 초 뒤에 온다 → 그 박의 16분음표 4칸을 예약.
   * 실제 예약 시각 = ctx.currentTime + max(0, delay - audio.latency)
   */
  scheduleBeat(beatIndex, delay, interval, { mode = 'play', fever = false } = {}) {
    const audio = this.audio;
    const ctx = audio && audio.ctx;
    if (!ctx || ctx.state === 'closed' || !audio.musicBus) return;
    const iv = Number(interval);
    if (!(iv > 0) || !Number.isFinite(iv)) return;
    try {
      this._ensureCache(ctx);
      const menu = mode === 'menu';
      const hot = !menu && !!fever;           // 피버는 플레이 모드에서만
      const latency = Number(audio.latency) || 0;
      const t0 = ctx.currentTime + Math.max(0, (Number(delay) || 0) - latency);
      const step = iv / STEPS_PER_BEAT;
      const beat = ((Math.floor(Number(beatIndex) || 0) % BEATS_PER_LOOP) + BEATS_PER_LOOP) % BEATS_PER_LOOP;

      for (let s = 0; s < STEPS_PER_BEAT; s++) {
        const idx = beat * STEPS_PER_BEAT + s;
        const t = t0 + s * step;
        this._scheduleLead(idx, t, step, menu, hot);
        this._scheduleBass(beat, s, t, step, menu, hot);
        if (!menu) this._scheduleDrums(idx, s, t, step, hot);
      }
    } catch (e) { /* 음악 예약 실패는 게임 진행에 영향 없게 무시 */ }
  }

  /** 리드 멜로디 (사각파 25%). 피버면 옥타브 위 + 원래 옥타브 하모니 */
  _scheduleLead(idx, t, step, menu, hot) {
    const note = LEAD[idx];
    if (!note) return;
    const dur = Math.max(0.03, note.len * step * (menu ? GATE.menu : GATE.play));
    const vol = VOL.lead * (menu ? VOL.menuScale : 1);
    if (hot) {
      this._tone(t, { wave: this._wave25, freq: mtof(note.midi + 12), dur, vol: vol * 0.85, hold: dur * 0.45 });
      // 하모니: 원래 옥타브에서 음계상 3도 아래 음을 가늘게 깐다
      this._tone(t, { wave: this._wave12, freq: mtof(thirdBelow(note.midi)), dur, vol: VOL.harmony, hold: dur * 0.45 });
    } else {
      this._tone(t, { wave: this._wave25, freq: mtof(note.midi), dur, vol, hold: dur * (menu ? 0.2 : 0.45) });
    }
  }

  /**
   * 베이스 (삼각파) — 쿵(근음, 1·3박) / 짝(5도 위, 2·4박).
   * 피버면 8분음표마다 옥타브 위를 섞어 더 몰아친다.
   */
  _scheduleBass(beat, s, t, step, menu, hot) {
    const root = CHORD_ROOTS[Math.floor(beat / 2)];
    const strong = beat % 2 === 0;
    const vol = VOL.bass * (menu ? VOL.menuScale : 1);
    if (s === 0) {
      const midi = strong ? root : root + 7;
      const len = hot ? 1.6 : (menu ? 2.6 : 2.2);
      this._tone(t, { wave: 'triangle', freq: mtof(midi), dur: step * len, vol, hold: step * 0.5 });
    } else if (s === 2 && hot) {
      this._tone(t, { wave: 'triangle', freq: mtof(root + 12), dur: step * 1.6, vol: vol * 0.8, hold: step * 0.4 });
    }
  }

  /** 드럼: 킥 블립(1·3박), 노이즈 스네어(2·4박), 피버면 8분 하이햇 */
  _scheduleDrums(idx, s, t, step, hot) {
    const d = DRUMS[idx];
    if (d === 'K') {
      // 킥: 삼각파가 빠르게 떨어지는 '퉁'
      this._tone(t, { wave: 'triangle', freq: 160, sweep: 45, dur: 0.11, vol: VOL.kick, attack: 0.002 });
    } else if (d === 'S') {
      // 스네어: 고역 노이즈 + 짧은 몸통음
      this._noise(t, { dur: 0.1, vol: VOL.snare, filter: 'highpass', freq: 1400 });
      this._tone(t, { wave: 'triangle', freq: 220, sweep: 140, dur: 0.05, vol: VOL.snare * 1.2, attack: 0.001 });
    }
    if (hot && (s === 0 || s === 2)) {
      this._noise(t, { dur: Math.min(0.04, step * 0.8), vol: VOL.hat, filter: 'highpass', freq: 7500 });
    }
  }

  /** 오실레이터 1음 예약 (wave: PeriodicWave 또는 'triangle' 등 타입 문자열) */
  _tone(t, { wave, freq, sweep = null, dur, vol, attack = 0.004, hold = 0 }) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    if (typeof wave === 'string') osc.type = wave;
    else osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const env = ctx.createGain();
    this._envelope(env.gain, t, dur, vol, attack, hold);
    osc.connect(env);
    env.connect(this.audio.musicBus);
    this._track(osc, [osc, env]);
    osc.start(t);
    osc.stop(t + dur + STOP_PAD);
  }

  /** 노이즈 1발 예약 (드럼용) */
  _noise(t, { dur, vol, filter, freq }) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, t);
    const env = ctx.createGain();
    this._envelope(env.gain, t, dur, vol, 0.001, 0);
    src.connect(bq);
    bq.connect(env);
    env.connect(this.audio.musicBus);
    this._track(src, [src, bq, env]);
    src.start(t, Math.random() * (NOISE_SECONDS - 0.05));
    src.stop(t + dur + STOP_PAD);
  }

  /** 엔벨로프: 0 → attack → hold → 지수 감쇠 */
  _envelope(param, t, dur, vol, attack, hold) {
    const a = Math.max(0.001, Math.min(attack, dur * 0.5));
    const h = Math.max(0, Math.min(hold, dur - a - 0.005));
    param.setValueAtTime(MIN_GAIN, t);
    param.linearRampToValueAtTime(vol, t + a);
    if (h > 0) param.setValueAtTime(vol, t + a + h);
    param.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
  }

  /** 소스 추적: 끝나면 추적 목록에서 빼고 연결 해제 */
  _track(src, nodes) {
    this._active.set(src, nodes);
    src.onended = () => {
      if (!this._active.has(src)) return;
      this._active.delete(src);
      for (const n of nodes) safeDisconnect(n);
    };
  }

  /** 예약된 음 모두 정지 (장면 전환·일시정지 해제 시) */
  stopAll() {
    const entries = Array.from(this._active.entries());
    this._active.clear();
    for (const [src, nodes] of entries) {
      src.onended = null;
      try { src.stop(0); } catch (e) { /* 이미 멈췄거나 시작 전 — 무시 */ }
      for (const n of nodes) safeDisconnect(n);
    }
  }
}
