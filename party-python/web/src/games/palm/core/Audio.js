// 손바닥 밀치기 — 오디오 엔진
// 외부 파일 없이 Web Audio API만으로 칩튠(8비트) 효과음과 축제풍 BGM을 합성한다.
// - AudioContext는 unlock()에서 지연 생성 (모듈 import 시점에는 DOM/Web Audio에 접근하지 않음)
// - 모든 공개 메서드는 컨텍스트가 없거나 실패해도 예외 없이 무음으로 동작
// - 신호 경로: (효과음 보이스 / BGM 레이어 / 차지 루프) → 버스 → 마스터 게인 → 컴프레서 → destination

// ───────────────────────────── 상수 ─────────────────────────────

const SFX_NAMES = new Set([
  'clap', 'clapBig', 'clash', 'whoosh', 'feint', 'hold', 'wobble', 'splash', 'thud',
  'count', 'go', 'win', 'lose', 'cheer', 'select', 'confirm', 'pause', 'tick',
]);

const MAX_VOICES = 18;          // 동시에 울릴 수 있는 효과음 보이스 수 (넘으면 가장 오래된 것을 페이드아웃)
const SFX_LEVEL = 1.0;          // 효과음 버스 레벨
const BGM_LEVEL = 0.34;         // BGM 버스 레벨 (효과음보다 작게)
const SILENT = 0.0001;          // 지수 램프용 "거의 0"

// BGM 템포: 12/8 굿거리풍, 점4분음표 1박 = 112 BPM, 한 박을 셋으로 쪼갠 8분음표가 1스텝
const TEMPO_BPM = 112;
const STEP_DUR = 60 / TEMPO_BPM / 3;
const STEPS_PER_BAR = 12;
const LOOKAHEAD = 0.1;          // 0.1초 앞까지 미리 예약
const SCHED_INTERVAL_MS = 25;   // 스케줄러 주기

// 리드 멜로디 (16마디, 마디당 12스텝) — 솔라도레미(G A C D E) 5음계, '-'는 쉼표
// 토큰 형식: 음이름+옥타브:길이(스텝)
const MELODY = [
  // A 파트 — 흥겨운 주제
  'G4:2 A4:1 C5:2 D5:1 E5:3 D5:3',
  'C5:2 D5:1 C5:2 A4:1 G4:6',
  'A4:2 C5:1 D5:2 E5:1 G5:2 E5:1 D5:3',
  'E5:2 D5:1 C5:2 A4:1 D5:6',
  'G4:2 A4:1 C5:2 D5:1 E5:3 G5:3',
  'A5:2 G5:1 E5:2 D5:1 E5:6',
  'D5:2 E5:1 D5:2 C5:1 A4:2 C5:1 A4:2 G4:1',
  'A4:3 C5:3 G4:6',
  // B 파트 — 높게 메기고 받기
  'E5:3 G5:3 A5:2 G5:1 E5:3',
  'D5:2 E5:1 G5:3 E5:6',
  'C5:2 D5:1 E5:2 D5:1 C5:2 A4:1 C5:3',
  'D5:2 E5:1 D5:2 C5:1 D5:6',
  'E5:3 G5:3 A5:2 C6:1 A5:3',
  'G5:2 A5:1 G5:2 E5:1 D5:6',
  'E5:2 D5:1 C5:2 A4:1 C5:2 D5:1 E5:3',
  'D5:2 C5:1 A4:2 C5:1 G4:3 -:3',
];

// 마디별 화음 (베이스 근음, 장/단)
const CHORDS = [
  ['G2', 'M'], ['C3', 'M'], ['A2', 'm'], ['D3', 'M'],
  ['G2', 'M'], ['E2', 'm'], ['D3', 'M'], ['G2', 'M'],
  ['C3', 'M'], ['E2', 'm'], ['A2', 'm'], ['D3', 'M'],
  ['C3', 'M'], ['G2', 'M'], ['A2', 'm'], ['G2', 'M'],
];

// 장구 장단 (굿거리: 덩 . 기덕 | 쿵 . 더러러 | 쿵 . 기덕 | 쿵 . 더러러)
// D=덩(쿵+덕) K=쿵(저음) k=기덕(꾸밈음+덕) r=더러러(잔 롤) .=쉼
const DRUM_MAIN = 'D.kK.rK.kK.r';
const DRUM_HALF = 'D.kK.rK.kDkr';   // 8마디째 변주
const DRUM_FILL = 'D.kK.rKkkDrr';   // 16마디째 필인

// 카운터 멜로디(펄스) 스텝 → 화음 구성음 인덱스
const COUNTER_STEPS = { 1: 0, 2: 1, 4: 2, 5: 1, 7: 0, 8: 1, 10: 2, 11: 1 };
const PENTA_PC = new Set([0, 2, 4, 7, 9]);  // C D E G A

