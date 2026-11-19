// 총 모양 손 판정 — MediaPipe 21개 랜드마크로 순수 계산 (손등/손바닥 어느 쪽이든 동일하게 동작)
//
// 인식하는 모양
//   1) 한 손 ㄱ자: 검지 펴짐 + 엄지 펴짐(검지와 55~140도) + 중지·약지·새끼 구부림
//   2) 양손 총: 검지 펴진 손(총 손) + 그 손목/검지 뿌리 근처를 감싼 다른 손(받침손)
// 방아쇠(발사)
//   - 검지를 구부림 (끝↔손목 / 둘째마디↔손목 거리 비율이 작아짐; z를 포함해 카메라를 향해도 안정적)
//   - 한 손 ㄱ자에서 세웠던 엄지를 내림(망치) — 검지는 편 채
//
// 랜드마크 번호: 0 손목, 1~4 엄지(CMC,MCP,IP,TIP), 5~8 검지(MCP,PIP,DIP,TIP), 9~12 중지, 13~16 약지, 17~20 새끼
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function analyzeHand(lm, aspect, cfg) {
  // 정규화 좌표의 가로세로 비율 보정. z는 x와 비슷한 스케일(손목 기준 깊이)이라 그대로 쓴다.
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y, z: (lm[i].z || 0) * aspect });
  const wrist = P(0);
  const handSize = dist2(wrist, P(9)) || 1e-6;
  // 손가락 펴짐 비율: 끝↔손목 / 둘째마디(PIP)↔손목 (3D). 곧게 펴면 ~1.3, 방아쇠처럼 90도 굽히면 ~1.05, 꽉 쥐면 ~0.8
  const ext = (tip, pip) => dist3(P(tip), wrist) / (dist3(P(pip), wrist) || 1e-6);
  const index = ext(8, 6), middle = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
  const indexExt = index > cfg.extendedRatio;
  const indexCurl = index < cfg.curledRatio;
  const curled = (v) => v < cfg.curledRatio + 0.08; // 나머지 손가락은 조금 관대하게
  const othersCurled = curled(middle) && curled(ring) && curled(pinky);
  // 엄지: 검지 방향과의 각도 + 검지 뿌리에서 떨어진 정도
  const thumbVec = { x: P(4).x - P(2).x, y: P(4).y - P(2).y };
  const indexVec = { x: P(8).x - P(5).x, y: P(8).y - P(5).y };
  const dot = thumbVec.x * indexVec.x + thumbVec.y * indexVec.y;
  const mag = (Math.hypot(thumbVec.x, thumbVec.y) * Math.hypot(indexVec.x, indexVec.y)) || 1e-6;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
  const thumbLen = dist2(P(4), P(5)) / handSize;
  const thumbUp = thumbLen > cfg.thumbMinLen && angle > cfg.thumbMinAngle && angle < cfg.thumbMaxAngle;
  // 엄지 내림(망치): 엄지 끝이 검지 둘째마디 쪽에 붙고 각도도 작다 — thumbUp과 겹치지 않도록 각도 조건 포함
  const thumbNear = Math.min(dist2(P(4), P(6)), dist2(P(4), P(7))) / handSize;
  const thumbDown = thumbNear < cfg.thumbDownDist && angle < cfg.thumbMinAngle - 10;
  const palmCenter = avg([P(0), P(5), P(9), P(13), P(17)]);
  return {
    index, middle, ring, pinky, angle, thumbLen, thumbUp, thumbDown, indexExt, indexCurl, othersCurled,
    pointing: indexExt && othersCurled,              // 검지만 편 상태 (총 손 후보)
    loose: (indexExt || indexCurl) && othersCurled,  // 방아쇠 동작 중에도 총 손으로 인정
    gunOne: indexExt && othersCurled && thumbUp,      // 한 손 ㄱ자 완성
    palmCenter, wrist, handSize, indexMcp: P(5), aimY: lm[5].y, raw: lm,
  };
}

function avg(pts) { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; }

// 여러 손 → 자세 판정. prevWrist: 직전 총 손의 손목(후보가 여럿일 때 같은 손을 유지)
// 반환 { pose: 'none'|'one'|'two', gunHand, supportHand, hands, gunIndex }
export function analyzeHands(landmarksList, aspect, cfg, prevWrist = null) {
  const hands = landmarksList.map((lm) => analyzeHand(lm, aspect, cfg));
  const pick = (pred) => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < hands.length; i++) {
      if (!pred(hands[i])) continue;
      const d = prevWrist ? dist2(hands[i].wrist, prevWrist) : i; // 직전 손과 가까운 쪽 우선
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  let gi = pick((h) => h.gunOne);
  if (gi < 0) gi = pick((h) => h.pointing);
  if (gi < 0) gi = pick((h) => h.loose);
  if (gi < 0) return { pose: 'none', gunHand: null, supportHand: null, hands, gunIndex: -1 };
  const g = hands[gi];
  let support = null;
  for (let i = 0; i < hands.length; i++) {
    if (i === gi) continue;
    const o = hands[i];
    const d1 = dist2(o.palmCenter, g.wrist) / g.handSize;
    const d2 = dist2(o.palmCenter, g.indexMcp) / g.handSize;
    const d3 = dist2(o.wrist, g.wrist) / g.handSize;
    if (Math.min(d1, d2, d3) < cfg.supportDist) { support = o; break; }
  }
  let pose = 'none';
  if (support && (g.pointing || g.loose)) pose = 'two';
  else if (g.gunOne) pose = 'one';
  return { pose, gunHand: g, supportHand: support, hands, gunIndex: gi };
}

