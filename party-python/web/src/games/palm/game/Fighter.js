// =============================================================
// Fighter.js — 한 명의 선수(플레이어 또는 CPU)의 상태 머신
//
//   상태 흐름
//     idle ─J─▶ windup ─(뗌)─▶ push ─▶ recover ─▶ idle          (툭 밀기)
//                     └(유지)▶ charge ─(뗌)─▶ release ─▶ push      (차지 밀기)
//     idle ─K─▶ feint(판정 창) ─▶ feintRecover(무방비) ─▶ idle
//     idle ─L─▶ holdStart ─▶ hold(스태미나 소모) ─(뗌)─▶ holdRecover ─▶ idle
//     (어디서든) 큰 충격 ─▶ stagger ─▶ idle,   |균형| ≥ 100 ─▶ fall
//
//   입력은 InputFrame { lean, pushDown, feintPressed, holdDown } 하나로 통일 —
//   사람이든 CPU든 같은 방식으로 조종된다.
// =============================================================
import { BalanceBody } from './BalanceSystem.js';
import { clamp } from '../util.js';

export const EMPTY_INPUT = Object.freeze({ lean: 0, pushDown: false, feintPressed: false, holdDown: false });

// 새 행동을 시작할 수 있는 상태
const ACTIONABLE = new Set(['idle']);

export class Fighter {
  /**
   * @param {object} o
   * @param {'left'|'right'} o.side  화면 위치 (left = 플레이어, right = CPU)
   */
  constructor({ cfg, side, name, lookId, baseX }) {
    this.cfg = cfg;
    this.side = side;
    this.name = name;
    this.lookId = lookId;
    this.baseX = baseX;
    this.dir = side === 'left' ? 1 : -1; // 화면에서 "앞"의 방향
    this.facing = side === 'left' ? 'right' : 'left';
    this.body = new BalanceBody(cfg);
    this.opponent = null;
    this.reset();
  }

  reset() {
    this.body.reset();
    this.state = 'idle';
    this.stateFrame = 0;
    this.stateLen = 0; // recover 등 가변 길이 상태의 길이
    this.charge = 0;
    this.chargeFrames = 0;
    this.overhold = 0;
    this.power = 1;
    this.charged = false;
    this.pushResolved = false;
    this.feintConsumed = false;
    this.stamina = this.cfg.ACTION.HOLD_STAMINA;
    this.staggerTimer = 0;
    this.pushLatch = false; // 밀기 버튼을 새로 눌러야 다음 밀기 시작
    this.holdLatch = false;
    this.input = EMPTY_INPUT;
    this.leanInput = 0;
    this.fallen = false;
    this.frozen = false; // 시간 종료 판정 후 멈춤
    this.fallOvershoot = 0; // 넘어질 때 한계를 얼마나 넘었는지 (동시 낙하 판정용)
    this.feintStreak = 0; // 연속 페인트 횟수 — 연달아 쓸수록 판정 창이 줄어든다
    this.feintStreakTimer = 0;
    this.feintWindow = this.cfg.ACTION.FEINT_WINDOW;
    this.fallDir = 0; // +1 앞으로, -1 뒤로
    this.fallT = 0;
    this.splashed = false;
    this.won = false;
    this.animT = 0; // 애니메이션 시계(프레임)
    this.flash = 0; // 맞았을 때 흰색 번쩍임
    this.squash = 0; // 헛손질 스쿼시&스트레치 타이머
    this.history = []; // 최근 행동 기록 (CPU 패턴 기억용)
    this.currentAction = null;
    this.stats = {
      pushes: 0, // 시도한 밀기
      pushesLanded: 0, // 맞힌 밀기
      chargePushes: 0,
      feints: 0, // 시도한 페인트
      feintsSucceeded: 0, // 성공한 페인트 (헛손질 유도 + 버티기 무너뜨리기)
      cleanFeints: 0, // 그중 연타가 아닌(첫 번째) 페인트로 성공한 횟수 — 점수는 이것만 인정
      holds: 0,
      holdsSucceeded: 0, // 밀기를 받아낸 횟수
      whiffs: 0, // 내가 헛손질한 횟수
      clashes: 0,
      staggers: 0,
    };
  }