// ───────────────────────────── 유틸 ─────────────────────────────

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'G4', 'F#4' → MIDI 번호. 잘못된 값이면 null
function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  let n = NOTE_INDEX[m[1]];
  if (m[2] === '#') n += 1;
  if (m[2] === 'b') n -= 1;
  return 12 * (parseInt(m[3], 10) + 1) + n;
}

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) {
  return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

function safeDisconnect(node) {
  try { if (node) node.disconnect(); } catch (e) { /* 이미 끊김 */ }
}

function safeStop(src, when) {
  try { src.stop(when); } catch (e) { /* 이미 멈춤 */ }
}

// 멜로디 문자열을 마디별 스텝 테이블로 변환: table[bar][step] = { midi, len } | undefined
function buildLeadTable() {
  return MELODY.map((bar) => {
    const steps = new Array(STEPS_PER_BAR);
    let pos = 0;
    for (const tok of bar.trim().split(/\s+/)) {
      const [name, lenStr] = tok.split(':');
      const len = Math.max(1, parseInt(lenStr, 10) || 1);
      if (pos < STEPS_PER_BAR && name !== '-') {
        const midi = noteToMidi(name);
        if (midi !== null) steps[pos] = { midi, len };
      }
      pos += len;
    }
    return steps;
  });
}

// 화음 구성음 (카운터 멜로디용): 5음계 밖의 3음은 sus2/5음으로 대체해 항상 어울리게
function buildCounterTones() {
  return CHORDS.map(([rootName, quality]) => {
    const root = noteToMidi(rootName);
    let base = root;
    while (base < 62) base += 12;
    let third = quality === 'M' ? 4 : 3;
    if (!PENTA_PC.has((base + third) % 12)) third = PENTA_PC.has((base + 2) % 12) ? 2 : 7;
    return [base, base + third, base + 7];
  });
}

const LEAD_TABLE = buildLeadTable();
const COUNTER_TONES = buildCounterTones();
const BASS_ROOTS = CHORDS.map(([n]) => noteToMidi(n));

// 강도(0..1)에 따른 BGM 레이어 목표 게인
function layerTargets(i) {
  return {
    lead: 0.24,
    bass: 0.34,
    drum: 0.42 + 0.33 * i,
    hat: clamp01((i - 0.2) / 0.3) * 0.3,
    counter: clamp01((i - 0.5) / 0.25) * 0.13,
  };
}

// 듀티비 duty의 펄스파 (푸리에 계수로 PeriodicWave 생성)
function makePulseWave(ctx, duty) {
  const N = 48;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
  }
  return ctx.createPeriodicWave(real, imag);
}

// ───────────────────────────── 엔진 ─────────────────────────────

export class AudioEngine {
  constructor({ muted = false, volume = 0.6 } = {}) {
    this._muted = !!muted;
    this._volume = Number.isFinite(volume) ? clamp(volume, 0, 1) : 0.6;
    this._destroyed = false;
    this._paused = false;

    // Web Audio 노드 (unlock 후 생성)
    this.ctx = null;
    this._master = null;
    this._comp = null;
    this._sfxBus = null;
    this._bgmBus = null;
    this._layers = null;
    this._noiseBuf = null;
    this._pulse25 = null;
    this._pulse12 = null;

    // 효과음 보이스 관리
    this._voices = [];
    this._lastPlay = Object.create(null);

    // BGM 스케줄러 상태
    this._bgmOn = false;
    this._bgmTimer = null;
    this._bgmNext = 0;
    this._bgmBar = 0;
    this._bgmStep = 0;
    this._intensity = 0;
    this._targets = layerTargets(0);

    // 차지 루프 상태
    this._charge = null;
    this._chargeWanted = false;
    this._chargeLevel = 0;
  }

  get muted() {
    return this._muted;
  }

  // ───────── 초기화 / 해제 ─────────

  // 사용자 입력(클릭/키) 시 호출: AudioContext 생성 + resume. 여러 번 호출해도 안전
  unlock() {
    if (this._destroyed) return;
    try {
      if (!this.ctx) {
        const g = typeof globalThis !== 'undefined' ? globalThis : {};
        const AC = g.AudioContext || g.webkitAudioContext;
        if (typeof AC !== 'function') return;
        let ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        this.ctx = ctx;
        try {
          this._buildGraph();
        } catch (e) {
          // 그래프 생성 실패 → 컨텍스트 폐기하고 무음 모드
          this._teardownContext();
          return;
        }
        this._primeIOS();
      }
      const st = this.ctx.state;
      if (st === 'suspended' || st === 'interrupted') {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      // unlock 이전에 요청된 BGM/차지를 이어서 시작
      if (this._bgmOn && !this._paused) this._startScheduler();
      if (this._chargeWanted && !this._charge) this._buildCharge();
    } catch (e) {
      /* 어떤 실패도 무음으로 처리 */
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._bgmOn = false;
    this._chargeWanted = false;
    this._stopScheduler();
    try { if (this._charge) this._killCharge(true); } catch (e) { /* 무시 */ }
    this._charge = null;
    this._teardownContext();
  }

  _teardownContext() {
    const ctx = this.ctx;
    this.ctx = null;
    this._voices.length = 0;
    this._master = this._comp = this._sfxBus = this._bgmBus = null;
    this._layers = null;
    this._noiseBuf = null;
    this._pulse25 = this._pulse12 = null;
    if (ctx) {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* 무시 */ }
    }
  }

  // 마스터 → 컴프레서 → destination, 그리고 버스/레이어/노이즈 버퍼 생성
  _buildGraph() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : this._volume;

    const comp = ctx.createDynamicsCompressor();
    try {
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
    } catch (e) { /* 일부 브라우저에서 파라미터 미지원 */ }

    master.connect(comp);
    comp.connect(ctx.destination);

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);

    const bgmBus = ctx.createGain();
    bgmBus.gain.value = BGM_LEVEL;
    bgmBus.connect(master);

