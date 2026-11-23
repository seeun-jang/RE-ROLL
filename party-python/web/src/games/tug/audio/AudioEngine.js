// =============================================================
// AudioEngine — Web Audio 칩튠 효과음 엔진 (외부 음원 파일 없음)
// 그래프: [효과음 voice] → sfxBus ┐
//                     [음악] → musicBus ┴→ master → destination
// AudioContext 는 자동재생 정책 때문에 unlock() (첫 사용자 입력) 때 만든다.
// 모듈 최상위에서는 window/AudioContext 에 접근하지 않는다 (Node 에서도 import 가능).
// =============================================================

const MIN_GAIN = 0.0001;        // 지수 램프 목표값 (0 은 지수 램프 불가)
const VOICE_LIMIT = 12;         // 짧은 시간 창 안에서 허용하는 최대 효과음 시작 수
const VOICE_WINDOW = 0.05;      // 효과음 폭주 감시 창 (초)
const MUTE_FADE = 0.012;        // 음소거 전환 시 '틱' 소리 방지용 짧은 페이드 시간 상수 (초)
const PULSE_HARMONICS = 64;     // 펄스파 PeriodicWave 배음 수
const NOISE_SECONDS = 1;        // 캐시해 둘 화이트 노이즈 버퍼 길이 (초)
const MAX_LATENCY = 0.3;        // 'auto' 지연 보정값 상한 (초) — 이상한 값 방지
const STOP_PAD = 0.03;          // 엔벨로프가 끝난 뒤 소스를 멈추기까지 여유 (초)

