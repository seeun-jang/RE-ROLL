// =====================================================
// 책상 탁! = 종 (개인 화면 전용)
//  - 마이크에서 '탁' 하고 갑자기 커지는 소리가 나면 그 순간을 기억해 두고,
//    AI 가 그게 진짜 치는 소리(노크 · 탁 · 손바닥 · 박수 …)인지 확인하면 종을 친다
//  - 모델: Hugging Face Xenova/ast-finetuned-audioset-10-10-0.4593 (소리 527종)
//  - AI 확인(약 0.3~0.4초) 동안은 CPU 가 종을 못 치게 잡아 둠 → 소리가 먼저였으면 내가 이김
//  - WebGPU 가 있어야 켜짐 (CPU 로는 한 번에 5초라 못 씀)
//  - 함께 하기 모드는 마이크 하나로 누가 쳤는지 알 수 없어서 안 씀
// =====================================================
const SlapBell = {
  MODEL: 'Xenova/ast-finetuned-audioset-10-10-0.4593',
  // 치는 소리로 인정할 이름 (상위 3개 안에 있고 확률이 MIN 이상)
  HIT_LABELS: ['Knock', 'Tap', 'Slap, smack', 'Thump, thud', 'Clapping', 'Hands', 'Wood', 'Bang', 'Whack, thwack', 'Bell', 'Ding', 'Cowbell', 'Bicycle bell', 'Hammer', 'Tick'],
  MIN: 0.15,
  GATE: 0.04,       // 이 음량(RMS)보다 크고
  JUMP: 4,          // 직전 평균 음량의 이 배 이상 갑자기 커지면 '탁'으로 봄
  WAIT_MS: 160,     // 소리가 다 들어올 때까지 기다린 뒤 AI 확인
  HOLD_MS: 900,     // 이 시간 안에 확인이 안 끝나면 CPU 잡아 두기 해제
  REFRACTORY: 450,  // 한 번 탁 한 뒤 이 시간은 무시
  SR: 16000,

  status: 'off',    // off | loading | on | error
  message: '',
  clf: null,
  ctx: null,
  stream: null,
  proc: null,
  ring: new Float32Array(16000),
  w: 0,
  frac: 0,
  avg: 0,
  lastOnset: 0,
  pending: null,    // { at } 확인 중인 '탁'
  hit: 0,           // 확인된 '탁'의 시각 → 게임이 한 번 가져감

  get on() {
    return this.status === 'on';
  },

  toggle() {
    if (this.status === 'on' || this.status === 'loading') this.stop();
    else this.start();
  },

  async start() {
    this.status = 'loading';
    this.message = '책상 종 준비 중…';
    try {
      if (!navigator.gpu) throw new Error('WebGPU 없음');
      // 버튼(키) 누른 직후에 만들어야 소리 처리가 바로 시작됨
      this.ctx = new AudioContext();
      // 잡음 제거 · 자동 음량은 '탁' 같은 짧은 소리를 깎아 버려서 끔
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!this.clf) {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        env.allowLocalModels = location.protocol !== 'file:';
        env.localModelPath = new URL('./models/', location.href).href;
        this.clf = await pipeline('audio-classification', this.MODEL, { dtype: 'fp32', device: 'webgpu' });
      }
      if (this.status !== 'loading') return; // 준비 중에 꺼짐
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(1024, 1, 1);
      this.proc.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0), this.ctx.sampleRate);
      src.connect(this.proc);
      this.proc.connect(this.ctx.destination); // 출력은 무음
      this.status = 'on';
      this.message = '책상을 탁! 치면 종';
    } catch (e) {
      console.warn('[slap] 책상 종을 켜지 못함', e);
      this.release();
      this.status = 'error';
      this.message = String(e.message).includes('WebGPU') ? '이 컴퓨터는 책상 종 불가 (WebGPU 없음)' : '마이크를 켜지 못했어요';
    }
  },

  stop() {
    this.release();
    this.status = 'off';
    this.message = '';
    this.pending = null;
    this.hit = 0;
  },

  release() {
    if (this.proc) this.proc.disconnect();
    this.proc = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  },

  // 마이크 소리를 16kHz 로 줄여 최근 1초 보관 + '탁' 감지
  onAudio(buf, rate) {
    const ratio = rate / this.SR;
    const n = this.ring.length;
    let pos = this.frac;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    for (; pos + ratio <= buf.length; pos += ratio) {
      let s = 0;
      let c = 0;
      // 이전 버퍼에 걸친 구간(pos < 0)은 이번 버퍼 처음부터만 평균
      for (let j = Math.max(0, pos | 0), e = (pos + ratio) | 0; j < e; j++) {
        s += buf[j];
        c++;
      }
      this.ring[this.w] = c ? s / c : 0;
      this.w = (this.w + 1) % n;
    }
    this.frac = pos - buf.length;

    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    const onset = this.on && rms > this.GATE && rms > this.avg * this.JUMP && now - this.lastOnset > this.REFRACTORY && !this.pending;
    this.avg = this.avg * 0.9 + rms * 0.1;
    if (!onset) return;
    this.lastOnset = now;
    this.pending = { at: now };
    setTimeout(() => this.confirm(), this.WAIT_MS);
  },

  async confirm() {
    const p = this.pending;
    if (!p) return;
    const n = this.ring.length;
    const clip = new Float32Array(n);
    // 아주 작은 잡음을 섞음 — 완전한 무음(0)이 섞이면 모델 값이 NaN 이 되는 경우가 있음
    for (let i = 0; i < n; i++) clip[i] = this.ring[(this.w + i) % n] + (Math.random() - 0.5) * 1e-3;
    try {
      const out = await this.clf(clip, { top_k: 3 });
      const ok = out.some((o) => this.HIT_LABELS.includes(o.label) && o.score >= this.MIN);
      console.info('[slap]', ok ? '탁!' : '아님', out.map((o) => `${o.label} ${o.score.toFixed(2)}`).join(', '));
      if (this.pending === p && ok) this.hit = p.at;
    } catch (e) {
      console.warn('[slap] 판정 실패', e);
    }
    if (this.pending === p) this.pending = null;
  },

  // CPU 종을 잡아 둘까? ('탁' 확인 중)
  holdBots() {
    if (!this.pending) return false;
    if (performance.now() - this.pending.at > this.HOLD_MS) {
      this.pending = null;
      return false;
    }
    return true;
  },

  // 확인된 '탁'을 한 번 가져감 (너무 오래된 건 버림)
  takeHit() {
    const h = this.hit;
    this.hit = 0;
    return h > 0 && performance.now() - h < this.HOLD_MS + 300;
  },
};