    // BGM 레이어별 게인 (강도에 따라 부드럽게 증감)
    const layers = {};
    for (const key of ['lead', 'bass', 'drum', 'hat', 'counter']) {
      const g = ctx.createGain();
      g.gain.value = this._targets[key];
      g.connect(bgmBus);
      layers[key] = g;
    }

    // 공용 화이트 노이즈 버퍼 (1초, 한 번만 생성해 재사용)
    const sr = ctx.sampleRate || 44100;
    const buf = ctx.createBuffer(1, Math.floor(sr), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // 펄스파 (미지원이면 square로 대체)
    let p25 = null;
    let p12 = null;
    try {
      if (typeof ctx.createPeriodicWave === 'function') {
        p25 = makePulseWave(ctx, 0.25);
        p12 = makePulseWave(ctx, 0.125);
      }
    } catch (e) {
      p25 = p12 = null;
    }

    this._master = master;
    this._comp = comp;
    this._sfxBus = sfxBus;
    this._bgmBus = bgmBus;
    this._layers = layers;
    this._noiseBuf = buf;
    this._pulse25 = p25;
    this._pulse12 = p12;
  }

  // iOS Safari: 사용자 제스처 안에서 무음 버퍼를 한 번 재생해야 소리가 풀림
  _primeIOS() {
    try {
      const ctx = this.ctx;
      const b = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.onended = () => safeDisconnect(s);
      s.start(0);
    } catch (e) { /* 무시 */ }
  }

  _alive() {
    return !!this.ctx && !this._destroyed && this.ctx.state !== 'closed' && !!this._master;
  }

  // ───────── 음소거 / 일시정지 ─────────

  setMuted(m) {
    this._muted = !!m;
    if (!this._alive()) return;
    try {
      const now = this.ctx.currentTime;
      const g = this._master.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(this._muted ? 0 : this._volume, now, 0.015);
    } catch (e) { /* 무시 */ }
  }