/** MIDI 노트 번호 → 주파수 (Hz) */
function mtof(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 현재 실제 시각 (초) — 효과음 폭주 감시용 (ctx.currentTime 은 suspend 중 멈추므로 사용 안 함) */
function wallNow() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

/**
 * 듀티비 d 의 펄스파 PeriodicWave 를 만든다.
 * 푸리에 계수: a_n = sin(2πnd)/(nπ), b_n = (1 - cos(2πnd))/(nπ)
 */
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

/** 화이트 노이즈 버퍼 생성 */
function buildNoiseBuffer(ctx) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** 노드 연결 해제 (이미 끊긴 노드여도 안전) */
function safeDisconnect(node) {
  if (!node) return;
  try { node.disconnect(); } catch (e) { /* 무시 */ }
}

// 음 이름 대신 MIDI 번호 상수 (가독성용)
const N = Object.freeze({
  G3: 55, C4: 60, E4: 64, G4: 67, A4: 69, B4: 71,
  C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83,
  C6: 84, D6: 86, E6: 88, G6: 91, C7: 96, G7: 103,
});

export class AudioEngine {
  constructor(config) {
    this.config = config || {};
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.muted = !!this.config.START_MUTED;
    this._paused = false;
    this._disposed = false;
    this._waves = null;          // { 0.125, 0.25, 0.5 } PeriodicWave (ctx 당 1회 생성)
    this._noise = null;          // 캐시된 화이트 노이즈 버퍼
    this._recentStarts = [];     // 최근 효과음 시작 시각 (폭주 방지)
  }

  /** ctx 가 실제로 소리를 내는 중인가 */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 출력 지연 보정값 (초) */
  get latency() {
    const v = this.config.AUDIO_LATENCY_COMP;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
    if (!this.ctx) return 0;
    const auto = Number(this.ctx.outputLatency) || Number(this.ctx.baseLatency) || 0;
    return Number.isFinite(auto) ? Math.min(MAX_LATENCY, Math.max(0, auto)) : 0;
  }

  /** 사용자 입력 시 호출: ctx 생성 또는 resume. 여러 번 호출해도 안전하고 절대 throw 하지 않는다 */
  unlock() {
    if (this._disposed) return;
    try {
      if (!this.ctx) {
        // 브라우저가 아니거나 Web Audio 미지원이면 조용히 무음으로 동작
        const host = typeof window !== 'undefined' ? window : null;
        const Ctor = host && (host.AudioContext || host.webkitAudioContext);
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        this._buildGraph(ctx);
      }
      if (this.ctx.state === 'suspended' && !this._paused) {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {
      // 생성 실패 → 무음 모드
      this.ctx = null;
      this.master = this.musicBus = this.sfxBus = null;
    }
  }

  /** 버스 그래프와 공용 파형/노이즈 캐시 생성 */
  _buildGraph(ctx) {
    const cfg = this.config;
    const vol = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : vol(cfg.MASTER_VOLUME, 0.5);
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = vol(cfg.MUSIC_VOLUME, 0.35);
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = vol(cfg.SFX_VOLUME, 0.6);
    this.sfxBus.connect(this.master);

    // 사각파 듀티 12.5% / 25% / 50% — ctx 당 한 번만 만든다
    this._waves = {
      0.125: buildPulseWave(ctx, 0.125),
      0.25: buildPulseWave(ctx, 0.25),
      0.5: buildPulseWave(ctx, 0.5),
    };
    this._noise = buildNoiseBuffer(ctx);
  }

  /** 음소거 (마스터 게인 0 / 복원) */
  setMuted(b) {
    this.muted = !!b;
    if (!this.ctx || !this.master) return;
    try {
      const target = this.muted ? 0 : (Number(this.config.MASTER_VOLUME) || 0);
      const now = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(target, now, MUTE_FADE);
    } catch (e) { /* 무시 */ }
  }

  /** 음소거 토글 → 바뀐 muted 값 반환 */
  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 일시정지: ctx 자체를 suspend/resume (예약된 음도 함께 멈춘다) */
  setPaused(b) {
    this._paused = !!b;
    if (!this.ctx || this.ctx.state === 'closed') return;
    try {
      const p = this._paused ? this.ctx.suspend() : this.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* 무시 */ }
  }

  /**
   * 효과음 재생.
   * delay: 지금부터 몇 초 뒤 (박자 예약용). ctx 가 없으면 조용히 무시.
   */
  play(name, { delay = 0, volume = 1, pan = 0 } = {}) {
    const ctx = this.ctx;
    if (!ctx || this._disposed || ctx.state === 'closed' || !this.sfxBus) return;
    const recipe = SFX[name];
    if (!recipe) return;

    // 효과음 폭주 방지: 최근 50ms 안에 너무 많이 시작했으면 버린다
    const wall = wallNow();
    const recent = this._recentStarts.filter((t) => wall - t < VOICE_WINDOW);
    if (recent.length >= VOICE_LIMIT) { this._recentStarts = recent; return; }
    recent.push(wall);
    this._recentStarts = recent;

    try {
      const t0 = ctx.currentTime + Math.max(0, Number(delay) || 0);
      const voice = this._createVoice(volume, pan);
      recipe(this, voice, t0);
      // 아무 소스도 만들지 않은 경우 즉시 정리
      if (voice.pending === 0) this._releaseVoice(voice);
    } catch (e) { /* 효과음 실패는 게임 진행에 영향 없게 무시 */ }
  }

  /** 효과음 1개 분량의 출력 체인 (볼륨 → 패닝 → sfxBus) */
  _createVoice(volume, pan) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Number(volume) || 0);
    let panner = null;
    if (typeof ctx.createStereoPanner === 'function' && pan) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, Number(pan) || 0));
      gain.connect(panner);
      panner.connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }
    return { input: gain, gain, panner, pending: 0 };
  }

  /** voice 의 모든 소스가 끝나면 체인 해제 */
  _releaseVoice(voice) {
    safeDisconnect(voice.gain);
    safeDisconnect(voice.panner);
  }

  /** 소스 노드 등록: 끝나면 관련 노드 전부 disconnect */
  _track(voice, src, nodes) {
    voice.pending++;
    src.onended = () => {
      for (const n of nodes) safeDisconnect(n);
      voice.pending--;
      if (voice.pending <= 0) this._releaseVoice(voice);
    };
  }

  /** 공통 엔벨로프: 0 → (attack) vol → (hold) → 지수 감쇠 → 0.0001 */
  _envelope(param, t0, dur, vol, attack, hold) {
    const a = Math.max(0.001, Math.min(attack, dur * 0.5));
    const h = Math.max(0, Math.min(hold, dur - a - 0.005));
    param.setValueAtTime(MIN_GAIN, t0);
    param.linearRampToValueAtTime(vol, t0 + a);
    if (h > 0) param.setValueAtTime(vol, t0 + a + h);
    param.exponentialRampToValueAtTime(MIN_GAIN, t0 + dur);
  }

  /**
   * 오실레이터 1음.
   * wave: 'p12' | 'p25' | 'p50' (펄스) | 'triangle' | 'sine'
   * freq: Hz, sweep: [[초, Hz], ...] (t0 기준 지수 램프 경유점)
   * vib: { rate, depth } 비브라토 (depth Hz)
   */
  _tone(voice, t0, { wave = 'p50', freq = 440, sweep = null, dur = 0.1, vol = 0.3, attack = 0.004, hold = 0, vib = null }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    if (wave === 'p12' || wave === 'p25' || wave === 'p50') {
      const duty = wave === 'p12' ? 0.125 : wave === 'p25' ? 0.25 : 0.5;
      osc.setPeriodicWave(this._waves[duty]);
    } else {
      osc.type = wave;
    }
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) {
      for (const [dt, f] of sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t0 + dt);
    }
    const env = ctx.createGain();
    this._envelope(env.gain, t0, dur, vol, attack, hold);
    osc.connect(env);
    env.connect(voice.input);

    const nodes = [osc, env];
    const stopAt = t0 + dur + STOP_PAD;
    if (vib) {
      // 비브라토 LFO → 주파수 변조
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(vib.rate, t0);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(vib.depth, t0);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(stopAt);
      lfo.onended = () => { safeDisconnect(lfo); safeDisconnect(depth); };
    }
    this._track(voice, osc, nodes);
    osc.start(t0);
    osc.stop(stopAt);
  }

  /**
   * 노이즈 1발.
   * filter: { type, freq, to?, q? } — to 가 있으면 필터 주파수를 지수 램프로 스윕
   */
  _noiseHit(voice, t0, { dur = 0.1, vol = 0.2, attack = 0.002, hold = 0, filter = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const env = ctx.createGain();
    this._envelope(env.gain, t0, dur, vol, attack, hold);
    const nodes = [src, env];
    let last = src;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = filter.type || 'lowpass';
      bq.frequency.setValueAtTime(filter.freq, t0);
      if (filter.to) bq.frequency.exponentialRampToValueAtTime(Math.max(10, filter.to), t0 + dur);
      if (filter.q) bq.Q.setValueAtTime(filter.q, t0);
      src.connect(bq);
      last = bq;
      nodes.push(bq);
    }
    last.connect(env);
    env.connect(voice.input);
    this._track(voice, src, nodes);
    // 같은 노이즈가 반복돼 들리지 않도록 시작 위치를 무작위로
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - 0.01);
    src.start(t0, offset);
    src.stop(t0 + dur + STOP_PAD);
  }

  /** 호루라기 한 번 (사각파 ~2.2kHz + 빠른 비브라토 + 숨소리 노이즈) */
  _whistle(voice, t0, dur, vol = 0.22) {
    this._tone(voice, t0, {
      wave: 'p50', freq: 2200, sweep: [[0.03, 2350], [dur, 2250]], dur, vol,
      attack: 0.012, hold: dur * 0.75, vib: { rate: 26, depth: 110 },
    });
    this._noiseHit(voice, t0, {
      dur, vol: vol * 0.35, attack: 0.01, hold: dur * 0.7,
      filter: { type: 'bandpass', freq: 2600, q: 1.5 },
    });
  }

  /** ctx 닫기. 이후 모든 호출은 조용히 무시된다 */
  dispose() {
    this._disposed = true;
    const ctx = this.ctx;
    this.ctx = null;
    safeDisconnect(this.sfxBus);
    safeDisconnect(this.musicBus);
    safeDisconnect(this.master);
    this.master = this.musicBus = this.sfxBus = null;
    this._waves = null;
    this._noise = null;
    if (ctx && ctx.state !== 'closed') {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* 무시 */ }
    }
  }
}

