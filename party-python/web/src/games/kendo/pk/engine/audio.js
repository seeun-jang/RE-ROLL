(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 오디오 — Web Audio API로 모든 소리를 코드에서 합성 (외부 파일 없음)
  //  - 효과음: 죽도 타격, 죽도 부딪힘, 헛침, 발구름, 심판 깃발, 한판, 북
  //  - 8비트 음성: 사각파 + 포먼트 필터 2개로 "머리!" "손목!" "허리!" "야아!" 비슷한 소리
  //  - 배경음: 16분음표 스텝 시퀀서 (도장 / 시합 / 결승)
  //  브라우저 정책상 첫 키 입력 뒤에 unlock() 으로 시작한다.
  // ─────────────────────────────────────────────────────────────

  // 음 이름 → 주파수
  const NOTE_BASE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  function noteFreq(n) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(n);
    if (!m) return 0;
    let semi = NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) - 4) * 12;
    return 440 * Math.pow(2, semi / 12);
  }

  // 모음 포먼트 (F1, F2)
  const VOWELS = {
    a: [800, 1250], e: [500, 1850], i: [320, 2300], o: [480, 880], u: [350, 750],
    m: [260, 1000], n: [280, 1500], y: [300, 2200]
  };

  // 단어 = 음소 목록 (c = 자음 소음, v = 유성음)
  const WORDS = {
    kiai:   [{ v: 'i', d: 0.05 }, { v: 'a', d: 0.30 }],
    men:    [{ v: 'm', d: 0.05 }, { v: 'e', d: 0.20 }, { v: 'n', d: 0.07 }],
    kote:   [{ c: 'k' }, { v: 'o', d: 0.09 }, { c: 't' }, { v: 'e', d: 0.17 }],
    do:     [{ c: 'd' }, { v: 'o', d: 0.28 }],
    hajime: [{ c: 's' }, { v: 'i', d: 0.08 }, { c: 'ch' }, { v: 'a', d: 0.12 }, { c: 'k' }],
    yame:   [{ c: 'k' }, { v: 'u', d: 0.06 }, { v: 'm', d: 0.04 }, { v: 'a', d: 0.16 }, { v: 'n', d: 0.06 }],
    wakare: [{ c: 'k' }, { v: 'a', d: 0.10 }, { v: 'y', d: 0.03 }, { v: 'o', d: 0.15 }],
    shobu:  [{ c: 's' }, { v: 'u', d: 0.06 }, { v: 'm', d: 0.04 }, { c: 'b' }, { v: 'u', d: 0.18 }]
  };
  const CONSONANTS = {
    k: { type: 'highpass', f: 1800, d: 0.03, v: 0.5 },
    t: { type: 'highpass', f: 3500, d: 0.02, v: 0.45 },
    d: { type: 'bandpass', f: 1500, d: 0.02, v: 0.35 },
    b: { type: 'lowpass', f: 600, d: 0.02, v: 0.4 },
    s: { type: 'highpass', f: 5000, d: 0.08, v: 0.25 },
    ch: { type: 'highpass', f: 3000, d: 0.04, v: 0.35 }
  };

  // ── 배경음 데이터 ── (토큰: 음이름 / '.' 쉼표 / '-' 앞 음 늘이기 / 북: X 큰북 x 작은북 k 테두리)
  const SONGS = {
    dojo: {
      bpm: 72,
      tracks: [
        { inst: 'koto', vol: 0.11, notes:
          'D4 . . . A4 . . . G4 . F4 . D4 . . . ' +
          'C4 . . . D4 . F4 . G4 . . . A4 . . . ' +
          'D5 . . . C5 . A4 . G4 . . . F4 . G4 . ' +
          'A4 . . . . . . . D4 . . . . . . . ' +
          'F4 . . . G4 . A4 . C5 . . . A4 . . . ' +
          'G4 . F4 . D4 . . . C4 . D4 . . . . . ' +
          'A3 . . . C4 . D4 . F4 . . . G4 . F4 . ' +
          'D4 . . . . . . . . . . . . . . . ' },
        { inst: 'bass', vol: 0.12, notes:
          'D2 - - - - - - - A2 - - - - - - - ' +
          'C3 - - - - - - - G2 - - - - - - - ' +
          'D2 - - - - - - - F2 - - - - - - - ' +
          'A2 - - - - - - - D2 - - - - - - - ' },
        { inst: 'drum', vol: 0.18, notes:
          'x . . . . . . . . . . . k . . . ' +
          'x . . . . . . . . . . . . . k . ' }
      ]
    },
    match: {
      bpm: 100,
      tracks: [
        { inst: 'drum', vol: 0.4, notes:
          'X . . x X . x . X . . x . x x . ' +
          'X . . x X . x . X . x . X x x x ' },
        { inst: 'bass', vol: 0.14, notes:
          'D2 . D2 . . . D2 . C2 . . . D2 . . . ' +
          'D2 . D2 . . . F2 . G2 . . . A1 . . . ' },
        { inst: 'flute', vol: 0.07, notes:
          'A4 - - - - - - - . . . . . . . . ' +
          'C5 - - - D5 - - - - - - - . . . . ' +
          'F5 - - - D5 - - - C5 - - - A4 - - - ' +
          'G4 - - - - - - - . . . . . . . . ' }
      ]
    },
    final: {
      bpm: 126,
      tracks: [
        { inst: 'drum', vol: 0.45, notes:
          'X . x x X . x . X x . x X . x x ' +
          'X . x x X . x . X x X x X x X x ' },
        { inst: 'bass', vol: 0.16, notes:
          'D2 . D3 . D2 . C3 . D2 . D3 . F2 . G2 . ' +
          'A1 . A2 . A1 . G2 . A1 . A2 . C2 . D2 . ' },
        { inst: 'koto', vol: 0.09, notes:
          'D5 . A4 . F4 . A4 . D5 . C5 . A4 . G4 . ' +
          'F5 . D5 . A4 . D5 . G5 . F5 . D5 . C5 . ' },
        { inst: 'flute', vol: 0.06, notes:
          'D5 - - - - - - - F5 - - - G5 - - - ' +
          'A5 - - - - - - - G5 - F5 - D5 - - - ' }
      ]
    }
  };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.bgmName = null;
      this.pendingBgm = null;
      this.timer = null;
    }

    // 첫 사용자 입력 때 오디오 컨텍스트 생성
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
        this.bgmBus = this.ctx.createGain(); this.bgmBus.gain.value = 0.55; this.bgmBus.connect(this.master);
        // 1초 백색소음 버퍼
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.pendingBgm) { const n = this.pendingBgm; this.pendingBgm = null; this.playBgm(n); }
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.7;
    }

    // ── 기본 음원 ──
    tone(type, freq, t0, dur, vol, opt) {
      opt = opt || {};
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + dur);
      const a = opt.attack || 0.004;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + a);
      if (opt.sustain) g.gain.setValueAtTime(vol, t0 + Math.max(a, dur - 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(opt.dest || this.sfxBus);
      if (opt.vibrato) {
        const l = c.createOscillator(), lg = c.createGain();
        l.frequency.value = opt.vibrato[0]; lg.gain.value = opt.vibrato[1];
        l.connect(lg); lg.connect(o.frequency);
        l.start(t0); l.stop(t0 + dur + 0.05);
      }
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    noise(t0, dur, vol, opt) {
      opt = opt || {};
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = opt.type || 'bandpass';
      f.frequency.setValueAtTime(opt.f || 1000, t0);
      if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
      f.Q.value = opt.q || 1;
      const g = c.createGain();
      const a = opt.attack || 0.002;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(opt.dest || this.sfxBus);
      s.start(t0, Math.random() * 0.5);
      s.stop(t0 + dur + 0.05);
    }

    // ── 효과음 ──
    sfx(name) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.005;
      switch (name) {
        case 'hit':      // 죽도가 호구에 맞는 "팍!"
          this.noise(t, 0.08, 0.9, { f: 1900, q: 1.2 });
          this.noise(t, 0.025, 0.6, { type: 'highpass', f: 4200 });
          this.tone('square', 240, t, 0.06, 0.18, { to: 110 });
          break;
        case 'clash':    // 죽도끼리 "딱"
          this.noise(t, 0.05, 0.65, { f: 3600, q: 5 });
          this.tone('square', 1320, t, 0.04, 0.12);
          this.tone('square', 1980, t + 0.012, 0.03, 0.08);
          break;
        case 'parry':    // 받아치기 성공 — 더 맑게
          this.noise(t, 0.06, 0.7, { f: 3000, q: 4 });
          this.tone('square', 1568, t, 0.06, 0.12);
          this.tone('square', 2093, t + 0.05, 0.12, 0.10);
          break;
        case 'whiff':    // 헛침 "휙"
          this.noise(t, 0.14, 0.28, { f: 700, to: 2600, q: 2, attack: 0.03 });
          break;
        case 'stomp':    // 발구름 "쿵"
          this.tone('sine', 120, t, 0.13, 0.7, { to: 45 });
          this.noise(t, 0.06, 0.45, { type: 'lowpass', f: 380 });
          break;
        case 'step':
          this.noise(t, 0.035, 0.06, { type: 'lowpass', f: 700 });
          break;
        case 'flag':     // 심판 깃발 "펄럭" + 판정음
          this.noise(t, 0.16, 0.25, { f: 1400, to: 500, q: 1.5, attack: 0.02 });
          this.tone('triangle', 988, t + 0.06, 0.12, 0.16);
          break;
        case 'nope':     // 무효
          this.tone('triangle', 330, t, 0.1, 0.12);
          this.tone('triangle', 262, t + 0.08, 0.14, 0.12);
          break;
        case 'ippon':    // 한판!
          [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, t + i * 0.055, 0.14, 0.14));
          this.tone('triangle', 1047, t + 0.3, 0.45, 0.16, { vibrato: [7, 8] });
          this.taiko(t, 1.0);
          break;
        case 'taiko': this.taiko(t, 1.0); break;
        case 'taiko2': this.taiko(t, 1.0); this.taiko(t + 0.22, 0.8); break;
        case 'blip': this.tone('square', 660, t, 0.04, 0.08); break;
        case 'confirm': this.tone('square', 880, t, 0.05, 0.1); this.tone('square', 1320, t + 0.05, 0.08, 0.1); break;
        case 'cancel': this.tone('square', 440, t, 0.1, 0.1, { to: 220 }); break;
        case 'type': this.tone('square', 1200 + Math.random() * 200, t, 0.015, 0.03); break;
        case 'stun': this.tone('triangle', 360, t, 0.45, 0.16, { to: 110, vibrato: [12, 30] }); break;
        case 'foul':     // 반칙 부저
          this.tone('square', 196, t, 0.22, 0.12, { sustain: true });
          this.tone('square', 147, t + 0.2, 0.3, 0.12, { sustain: true });
          break;
        case 'cheer':    // 관중 함성
          this.noise(t, 1.3, 0.22, { f: 1100, q: 0.6, attack: 0.15 });
          this.noise(t + 0.1, 1.0, 0.12, { f: 2400, q: 0.8, attack: 0.2 });
          break;
        case 'lock': this.tone('square', 200, t, 0.08, 0.1); this.tone('square', 150, t + 0.08, 0.1, 0.1); break;
        case 'lesson': [784, 988, 1175, 1568].forEach((f, i) => this.tone('square', f, t + i * 0.07, 0.12, 0.1)); break;
      }
    }

    taiko(t, v) {
      this.tone('sine', 150, t, 0.5, 0.85 * v, { to: 48 });
      this.tone('triangle', 75, t, 0.35, 0.3 * v, { to: 50 });
      this.noise(t, 0.12, 0.35 * v, { type: 'lowpass', f: 260 });
    }

    // ── 8비트 음성 ── word: WORDS 키, pitch: 1.0 기준 배율
    voice(word, pitch) {
      if (!this.ctx) return;
      const seq = WORDS[word];
      if (!seq) return;
      const c = this.ctx;
      const t0 = c.currentTime + 0.01;
      const f0 = 210 * (pitch || 1);
      // 전체 길이
      let total = 0;
      seq.forEach(function (p) { total += p.v ? p.d : CONSONANTS[p.c].d; });
      const src = c.createOscillator();
      src.type = 'square';
      src.frequency.setValueAtTime(f0 * 0.92, t0);
      src.frequency.linearRampToValueAtTime(f0 * 1.18, t0 + Math.min(0.08, total * 0.3));
      src.frequency.linearRampToValueAtTime(f0 * 0.82, t0 + total);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 9;
      const g1 = c.createGain(); g1.gain.value = 1.0;
      const g2 = c.createGain(); g2.gain.value = 0.55;
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      src.connect(f1); f1.connect(g1); g1.connect(env);
      src.connect(f2); f2.connect(g2); g2.connect(env);
      env.connect(this.sfxBus);
      let t = t0;
      const self = this;
      seq.forEach(function (p) {
        if (p.c) {
          const k = CONSONANTS[p.c];
          self.noise(t, k.d + 0.01, k.v * 0.6, { type: k.type, f: k.f });
          env.gain.setValueAtTime(0.0001, t);
          t += k.d;
          return;
        }
        const fm = VOWELS[p.v];
        f1.frequency.setValueAtTime(fm[0], t);
        f2.frequency.setValueAtTime(fm[1], t);
        const lv = (p.v === 'm' || p.v === 'n') ? 0.25 : 0.9;
        env.gain.linearRampToValueAtTime(lv, t + 0.012);
        env.gain.setValueAtTime(lv, t + p.d * 0.7);
        t += p.d;
      });
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.start(t0);
      src.stop(t + 0.1);
    }

    // ── 배경음 시퀀서 ──
    playBgm(name) {
      if (!this.ctx) { this.pendingBgm = name; return; }
      if (this.bgmName === name) return;
      this.stopBgm();
      const song = SONGS[name];
      if (!song) return;
      this.bgmName = name;
      // 토큰 파싱 (한 번만)
      if (!song.parsed) {
        song.parsed = song.tracks.map(function (tr) {
          const toks = tr.notes.trim().split(/\s+/);
          return { inst: tr.inst, vol: tr.vol, toks: toks };
        });
        song.length = Math.max.apply(null, song.parsed.map(function (t) { return t.toks.length; }));
      }
      this.song = song;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
      const self = this;
      this.timer = setInterval(function () { self.schedule(); }, 25);
    }

    stopBgm() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.bgmName = null;
      this.pendingBgm = null;
    }

    schedule() {
      if (!this.ctx || !this.song) return;
      const stepDur = 60 / this.song.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.12) {
        this.playStep(this.step, this.nextTime, stepDur);
        this.nextTime += stepDur;
        this.step = (this.step + 1) % this.song.length;
      }
    }

    playStep(step, t, stepDur) {
      const self = this;
      this.song.parsed.forEach(function (tr) {
        const i = step % tr.toks.length;
        const tok = tr.toks[i];
        if (tok === '.' || tok === '-') return;
        // 늘임표 개수만큼 길이 연장
        let len = 1;
        while (tr.toks[(i + len) % tr.toks.length] === '-' && len < 32) len++;
        const dur = len * stepDur;
        const B = self.bgmBus;
        if (tr.inst === 'drum') {
          if (tok === 'X') { self.tone('sine', 130, t, 0.4, tr.vol, { to: 46, dest: B }); self.noise(t, 0.08, tr.vol * 0.4, { type: 'lowpass', f: 240, dest: B }); }
          else if (tok === 'x') { self.tone('sine', 190, t, 0.18, tr.vol * 0.55, { to: 80, dest: B }); }
          else if (tok === 'k') { self.noise(t, 0.03, tr.vol * 0.5, { type: 'highpass', f: 3500, dest: B }); }
          return;
        }
        const f = noteFreq(tok);
        if (!f) return;
        if (tr.inst === 'koto') {
          self.tone('triangle', f, t, Math.max(0.35, dur), tr.vol, { dest: B });
          self.tone('square', f * 2, t, 0.06, tr.vol * 0.25, { dest: B });
        } else if (tr.inst === 'bass') {
          self.tone('triangle', f, t, dur * 0.95, tr.vol, { dest: B, sustain: true });
        } else if (tr.inst === 'flute') {
          self.tone('sine', f, t, dur, tr.vol, { dest: B, attack: 0.06, sustain: true, vibrato: [5, f * 0.012] });
          self.noise(t, Math.min(0.2, dur), tr.vol * 0.25, { f: f * 2, q: 3, attack: 0.04, dest: B });
        }
      });
    }
  }

  PK.Audio = new AudioEngine();
})(window.PK = window.PK || {});
