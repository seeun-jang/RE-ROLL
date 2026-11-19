// =============================================================
// 마이크 녹음 — 말소리 한 토막을 잘라 16kHz 16비트 PCM 으로 돌려준다.
//
//   const mic = new MicCapture();            // 또는 new MicCapture({ SILENCE_MS: 350 }) 처럼 값을 바꿔서
//   await mic.start();              // 권한 요청. 성공하면 mic.status === 'ready'
//   const clip = await mic.listen(); // 말이 시작되고 끝날 때까지 기다린다 → { pcm: Int16Array, rate } | null(취소)
//   const take = await mic.record(3000); // 말의 시작·끝을 가리지 않고 3초를 통째로 녹음 → { pcm, rate } | null(취소)
//   mic.cancel();                   // 듣기·녹음 취소
//   mic.stop();                     // 마이크 끄기
//
// 인식(글자로 바꾸기)은 서버가 한다. 여기서는 소리 크기로 말의 시작과 끝만 가린다.
// 마이크는 localhost 또는 https 주소에서만 쓸 수 있다(브라우저 규칙).
// =============================================================

/** 기본값 — 게임마다 new MicCapture({ ... }) 로 일부를 바꿀 수 있다 */
export const MIC_DEFAULTS = Object.freeze({
  SAMPLE_RATE: 16000,
  START_LEVEL: 0.02,     // 이보다 큰 소리가 나면 말하기 시작으로 본다 (0~1)
  STOP_LEVEL: 0.012,     // 이보다 작으면 조용한 것으로 본다
  SILENCE_MS: 650,       // 이만큼 조용하면 말이 끝난 것으로 본다
  PRE_ROLL_MS: 250,      // 말 시작 직전 소리도 조금 포함한다(첫 음절이 잘리지 않게)
  MIN_SPEECH_MS: 200,    // 이보다 짧은 소리는 잡음으로 보고 버린다
  MAX_MS: 5000,          // 한 번에 보내는 최대 길이
  RAW: false,            // true 면 브라우저의 잡음 제거·자동 음량·울림 제거를 끈다(말이 아닌 소리를 녹음할 때)
});

/** 오디오 스레드에서 도는 작은 프로그램: 들어온 소리를 그대로 메인 스레드로 넘긴다 */
const WORKLET_SOURCE = `
class PartyMicTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('party-mic-tap', PartyMicTap);
`;

/** Float32(임의 샘플레이트) → Int16(16kHz). 구간 평균으로 줄인다 */
export function toPcm16(chunks, fromRate, toRate = MIC_DEFAULTS.SAMPLE_RATE) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const src = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    src.set(c, o);
    o += c.length;
  }
  const ratio = fromRate / toRate;
  const n = Math.floor(total / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(total, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += src[j];
    const v = Math.max(-1, Math.min(1, sum / (b - a)));
    out[i] = Math.round(v * 32767);
  }
  return out;
}

