// =============================================================
// 소리 따라하기의 소리 재생: 제시 소리(WAV), 다른 사람의 녹음, 효과음.
// 녹음 중에는 아무 소리도 내지 않는다(마이크에 섞이지 않게) — 화면 쪽에서 재생을 부르지 않는다.
// =============================================================
import { SFX } from './Sfx.js';

// 제시 소리 파일 (서버의 server/party/games/mimic/sounds/ 와 같은 파일. 테스트가 비교한다)
const SOUND_URLS = {
  beep: new URL('../sounds/beep.wav', import.meta.url).href,
  dingdong: new URL('../sounds/dingdong.wav', import.meta.url).href,
  hum_up: new URL('../sounds/hum_up.wav', import.meta.url).href,
  meow: new URL('../sounds/meow.wav', import.meta.url).href,
  cuckoo: new URL('../sounds/cuckoo.wav', import.meta.url).href,
  whistle_up: new URL('../sounds/whistle_up.wav', import.meta.url).href,
  siren: new URL('../sounds/siren.wav', import.meta.url).href,
  melody: new URL('../sounds/melody.wav', import.meta.url).href,
  rhythm: new URL('../sounds/rhythm.wav', import.meta.url).href,
};

export class MimicAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.buffers = new Map();   // 소리 id → AudioBuffer
    this._loading = new Map();
    this._playing = new Set();
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.5;
      this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
  }

  /** 제시 소리를 미리 받아 둔다 */
  load(id) {
    if (this.buffers.has(id) || this._loading.has(id) || !this.ctx || !SOUND_URLS[id]) return;
    const job = fetch(SOUND_URLS[id])
      .then((res) => res.arrayBuffer())
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buf) => this.buffers.set(id, buf))
      .catch((err) => console.warn('[mimic] 소리를 불러오지 못했습니다', id, err))
      .finally(() => this._loading.delete(id));
    this._loading.set(id, job);
  }

  _start(buffer, gain = 1) {
    if (!this.ctx || !buffer) return 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    this._playing.add(src);
    src.onended = () => {
      this._playing.delete(src);
      try { g.disconnect(); } catch (e) { /* 이미 끊김 */ }
    };
    return buffer.duration;
  }

  /** 제시 소리 재생. 아직 못 받았으면 false */
  playPrompt(id) {
    const buf = this.buffers.get(id);
    if (!buf) {
      this.load(id);
      return false;
    }
    this._start(buf, 1);
    return true;
  }

  /** 녹음(16비트 PCM, base64) 재생. 파형 표시용 Float32Array 를 돌려준다 */
  playPcm(base64, rate) {
    const bin = atob(base64);
    const n = bin.length >> 1;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      data[i] = v / 32768;
    }
    if (this.ctx && n > 0) {
      const buf = this.ctx.createBuffer(1, n, rate);
      buf.copyToChannel(data, 0);
      this._start(buf, 1.4);
    }
    return data;
  }

  sfx(name) {
    if (!this.ctx || !SFX[name]) return;
    try {
      SFX[name](this.ctx, this.sfxBus, this.ctx.currentTime + 0.01);
    } catch (e) { /* 효과음 실패는 무시 */ }
  }

  /** 재생 중인 제시 소리·녹음을 모두 멈춘다(녹음 시작 직전) */
  stopAll() {
    for (const src of this._playing) {
      try { src.stop(); } catch (e) { /* 이미 끝남 */ }
    }
    this._playing.clear();
  }

  destroy() {
    this.stopAll();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
