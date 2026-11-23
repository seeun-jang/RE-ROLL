// 총 인식 미니 패널 (DOM) — 게임 화면을 가리지 않는 별도 영역에 카메라 미리보기 + 손 모양 가이드 + 상태
import { HAND_CONNECTIONS } from './GunPose.js';

const STATUS_TEXT = {
  off: ['제스처 꺼짐', 'G 키로 켜기'],
  loading: ['손 인식 모델 로딩 중…', '잠시만 기다려 주세요'],
  camera: ['카메라 켜는 중…', '권한을 허용해 주세요'],
  nohand: ['손을 카메라에 보여주세요', 'ㄱ자 손 또는 양손 총'],
  searching: ['총 모양을 만드세요', '검지 펴고 엄지 세우기 / 양손으로 감싸기'],
  armed: ['조준 중!', '검지(또는 엄지)를 구부리면 발사'],
  fire: ['발사!!', '손가락을 펴면 다시 조준'],
  release: ['손가락을 펴세요', '다시 펴면 재발사 가능'],
  error: ['손 인식을 쓸 수 없습니다', ''],
};

const CSS = `
.pgd-gesture{display:flex;gap:8px;align-items:stretch;font-family:"Galmuri9","Galmuri11",monospace;color:#c0cbdc;background:#181425;
  border:2px solid #3a4466;box-shadow:inset 0 0 0 2px #262b44;padding:6px;image-rendering:pixelated;user-select:none}
.pgd-gesture[data-status="armed"]{border-color:#fee761}
.pgd-gesture[data-status="fire"]{border-color:#ff0044}
.pgd-gesture[data-status="error"]{border-color:#a22633}
.pgd-gesture-cam{width:240px;height:135px;image-rendering:pixelated;background:#262b44;display:block}
.pgd-gesture-side{display:flex;flex-direction:column;gap:4px;width:180px}
.pgd-gesture-title{font-size:11px;color:#fee761;letter-spacing:1px}
.pgd-gesture-icons{width:132px;height:60px;image-rendering:pixelated;display:block}
.pgd-gesture-status{font-size:12px;color:#ffffff;min-height:14px}
.pgd-gesture-sub{font-size:11px;color:#8b9bb4;min-height:28px;line-height:14px}
.pgd-gesture-lane{font-size:11px;color:#2ce8f5}
`;

