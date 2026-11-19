// 제스처 시스템 파사드 — 추적기 + 판정 상태 기계 + 패널을 묶고, 게임에는 pollActions()로 액션을 준다.
import { HandTracker } from '../../../shared/HandTracker.js';
import { GesturePanel } from './GesturePanel.js';
import { analyzeHands, GunTriggerFSM } from './GunPose.js';

export class GunGesture {
  constructor({ cfg, host, sprites, audio }) {
    this.cfg = cfg;
    this.audio = audio;
    this.panel = new GesturePanel(host, sprites, cfg);
    this.fsm = new GunTriggerFSM(cfg);
    this.tracker = null;
    this.status = 'off';
    this.errorMsg = '';
    this.landmarks = [];
    this.analysis = null;
    this.video = null;
    this.active = true;
    this.lastResultAt = 0;
    this.pendingLane = null;
    this.justFired = false;
    this.crop = { sy: 0, sh: 1, vh: 1 }; // 패널 크롭 정보 (레인 가이드 일치용)
  }

  get state() {
    return { status: this.status, armed: this.fsm.armed, firing: this.fsm.firing, lane: this.fsm.lane, pose: this.fsm.armed ? this.fsm.armedPose : this.fsm.pose };
  }

  start() {
    if (this.tracker) return;
    this.status = 'loading';
    this.errorMsg = '';
    const tracker = new HandTracker({
      numHands: this.cfg.numHands,
      onResult: (lms, video) => { if (this.tracker === tracker) this.onResult(lms, video); },
      onStatus: (s, msg) => {
        if (this.tracker !== tracker) return;
        if (s === 'running') this.status = 'nohand';
        else if (s === 'error') { this.status = 'error'; this.errorMsg = msg || ''; this.tracker = null; this.resetState(); }
        else this.status = s;
      },
    });
    this.tracker = tracker;
    tracker.start().catch((e) => {
      console.warn('[GunGesture]', e);
      tracker.stop();
      if (this.tracker !== tracker) return; // 그 사이 stop()됨
      this.status = 'error';
      this.errorMsg = e.message || String(e);
      this.tracker = null;
    });
  }

  stop() {
    if (this.tracker) { this.tracker.stop(); this.tracker = null; }
    this.status = 'off';
    this.resetState();
    this.landmarks = []; this.analysis = null; this.video = null;
  }

  setActive(on) { this.active = on; if (!on) this.resetState(); }
  resetState() { this.fsm.reset(); this.pendingLane = null; this.justFired = false; }

  onResult(landmarks, video) {
    const now = performance.now();
    const dt = this.lastResultAt ? Math.min(0.1, (now - this.lastResultAt) / 1000) : 1 / 30;
    this.lastResultAt = now;
    this.landmarks = landmarks;
    this.video = video;
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    this.analysis = analyzeHands(landmarks, aspect, this.cfg, this.fsm.prevWrist);
    if (!this.active) { this.status = landmarks.length ? 'searching' : 'nohand'; return; } // 일시정지 중엔 판정하지 않는다
    const f = this.fsm.update(this.analysis, dt);
    if (f.justArmed) this.audio?.play('gestureArm');
    if (f.justFired) this.justFired = true;
    if (f.laneChanged) { this.pendingLane = f.lane; f.laneChanged = false; }
    this.status = f.status;
  }

  // 게임 루프에서 매 틱 호출: 추적이 멈추면 조준 해제
  update(dt) {
    if (this.tracker && this.lastResultAt && performance.now() - this.lastResultAt > 600 && this.fsm.armed) {
      this.resetState();
      this.status = 'nohand';
    }
  }

  // 컨트롤러가 읽는 1회성 액션
  pollActions() {
    if (!this.active || !this.tracker) { this.pendingLane = null; this.justFired = false; return null; }
    const a = { firing: this.fsm.firing, laneSet: this.pendingLane, laneChanged: this.pendingLane !== null, lane: this.pendingLane, justFired: this.justFired, armed: this.fsm.armed };
    this.pendingLane = null;
    this.justFired = false;
    return a;
  }

  render() {
    this.panel.render(this.video, this.landmarks, this.analysis, this.fsm, this.status, this.errorMsg);
  }

  destroy() { this.stop(); this.panel.destroy(); }
}