  // ---------- 조회용 ----------
  get balance() {
    return this.body.b;
  }
  // 화면 기준 균형 (-: 화면 왼쪽, +: 화면 오른쪽)
  get screenBalance() {
    return this.body.b * this.dir;
  }
  get actionable() {
    return ACTIONABLE.has(this.state);
  }
  get inFeintWindow() {
    return this.state === 'feint' && !this.feintConsumed;
  }
  get isHolding() {
    return this.state === 'hold';
  }
  // 앞으로 기운 정도 0~1 (밀기 위력 보너스 / 헛손질 피해 증가에 사용)
  get forwardLean() {
    return clamp(this.body.b / this.cfg.BALANCE.LIMIT, 0, 1);
  }

  setState(state, len = 0) {
    this.state = state;
    this.stateFrame = 0;
    this.stateLen = len;
  }

  // ---------- 행동 기록 ----------
  logAction(action, frame) {
    const entry = { action, frame: Math.round(frame), result: 'pending' };
    this.history.push(entry);
    const max = this.cfg.CPU.MEMORY_SIZE;
    if (this.history.length > max) this.history.splice(0, this.history.length - max);
    this.currentAction = entry;
    return entry;
  }

  // 페인트 성공 기록 (연타 중이 아닌 첫 페인트만 점수용으로 따로 센다)
  recordFeintSuccess() {
    this.stats.feintsSucceeded++;
    if (this.feintStreak <= 1) this.stats.cleanFeints++;
  }

  setResult(result) {
    if (this.currentAction && this.currentAction.result === 'pending') this.currentAction.result = result;
  }

  // ---------- 메인 업데이트 ----------
  /**
   * @param {number} dt  프레임 (슬로모션이면 1보다 작음)
   * @param {object} input InputFrame (자기 기준)
   * @param {object} env  { frame, sway, emit(event) }
   */
  update(dt, input, env) {
    const A = this.cfg.ACTION;
    const B = this.cfg.BALANCE;
    this.input = input || EMPTY_INPUT;
    this.animT += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt);

    if (this.fallen) {
      this.updateFall(dt, env);
      return;
    }
    if (this.won) {
      this.leanInput = 0;
      // 이긴 쪽은 균형을 천천히 중앙으로 되돌린다 (연출)
      this.body.b *= Math.pow(0.95, dt);
      this.body.v = 0;
      return;
    }
    if (this.frozen) {
      // 시간 종료 판정 후: 진 쪽/무승부는 그 자세로 멈춘다 (판정 뒤에 물에 빠지는 일 없도록)
      this.leanInput = 0;
      this.body.v = 0;
      return;
    }
    if (this.feintStreakTimer > 0) {
      this.feintStreakTimer -= dt;
      if (this.feintStreakTimer <= 0) this.feintStreak = 0;
    }

    // 버튼을 떼면 래치 해제 → 다음 행동을 시작할 수 있다
    if (!this.input.pushDown) this.pushLatch = false;
    if (!this.input.holdDown) this.holdLatch = false;

    this.stateFrame += dt;

