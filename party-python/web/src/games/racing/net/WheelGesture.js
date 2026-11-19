// =============================================================
// WheelGesture — 카메라 앞에서 두 손을 "핸들" 처럼 들고 조종한다
//
//   조향   두 손을 잇는 선이 기울어진 만큼 (오른손을 내리면 오른쪽으로)
//   가속   두 손을 카메라 쪽으로 밀면(손이 크게 보이면) 가속, 뒤로 당기면(작게 보이면) 감속·후진
//   드리프트  핸들을 끝까지 꺾으면 미끄러진다
//
// "손 크기의 기준" 은 처음 두 손이 보였을 때 잠깐 재서 정한다(R 키로 다시 잴 수 있다).
// 손 추적은 공용 HandTracker(MediaPipe)를 쓴다. 카메라가 없으면 status 가 'error' 가 된다.
// =============================================================
import { HandTracker } from '../../../shared/HandTracker.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const GESTURE = {
  STEER_FULL: 0.8,       // 기울기(세로 차이 ÷ 가로 차이)가 이만큼이면 끝까지 꺾은 것
  PUSH_START: 1.10,      // 손 크기가 기준의 이 배율을 넘으면 가속 시작
  PUSH_FULL: 1.30,       // 이 배율이면 가속 최대
  PULL_START: 0.93,      // 이 배율보다 작아지면 감속 시작
  PULL_FULL: 0.80,       // 이 배율이면 감속 최대
  DRIFT_START: 0.8,      // 조향이 이보다 크면 드리프트 시작
  SMOOTH: 0.35,          // 값이 튀지 않게 섞는 비율
  CALIBRATE_FRAMES: 25,  // 기준을 잡을 때 쓰는 프레임 수
  LOST_MS: 500,          // 손이 이만큼 안 보이면 손을 뗀 것으로 본다
};

export class WheelGesture {
  constructor(host) {
    this.status = 'off';      // off | loading | camera | ready | error
    this.message = '';
    this.steer = 0;
    this.throttle = 0;
    this.drift = 0;
    this.hands = 0;
    this.base = null;         // 손 크기 기준
    this.samples = [];
    this.invert = false;
    this.lastSeen = 0;
    this.tracker = null;
    this.video = null;
    this.landmarks = [];

    this.root = document.createElement('div');
    this.root.className = 'rc-cam';
    this.cv = document.createElement('canvas');
    this.cv.width = 96;
    this.cv.height = 54;
    this.label = document.createElement('span');
    this.root.appendChild(this.cv);
    this.root.appendChild(this.label);
    host.appendChild(this.root);
    this.g = this.cv.getContext('2d');
    this.g.imageSmoothingEnabled = false;
  }

  /** 손으로 조종할 수 있는 상태인가 (카메라가 켜졌는가) */
  get usable() {
    return this.status === 'ready';
  }

  /** 카메라를 쓸 수 없어 키보드로 넘어가야 하는가 */
  get failed() {
    return this.status === 'error' || this.status === 'off';
  }

  get calibrated() {
    return this.base !== null;
  }

  start() {
    if (this.tracker) return;
    this.status = 'loading';
    const tracker = new HandTracker({
      numHands: 2,
      onResult: (lms, video) => { if (this.tracker === tracker) this.onResult(lms, video); },
      onStatus: (s, msg) => {
        if (this.tracker !== tracker) return;
        if (s === 'running') this.status = 'ready';
        else if (s === 'error') this.fail(msg);
        else this.status = s;
      },
    });
    this.tracker = tracker;
    tracker.start().catch((e) => {
      console.warn('[WheelGesture]', e);
      tracker.stop();
      if (this.tracker === tracker) this.fail(e.message || String(e));
    });
  }

  fail(message) {
    this.status = 'error';
    this.message = message || '';
    this.tracker = null;
    this.steer = 0;
    this.throttle = 0;
    this.drift = 0;
  }

  recalibrate() {
    this.base = null;
    this.samples = [];
  }

