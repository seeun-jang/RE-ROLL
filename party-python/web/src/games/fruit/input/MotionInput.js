// ============================================================
//  모션 인식 입력 — 웹캠 + MediaPipe Hand Landmarker
//  검지 손가락 끝을 따라 커서가 움직이고, 손을 빠르게 휘두르면 칼날이 활성화된다.
// ============================================================
import { MOTION, VIEW } from '../config.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class MotionInput {
  constructor(manager) {
    this.manager = manager;
    this.status = 'off'; // off | loading | ready | error
    this.message = '';
    this.onStatus = null;
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.running = false;
    this.rafId = 0;
    this.lastVideoTime = -1;
    this.stroke = 0;
    this.lastSeen = 0;
    this.lastT = 0;
    this.inactiveFor = 0;
    this.cursor = { x: VIEW.W / 2, y: VIEW.H / 2, visible: false, active: false, source: 'motion' };
    this.loop = this.loop.bind(this);
  }

  setStatus(status, message) {
    this.status = status;
    this.message = message;
    this.onStatus?.(status, message);
  }

  async start(video) {
    if (this.running || this.status === 'loading') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', '이 브라우저는 카메라를 지원하지 않아요');
      return;
    }
    this.setStatus('loading', '모션 인식 준비 중...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: MOTION.VIDEO_W }, height: { ideal: MOTION.VIDEO_H }, facingMode: 'user' },
        audio: false,
      });
      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (!this.landmarker) this.landmarker = await this.createLandmarker();
      this.video = video;
      this.running = true;
      this.lastVideoTime = -1;
      this.setStatus('ready', '손을 카메라에 보여주세요');
      this.rafId = requestAnimationFrame(this.loop);
    } catch (err) {
      console.error('[motion]', err);
      this.releaseCamera(video);
      const msg =
        err?.name === 'NotAllowedError' ? '카메라 권한이 거부됐어요'
          : err?.name === 'NotFoundError' ? '카메라를 찾을 수 없어요'
            : '모션 인식을 켜지 못했어요';
      this.setStatus('error', msg);
    }
  }

  // MediaPipe 는 무거우므로 모션 모드를 켤 때만 불러온다 (지연 로딩)
  async createLandmarker() {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(new URL(MOTION.WASM_PATH, location.href).href);
    let lastErr = null;
    for (const url of MOTION.MODEL_URLS) {
      const full = new URL(url, location.href).href;
      if (full.startsWith(location.origin) && !(await this.localModelExists(full))) continue;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          return await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: full, delegate },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch (err) {
          lastErr = err;
        }
      }
    }
    throw lastErr ?? new Error('손 인식 모델을 불러오지 못했습니다');
  }

  async localModelExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      const type = r.headers.get('content-type') || '';
      return r.ok && !type.includes('text/html'); // 개발 서버의 index.html 대체 응답 제외
    } catch {
      return false;
    }
  }

  loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    const v = this.video;
    const now = performance.now();
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      try {
        this.handle(this.landmarker.detectForVideo(v, now), now / 1000);
      } catch (err) {
        console.warn('[motion] detect 실패', err);
      }
    }
    if (now / 1000 - this.lastSeen > MOTION.LOST_TIMEOUT) {
      this.cursor.visible = false;
      this.cursor.active = false;
    }
  }

  handle(result, now) {
    const hand = result?.landmarks?.[0];
    if (!hand) return;
    const tip = hand[MOTION.INDEX_TIP];
    // 거울 모드(좌우 반전) + 가장자리 여백 잘라내기
    const m = MOTION.MARGIN;
    const tx = clamp01((1 - tip.x - m) / (1 - 2 * m)) * VIEW.W;
    const ty = clamp01((tip.y - m) / (1 - 2 * m)) * VIEW.H;
    const c = this.cursor;
    const wasVisible = c.visible;
    const px = c.x;
    const py = c.y;
    if (!wasVisible) {
      c.x = tx;
      c.y = ty;
    } else {
      // 지수 이동 평균으로 손떨림 보정
      c.x += (tx - c.x) * MOTION.SMOOTHING;
      c.y += (ty - c.y) * MOTION.SMOOTHING;
    }
    const dt = Math.max(1 / 120, now - this.lastT);
    const speed = wasVisible ? Math.hypot(c.x - px, c.y - py) / dt : 0;
    this.lastT = now;
    this.lastSeen = now;
    c.visible = true;

    // 속도 히스테리시스: 빠르면 켜고, 일정 시간 느리면 끔
    if (!c.active && speed > MOTION.ACTIVE_SPEED) {
      c.active = true;
      this.stroke++;
      this.inactiveFor = 0;
      // 휘두르기 시작점도 궤적에 넣는다
      this.manager.push({ x: px, y: py, t: now - dt, stroke: `h${this.stroke}`, source: 'motion' });
    } else if (c.active && speed < MOTION.INACTIVE_SPEED) {
      this.inactiveFor += dt;
      if (this.inactiveFor > MOTION.INACTIVE_HOLD) c.active = false;
    } else {
      this.inactiveFor = 0;
    }
    if (c.active) {
      this.manager.push({ x: c.x, y: c.y, t: now, stroke: `h${this.stroke}`, source: 'motion' });
    }
  }

  releaseCamera(video) {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (video) video.srcObject = null;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.releaseCamera(this.video);
    this.video = null;
    this.cursor.visible = false;
    this.cursor.active = false;
    this.setStatus('off', '');
  }
}
