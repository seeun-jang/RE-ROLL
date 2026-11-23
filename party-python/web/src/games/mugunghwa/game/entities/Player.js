// ============================================================
// Player.js — 플레이어(아이 캐릭터) 1명
//
// 키를 누르고 있으면 가속, 떼면 감속 → 바로 멈추지 못하는 "관성" 손맛.
// 거리는 미터 단위(dist)로 저장하고, 화면 좌표 변환은 Stage 가 담당한다.
//
// (멀티플레이) 이동·탈락·도착 판정은 서버가 한다. 여기서는 서버가 알려 준 거리·속도를
// 받아(applyNet) 그리기와 동작만 맡는다. 캐릭터는 공용 동물 그림을 쓴다.
// ============================================================

import { MOVE, TRACK, FX } from '../../config.js';
import { spriteFeet, shadow, rect } from '../../engine/Draw.js';
import { C, isLight } from '../../assets/palette.js';

export class Player {
  /**
   * @param {{id,name,color,shade,key}} info  외부에서 주입받는 플레이어 정보
   * @param {number} lane     레인 번호 (0부터)
   * @param {number} laneCount
   */
  constructor(info, lane, laneCount, assets) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.shade = info.shade;
    this.isMe = !!info.isMe;
    this.lane = lane;
    this.laneCount = laneCount;
    this.frames = assets.getAnimalFrames(info.lookId);
    this.labelText = isLight(this.color) ? C.ink : C.white;
    this.reset();
  }

  reset() {
    this.dist = 0;           // 전진 거리 (m)
    this.speed = 0;          // 현재 속도 (m/s)
    this.alive = true;
    this.finished = false;
    this.finishRank = 0;
    this.finishTimeLeft = 0;
    this.elimDist = 0;
    this.ready = false;
    this.anim = 'idle';
    this.animT = 0;
    this.runPhase = 0;
    this.dustT = 0;
    this.squash = 0;         // +: 납작(스쿼시), -: 길쭉(스트레치)
    this.blink = 0;
    this.elimT = 0;
    this.bubble = null;      // { text, t }
    this.hop = 0;
    this.wasMoving = false;
  }

  get eliminated() { return !this.alive; }
  get done() { return this.finished || !this.alive; }
  get progress() { return Math.min(1, this.dist / TRACK.METERS); }
  get isMoving() { return this.speed > MOVE.MOVING_THRESHOLD; }

  /** 서버 상태 반영 */
  applyNet(r) {
    this.dist = r.alive ? r.dist : r.elimDist;
    this.speed = r.speed;
    if (!r.alive && this.alive) this.eliminate();
    if (r.finished && !this.finished) this.finish(1, 0);
  }

  // ------------------------------------------------------------
  // 갱신 (동작·연출만. 위치는 서버 값 사이를 속도로 이어 그린다)
  // ------------------------------------------------------------
  update(dt, { taggerFacing }, particles, stage) {
    this.animT += dt;
    if (this.bubble) { this.bubble.t -= dt; if (this.bubble.t <= 0) this.bubble = null; }
    if (this.blink > 0) this.blink -= dt;
    this.squash *= Math.pow(0.0005, dt); // 스쿼시는 빠르게 원래대로

    if (!this.alive) { this.elimT += dt; this.anim = 'out'; return null; }
    if (this.finished) { this.anim = 'cheer'; this.hop += dt; return null; }

    this.dist = Math.min(TRACK.METERS, this.dist + this.speed * dt);

    const moving = this.isMoving;
    if (moving && !this.wasMoving) this.squash = -0.18;          // 출발: 길쭉하게
    if (!moving && this.wasMoving) this.squash = 0.22;           // 급정지: 납작하게
    this.wasMoving = moving;

    if (moving) {
      this.anim = 'run';
      // 속도에 비례한 달리기 애니메이션 (약 8~12FPS)
      this.runPhase += dt * (8 + 4 * (this.speed / MOVE.MAX_SPEED));
      this.dustT -= dt;
      if (this.dustT <= 0 && stage) {
        this.dustT = MOVE.DUST_INTERVAL;
        particles.dust(stage.laneX(this.lane, this.dist, this.laneCount), stage.distToY(this.dist));
      }
    } else {
      this.anim = taggerFacing ? 'freeze' : 'idle';
    }

    return null;
  }

  // 술래에게 걸림
  eliminate() {
    if (!this.alive) return;
    this.alive = false;
    this.elimDist = this.dist;
    this.speed = 0;
    this.elimT = 0;
    this.blink = FX.BLINK_TIME;
    this.squash = 0.3;
    this.bubble = { text: '걸렸다!', t: 1.4 };
  }

  finish(rank, timeLeft) {
    if (this.finished) return;
    this.finished = true;
    this.finishRank = rank;
    this.finishTimeLeft = timeLeft;
    this.hop = 0;
    this.squash = -0.25;
    this.bubble = { text: '도착!', t: 1.6 };
  }

  _currentFrame() {
    const F = this.frames;
    switch (this.anim) {
      case 'run': return F.run[Math.floor(this.runPhase) % 4];
      case 'freeze': return F.freeze[Math.floor(this.animT * 2) % 2];
      case 'out': {
        // 깜짝(0.1초) → 회색(0.15초) → 반쯤 주저앉기 → 주저앉기
        const t = this.elimT;
        return F.out[t < 0.1 ? 0 : t < 0.25 ? 1 : t < 0.4 ? 2 : 3];
      }
      case 'cheer': return F.cheer[Math.floor(this.hop * 6) % 2];
      default: return F.idle[Math.floor(this.animT * 2.5) % 2];
    }
  }

  // 그림자 + 캐릭터 (깊이 정렬은 호출하는 쪽에서)
  render(ctx, stage) {
    const cx = stage.laneX(this.lane, this.dist, this.laneCount);
    const fy = stage.distToY(this.dist);
    shadow(ctx, cx, fy - 1, 14, C.dark);

    // 탈락 직후 깜빡임
    if (this.blink > 0 && Math.floor(this.blink * 16) % 2 === 0) return;

    let yOff = 0, xOff = 0;
    if (this.anim === 'cheer') yOff = -Math.round(Math.abs(Math.sin(this.hop * 9)) * 3);
    if (this.anim === 'out' && this.elimT < 0.25) xOff = Math.floor(this.elimT * 40) % 2 ? 1 : -1;
    const sq = this.squash;
    spriteFeet(ctx, this._currentFrame(), cx + xOff, fy + yOff, 1 + sq * 0.6, 1 - sq);
  }

  // 머리 위 P1~P5 이름표
  renderLabel(ctx, stage, text) {
    const cx = stage.laneX(this.lane, this.dist, this.laneCount);
    const fy = stage.distToY(this.dist);
    const w = text.measure(this.name, 'tiny') + 4;
    const x = Math.round(cx - w / 2), y = fy - this.frames.idle[0].height - 8;
    const bg = this.alive ? this.color : C.slate;
    rect(ctx, x, y, w, 8, C.ink);
    rect(ctx, x + 1, y + 1, w - 2, 6, bg);
    rect(ctx, cx - 1, y + 8, 2, 1, C.ink); // 꼬리
    text.draw(ctx, this.name, cx, y, { font: 'tiny', color: this.alive ? this.labelText : C.silver, align: 'center' });
  }
}