/** Int16Array → base64 (리틀엔디언) */
export function pcmToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class MicCapture {
  constructor(options = {}) {
    this.cfg = { ...MIC_DEFAULTS, ...options };
    /** 'idle' | 'starting' | 'ready' | 'denied' | 'unsupported' | 'error' */
    this.status = 'idle';
    /** 지금 소리 크기 (0~1, 화면 표시용) */
    this.level = 0;
    /** 듣는 중인지 / 말하는 중인지 (화면 표시용) */
    this.listening = false;
    this.speaking = false;
    this._ctx = null;
    this._stream = null;
    this._node = null;
    this._pre = [];        // 말 시작 직전 소리(조금만 보관)
    this._preLen = 0;
    this._rec = null;      // 듣는 중일 때의 녹음 상태
    this._fixed = null;    // 정해진 길이로 녹음하는 중일 때의 상태
  }

  async start() {
    if (this.status === 'ready' || this.status === 'starting') return this.status;
    const md = navigator.mediaDevices;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!md || !md.getUserMedia || !Ctx || typeof AudioWorkletNode === 'undefined') {
      this.status = 'unsupported';
      return this.status;
    }
    this.status = 'starting';
    try {
      this._stream = await md.getUserMedia({
        audio: this.cfg.RAW
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this._ctx = new Ctx();
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await this._ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = this._ctx.createMediaStreamSource(this._stream);
      this._node = new AudioWorkletNode(this._ctx, 'party-mic-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
      this._node.port.onmessage = (e) => this._onChunk(e.data);
      source.connect(this._node);
      if (this._ctx.state === 'suspended') await this._ctx.resume();
      if (this.status === 'starting') this.status = 'ready';
      else this.stop(); // 시작하는 사이에 stop() 이 불렸다
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this._release();
      this.status = denied ? 'denied' : 'error';
      if (!denied) console.warn('[quiz] 마이크를 열 수 없습니다', err);
    }
    return this.status;
  }

  /** 말 한 토막을 기다린다. 취소되면 null */
  listen() {
    this.cancel();
    if (this.status !== 'ready') return Promise.resolve(null);
    this.listening = true;
    return new Promise((resolve) => {
      this._rec = { resolve, chunks: [], samples: 0, speech: false, speechSamples: 0, quiet: 0 };
    });
  }

  /** 지금부터 ms 밀리초를 통째로 녹음한다. 취소되면 null */
  record(ms) {
    this.cancel();
    if (this.status !== 'ready') return Promise.resolve(null);
    return new Promise((resolve) => {
      this._fixed = { resolve, chunks: [], samples: 0, ms };
    });
  }

  cancel() {
    const fixed = this._fixed;
    this._fixed = null;
    if (fixed) fixed.resolve(null);
    const rec = this._rec;
    this._rec = null;
    this.listening = false;
    this.speaking = false;
    if (rec) rec.resolve(null);
  }

  stop() {
    this.cancel();
    this._release();
    this.status = 'idle';
    this.level = 0;
  }

  _release() {
    if (this._node) {
      this._node.port.onmessage = null;
      try { this._node.disconnect(); } catch (e) { /* 무시 */ }
    }
    if (this._stream) this._stream.getTracks().forEach((t) => t.stop());
    if (this._ctx) this._ctx.close().catch(() => {});
    this._node = null;
    this._stream = null;
    this._ctx = null;
    this._pre = [];
    this._preLen = 0;
  }

  _onChunk(chunk) {
    const MIC = this.cfg;
    const rate = this._ctx ? this._ctx.sampleRate : 48000;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    this.level = Math.max(rms, this.level * 0.85);

    const fixed = this._fixed;
    if (fixed) {
      fixed.chunks.push(chunk);
      fixed.samples += chunk.length;
      if ((fixed.samples / rate) * 1000 >= fixed.ms) {
        this._fixed = null;
        fixed.resolve({ pcm: toPcm16(fixed.chunks, rate), rate: MIC.SAMPLE_RATE });
      }
      return;
    }

    const rec = this._rec;
    if (!rec || !rec.speech) {
      // 말 시작 직전 소리를 조금 보관
      this._pre.push(chunk);
      this._preLen += chunk.length;
      const keep = (MIC.PRE_ROLL_MS / 1000) * rate;
      while (this._pre.length > 1 && this._preLen - this._pre[0].length >= keep) this._preLen -= this._pre.shift().length;
    }
    if (!rec) return;

    const ms = (n) => (n / rate) * 1000;
    if (!rec.speech) {
      if (rms < MIC.START_LEVEL) return;
      rec.speech = true;
      this.speaking = true;
      rec.chunks = this._pre.slice();
      rec.samples = this._preLen;
      rec.speechSamples = 0;
      rec.quiet = 0;
      this._pre = [];
      this._preLen = 0;
      return;
    }
    rec.chunks.push(chunk);
    rec.samples += chunk.length;
    if (rms >= MIC.STOP_LEVEL) {
      rec.quiet = 0;
      rec.speechSamples += chunk.length;
    } else {
      rec.quiet += chunk.length;
    }
    const ended = ms(rec.quiet) >= MIC.SILENCE_MS;
    const tooLong = ms(rec.samples) >= MIC.MAX_MS;
    if (!ended && !tooLong) return;
    if (ms(rec.speechSamples) < MIC.MIN_SPEECH_MS) {
      // 짧은 잡음 — 버리고 계속 듣는다
      rec.speech = false;
      rec.chunks = [];
      rec.samples = 0;
      this.speaking = false;
      return;
    }
    this._rec = null;
    this.listening = false;
    this.speaking = false;
    rec.resolve({ pcm: toPcm16(rec.chunks, rate), rate: MIC.SAMPLE_RATE });
  }
}