    // ---- 상태별 처리 ----
    switch (this.state) {
      case 'idle':
        this.tryStartAction(env);
        break;

      case 'windup':
        // 준비 동작이 끝났을 때 아직 누르고 있으면 차지, 아니면 툭 밀기
        if (this.stateFrame >= A.PUSH_WINDUP) {
          if (this.input.pushDown) {
            this.setState('charge');
            this.chargeFrames = 0;
            this.overhold = 0;
            if (this.currentAction) this.currentAction.action = 'charge';
            env.emit({ type: 'chargeStart', who: this });
          } else {
            this.beginPush(env, false);
          }
        }
        break;

      case 'charge':
        this.chargeFrames += dt;
        this.charge = clamp(this.chargeFrames / A.CHARGE_MAX, 0, 1);
        if (this.charge >= 1) this.overhold += dt;
        // 버튼을 떼거나 너무 오래 들고 있으면 발사
        if (!this.input.pushDown || this.overhold >= A.CHARGE_OVERHOLD) {
          this.setState('release');
          env.emit({ type: 'chargeEnd', who: this });
        }
        break;

      case 'release':
        if (this.stateFrame >= A.CHARGE_RELEASE) this.beginPush(env, true);
        break;

      case 'push': {
        const active = this.charged ? A.CHARGE_ACTIVE : A.PUSH_ACTIVE;
        if (this.stateFrame >= active) {
          // 판정이 끝까지 아무 일도 없었다면(상대가 이미 쓰러짐 등) 결과 없음
          if (!this.pushResolved) this.setResult('none');
          this.pushResolved = true;
          this.setState('recover', this.charged ? A.CHARGE_RECOVER : A.PUSH_RECOVER);
        }
        break;
      }

      case 'recover':
      case 'holdRecover':
      case 'feintRecover':
        if (this.stateFrame >= this.stateLen) this.setState('idle');
        break;

      case 'feint':
        if (this.stateFrame >= this.feintWindow) {
          if (!this.feintConsumed) {
            // 아무도 걸려들지 않음 → 살짝 앞으로 쏠리고 무방비
            this.setResult('none');
            // 헛페인트를 연달아 할수록 더 크게 앞으로 쏠린다
            this.body.applyImpulse(this.cfg.IMPACT.FEINT_EMPTY * (1 + 0.6 * (this.feintStreak - 1)));
            env.emit({ type: 'feintEmpty', who: this });
            this.setState('feintRecover', A.FEINT_RECOVER);
          } else {
            this.setState('recover', 6);
          }
        }
        break;

      case 'holdStart':
        this.stamina -= dt;
        if (this.stateFrame >= A.HOLD_STARTUP) this.setState('hold');
        break;

      case 'hold':
        this.stamina -= dt;
        if (this.stamina <= 0) {
          // 힘이 빠져서 앞으로 쏠림
          this.stamina = 0;
          this.setResult('none');
          this.body.applyImpulse(this.cfg.IMPACT.STAMINA_EMPTY_LURCH);
          env.emit({ type: 'holdTired', who: this });
          this.setState('holdRecover', A.HOLD_RECOVER * 2);
          this.holdLatch = true;
        } else if (!this.input.holdDown) {
          this.setResult('none');
          this.setState('holdRecover', A.HOLD_RECOVER);
        }
        break;

      case 'stagger':
        this.staggerTimer -= dt;
        if (this.staggerTimer <= 0) this.setState('idle');
        break;

      default:
        this.setState('idle');
    }

    // 버티지 않을 때 스태미나 회복
    if (this.state !== 'hold' && this.state !== 'holdStart') {
      this.stamina = Math.min(A.HOLD_STAMINA, this.stamina + A.HOLD_REGEN * dt);
    }
    if (this.state !== 'charge' && this.state !== 'release') {
      if (this.state !== 'push') this.charge = 0;
    }

    // ---- 균형 물리 ----
    let leanMult = 1;
    if (this.state === 'stagger') leanMult = B.STAGGER_LEAN_MULT;
    else if (this.state === 'hold' || this.state === 'holdStart') leanMult = B.HOLD_LEAN_MULT;
    this.leanInput = this.input.lean || 0;
    let force = this.leanInput * B.LEAN_FORCE * leanMult;
    let sway = env.sway;
    if (this.state === 'hold' || this.state === 'holdStart') sway *= B.HOLD_SWAY_MULT;
    force += sway;
    if (this.state === 'charge') force += B.CHARGE_DRIFT; // 차지 중엔 몸이 앞으로 쏠린다
    this.body.step(dt, force);