// =============================================================
// 효과음 레시피 — (engine, voice, t0) => void
// 모두 짧은 칩튠 합성음. 볼륨은 sfxBus 기준 상대값.
// =============================================================
const SFX = Object.freeze({
  // 박자 틱: 짧고 높은 블립
  tick(e, v, t) {
    e._tone(v, t, { wave: 'p12', freq: 1760, dur: 0.045, vol: 0.16, attack: 0.002 });
  },
  // 강박 틱 (4박마다): 조금 더 크고 높게 + 아래 옥타브 받침
  tickAccent(e, v, t) {
    e._tone(v, t, { wave: 'p25', freq: mtof(N.C7), dur: 0.07, vol: 0.24, attack: 0.002 });
    e._tone(v, t, { wave: 'triangle', freq: mtof(N.C6), dur: 0.06, vol: 0.18, attack: 0.002 });
  },
  // Perfect: 밝은 2음 상행 아르페지오 + 반짝이는 고음
  perfect(e, v, t) {
    e._tone(v, t, { wave: 'p25', freq: mtof(N.E6), dur: 0.07, vol: 0.24, attack: 0.002, hold: 0.03 });
    e._tone(v, t + 0.055, { wave: 'p25', freq: mtof(N.B5) * 2, dur: 0.18, vol: 0.24, attack: 0.002, hold: 0.04 });
    e._tone(v, t + 0.05, { wave: 'p12', freq: mtof(N.G7), dur: 0.26, vol: 0.07, attack: 0.01, vib: { rate: 18, depth: 60 } });
    e._noiseHit(v, t, { dur: 0.08, vol: 0.05, filter: { type: 'highpass', freq: 7000 } });
  },
  // Good: 기분 좋은 단음 블립
  good(e, v, t) {
    e._tone(v, t, { wave: 'p50', freq: mtof(N.A5), dur: 0.1, vol: 0.18, attack: 0.002, hold: 0.02 });
    e._tone(v, t, { wave: 'triangle', freq: mtof(N.A5), dur: 0.11, vol: 0.14, attack: 0.002 });
  },
  // Miss: 둔탁하고 낮은 '쿵'
  miss(e, v, t) {
    e._tone(v, t, { wave: 'triangle', freq: 150, sweep: [[0.14, 70]], dur: 0.16, vol: 0.45, attack: 0.003 });
    e._noiseHit(v, t, { dur: 0.06, vol: 0.18, filter: { type: 'lowpass', freq: 500 } });
  },
  // 헛힘: 지글거리며 내려가는 '부즈즈'
  spam(e, v, t) {
    e._tone(v, t, { wave: 'p50', freq: 220, sweep: [[0.17, 105]], dur: 0.18, vol: 0.16, attack: 0.003, hold: 0.06, vib: { rate: 42, depth: 28 } });
    e._tone(v, t, { wave: 'p12', freq: 233, sweep: [[0.17, 110]], dur: 0.18, vol: 0.1, attack: 0.003, hold: 0.06 });
  },
  // 피버 시작: 빠르게 올라가는 아르페지오 스윕 + 쉬익 노이즈
  fever(e, v, t) {
    const notes = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6, N.C7];
    notes.forEach((m, i) => {
      e._tone(v, t + i * 0.045, { wave: 'p25', freq: mtof(m), dur: i === notes.length - 1 ? 0.3 : 0.09, vol: 0.2, attack: 0.002, hold: 0.02 });
    });
    e._noiseHit(v, t, { dur: 0.38, vol: 0.08, attack: 0.05, filter: { type: 'highpass', freq: 1000, to: 9000 } });
  },
  // 라운드 승리: 짧은 4음 징글
  roundWin(e, v, t) {
    const seq = [[0, N.G5, 0.09], [0.1, N.C6, 0.09], [0.2, N.E6, 0.09], [0.3, N.G6, 0.42]];
    for (const [dt, m, d] of seq) {
      e._tone(v, t + dt, { wave: 'p25', freq: mtof(m), dur: d, vol: 0.22, attack: 0.003, hold: d * 0.4 });
    }
    e._tone(v, t + 0.3, { wave: 'triangle', freq: mtof(N.C4), dur: 0.42, vol: 0.3, attack: 0.003, hold: 0.15 });
  },
  // 시작 호루라기 (~0.5초)
  whistle(e, v, t) {
    e._whistle(v, t, 0.5);
  },
  // 종료 호루라기: 짧게 두 번 + 길게
  whistleEnd(e, v, t) {
    e._whistle(v, t, 0.13);
    e._whistle(v, t + 0.2, 0.13);
    e._whistle(v, t + 0.4, 0.75);
  },
  // 카운트다운 삑
  countdown(e, v, t) {
    e._tone(v, t, { wave: 'p50', freq: mtof(N.A5), dur: 0.14, vol: 0.2, attack: 0.003, hold: 0.07 });
  },
  // 출발 삑 (더 높고 길게, 화음)
  go(e, v, t) {
    e._tone(v, t, { wave: 'p50', freq: mtof(N.A5) * 2, dur: 0.38, vol: 0.2, attack: 0.003, hold: 0.22 });
    e._tone(v, t, { wave: 'p25', freq: mtof(N.E6), dur: 0.38, vol: 0.12, attack: 0.003, hold: 0.22 });
  },
  // UI 클릭
  click(e, v, t) {
    e._tone(v, t, { wave: 'p12', freq: 1200, sweep: [[0.025, 900]], dur: 0.03, vol: 0.16, attack: 0.001 });
  },
  // 준비 완료: 귀여운 '뽀잉'
  ready(e, v, t) {
    e._tone(v, t, { wave: 'triangle', freq: 300, sweep: [[0.07, 900], [0.2, 520]], dur: 0.22, vol: 0.32, attack: 0.003, hold: 0.06, vib: { rate: 14, depth: 25 } });
    e._tone(v, t, { wave: 'p25', freq: 600, sweep: [[0.07, 1800], [0.2, 1040]], dur: 0.2, vol: 0.06, attack: 0.003 });
  },
  // 최종 승리 팡파르 (짧은 원곡 아닌 팡파르)
  fanfare(e, v, t) {
    const lead = [
      [0, N.G4, 0.08], [0.09, N.G4, 0.08], [0.18, N.G4, 0.08],
      [0.27, N.C5, 0.22], [0.5, N.E5, 0.1], [0.62, N.D5, 0.1],
      [0.74, N.G5, 0.6],
    ];
    for (const [dt, m, d] of lead) {
      e._tone(v, t + dt, { wave: 'p25', freq: mtof(m) * 2, dur: d, vol: 0.2, attack: 0.003, hold: d * 0.55 });
      e._tone(v, t + dt, { wave: 'p50', freq: mtof(m), dur: d, vol: 0.08, attack: 0.003, hold: d * 0.55 });
    }
    const bass = [[0.27, N.C4 - 12, 0.22], [0.5, N.G3 - 12, 0.22], [0.74, N.C4 - 12, 0.6]];
    for (const [dt, m, d] of bass) {
      e._tone(v, t + dt, { wave: 'triangle', freq: mtof(m), dur: d, vol: 0.32, attack: 0.003, hold: d * 0.5 });
    }
    e._noiseHit(v, t + 0.74, { dur: 0.3, vol: 0.08, filter: { type: 'highpass', freq: 5000 } });
  },
  // 룰렛 셔플 틱
  shuffle(e, v, t) {
    e._tone(v, t, { wave: 'p12', freq: mtof(N.E6), dur: 0.035, vol: 0.13, attack: 0.001 });
    e._noiseHit(v, t, { dur: 0.02, vol: 0.05, filter: { type: 'highpass', freq: 4000 } });
  },
  // 미끄러짐: 빠른 노이즈 슬라이드
  slip(e, v, t) {
    e._noiseHit(v, t, { dur: 0.22, vol: 0.2, attack: 0.005, filter: { type: 'bandpass', freq: 3200, to: 500, q: 2 } });
    e._tone(v, t, { wave: 'triangle', freq: 640, sweep: [[0.2, 180]], dur: 0.2, vol: 0.12, attack: 0.003 });
  },
});
