// =============================================================
// HandTracker — 웹캠 + MediaPipe Hand Landmarker 로 손 관절 위치를 추적한다 (카메라 게임 공용)
//
//   const tracker = new HandTracker({ numHands: 2, onResult(landmarks, video) {}, onStatus(status, message) {} });
//   await tracker.start();   // 실패하면 예외(메시지는 한글) — 게임은 키보드·마우스로 계속하면 된다
//   tracker.stop();
//
// - 손 인식은 각자의 브라우저에서 돈다. 카메라 영상은 서버로 보내지 않는다.
// - 엔진(wasm)은 서버가 내려주는 /mediapipe/wasm (npm run build 때 복사됨),
//   모델은 /models/hand_landmarker.task 가 있으면 그것을, 없으면 Google 저장소에서 받는다.
// - start() 는 여러 await 사이에 stop() 이 끼어들 수 있으므로 세대(generation) 번호로 취소를 확인한다.
// - 카메라는 localhost 또는 https 주소에서만 켜진다.
// =============================================================

const WASM_PATH = './mediapipe/wasm';
const MODEL_URLS = [
  './models/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];

async function localFileExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    return r.ok && !type.includes('text/html');   // 개발 서버가 대신 돌려주는 index.html 은 제외
  } catch {
    return false;
  }
}

export class HandTracker {
  constructor({ numHands = 2, onResult, onStatus } = {}) {
    this.numHands = numHands;
    this.onResult = onResult || (() => {});
    this.onStatus = onStatus || (() => {});
    this.landmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.raf = 0;
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.gen = 0;
  }

  async createLandmarker() {
    let mod;
    try {
      mod = await import('@mediapipe/tasks-vision');
    } catch (e) {
      throw new Error('손 인식 라이브러리를 불러올 수 없습니다');
    }
    const V = mod.HandLandmarker && mod.FilesetResolver ? mod : mod.default || mod;
    const fileset = await V.FilesetResolver.forVisionTasks(new URL(WASM_PATH, location.href).href);
    let lastErr = null;
    for (const url of MODEL_URLS) {
      const full = new URL(url, location.href).href;
      if (full.startsWith(location.origin) && !(await localFileExists(full))) continue;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          return await V.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: full, delegate },
            runningMode: 'VIDEO',
            numHands: this.numHands,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (err) {
          lastErr = err;
        }
      }
    }
    console.warn('[HandTracker]', lastErr);
    throw new Error('손 인식 모델을 불러올 수 없습니다 (인터넷 연결 확인)');
  }

  async start() {
    const gen = ++this.gen;
    const dead = () => this.gen !== gen;
    this.onStatus('loading');
    const lm = await this.createLandmarker();
    if (dead()) {
      try { lm.close(); } catch (_) { /* 무시 */ }
      return;
    }
    this.landmarker = lm;

    this.onStatus('camera');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 주소에서는 카메라를 쓸 수 없습니다 (localhost 또는 https 필요)');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('카메라 권한이 거부되었습니다');
      if (e.name === 'NotFoundError') throw new Error('카메라를 찾을 수 없습니다');
      throw new Error(`카메라를 열 수 없습니다: ${e.message}`);
    }
    if (dead()) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.stream = stream;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    this.video = video;
    await video.play();
    if (dead()) {
      this.releaseMedia();
      return;
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (!dead()) {
        this.stop();
        this.onStatus('error', '카메라 연결이 끊어졌습니다');
      }
    });
    this.running = true;
    this.onStatus('running');
    this.loop();
  }

  loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const v = this.video;
    if (!v || v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const ts = Math.max(performance.now(), this.lastTs + 1);   // 단조 증가 타임스탬프 필수
    this.lastTs = ts;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, ts);
    } catch (e) {
      console.warn('[HandTracker] detect 실패', e);
      return;
    }
    this.onResult(res?.landmarks || [], v);
  }

  releaseMedia() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }

  stop() {
    this.gen++;                 // 진행 중인 start() 를 취소
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.releaseMedia();
    if (this.landmarker) {
      try { this.landmarker.close(); } catch (_) { /* 무시 */ }
      this.landmarker = null;
    }
  }
}