  onResult(landmarks, video) {
    this.video = video;
    this.landmarks = landmarks;
    this.hands = landmarks.length;
    const G = GESTURE;
    if (landmarks.length < 2) return;
    this.lastSeen = performance.now();
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    // 영상의 왼쪽에 보이는 손 = 사용자의 오른손 (카메라 영상은 거울상이 아니다)
    const [a, b] = landmarks[0][0].x < landmarks[1][0].x ? [landmarks[0], landmarks[1]] : [landmarks[1], landmarks[0]];
    const dx = Math.max(0.05, (b[0].x - a[0].x) * aspect);
    let steer = clamp((a[0].y - b[0].y) / dx / G.STEER_FULL, -1, 1);    // 오른손이 내려가면 +(오른쪽)
    if (this.invert) steer = -steer;

    // 손 크기 = 손목 ~ 가운뎃손가락 뿌리 거리 (두 손 평균)
    const sizeOf = (lm) => Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y);
    const size = (sizeOf(a) + sizeOf(b)) / 2;
    if (this.base === null) {
      this.samples.push(size);
      if (this.samples.length >= G.CALIBRATE_FRAMES) {
        const sorted = this.samples.slice().sort((p, q) => p - q);
        this.base = sorted[Math.floor(sorted.length / 2)];
      }
    }
    let throttle = 0;
    if (this.base !== null) {
      const ratio = size / this.base;
      if (ratio >= G.PUSH_START) throttle = clamp((ratio - G.PUSH_START) / (G.PUSH_FULL - G.PUSH_START), 0, 1);
      else if (ratio <= G.PULL_START) throttle = -clamp((G.PULL_START - ratio) / (G.PULL_START - G.PULL_FULL), 0, 1);
    }
    const mag = Math.abs(steer);
    const drift = mag > G.DRIFT_START ? clamp((mag - G.DRIFT_START) / (1 - G.DRIFT_START), 0, 1) : 0;
    this.steer += (steer - this.steer) * G.SMOOTH;
    this.throttle += (throttle - this.throttle) * G.SMOOTH;
    this.drift += (drift - this.drift) * G.SMOOTH;
  }

  /** 매 프레임: 손이 안 보이면 손을 뗀 것으로 보고, 미리보기를 그린다 */
  update() {
    if (this.usable && performance.now() - this.lastSeen > GESTURE.LOST_MS) {
      this.steer *= 0.8;
      this.throttle *= 0.8;
      this.drift = 0;
    }
    const g = this.g;
    const W = this.cv.width;
    const H = this.cv.height;
    g.fillStyle = '#262b44';
    g.fillRect(0, 0, W, H);
    const show = this.usable ? '' : 'none';
    if (this.cv.style.display !== show) this.cv.style.display = show;
    if (this.usable && this.video && this.video.readyState >= 2) {
      g.save();
      g.translate(W, 0);
      g.scale(-1, 1);                       // 거울처럼 보이게
      g.drawImage(this.video, 0, 0, W, H);
      g.restore();
      const pt = (p) => [(1 - p.x) * W, p.y * H];
      if (this.landmarks.length >= 2) {
        const [x0, y0] = pt(this.landmarks[0][0]);
        const [x1, y1] = pt(this.landmarks[1][0]);
        g.strokeStyle = this.calibrated ? '#fee761' : '#8b9bb4';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.fillStyle = '#2ce8f5';
      for (const lm of this.landmarks) {
        const [x, y] = pt(lm[0]);
        g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
      }
      // 가속 게이지(오른쪽 세로 막대)
      g.fillStyle = '#181425';
      g.fillRect(W - 5, 2, 3, H - 4);
      const mid = H / 2;
      g.fillStyle = this.throttle >= 0 ? '#63c74d' : '#e43b44';
      const len = Math.round(Math.abs(this.throttle) * (H / 2 - 2));
      g.fillRect(W - 5, this.throttle >= 0 ? mid - len : mid, 3, len);
    }
    let text;
    if (this.status === 'loading') text = '손 인식 준비 중…';
    else if (this.status === 'camera') text = '카메라 켜는 중… (권한 허용)';
    else if (this.status === 'error') text = '카메라를 쓸 수 없어 키보드로 조종합니다';
    else if (this.status === 'off') text = '';
    else if (this.hands < 2) text = '두 손을 핸들처럼 들어 주세요';
    else if (!this.calibrated) text = '기준 잡는 중… 편한 자리에 두세요';
    else text = this.throttle > 0.1 ? '가속!' : this.throttle < -0.1 ? '감속' : '앞으로 밀면 가속';
    if (this.label.textContent !== text) this.label.textContent = text;
  }

  destroy() {
    if (this.tracker) this.tracker.stop();
    this.tracker = null;
    this.status = 'off';
    this.root.remove();
  }
}
