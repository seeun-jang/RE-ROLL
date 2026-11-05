// =====================================================
// 리액션 캠 — 스트라이크 · 스페어 · 거터 · 스플릿 순간 웹캠으로 리액션을 찍어 전광판에 띄움
//  - 모델: Hugging Face Xenova/clip-vit-base-patch32 (사진이 '환호 / 좌절 / 덤덤' 문장 중 어디에 가까운지)
//  - 크게 환호하거나 크게 좌절하면 리액션 보너스 +2점 (한 사람당 최대 +10)
//  - WebGPU 가 있어야 켜짐 (CPU 로는 한 번에 1초 넘게 화면이 멈춰서 끔)
//  - 타이틀에서 V 키로 켜고 끔. 카메라/모델이 안 되면 그냥 꺼진 채로 진행
// =====================================================
const ReactionCam = {
  MODEL: 'Xenova/clip-vit-base-patch32',
  BONUS: 2,
  BONUS_MAX: 10,
  MIN_SCORE: 0.5, // 환호/좌절 확률이 이 이상이어야 보너스
  // 리액션 종류 → CLIP 에 물어볼 문장
  KINDS: {
    cheer: { label: '환호!', color: '9', texts: ['a photo of a person cheering with joy', 'a photo of an excited person celebrating with arms up'] },
    sad: { label: '좌절…', color: 'k', texts: ['a photo of a frustrated disappointed person', 'a photo of a person holding their head in despair'] },
    calm: { label: '덤덤', color: 'a', texts: ['a photo of a person with a calm neutral face'] },
  },
  status: 'off', // off | loading | on | error
  message: '',
  video: null,
  stream: null,
  clf: null,

  get on() {
    return this.status === 'on';
  },

  toggle() {
    if (this.status === 'on' || this.status === 'loading') this.stop();
    else this.start();
  },

  async start() {
    this.status = 'loading';
    this.message = '리액션 캠 준비 중…';
    try {
      if (!navigator.gpu) throw new Error('WebGPU 없음');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.clf) {
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        env.allowLocalModels = location.protocol !== 'file:';
        env.localModelPath = new URL('./models/', location.href).href;
        // q8 압축본은 판정이 엉망이라 fp32 + WebGPU
        this.clf = await pipeline('zero-shot-image-classification', this.MODEL, { dtype: 'fp32', device: 'webgpu' });
      }
      if (this.status !== 'loading') return; // 준비 중에 꺼짐
      this.status = 'on';
      this.message = '리액션 캠 켜짐! 크게 리액션하면 +2점';
    } catch (e) {
      console.warn('[reaction] 리액션 캠을 켜지 못함', e);
      this.releaseCamera();
      this.status = 'error';
      this.message = String(e.message).includes('WebGPU') ? '이 컴퓨터는 리액션 캠 불가 (WebGPU 없음)' : '카메라를 켜지 못했어요';
    }
  },

  stop() {
    this.releaseCamera();
    this.status = 'off';
    this.message = '';
  },

  releaseCamera() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
  },

  // 지금 장면을 찍어 리액션 판정 → { kind, label, color, score, img(56x42 픽셀 사진) } 또는 null
  async snap() {
    if (!this.on || !this.video) return null;
    const v = this.video;
    const big = document.createElement('canvas');
    big.width = 320;
    big.height = 240;
    const bg = big.getContext('2d');
    bg.translate(320, 0); // 거울처럼
    bg.scale(-1, 1);
    bg.drawImage(v, 0, 0, 320, 240);
    // 전광판용 작은 픽셀 사진
    const img = document.createElement('canvas');
    img.width = 56;
    img.height = 42;
    const ig = img.getContext('2d');
    ig.imageSmoothingEnabled = true;
    ig.drawImage(big, 0, 0, 56, 42);

    const kinds = Object.entries(this.KINDS);
    const out = await this.clf(big.toDataURL('image/jpeg', 0.85), kinds.flatMap(([, k]) => k.texts));
    const prob = Object.fromEntries(out.map((o) => [o.label, o.score]));
    // 종류별로 문장 확률을 합침
    let best = null;
    for (const [kind, k] of kinds) {
      const score = k.texts.reduce((s, t) => s + (prob[t] || 0), 0);
      if (!best || score > best.score) best = { kind, label: k.label, color: k.color, score };
    }
    console.info('[reaction]', best.kind, best.score.toFixed(2));
    return { ...best, img };
  },
};