// 총 모양 → 조준/발사 상태 기계 (프레임 수 기반 디바운스 + 유예 시간)
export class GunTriggerFSM {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.armed = false; this.firing = false; this.pose = 'none'; this.armedPose = 'none';
    this.poseFrames = 0; this.pullFrames = 0; this.grace = 0; this.pullTime = 0; this.needRelease = false;
    this.lane = null; this.laneChanged = false; this.justFired = false; this.justArmed = false;
    this.aimSmooth = null; this.handPresent = false; this.pulled = false; this.thumbWasUp = false;
    this.prevWrist = null;
  }

  // analysis: analyzeHands 결과, dt: 지난 프레임과의 시간(초)
  update(analysis, dt) {
    const cfg = this.cfg;
    this.justFired = false; this.justArmed = false;
    this.handPresent = analysis.hands.length > 0;
    const g = analysis.gunHand;
    const poseNow = analysis.pose;
    this.pose = poseNow;
    if (g) this.prevWrist = g.wrist;

    // 조준 진입: 총 모양이 연속 N프레임 (검지는 펴진 상태)
    if (poseNow !== 'none' && g && g.indexExt) {
      this.poseFrames++;
      if (this.poseFrames >= cfg.armFrames) {
        if (!this.armed) { this.armed = true; this.justArmed = true; }
        this.armedPose = poseNow;
        this.grace = cfg.graceTime;
        if (g.thumbUp) this.thumbWasUp = true;
        this.needRelease = false;
      }
    } else this.poseFrames = 0;

    if (this.armed) {
      let pulled = false;
      if (g) {
        // 방아쇠: 검지 구부림, 또는 (한 손 ㄱ자) 세웠던 엄지를 내림
        const hammer = this.armedPose === 'one' && this.thumbWasUp && g.thumbDown && g.indexExt;
        pulled = (g.indexCurl || hammer) && !this.needRelease;
        if (poseNow !== 'none' && g.indexExt && !g.thumbDown) { this.grace = cfg.graceTime; this.needRelease = false; }
      }
      this.pulled = pulled;
      if (pulled) { this.pullFrames++; this.pullTime += dt; } else { this.pullFrames = 0; this.pullTime = 0; }
      // 주먹을 쥔 채 계속 발사되는 것을 막는다: 일정 시간 이상 당기면 손가락을 다시 펴야 한다
      if (this.pullTime > cfg.maxPullTime) { this.needRelease = true; pulled = false; this.pulled = false; this.pullFrames = 0; this.pullTime = 0; }
      const wasFiring = this.firing;
      this.firing = this.pullFrames >= cfg.pullFrames;
      if (this.firing) this.grace = cfg.graceTime;
      if (this.firing && !wasFiring) this.justFired = true;
      // 손을 잃거나 모양이 풀리면 유예 후 해제
      if (!g || (!pulled && poseNow === 'none')) {
        this.grace -= dt;
        if (this.grace <= 0) { this.armed = false; this.firing = false; this.pullFrames = 0; this.armedPose = 'none'; this.thumbWasUp = false; this.needRelease = false; }
      }
      // 손 높이 → 레인 (히스테리시스 + 지수 평활)
      if (g && cfg.laneControl) {
        const y = g.aimY;
        this.aimSmooth = this.aimSmooth === null ? y : this.aimSmooth + (y - this.aimSmooth) * 0.45;
        const range = cfg.aimBottom - cfg.aimTop;
        const v = (this.aimSmooth - cfg.aimTop) / range * 5;   // 0..5 연속 값
        const hyst = cfg.aimHysteresis / range * 5;
        let lane = this.lane;
        if (lane === null) lane = Math.max(0, Math.min(4, Math.floor(v)));
        else if (v < lane - hyst) lane = Math.max(0, Math.floor(v));
        else if (v >= lane + 1 + hyst) lane = Math.min(4, Math.floor(v));
        if (lane !== this.lane) { this.lane = lane; this.laneChanged = true; }
      }
    } else {
      this.firing = false; this.pullFrames = 0; this.pulled = false; this.pullTime = 0;
    }
    return this;
  }

  get status() {
    if (!this.handPresent) return 'nohand';
    if (!this.armed) return 'searching';
    if (this.needRelease) return 'release';
    return this.firing ? 'fire' : 'armed';
  }
}
