// 칩튠 효과음 합성기.
// SFX[name](ctx, dest, t)는 t 시각에 소리를 예약하고 { sources, end }를 돌려준다.
//   sources: 만든 모든 소스 노드(Oscillator·BufferSource) — AudioManager.silenceAll()이 즉시 stop()한다.
//   end: 소리가 완전히 끝나는 AudioContext 시각(초).
// 외부 파일 없이 Oscillator + Gain 엔벨로프 + LFSR 노이즈 버퍼만 쓴다.
import { TIMING } from '../config.js';

// ── 공용 파형 캐시 (Music.js도 같이 쓴다) ─────────────────
const pulseCache = new WeakMap(); // ctx → Map(duty → PeriodicWave)
const noiseCache = new WeakMap(); // ctx → { long, short }

// 듀티비 duty(0~1)의 펄스파를 푸리에 급수로 만든다. (NES 펄스 채널 12.5% / 25% / 50%)
export function getPulseWave(ctx, duty = 0.5) {
  let m = pulseCache.get(ctx);
  if (!m) { m = new Map(); pulseCache.set(ctx, m); }
  const key = Math.round(duty * 1000);
  let w = m.get(key);
  if (!w) {
    const N = 64; // 배음 수 (높을수록 각진 소리)
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      // 펄스 중심을 0에 둔 코사인 급수: a_n = 2/(nπ)·sin(nπd)
      real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }
    w = ctx.createPeriodicWave(real, imag);
    m.set(key, w);
  }
  return w;
}

// 15비트 LFSR 노이즈(패미컴 노이즈 채널 방식). short=true면 93스텝 주기의 금속성 노이즈.
export function getNoiseBuffer(ctx, short = false) {
  let c = noiseCache.get(ctx);
  if (!c) { c = {}; noiseCache.set(ctx, c); }
  const key = short ? 'short' : 'long';
  if (!c[key]) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.0); // 1초 길이 버퍼 (loop 재생)
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let reg = 1;
    const clock = 22050;          // LFSR 클럭 (샘플 홀드 주기)
    const hold = sr / clock;
    let acc = 0;
    let val = 1;
    for (let i = 0; i < len; i++) {
      acc += 1;
      if (acc >= hold) {
        acc -= hold;
        const tap = short ? 6 : 1; // 짧은 모드는 6번 비트, 긴 모드는 1번 비트와 XOR
        const fb = (reg & 1) ^ ((reg >> tap) & 1);
        reg = (reg >> 1) | (fb << 14);
        val = (reg & 1) ? 1 : -1;
      }
      d[i] = val * 0.8;
    }
    c[key] = buf;
  }
  return c[key];
}