    if (this.body.fallen) this.startFall(env);
  }

  // idle 상태에서 새 행동 시작 (우선순위: 페인트 > 버티기 > 밀기 — 동시 입력 시)
  tryStartAction(env) {
    const A = this.cfg.ACTION;
    const inp = this.input;
    if (inp.feintPressed) {
      this.setState('feint');
      this.feintConsumed = false;
      // 연속 페인트는 읽히기 쉬워서 판정 창이 점점 짧아진다 (K 연타 방지)
      this.feintWindow = Math.max(A.FEINT_MIN_WINDOW, Math.round(A.FEINT_WINDOW * Math.pow(A.FEINT_STREAK_DECAY, this.feintStreak)));
      this.feintStreak++;
      this.feintStreakTimer = A.FEINT_STREAK_RESET + this.feintWindow + A.FEINT_RECOVER;
      this.stats.feints++;
      this.logAction('feint', env.frame);
      env.emit({ type: 'feint', who: this });
      return;
    }
    if (inp.holdDown && !this.holdLatch && this.stamina >= A.HOLD_MIN_STAMINA) {
      this.holdLatch = true;
      this.setState('holdStart');
      this.stats.holds++;
      this.logAction('hold', env.frame);
      env.emit({ type: 'holdStart', who: this });
      return;
    }
    if (inp.pushDown && !this.pushLatch) {
      this.pushLatch = true;
      this.setState('windup');
      this.charge = 0;
      this.charged = false;
      this.stats.pushes++;
      this.logAction('push', env.frame);
      env.emit({ type: 'windup', who: this });
    }
  }

  beginPush(env, charged) {
    const I = this.cfg.IMPACT;
    this.charged = charged;
    // 위력 = 차지 배율 × 앞으로 기운 보너스
    const chargeMult = charged ? 1 + (I.CHARGE_MULT_MAX - 1) * this.charge : 1;
    this.power = chargeMult * (1 + I.FORWARD_LEAN_POWER * this.forwardLean);
    if (charged) this.stats.chargePushes++;
    this.pushResolved = false;
    this.setState('push');
    env.emit({ type: 'pushActive', who: this, charged });
  }

  // 행동 강제 취소 (카운터를 맞았을 때 등)
  interrupt(len = 8) {
    if (this.state === 'charge' || this.state === 'release' || this.state === 'windup') {
      this.setResult('interrupted');
    }
    this.charge = 0;
    this.charged = false;
    this.setState('recover', len);
  }

  // 충격을 받음. 크기가 크면 휘청임
  takeImpulse(amount, env) {
    this.body.applyImpulse(amount);
    if (Math.abs(amount) >= this.cfg.BALANCE.STAGGER_THRESHOLD && !this.fallen) {
      this.charge = 0;
      this.charged = false;
      this.setState('stagger');
      this.staggerTimer = this.cfg.BALANCE.STAGGER_FRAMES;
      this.stats.staggers++;
      env.emit({ type: 'stagger', who: this });
    }
  }

  // 승부가 났을 때 하던 동작 정리 (차지/버티기 중이던 승자가 그 자세로 굳지 않게)
  endAction() {
    if (this.fallen) return;
    this.charge = 0;
    this.charged = false;
    this.setState('idle');
  }

  startFall(env) {
    if (this.fallen) return;
    this.fallen = true;
    this.fallOvershoot = Math.abs(this.body.b) + Math.abs(this.body.v) * 0.5;
    this.fallDir = this.body.b > 0 ? 1 : -1;
    this.fallT = 0;
    this.body.b = clamp(this.body.b, -this.cfg.BALANCE.LIMIT, this.cfg.BALANCE.LIMIT);
    this.body.v = 0;
    this.setState('fall');
    env.emit({ type: 'fall', who: this, dir: this.fallDir });
  }

  // 넘어짐 연출 진행: 0~20 회전, 20~ 낙하, 수면 도달 시 풍덩
  updateFall(dt, env) {
    this.fallT += dt;
    if (!this.splashed && this.fallT >= 34) {
      this.splashed = true;
      env.emit({ type: 'splash', who: this, x: this.fallWaterX() });
    }
  }

  // 물에 빠지는 x 위치 (넘어진 방향으로 조금 이동)
  fallWaterX() {
    return Math.round(this.baseX + this.dir * this.fallDir * 13);
  }

  // CPU에게 넘기는 직렬화 가능한 상태
  view() {
    return {
      balance: Math.round(this.body.b * 10) / 10,
      velocity: Math.round(this.body.v * 100) / 100,
      state: this.state,
      stateFrame: Math.floor(this.stateFrame),
      charge: Math.round(this.charge * 100) / 100,
      stamina: Math.round((this.stamina / this.cfg.ACTION.HOLD_STAMINA) * 100) / 100,
      leanInput: this.leanInput,
    };
  }
}