export class GesturePanel {
  constructor(host, sprites, cfg) {
    this.cfg = cfg;
    this.sprites = sprites;
    if (!document.getElementById('pgd-gesture-style')) {
      const st = document.createElement('style'); st.id = 'pgd-gesture-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'pgd-gesture';
    this.root.innerHTML = `
      <canvas class="pgd-gesture-cam" width="160" height="90"></canvas>
      <div class="pgd-gesture-side">
        <div class="pgd-gesture-title">HAND GUN</div>
        <canvas class="pgd-gesture-icons" width="44" height="20"></canvas>
        <div class="pgd-gesture-status"></div>
        <div class="pgd-gesture-sub"></div>
        <div class="pgd-gesture-lane"></div>
      </div>`;
    host.appendChild(this.root);
    this.cam = this.root.querySelector('.pgd-gesture-cam');
    this.cctx = this.cam.getContext('2d');
    this.cctx.imageSmoothingEnabled = false;
    this.icons = this.root.querySelector('.pgd-gesture-icons');
    this.ictx = this.icons.getContext('2d');
    this.statusEl = this.root.querySelector('.pgd-gesture-status');
    this.subEl = this.root.querySelector('.pgd-gesture-sub');
    this.laneEl = this.root.querySelector('.pgd-gesture-lane');
    this.lastStatus = null;
    this.frame = 0;
  }

  destroy() { this.root.remove(); }

  // 매 프레임: video(또는 null), landmarks, analysis, fsm, status, errorMsg
  render(video, landmarks, analysis, fsm, status, errorMsg) {
    this.frame++;
    const ctx = this.cctx, W = this.cam.width, H = this.cam.height;
    const col = (i) => this.sprites.css(i);
    ctx.fillStyle = col(24); ctx.fillRect(0, 0, W, H);

    // 카메라 미리보기 (거울 모드, 16:9로 세로 크롭)
    let sx = 0, sy = 0, sw = 0, sh = 0;
    if (video && video.videoWidth) {
      sw = video.videoWidth; sh = video.videoHeight;
      const targetH = sw * H / W;
      if (targetH < sh) { sy = (sh - targetH) / 2; sh = targetH; } else { const targetW = sh * W / H; sx = (sw - targetW) / 2; sw = targetW; }
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sw, sh, -W, 0, W, H);
      ctx.restore();
      ctx.fillStyle = 'rgba(24,20,37,0.25)'; ctx.fillRect(0, 0, W, H);
    }
    // 레인 조준 가이드 (손 높이 → 레인). 판정은 원본 프레임의 정규화 y 기준이므로 크롭을 반영해 그린다
    if (this.cfg.laneControl && status !== 'off' && status !== 'error') {
      const vh = sh ? video.videoHeight : 1;
      const toPanelY = (ny) => sh ? ((ny * vh - sy) / sh) * H : ny * H;
      const top = toPanelY(this.cfg.aimTop), bottom = toPanelY(this.cfg.aimBottom);
      for (let i = 0; i <= 5; i++) { const y = Math.round(top + (bottom - top) * i / 5); ctx.fillStyle = 'rgba(192,203,220,0.35)'; ctx.fillRect(0, y, W, 1); }
      if (fsm?.armed && fsm.lane !== null) {
        const y0 = Math.round(top + (bottom - top) * fsm.lane / 5), y1 = Math.round(top + (bottom - top) * (fsm.lane + 1) / 5);
        ctx.fillStyle = 'rgba(254,231,97,0.18)'; ctx.fillRect(0, y0, W, y1 - y0);
      }
    }
    // 랜드마크 (픽셀 점 + 선)
    if (video && landmarks?.length) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const map = (p) => ({ x: Math.round(W - ((p.x * vw - sx) / sw) * W), y: Math.round(((p.y * vh - sy) / sh) * H) });
      landmarks.forEach((lm, hi) => {
        const isGun = analysis && hi === analysis.gunIndex;
        const isSupport = analysis && analysis.supportHand && analysis.hands[hi] === analysis.supportHand;
        let c = col(20);
        if (isGun) c = status === 'fire' ? col(26) : status === 'armed' ? col(11) : status === 'release' ? col(10) : col(19);
        else if (isSupport) c = col(18);
        ctx.fillStyle = c;
        for (const [a, b] of HAND_CONNECTIONS) this.line(ctx, map(lm[a]), map(lm[b]));
        for (let i = 0; i < lm.length; i++) { const p = map(lm[i]); ctx.fillRect(p.x - 1, p.y - 1, 2, 2); }
        if (isGun) { // 검지 끝 강조
          const t = map(lm[8]); ctx.fillStyle = col(19); ctx.fillRect(t.x - 2, t.y - 2, 4, 4);
          const th = map(lm[4]); ctx.fillStyle = col(10); ctx.fillRect(th.x - 1, th.y - 1, 3, 3);
        }
      });
    }
    if (status === 'fire' && this.frame % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, W, H); }
    if (status === 'off' || status === 'error' || status === 'loading' || status === 'camera') {
      ctx.fillStyle = col(23); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = col(21);
      for (let i = 0; i < 6; i++) ctx.fillRect(10 + i * 24, 40 + ((this.frame >> 3) + i) % 2 * 4, 12, 6);
    }

    // 자세 아이콘 (한 손 / 양손) — 현재 인식된 자세는 노란 박스
    const ic = this.ictx; ic.imageSmoothingEnabled = false;
    ic.fillStyle = col(24); ic.fillRect(0, 0, 44, 20);
    const pose = fsm?.armed ? fsm.armedPose : analysis?.pose;
    const drawIcon = (name, x, active) => {
      if (active) { ic.fillStyle = col(11); ic.fillRect(x - 2, 0, 20, 20); ic.fillStyle = col(15); ic.fillRect(x - 1, 1, 18, 18); }
      ic.globalAlpha = active || !fsm?.armed ? 1 : 0.45;
      ic.drawImage(this.sprites.get(name), x, 2);
      ic.globalAlpha = 1;
    };
    drawIcon('pose_one', 2, pose === 'one');
    drawIcon('pose_two', 26, pose === 'two');

    // 텍스트
    if (status !== this.lastStatus) {
      const [a, b] = STATUS_TEXT[status] || STATUS_TEXT.error;
      this.statusEl.textContent = a;
      this.subEl.textContent = status === 'error' ? (errorMsg || b) : b;
      this.root.dataset.status = status;
      this.lastStatus = status;
    }
    this.laneEl.textContent = (fsm?.armed && fsm.lane !== null && this.cfg.laneControl) ? `▶ LANE ${fsm.lane + 1}  (손 높이로 레인 이동)` : ' ';
  }

  line(ctx, a, b) {
    // 브레젠험 직선 (픽셀 느낌 유지)
    let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 400; i++) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}
