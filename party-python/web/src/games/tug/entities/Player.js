// =============================================================
// Player — 플레이어 상태 + 애니메이션 상태 머신
// 애니메이션: 'idle' | 'pull' | 'slip' | 'win' | 'fall' (프레임 수·속도는 config.ANIMS)
// =============================================================
import { shadeOf } from '../palette.js';

/** 판정 팝업 표시 시간 (초) */
const POP_DURATION = 0.6;
/** 입력이 들어와도 '당기기'로 바꾸지 않는 애니메이션 (연출 우선) */
const LOCKED_ANIMS = new Set(['slip', 'fall', 'win']);

export class Player {
  /**
   * @param {{ id: string, name: string, color: string, hair: string, key: string, keyLabel: string }} def
   * @param {number} index 0-based (P1 = 0)
   * @param {object} config
   */
  constructor(def, index, config) {
    this.config = config;
    this.id = def.id;
    this.name = def.name;
    this.color = def.color;
    this.hair = def.hair;
    this.key = def.key;
    this.keyLabel = def.keyLabel;
    this.isMe = !!def.isMe;   // 멀티플레이: 이 화면에서 조작하는 선수
    this.animal = def.animal || null; // 동물 캐릭터 id (shared/animals.js). 없으면 원래 사람 캐릭터
    this.index = index;
    this.label = `P${index + 1}`;
    this.shade = shadeOf(def.color);

    // 팀 배정 결과
    this.side = null;
    this.slot = 0;
    // 월드 위치 (발 중앙)
    this.x = 0;
    this.y = config.LAYOUT.GROUND_Y;

    // 애니메이션
    this.anim = 'idle';
    this.frame = 0;
    this.animTime = 0;
    this.animDone = false; // 1회 재생 애니메이션이 끝났나

    this.pop = null;        // { grade, t }
    this.pressT = Infinity; // 마지막 입력 후 경과 초
    this.ready = false;     // 타이틀 준비 상태
    this.powerSource = null;
  }

  /** 오른쪽 팀은 왼쪽을 바라봄 → 좌우 반전 */
  get flip() {
    return this.side === 'right';
  }

  _animDef(name = this.anim) {
    const a = this.config.ANIMS || {};
    return a[name] || a.idle || { frames: 1, fps: 1, loop: true };
  }

  /** 애니메이션 전환. 같은 anim 이면 restart=true 일 때만 처음부터 */
  setAnim(name, restart = false) {
    if (name === this.anim && !restart) return;
    this.anim = name;
    this.frame = 0;
    this.animTime = 0;
    this.animDone = false;
  }

  /** 입력 판정 반영: 팝업 + 키캡 눌림 + (spam 이 아니면) 당기기 재생 */
  onPull(grade) {
    this.pop = { grade, t: 0 };
    this.pressT = 0;
    if (grade === 'spam') return; // 헛힘은 팝업만
    if (!LOCKED_ANIMS.has(this.anim)) this.setAnim('pull', true);
  }

  /**
   * @param {number} dt
   * @param {boolean} frozen 히트스톱 중이면 애니메이션만 정지 (팝업·pressT 는 진행)
   */
  update(dt, frozen = false) {
    // 팝업·키캡 타이머
    if (this.pop) {
      this.pop.t += dt;
      if (this.pop.t >= POP_DURATION) this.pop = null;
    }
    this.pressT += dt;

    if (frozen || this.animDone) return;
    const def = this._animDef();
    const frames = Math.max(1, def.frames | 0);
    const fps = def.fps > 0 ? def.fps : 1;
    this.animTime += dt;
    const idx = Math.floor(this.animTime * fps);
    if (def.loop) {
      // 반복: 시간도 한 바퀴 안으로 접어 둔다 (오래 켜두어도 정밀도 유지)
      const cycle = frames / fps;
      if (this.animTime >= cycle) this.animTime %= cycle;
      this.frame = Math.floor(this.animTime * fps) % frames;
    } else if (idx >= frames) {
      // 1회 재생 끝: pull 은 0프레임(버티기 자세), 나머지는 마지막 프레임에서 정지
      this.frame = this.anim === 'pull' ? 0 : frames - 1;
      this.animDone = true;
    } else {
      this.frame = idx;
    }
  }

  /** 스프라이트 색 정보 */
  appearance() {
    const look = { shirt: this.color, shirtShade: this.shade, hair: this.hair };
    if (this.animal) look.animal = this.animal;
    return look;
  }

  /** 라운드 시작: 버티기 자세(pull 0프레임), 팝업 제거 */
  resetForRound() {
    this.anim = 'pull';
    this.frame = 0;
    this.animTime = 0;
    this.animDone = true; // 입력 전까지 0프레임 유지
    this.pop = null;
    this.pressT = Infinity;
  }
}