// ── 음이름 → 주파수 ────────────────────────────────────
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`잘못된 음이름: ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + NOTE_INDEX[m[1]] + acc;
}
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hz = (n) => (typeof n === 'number' ? n : midiToFreq(noteToMidi(n)));

// ── 기본 음원 ─────────────────────────────────────────
// 톤 하나: o = { wave: 'triangle'|'sine'|'sawtooth'|듀티(숫자), f, f2(슬라이드 목표), slide(슬라이드 시간),
//               dur, vol, a(어택), r(릴리스), decay, sus(서스테인 비율), vib(비브라토 반음 폭), vibRate }
function tone(ctx, dest, t, o) {
  const dur = Math.max(0.01, o.dur);
  const vol = o.vol ?? 0.25;
  const a = Math.min(o.a ?? 0.004, dur * 0.5);
  const r = Math.min(o.r ?? 0.02, dur - a);
  const osc = ctx.createOscillator();
  const wave = o.wave ?? 0.5;
  if (typeof wave === 'number') osc.setPeriodicWave(getPulseWave(ctx, wave));
  else osc.type = wave;
  const f = hz(o.f);
  osc.frequency.setValueAtTime(f, t);
  if (o.f2 != null) {
    // 지수 슬라이드(음정이 자연스럽게 미끄러짐)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, hz(o.f2)), t + (o.slide ?? dur));
  }
  const sources = [osc];
  if (o.vib) {
    // 비브라토: LFO → detune(센트)
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = o.vibRate ?? 6;
    lg.gain.value = o.vib * 100;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
    sources.push(lfo);
  }
  const g = ctx.createGain();
  // 엔벨로프: 0 → vol(어택) → vol·sus(디케이) → 유지 → 0(릴리스)
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  let level = vol;
  let tt = t + a;
  if (o.decay) {
    level = vol * (o.sus ?? 0.6);
    tt = t + a + Math.min(o.decay, dur - a - r);
    g.gain.linearRampToValueAtTime(level, tt);
  }
  const relStart = Math.max(tt, t + dur - r);
  g.gain.setValueAtTime(level, relStart);
  g.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  // 끝나면 노드 정리
  osc.onended = () => { try { g.disconnect(); } catch { /* 이미 끊김 */ } };
  return { sources, end: t + dur };
}

// 노이즈 하나: o = { dur, vol, filter:'highpass'|'bandpass'|'lowpass', freq, q, short, a, f2(필터 슬라이드) }
function noise(ctx, dest, t, o) {
  const dur = Math.max(0.01, o.dur);
  const vol = o.vol ?? 0.2;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx, !!o.short);
  src.loop = true;
  let node = src;
  let filt = null;
  if (o.filter) {
    filt = ctx.createBiquadFilter();
    filt.type = o.filter;
    filt.frequency.setValueAtTime(o.freq ?? 4000, t);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    filt.Q.value = o.q ?? 0.8;
    src.connect(filt);
    node = filt;
  }
  const g = ctx.createGain();
  const a = Math.min(o.a ?? 0.002, dur * 0.5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  // 타악기 느낌의 빠른 감쇠
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.005);
  node.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
  src.onended = () => {
    try { g.disconnect(); } catch { /* 이미 끊김 */ }
    if (filt) { try { filt.disconnect(); } catch { /* 이미 끊김 */ } }
  };
  return { sources: [src], end: t + dur };
}

// 여러 음원을 모아 { sources, end }로 돌려주는 도우미
function kit(ctx, dest) {
  const sources = [];
  let end = 0;
  const add = (r) => { sources.push(...r.sources); end = Math.max(end, r.end); return r.end; };
  return {
    tone: (t, o) => add(tone(ctx, dest, t, o)),
    noise: (t, o) => add(noise(ctx, dest, t, o)),
    // 음 나열: notes = [[음이름|Hz|null(쉼표), 길이초], ...]. gate = 실제 소리 비율(스타카토)
    seq: (t0, notes, o = {}) => {
      let t = t0;
      for (const [n, len] of notes) {
        if (n != null) add(tone(ctx, dest, t, { ...o, f: n, dur: len * (o.gate ?? 0.9) }));
        t += len;
      }
      return t;
    },
    done: () => ({ sources, end }),
  };
}

// ── 효과음 정의 ──────────────────────────────────────
// 음량은 sfxBus(-6dB) 앞 기준. 펄스파는 0.2~0.3, 삼각파는 체감이 작아 0.3~0.4.
export const SFX = {
  // 메뉴 이동: 짧은 블립
  move(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.25, f: 'E6', dur: 0.035, vol: 0.16, r: 0.012 });
    return k.done();
  },
  // 선택(확정): 두 음 상승
  select(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.seq(t, [['A5', 0.05], ['E6', 0.09]], { wave: 0.25, vol: 0.2, gate: 0.95, r: 0.02 });
    return k.done();
  },
  // 슬라이더 눈금: 아주 짧은 틱
  tick(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.125, f: 1760, dur: 0.022, vol: 0.12, r: 0.008 });
    return k.done();
  },
  // 뒤로: 두 음 하강
  back(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.seq(t, [['E5', 0.05], ['A4', 0.08]], { wave: 0.25, vol: 0.2, gate: 0.95 });
    return k.done();
  },
  // 인원 증가: 위로 미끄러짐
  plus(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.25, f: 'C5', f2: 'G5', dur: 0.08, slide: 0.06, vol: 0.2 });
    k.tone(t + 0.08, { wave: 0.25, f: 'C6', dur: 0.05, vol: 0.12 });
    return k.done();
  },
  // 인원 감소: 아래로 미끄러짐
  minus(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.25, f: 'G5', f2: 'C5', dur: 0.08, slide: 0.06, vol: 0.2 });
    k.tone(t + 0.08, { wave: 0.25, f: 'C4', dur: 0.05, vol: 0.12 });
    return k.done();
  },
  // 차례 시작 안내음: 도-미-솔-도 아르페지오 + 삼각파 받침 (약 0.45초, VAD 켜기 전에 끝남)
  turn(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['C5', 0.07], ['E5', 0.07], ['G5', 0.07]], { wave: 0.25, vol: 0.22, gate: 0.9 });
    k.tone(e, { wave: 0.25, f: 'C6', dur: 0.24, vol: 0.22, decay: 0.08, sus: 0.6, r: 0.08, vib: 0.15 });
    k.tone(t, { wave: 'triangle', f: 'C4', dur: 0.21, vol: 0.32 });
    k.tone(e, { wave: 'triangle', f: 'G3', dur: 0.24, vol: 0.32, r: 0.08 });
    return k.done();
  },
  // 카운트다운 비프 3·2: 880Hz, TIMING.beepLen 길이 그대로
  beep(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.5, f: 880, dur: TIMING.beepLen, vol: 0.26, a: 0.003, r: 0.02 });
    return k.done();
  },
  // 마지막 비프(녹음 시작 신호): 1320Hz, 같은 길이
  beepLast(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.5, f: 1320, dur: TIMING.beepLen, vol: 0.26, a: 0.003, r: 0.02 });
    return k.done();
  },
  // 녹음 종료음: 솔→도로 떨어지는 '뽀옹' (약 0.3초, TIMING.recEndSfx 이내)
  recEnd(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.25, f: 'G5', dur: 0.08, vol: 0.22 });
    k.tone(t + 0.09, { wave: 0.25, f: 'C5', f2: 'G4', slide: 0.2, dur: 0.21, vol: 0.22, r: 0.08 });
    k.tone(t + 0.09, { wave: 'triangle', f: 'C4', dur: 0.21, vol: 0.3, r: 0.08 });
    return k.done();
  },
  // 분석 중 롤링음(한 번, 약 0.77초): 얇은 펄스가 아르페지오로 돌며 조금씩 올라간다
  analyze(ctx, dest, t) {
    const k = kit(ctx, dest);
    const cyc = ['C5', 'E5', 'G5', 'E5', 'D5', 'F5', 'A5', 'F5', 'E5', 'G5', 'B5', 'G5'];
    k.seq(t, cyc.map((n) => [n, 0.064]), { wave: 0.125, vol: 0.12, gate: 0.7, r: 0.01 });
    return k.done();
  },
  // 등급 S: 두 옥타브 아르페지오 + 반짝이는 화음
  gradeS(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['C5', 0.06], ['E5', 0.06], ['G5', 0.06], ['C6', 0.06], ['E6', 0.06], ['G6', 0.06]],
      { wave: 0.25, vol: 0.2, gate: 0.85 });
    k.tone(e, { wave: 0.25, f: 'C6', dur: 0.55, vol: 0.18, decay: 0.15, sus: 0.5, r: 0.2, vib: 0.2 });
    k.tone(e, { wave: 0.125, f: 'E6', dur: 0.55, vol: 0.12, decay: 0.15, sus: 0.5, r: 0.2, vib: 0.2 });
    k.tone(e, { wave: 'triangle', f: 'C4', dur: 0.55, vol: 0.34, r: 0.2 });
    // 반짝임: 높은 금속성 노이즈 두 번
    k.noise(e + 0.05, { dur: 0.12, vol: 0.06, filter: 'highpass', freq: 8000, short: true });
    k.noise(e + 0.25, { dur: 0.12, vol: 0.05, filter: 'highpass', freq: 9000, short: true });
    return k.done();
  },
  // 등급 A: 밝은 상승 + 3도 화음
  gradeA(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['C5', 0.08], ['E5', 0.08], ['G5', 0.08]], { wave: 0.25, vol: 0.2, gate: 0.9 });
    k.tone(e, { wave: 0.25, f: 'C6', dur: 0.36, vol: 0.2, decay: 0.1, sus: 0.6, r: 0.12, vib: 0.15 });
    k.tone(e, { wave: 0.125, f: 'G5', dur: 0.36, vol: 0.12, decay: 0.1, sus: 0.6, r: 0.12 });
    k.tone(e, { wave: 'triangle', f: 'C4', dur: 0.36, vol: 0.32, r: 0.12 });
    return k.done();
  },
  // 등급 B: 무난한 두 걸음 상승
  gradeB(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['G4', 0.1], ['C5', 0.1]], { wave: 0.25, vol: 0.2, gate: 0.9 });
    k.tone(e, { wave: 0.25, f: 'E5', dur: 0.3, vol: 0.2, decay: 0.08, sus: 0.6, r: 0.1 });
    k.tone(t, { wave: 'triangle', f: 'C4', dur: 0.5, vol: 0.3, r: 0.1 });
    return k.done();
  },
  // 등급 C: 오답 버저가 아닌 부드러운 '아쉬워~' 하강 (삼각파 위주)
  gradeC(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['E5', 0.18], ['D5', 0.18]], { wave: 'triangle', vol: 0.34, gate: 0.9 });
    k.tone(e, { wave: 'triangle', f: 'C5', f2: 'A4', slide: 0.35, dur: 0.38, vol: 0.34, r: 0.15, vib: 0.2, vibRate: 5 });
    k.tone(t, { wave: 0.125, f: 'C4', dur: 0.72, vol: 0.08, r: 0.2 });
    return k.done();
  },
  // 최고 기록 갱신: 빠른 음계 질주 + 화음
  best(ctx, dest, t) {
    const k = kit(ctx, dest);
    const run = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'].map((n) => [n, 0.045]);
    const e = k.seq(t, run, { wave: 0.25, vol: 0.18, gate: 0.85 });
    k.tone(e, { wave: 0.25, f: 'C6', dur: 0.42, vol: 0.2, decay: 0.12, sus: 0.6, r: 0.15, vib: 0.2 });
    k.tone(e, { wave: 0.125, f: 'E6', dur: 0.42, vol: 0.12, decay: 0.12, sus: 0.6, r: 0.15 });
    k.tone(e, { wave: 'triangle', f: 'C4', dur: 0.42, vol: 0.32, r: 0.15 });
    k.noise(e, { dur: 0.18, vol: 0.05, filter: 'highpass', freq: 8000, short: true });
    return k.done();
  },
  // 우승 팡파르(약 2초): 따-따-따 따안! 따-따-따-따아안!
  fanfare(ctx, dest, t) {
    const k = kit(ctx, dest);
    const lead = [['G4', 0.11], ['G4', 0.11], ['G4', 0.11], ['C5', 0.36], ['G4', 0.18], ['C5', 0.18], ['E5', 0.18]];
    const harm = [['E4', 0.11], ['E4', 0.11], ['E4', 0.11], ['G4', 0.36], ['E4', 0.18], ['G4', 0.18], ['C5', 0.18]];
    const e = k.seq(t, lead, { wave: 0.25, vol: 0.2, gate: 0.85 });
    k.seq(t, harm, { wave: 0.125, vol: 0.12, gate: 0.85 });
    k.tone(e, { wave: 0.25, f: 'G5', dur: 0.75, vol: 0.2, decay: 0.2, sus: 0.65, r: 0.25, vib: 0.25 });
    k.tone(e, { wave: 0.125, f: 'E5', dur: 0.75, vol: 0.12, decay: 0.2, sus: 0.65, r: 0.25, vib: 0.25 });
    // 베이스: 도 - 솔 - 도
    k.tone(t + 0.33, { wave: 'triangle', f: 'C3', dur: 0.36, vol: 0.36 });
    k.tone(t + 0.69, { wave: 'triangle', f: 'G2', dur: 0.54, vol: 0.36 });
    k.tone(e, { wave: 'triangle', f: 'C3', dur: 0.75, vol: 0.36, r: 0.25 });
    // 드럼: 첫 큰 음에 스네어, 마지막 음에 크래시
    k.noise(t + 0.33, { dur: 0.14, vol: 0.16, filter: 'bandpass', freq: 2000, q: 0.7 });
    k.noise(e, { dur: 0.6, vol: 0.12, filter: 'highpass', freq: 5000 });
    // 끝 반짝임
    k.seq(e + 0.35, [['C6', 0.05], ['E6', 0.05], ['G6', 0.05], ['C7', 0.12]], { wave: 0.125, vol: 0.07, gate: 0.8 });
    return k.done();
  },
  // 공동 1위: 두 목소리가 번갈아 부르다 함께 화음
  tie(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.seq(t, [['E5', 0.1], [null, 0.1], ['E5', 0.1], [null, 0.1]], { wave: 0.25, vol: 0.18 });
    k.seq(t, [[null, 0.1], ['C5', 0.1], [null, 0.1], ['C5', 0.1]], { wave: 0.5, vol: 0.14 });
    k.tone(t + 0.4, { wave: 0.25, f: 'G5', dur: 0.42, vol: 0.18, decay: 0.1, sus: 0.6, r: 0.15, vib: 0.2 });
    k.tone(t + 0.4, { wave: 0.5, f: 'E5', dur: 0.42, vol: 0.12, decay: 0.1, sus: 0.6, r: 0.15, vib: 0.2 });
    k.tone(t + 0.4, { wave: 'triangle', f: 'C4', dur: 0.42, vol: 0.32, r: 0.15 });
    return k.done();
  },
  // 오류 안내: 낮은 두 음 버즈 (오답음이 아니라 '문제가 생겼어요' 신호)
  error(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.tone(t, { wave: 0.5, f: 'A3', dur: 0.14, vol: 0.18 });
    k.tone(t + 0.16, { wave: 0.5, f: 'F3', dur: 0.24, vol: 0.18, r: 0.06 });
    k.tone(t + 0.16, { wave: 0.5, f: 175.6, dur: 0.24, vol: 0.08, r: 0.06 }); // 살짝 어긋난 음으로 버즈 느낌
    return k.done();
  },
  // 재녹음 안내: '한 번 더!' 느낌의 친근한 세 음
  retry(ctx, dest, t) {
    const k = kit(ctx, dest);
    k.seq(t, [['G4', 0.1], [null, 0.04], ['G4', 0.1], ['C5', 0.22]], { wave: 0.25, vol: 0.2, gate: 0.85 });
    k.tone(t, { wave: 'triangle', f: 'C4', dur: 0.46, vol: 0.28, r: 0.1 });
    return k.done();
  },
  // 출력 테스트음: 또렷한 도-미-솔-도 (약 0.9초)
  test(ctx, dest, t) {
    const k = kit(ctx, dest);
    const e = k.seq(t, [['C5', 0.15], ['E5', 0.15], ['G5', 0.15]], { wave: 0.5, vol: 0.18, gate: 0.9 });
    k.tone(e, { wave: 0.5, f: 'C6', dur: 0.45, vol: 0.18, decay: 0.1, sus: 0.7, r: 0.15 });
    k.seq(t, [['C4', 0.15], ['E4', 0.15], ['G4', 0.15], ['C4', 0.45]], { wave: 'triangle', vol: 0.3, gate: 0.9 });
    return k.done();
  },
};

export const SFX_NAMES = Object.keys(SFX);