  toggleMute() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  // 일시정지: BGM 스케줄러와 차지 루프만 멈춤 (UI 효과음은 계속 재생 가능)
  pauseAll() {
    if (this._destroyed || this._paused) return;
    this._paused = true;
    this._stopScheduler();
    if (!this._alive()) return;
    try {
      const now = this.ctx.currentTime;
      const g = this._bgmBus.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.02);   // 이미 예약된 음도 조용히
      if (this._charge) this._applyCharge(0.02);
    } catch (e) { /* 무시 */ }
  }

  resumeAll() {
    if (this._destroyed || !this._paused) return;
    this._paused = false;
    if (!this._alive()) return;
    try {
      if (this._bgmOn) this._startScheduler();
      if (this._charge) this._applyCharge(0.03);
      else if (this._chargeWanted) this._buildCharge();
    } catch (e) { /* 무시 */ }
  }

  // ───────── 효과음 ─────────

  // 효과음 재생. unlock 전/음소거/알 수 없는 이름이면 조용히 무시
  // (일시정지는 BGM·차지 루프만 멈추므로 효과음은 계속 재생 가능 — 일시정지 메뉴 블립용)
  play(name, opts) {
    if (!this._alive() || this._muted) return;
    if (!SFX_NAMES.has(name)) return;
    const o = opts || {};
    const pitch = Number.isFinite(o.pitch) && o.pitch > 0 ? clamp(o.pitch, 0.25, 4) : 1;
    const vol = Number.isFinite(o.volume) ? clamp(o.volume, 0, 2) : 1;
    if (vol <= 0) return;
    try {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      // 같은 소리 연타 제한 (같은 순간 중복 방지)
      const last = this._lastPlay[name];
      const minGap = name === 'tick' ? 0.03 : 0.012;
      if (last !== undefined && now - last >= 0 && now - last < minGap) return;
      this._lastPlay[name] = now;

      const v = this._voice(vol);
      const t = now + 0.005;
      this['_s_' + name](v, t, pitch);
      if (v.pending === 0) this._releaseVoice(v);
    } catch (e) { /* 무음 */ }
  }

  // 보이스 = 효과음 하나의 출력 게인. 소스가 모두 끝나면 연결 해제
  _voice(vol) {
    const out = this.ctx.createGain();
    out.gain.value = vol;
    out.connect(this._sfxBus);
    const v = { out, pending: 0, done: false, killed: false, sources: [] };
    this._voices.push(v);
    while (this._voices.length > MAX_VOICES) this._killVoice(this._voices[0]);
    return v;
  }

  // 가장 오래된 보이스를 짧게 페이드아웃 후 정지 (클릭 방지)
  _killVoice(v) {
    const idx = this._voices.indexOf(v);
    if (idx >= 0) this._voices.splice(idx, 1);
    if (v.killed || v.done) return;
    v.killed = true;
    try {
      const t = this.ctx.currentTime;
      const g = v.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.02);
      for (const s of v.sources) safeStop(s, t + 0.03);
    } catch (e) {
      this._releaseVoice(v);
    }
  }

  _releaseVoice(v) {
    if (v.done) return;
    v.done = true;
    safeDisconnect(v.out);
    const idx = this._voices.indexOf(v);
    if (idx >= 0) this._voices.splice(idx, 1);
  }

  // 소스 종료 시 노드 정리 (v가 없으면 BGM 음 — 자기 노드만 정리)
  _track(v, src, nodes) {
    if (v) {
      v.pending++;
      v.sources.push(src);
    }
    src.onended = () => {
      for (const n of nodes) safeDisconnect(n);
      if (v) {
        v.pending--;
        if (v.pending <= 0) this._releaseVoice(v);
      }
    };
  }

  // 게인 엔벨로프: sus=false → 짧게 찍고 지수 감쇠, sus=true → 유지 후 release
  _env(param, t, dur, vol, attack, sus, release) {
    const a = Math.min(Math.max(attack, 0.0005), dur * 0.5);
    const peak = Math.max(vol, SILENT * 2);
    param.setValueAtTime(SILENT, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (sus) {
      const r = Math.min(Math.max(release, 0.005), dur * 0.5);
      param.setValueAtTime(peak, t + Math.max(a, dur - r));
      param.linearRampToValueAtTime(SILENT, t + dur);
    } else {
      param.exponentialRampToValueAtTime(SILENT, t + dur);
    }
  }

  // 사용자 정의 엔벨로프: points = [[시간(초), 값], ...] 선형 연결
  _envPoints(param, t, points) {
    param.setValueAtTime(SILENT, t);
    for (const [dt, val] of points) param.linearRampToValueAtTime(Math.max(val, SILENT), t + dt);
  }

  // 오실레이터 음 하나
  // o: { type, wave, f, f2, slide, sweep:[[frac,freq]], t, dur, vol, attack, sus, release,
  //      vib:{rate, depth, delay}, filter:{type, Q, points:[[frac,freq]]}, env:[[dt,val]] }
  _tone(dest, v, o) {
    const ctx = this.ctx;
    const t = o.t;
    const dur = Math.max(0.01, o.dur);
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type || 'square';

    const fr = osc.frequency;
    fr.setValueAtTime(Math.max(1, o.f), t);
    if (o.sweep) {
      for (const [frac, fq] of o.sweep) fr.linearRampToValueAtTime(Math.max(1, fq), t + dur * frac);
    } else if (o.f2) {
      fr.exponentialRampToValueAtTime(Math.max(1, o.f2), t + Math.min(o.slide || dur, dur));
    }

    const g = ctx.createGain();
    if (o.env) this._envPoints(g.gain, t, o.env);
    else this._env(g.gain, t, dur, o.vol === undefined ? 0.3 : o.vol, o.attack || 0.003, !!o.sus, o.release || 0.03);

    const nodes = [osc, g];
    let last = osc;
    if (o.filter) {
      const flt = ctx.createBiquadFilter();
      flt.type = o.filter.type || 'lowpass';
      flt.Q.value = o.filter.Q || 1;
      const pts = o.filter.points || [[0, 2000]];
      flt.frequency.setValueAtTime(pts[0][1], t);
      for (let i = 1; i < pts.length; i++) flt.frequency.linearRampToValueAtTime(pts[i][1], t + dur * pts[i][0]);
      osc.connect(flt);
      last = flt;
      nodes.push(flt);
    }
    last.connect(g);
    g.connect(dest);

    if (o.vib) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = o.vib.rate;
      const lg = ctx.createGain();
      const d = o.vib.delay || 0;
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + d);
      lg.gain.linearRampToValueAtTime(o.vib.depth, t + d + 0.05);
      lfo.connect(lg);
      lg.connect(fr);
      lfo.start(t);
      lfo.stop(t + dur + 0.04);
      nodes.push(lfo, lg);
    }

    osc.start(t);
    osc.stop(t + dur + 0.03);
    this._track(v, osc, nodes);
    return osc;
  }

  // 노이즈 한 덩어리 (공용 버퍼 + 필터)
  // o: { t, dur, vol, type, f, f2, slide, Q, attack, sus, release, env }
  _noise(dest, v, o) {
    const ctx = this.ctx;
    const t = o.t;
    const dur = Math.max(0.005, o.dur);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;

    const g = ctx.createGain();
    if (o.env) this._envPoints(g.gain, t, o.env);
    else this._env(g.gain, t, dur, o.vol === undefined ? 0.3 : o.vol, o.attack || 0.001, !!o.sus, o.release || 0.02);

    const nodes = [src, g];
    if (o.type && o.type !== 'none') {
      const flt = ctx.createBiquadFilter();
      flt.type = o.type;
      flt.Q.value = o.Q || 1;
      flt.frequency.setValueAtTime(Math.max(20, o.f || 1000), t);
      if (o.f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + Math.min(o.slide || dur, dur));
      src.connect(flt);
      flt.connect(g);
      nodes.push(flt);
    } else {
      src.connect(g);
    }
    g.connect(dest);

    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
    this._track(v, src, nodes);
    return src;
  }

  // 손뼉 핵심: 25ms 안에 2~3번 짧게 터지는 노이즈 + 꼬리 (진짜 손뼉 느낌)
  _clapCore(v, t, f, vol, tail) {
    const d = v.out;
    const bursts = [[0, 1.0], [0.008, 0.75], [0.017, 0.62]];
    for (const [dt, k] of bursts) {
      this._noise(d, v, { t: t + dt, dur: 0.011, vol: vol * k, type: 'bandpass', f, Q: 1.0, attack: 0.0008 });
    }
    this._noise(d, v, { t: t + 0.024, dur: tail, vol: vol * 0.6, type: 'bandpass', f, f2: f * 0.78, Q: 1.2, attack: 0.001 });
  }

  // ── 개별 효과음 (v: 보이스, t: 시작 시각, p: 피치 배율) ──

  // 짝!
  _s_clap(v, t, p) {
    this._clapCore(v, t, 1800 * p, 1.4, 0.1);
    this._tone(v.out, v, { type: 'square', f: 1700 * p, f2: 1150 * p, t, dur: 0.03, vol: 0.1 });
  }

  // 차지 밀기 짝!! — 더 크고 낮게, 서브 쿵 + 떨어지는 사각파
  _s_clapBig(v, t, p) {
    this._clapCore(v, t, 1150 * p, 1.0, 0.18);
    this._noise(v.out, v, { t, dur: 0.04, vol: 0.3, type: 'bandpass', f: 3000 * p, Q: 0.9 });
    this._tone(v.out, v, { type: 'sine', f: 120 * p, f2: 42 * p, slide: 0.16, t, dur: 0.24, vol: 0.9, attack: 0.002 });
    this._tone(v.out, v, { type: 'square', f: 560 * p, f2: 140 * p, t, dur: 0.13, vol: 0.13 });
  }

  // 동시 밀기 — 어긋난 손뼉 두 번 + 금속성 울림
  _s_clash(v, t, p) {
    this._clapCore(v, t, 1650 * p, 1.2, 0.1);
    this._clapCore(v, t + 0.012, 2250 * p, 1.05, 0.1);
    const ring = [1320, 1867, 2493];
    ring.forEach((f, i) => {
      this._tone(v.out, v, {
        type: 'triangle', f: f * p, t: t + 0.01, dur: 0.45 - i * 0.08, vol: 0.09,
        vib: { rate: 9 + i * 2, depth: 6 * p },
      });
    });
    this._tone(v.out, v, { type: 'square', f: 880 * p, t, dur: 0.04, vol: 0.06 });
  }

  // 헛손질 휙 — 대역통과 노이즈 400→2500Hz 스윕
  _s_whoosh(v, t, p) {
    this._noise(v.out, v, {
      t, dur: 0.27, type: 'bandpass', f: 400 * p, f2: 2500 * p, slide: 0.25, Q: 1.8,
      env: [[0.09, 0.6], [0.27, SILENT]],
    });
    this._noise(v.out, v, {
      t, dur: 0.22, type: 'lowpass', f: 300 * p, f2: 900 * p, Q: 0.7,
      env: [[0.07, 0.2], [0.22, SILENT]],
    });
  }

  // 손 빼기 — 짧고 높은 휙 + 위로 튀는 처프 (코믹)
  _s_feint(v, t, p) {
    this._noise(v.out, v, {
      t, dur: 0.15, type: 'bandpass', f: 900 * p, f2: 3600 * p, Q: 2.2,
      env: [[0.04, 0.32], [0.15, SILENT]],
    });
    this._tone(v.out, v, { type: 'square', f: 520 * p, f2: 1150 * p, t: t + 0.04, dur: 0.08, vol: 0.07 });
  }

  // 버티기 쿵 — 낮은 삼각파 120→60Hz + 먹먹한 노이즈
  _s_hold(v, t, p) {
    this._tone(v.out, v, { type: 'triangle', f: 120 * p, f2: 60 * p, slide: 0.12, t, dur: 0.2, vol: 0.8, attack: 0.002 });
    this._noise(v.out, v, { t, dur: 0.09, vol: 0.3, type: 'lowpass', f: 700 * p, Q: 0.7 });
    this._tone(v.out, v, { type: 'square', f: 90 * p, t, dur: 0.05, vol: 0.05 });
  }

  // 휘청 — 빠른 비브라토 사각파 "워-워-워"
  _s_wobble(v, t, p) {
    const vib = { rate: 12, depth: 35 * p };
    this._tone(v.out, v, {
      type: 'square', f: 300 * p, sweep: [[0.5, 340 * p], [1, 250 * p]], t, dur: 0.42,
      vol: 0.11, sus: true, release: 0.08, vib,
    });
    this._tone(v.out, v, {
      type: 'triangle', f: 150 * p, sweep: [[0.5, 170 * p], [1, 125 * p]], t, dur: 0.42,
      vol: 0.15, sus: true, release: 0.08, vib: { rate: 12, depth: 17 * p },
    });
  }

  // 풍덩 — 내려가는 로우패스 노이즈 + 보글보글 사인 방울
  _s_splash(v, t, p) {
    this._noise(v.out, v, { t, dur: 0.07, vol: 0.6, type: 'bandpass', f: 1200 * p, Q: 0.7 });
    this._noise(v.out, v, { t, dur: 0.55, vol: 0.75, type: 'lowpass', f: 5000 * p, f2: 250 * p, slide: 0.5, Q: 0.5, attack: 0.004 });
    this._tone(v.out, v, { type: 'sine', f: 180 * p, f2: 90 * p, t, dur: 0.12, vol: 0.4 });
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const bt = t + 0.12 + Math.random() * 0.45;
      const f = (380 + Math.random() * 520) * p;
      this._tone(v.out, v, { type: 'sine', f, f2: f * 1.9, t: bt, dur: 0.05 + Math.random() * 0.03, vol: 0.18 });
    }
  }

  // 쿵
  _s_thud(v, t, p) {
    this._tone(v.out, v, { type: 'sine', f: 90 * p, f2: 40 * p, slide: 0.18, t, dur: 0.24, vol: 0.95, attack: 0.002 });
    this._noise(v.out, v, { t, dur: 0.08, vol: 0.4, type: 'lowpass', f: 450 * p, Q: 0.7 });
    this._tone(v.out, v, { type: 'triangle', f: 60 * p, t, dur: 0.1, vol: 0.3 });
  }

  // 카운트다운 삐
  _s_count(v, t, p) {
    this._tone(v.out, v, { type: 'square', f: 440 * p, t, dur: 0.12, vol: 0.16, sus: true, release: 0.02 });
    this._tone(v.out, v, { type: 'triangle', f: 220 * p, t, dur: 0.12, vol: 0.12, sus: true, release: 0.02 });
  }

  // 시작! — 660-880-1320 아르페지오
  _s_go(v, t, p) {
    const notes = [660, 880, 1320];
    notes.forEach((f, i) => {
      const nt = t + i * 0.065;
      const last = i === notes.length - 1;
      const dur = last ? 0.32 : 0.07;
      this._tone(v.out, v, {
        type: 'square', f: f * p, t: nt, dur, vol: 0.15, sus: true, release: last ? 0.12 : 0.015,
        vib: last ? { rate: 7, depth: 12 * p, delay: 0.08 } : null,
      });
      this._tone(v.out, v, { type: 'triangle', f: f * 0.5 * p, t: nt, dur, vol: 0.14, sus: true, release: last ? 0.12 : 0.015 });
    });
  }

  // 승리 징글 — 장조 5음계 8음 + 삼각파 베이스
  _s_win(v, t, p) {
    const S = 0.095;
    const lead = [[0, 'C5', 1], [1, 'D5', 1], [2, 'E5', 1], [3, 'G5', 2], [5, 'E5', 1], [6, 'G5', 1], [7, 'A5', 1], [8, 'C6', 5]];
    for (const [st, n, len] of lead) {
      const f = midiToFreq(noteToMidi(n)) * p;
      const end = st === 8;
      this._tone(v.out, v, {
        type: 'square', f, t: t + st * S, dur: len * S * (end ? 1 : 0.9), vol: 0.13, sus: true,
        release: end ? 0.2 : 0.02, vib: end ? { rate: 6.5, depth: f * 0.012, delay: 0.12 } : null,
      });
      this._tone(v.out, v, { type: 'square', f: f * 2, t: t + st * S, dur: len * S * 0.6, vol: 0.025 });
    }
    // 마지막 화음 (펄스파)
    for (const n of ['E5', 'G5']) {
      this._tone(v.out, v, {
        wave: this._pulse25, type: 'square', f: midiToFreq(noteToMidi(n)) * p, t: t + 8 * S,
        dur: 5 * S, vol: 0.06, sus: true, release: 0.2,
      });
    }
    const bass = [[0, 'C3', 3], [3, 'G2', 2], [5, 'A2', 3], [8, 'C3', 5]];
    for (const [st, n, len] of bass) {
      this._tone(v.out, v, {
        type: 'triangle', f: midiToFreq(noteToMidi(n)) * p, t: t + st * S, dur: len * S * 0.95,
        vol: 0.32, sus: true, release: 0.04,
      });
    }
    this._noise(v.out, v, { t: t + 8 * S, dur: 0.18, vol: 0.12, type: 'highpass', f: 6000, Q: 0.7 });
  }

  // 패배 징글 — "와-와-와-와아~" 내려가는 사각파 + 로우패스 와우, 마지막 음 비브라토
  _s_lose(v, t, p) {
    const notes = [67, 66, 65, 64];
    notes.forEach((m, i) => {
      const f = midiToFreq(m) * p;
      const last = i === notes.length - 1;
      const dur = last ? 0.85 : 0.26;
      this._tone(v.out, v, {
        type: 'square', f, sweep: [[1, f * (last ? 0.94 : 0.97)]], t: t + i * 0.3, dur,
        vol: 0.17, sus: true, release: last ? 0.25 : 0.05,
        filter: { type: 'lowpass', Q: 4, points: [[0, 450], [0.3, 2200], [1, 600]] },
        vib: last ? { rate: 6, depth: f * 0.03, delay: 0.15 } : null,
      });
    });
  }

  // 관중 환호 — 부풀어 오르는 노이즈 함성 + 'yay' 처프들
  _s_cheer(v, t, p) {
    this._noise(v.out, v, {
      t, dur: 1.6, type: 'bandpass', f: 800 * p, f2: 1200 * p, slide: 0.8, Q: 0.6,
      env: [[0.35, 0.42], [1.0, 0.36], [1.6, SILENT]],
    });
    this._noise(v.out, v, {
      t, dur: 1.5, type: 'bandpass', f: 2600 * p, Q: 1.2,
      env: [[0.3, 0.14], [0.9, 0.12], [1.5, SILENT]],
    });
    for (let i = 0; i < 10; i++) {
      const ct = t + 0.08 + Math.random() * 1.1;
      const f = (520 + Math.random() * 480) * p;
      const dur = 0.08 + Math.random() * 0.08;
      this._tone(v.out, v, {
        type: 'square', f, sweep: [[0.4, f * 1.45], [1, f * 1.15]], t: ct, dur,
        vol: 0.035 + Math.random() * 0.025,
      });
    }
  }

  // UI 블립들
  _s_select(v, t, p) {
    this._tone(v.out, v, { type: 'square', f: 990 * p, f2: 1320 * p, slide: 0.02, t, dur: 0.045, vol: 0.11 });
  }

  _s_confirm(v, t, p) {
    this._tone(v.out, v, { type: 'square', f: 784 * p, t, dur: 0.05, vol: 0.09, sus: true, release: 0.01 });
    this._tone(v.out, v, { type: 'square', f: 1175 * p, t: t + 0.055, dur: 0.09, vol: 0.09 });
  }

  _s_pause(v, t, p) {
    this._tone(v.out, v, { type: 'triangle', f: 660 * p, t, dur: 0.06, vol: 0.22, sus: true, release: 0.01 });
    this._tone(v.out, v, { type: 'triangle', f: 440 * p, t: t + 0.07, dur: 0.1, vol: 0.22 });
  }

  _s_tick(v, t, p) {
    this._tone(v.out, v, { type: 'square', f: 1760 * p, t, dur: 0.022, vol: 0.05 });
  }

  // ───────── 차지 루프 ─────────

  // 차지 중 상승음: 펄스파 220→880Hz, 레벨이 오를수록 트레몰로가 빨라짐
  startCharge() {
    if (this._destroyed) return;
    this._chargeWanted = true;
    this._chargeLevel = 0;
    if (!this._alive()) return;
    try {
      if (this._charge) {
        this._applyCharge(0.03);
        return;
      }
      if (!this._paused) this._buildCharge();
    } catch (e) {
      this._charge = null;
    }
  }

  setCharge(level) {
    this._chargeLevel = clamp01(level);
    if (!this._charge || !this._alive()) return;
    try { this._applyCharge(0.03); } catch (e) { /* 무시 */ }
  }

  stopCharge() {
    this._chargeWanted = false;
    this._chargeLevel = 0;
    if (!this._charge) return;
    try { this._killCharge(false); } catch (e) { /* 무시 */ }
    this._charge = null;
  }

  _buildCharge() {
    if (!this._alive() || this._charge || this._paused) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    if (this._pulse25) osc.setPeriodicWave(this._pulse25);
    else osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(110, t);
    const subG = ctx.createGain();
    subG.gain.value = 0.6;

    // 트레몰로: trem.gain = 0.6 + LFO*0.4
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(4, t);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain);
    lfoGain.connect(trem.gain);

    const out = ctx.createGain();
    out.gain.value = 0;              // 0에서 부드럽게 올라감 (클릭 방지)

    osc.connect(trem);
    sub.connect(subG);
    subG.connect(trem);
    trem.connect(out);
    out.connect(this._sfxBus);

    osc.start(t);
    sub.start(t);
    lfo.start(t);
    this._charge = { osc, sub, subG, trem, lfo, lfoGain, out };
    this._applyCharge(0.025);
  }

  // 현재 차지 레벨/일시정지 상태를 노드 파라미터에 반영
  _applyCharge(tc) {
    const c = this._charge;
    if (!c) return;
    const now = this.ctx.currentTime;
    const l = this._chargeLevel;
    const f = 220 * Math.pow(4, l);           // 220 → 880Hz
    c.osc.frequency.setTargetAtTime(f, now, 0.03);
    c.sub.frequency.setTargetAtTime(f * 0.5, now, 0.03);
    c.lfo.frequency.setTargetAtTime(4 + 18 * l, now, 0.05);   // 트레몰로 4 → 22Hz
    const vol = this._paused ? 0 : 0.085 + 0.07 * l;
    // cancel 없이 setTarget만 겹쳐 쌓음 → 항상 현재 값에서 이어져 클릭이 없음
    c.out.gain.setTargetAtTime(vol, now, tc);
  }

  // 차지 루프 정지: 게인을 짧게 내려 클릭 없이 끊고 노드 정리
  _killCharge(immediate) {
    const c = this._charge;
    if (!c || !this.ctx) return;
    const now = this.ctx.currentTime;
    const end = now + (immediate ? 0.01 : 0.09);
    try {
      c.out.gain.setTargetAtTime(0, now, immediate ? 0.003 : 0.015);
    } catch (e) { /* 무시 */ }
    c.osc.onended = () => {
      for (const n of [c.osc, c.sub, c.subG, c.trem, c.lfo, c.lfoGain, c.out]) safeDisconnect(n);
    };
    safeStop(c.osc, end);
    safeStop(c.sub, end);
    safeStop(c.lfo, end);
  }

  // ───────── BGM ─────────

  startBgm() {
    if (this._destroyed || this._bgmOn) return;
    this._bgmOn = true;
    this._bgmBar = 0;
    this._bgmStep = 0;
    if (this._alive() && !this._paused) {
      try { this._startScheduler(); } catch (e) { /* 무시 */ }
    }
  }

  stopBgm() {
    if (!this._bgmOn) return;
    this._bgmOn = false;
    this._stopScheduler();
    if (!this._alive()) return;
    try {
      const now = this.ctx.currentTime;
      const g = this._bgmBus.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.03);   // 이미 예약된 음까지 부드럽게 끔
    } catch (e) { /* 무시 */ }
  }

  // 강도 0..1: 0.25↑ 하이햇, 0.5↑ 카운터 멜로디, 0.75↑ 꽹과리 + 북 강해짐 (레이어 게인 부드럽게 전환)
  setBgmIntensity(x) {
    this._intensity = clamp01(x);
    this._targets = layerTargets(this._intensity);
    if (!this._alive() || !this._layers) return;
    try {
      const now = this.ctx.currentTime;
      for (const key of Object.keys(this._layers)) {
        const g = this._layers[key].gain;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(this._targets[key], now, 0.35);
      }
    } catch (e) { /* 무시 */ }
  }

  _startScheduler() {
    if (this._bgmTimer || !this._alive() || typeof setInterval !== 'function') return;
    const now = this.ctx.currentTime;
    const g = this._bgmBus.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(BGM_LEVEL, now, 0.02);
    this._bgmNext = now + 0.06;
    this._bgmTimer = setInterval(() => this._schedTick(), SCHED_INTERVAL_MS);
    this._schedTick();
  }

  _stopScheduler() {
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
  }

  // 룩어헤드 스케줄러: 현재 시각 + LOOKAHEAD 안에 들어오는 스텝을 미리 예약
  _schedTick() {
    if (!this._alive() || !this._bgmOn || this._paused) return;
    try {
      const now = this.ctx.currentTime;
      // 탭이 백그라운드여서 타이머가 밀렸으면 현재 시각으로 재동기화 (몰아서 재생 방지)
      if (this._bgmNext < now - 0.25) this._bgmNext = now + 0.03;
      let guard = 0;
      while (this._bgmNext < now + LOOKAHEAD && guard++ < 32) {
        // 음소거 중에는 노드를 만들지 않고 진행 위치만 전진 (해제 시 자연스럽게 이어짐)
        if (!this._muted) this._scheduleStep(this._bgmBar, this._bgmStep, this._bgmNext);
        this._bgmNext += STEP_DUR;
        this._bgmStep++;
        if (this._bgmStep >= STEPS_PER_BAR) {
          this._bgmStep = 0;
          this._bgmBar = (this._bgmBar + 1) % MELODY.length;
        }
      }
    } catch (e) { /* 무시 */ }
  }

  _scheduleStep(bar, step, t) {
    const L = this._layers;
    const T = this._targets;

    // 리드 멜로디 (사각파)
    const ev = LEAD_TABLE[bar][step];
    if (ev && T.lead > 0) {
      const f = midiToFreq(ev.midi);
      const dur = ev.len * STEP_DUR * 0.9;
      const long = ev.len >= 3;
      this._tone(L.lead, null, {
        type: 'square', f, t, dur, vol: step === 0 ? 0.55 : 0.45, sus: true,
        release: long ? 0.08 : 0.03, attack: 0.004,
        vib: long ? { rate: 5.5, depth: f * 0.012, delay: 0.15 } : null,
      });
    }

    // 베이스 (삼각파): 근음 - 5도 - 옥타브 - 5도
    if (step % 3 === 0 && T.bass > 0) {
      const root = BASS_ROOTS[bar];
      const offs = [0, 7, 12, 7][step / 3];
      this._tone(L.bass, null, {
        type: 'triangle', f: midiToFreq(root + offs), t, dur: STEP_DUR * 1.8, vol: 0.9,
        sus: true, release: 0.04, attack: 0.004,
      });
    }

    // 장구 장단
    const pat = bar === 15 ? DRUM_FILL : bar === 7 ? DRUM_HALF : DRUM_MAIN;
    const ch = pat[step];
    if (T.drum > 0) {
      if (ch === 'D') { this._bgmKick(t, 1.0); this._bgmSnare(t, 0.55); }
      else if (ch === 'K') this._bgmKick(t, 0.8);
      else if (ch === 'k') { this._bgmSnare(t, 0.18); this._bgmSnare(t + STEP_DUR * 0.5, 0.45); }
      else if (ch === 'r') {
        for (let i = 0; i < 3; i++) {
          this._noise(L.drum, null, { t: t + i * STEP_DUR / 3, dur: 0.025, vol: 0.12 + i * 0.05, type: 'bandpass', f: 2400, Q: 1 });
        }
      }
      // 강도 높을 때 마디 첫 박 꽹과리 (금속성 짧은 울림)
      if (step === 0 && this._intensity > 0.75) {
        this._tone(L.drum, null, { type: 'square', f: 2093, t, dur: 0.16, vol: 0.05 });
        this._tone(L.drum, null, { type: 'square', f: 2960, t, dur: 0.12, vol: 0.04 });
      }
    }

    // 하이햇 (매 스텝, 박 첫 스텝 강세)
    if (T.hat > 0) {
      this._noise(L.hat, null, { t, dur: 0.03, vol: step % 3 === 0 ? 0.45 : 0.25, type: 'highpass', f: 7000, Q: 0.7 });
    }

    // 카운터 멜로디 (25% 펄스)
    if (T.counter > 0 && COUNTER_STEPS[step] !== undefined) {
      const m = COUNTER_TONES[bar][COUNTER_STEPS[step]];
      this._tone(L.counter, null, {
        wave: this._pulse25, type: 'square', f: midiToFreq(m), t, dur: STEP_DUR * 0.8, vol: 0.7,
        sus: true, release: 0.03,
      });
    }
  }

  _bgmKick(t, k) {
    this._tone(this._layers.drum, null, { type: 'sine', f: 150, f2: 48, slide: 0.09, t, dur: 0.14, vol: 0.9 * k, attack: 0.002 });
  }

  _bgmSnare(t, k) {
    this._noise(this._layers.drum, null, { t, dur: 0.07, vol: 0.9 * k, type: 'bandpass', f: 1900, Q: 0.9 });
    this._tone(this._layers.drum, null, { type: 'triangle', f: 240, f2: 180, t, dur: 0.04, vol: 0.25 * k });
  }
}
