(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Fighter — 선수 공통 로직 (플레이어와 상대 AI가 함께 사용)
  //  컨트롤러(키보드 또는 AI)가 매 틱 "의도(intent)" 를 만들고, Fighter는 그 의도를 받아
  //  이동·기합·타격·막기·경직 상태를 갱신한다. 판정은 world.events(시합 장면)에 위임한다.
  //
  //  intent = { move:-1|0|1 (월드 방향), attack:'men'|'kote'|'do'|null, attackPressed,
  //             block, blockPressed, kiai, kiaiPressed, present, tsuki, debana(출발기), cancel(페인트) }
  //
  //  상태: idle(겨눔) / move(발놀림) / strike(타격) / block(막기) / stagger(무너짐)
  //        stun(기세 0 경직) / present(수련용 부위 열어주기) / sonkyo(준거) / frozen(정지)
  // ─────────────────────────────────────────────────────────────
  let STRIKE_ID = 0;

  class Fighter {
    constructor(o) {
      this.name = o.name;
      this.side = o.side;                 // 'red'(홍) | 'white'(백)
      this.facing = o.facing;             // 1 = 오른쪽, -1 = 왼쪽
      this.swapKey = o.swapKey || o.side;
      this.reach = o.reach || 0;
      this.swordLen = o.swordLen || 20;
      this.speedMul = o.speedMul || 1;
      this.strikeSpeedMul = o.strikeSpeedMul || 1;
      this.voicePitch = o.voicePitch || 1;
      this.controller = null;
      this.reset(o.x || 0);
    }

    reset(x) {
      const M = PK.CONFIG.MOMENTUM;
      this.x = x;
      this.vx = 0;
      this.state = 'idle';
      this.stateT = 0;
      this.stateDur = 0;
      this.momentum = M.MAX;
      this.kiai = 0;
      this.kiaiHolding = false;
      this.lastKiaiPress = -9999;
      this.strike = null;
      this.blockT = 0;
      this.counterT = 0;
      this.parryCdT = 0;
      this.blockHit = false;
      this.blockNoParry = false;
      this.moveRel = 0;
      this.presentTarget = null;
      this.flinchT = 0;
      this.squashT = 0;
      this.animT = 0;
      this.stepT = 0;
      this.stepFrame = 0;
      this.lastResult = null;
      this.telegraphT = 0;
    }

    setState(s, dur) {
      this.state = s;
      this.stateT = 0;
      this.stateDur = dur || 0;
    }

    // 새 행동(이동·타격·막기)을 시작할 수 있는가
    get canAct() {
      return this.state === 'idle' || this.state === 'move' || this.state === 'present';
    }

    strikePhase() {
      const s = this.strike;
      if (!s) return null;
      if (s.t < s.startup) return 'windup';
      if (s.t === s.startup) return 'active';
      return 'recover';
    }

    // AI 인지·판정용 상태 요약
    snapshot() {
      const s = this.strike;
      return {
        x: this.x,
        state: this.state,
        moveRel: this.moveRel,
        strikeType: s ? s.type : null,
        strikeId: s ? s.id : 0,
        strikeT: s ? s.t : 0,
        startup: s ? s.startup : 0,
        phase: this.strikePhase(),
        recoverBad: s ? s.bad : false,
        blockT: this.blockT,
        presentTarget: this.presentTarget,
        momentum: this.momentum,
        kiai: this.kiai
      };
    }

    addMomentum(v) {
      const M = PK.CONFIG.MOMENTUM;
      this.momentum = Math.max(0, Math.min(M.MAX, this.momentum + v));
    }

    // 받아치기 당함 → 무너짐
    stagger(ticks) {
      this.strike = null;
      this.vx = -this.facing * 0.9;
      this.setState('stagger', ticks);
    }

    // 기세 0 → 경직
    stun() {
      this.strike = null;
      this.vx = 0;
      this.setState('stun', PK.CONFIG.MOMENTUM.STUN_TICKS);
    }

    // 상대 타격을 받아쳐 냄
    onParry() {
      this.counterT = PK.CONFIG.PARRY.COUNTER_TICKS;
      this.addMomentum(PK.CONFIG.MOMENTUM.PARRY_GAIN);
    }

    // 맞았을 때 움찔
    flinch() {
      this.flinchT = 8;
    }

    // 정지 상태로 (시합 중단, 개시선 정렬 등)
    freeze(state) {
      this.strike = null;
      this.vx = 0;
      this.setState(state || 'frozen');
    }

    // ── 매 틱 갱신 ──
    update(intent, w) {
      const C = PK.CONFIG, K = C.KIAI, M = C.MOMENTUM;
      this.stateT++;
      this.animT++;
      if (this.flinchT > 0) this.flinchT--;
      if (this.squashT > 0) this.squashT--;
      if (this.counterT > 0) this.counterT--;
      if (this.parryCdT > 0) this.parryCdT--;
      if (this.telegraphT > 0) this.telegraphT--;

      const disabled = this.state === 'stun' || this.state === 'stagger' || this.state === 'frozen' || this.state === 'sonkyo';

      // ── 기합 게이지: Shift 누르는 동안 차오르고, 놓으면 서서히 줄어든다 ──
      if (!disabled && intent.kiaiPressed) {
        this.lastKiaiPress = w.frame;
        w.events.onKiai(this);
      }
      if (!disabled && intent.kiai) {
        this.kiai = Math.min(K.MAX, this.kiai + K.CHARGE);
        this.kiaiHolding = true;
      } else {
        this.kiai = Math.max(0, this.kiai - K.DECAY);
        this.kiaiHolding = false;
      }

      switch (this.state) {
        case 'idle':
        case 'move':
        case 'present': {
          if (intent.attack) { this.startStrike(intent.attack, w, intent.debana); break; }
          if (intent.block) { this.startBlock(); break; }
          if (intent.present) {
            this.state = 'present';
            this.presentTarget = intent.present;
          } else if (this.state === 'present') {
            this.state = 'idle';
            this.presentTarget = null;
          }
          this.applyMove(intent.move, intent.kiai ? C.MOVE.KIAI_MUL : 1);
          if (this.state !== 'present') this.state = Math.abs(this.vx) > 0.15 ? 'move' : 'idle';
          break;
        }
        case 'block':
          this.blockT++;
          if (intent.attack) { this.endBlock(); this.startStrike(intent.attack, w, intent.debana); break; }   // 막은 직후 바로 반격 가능
          if (!intent.block) { this.endBlock(); this.setState('idle'); break; }
          this.applyMove(intent.move, C.MOVE.BLOCK_MUL);
          this.addMomentum(-M.BLOCK_DRAIN);
          break;
        case 'strike':
          this.updateStrike(w, intent);
          break;
        case 'stagger':
          this.vx *= 0.82;
          if (this.stateT >= this.stateDur) this.setState('idle');
          break;
        case 'stun':
          this.vx *= 0.8;
          if (this.stateT >= this.stateDur) { this.setState('idle'); this.momentum = M.STUN_RECOVER; }
          break;
        case 'frozen':
        case 'sonkyo':
          this.vx = 0;
          break;
      }

      // 이동 방향 (상대 쪽으로 = +1, 뒤로 = −1)
      this.moveRel = Math.abs(this.vx) > 0.2 ? Math.sign(this.vx) * this.facing : 0;

      // ── 기세: 겨눔·압박하면 회복, 물러나면 감소 ──
      if (this.state === 'idle') this.addMomentum(M.REGEN);
      else if (this.state === 'move') this.addMomentum(this.moveRel > 0 ? M.SEME_GAIN : this.moveRel < 0 ? -M.RETREAT_DRAIN : 0);

      this.x += this.vx;

      // 발놀림 애니메이션 (4프레임, 뒤로 가면 역순)
      if (this.state === 'move') {
        this.stepT++;
        if (this.stepT >= C.ANIM_TICKS + 1) {
          this.stepT = 0;
          this.stepFrame = (this.stepFrame + (this.moveRel >= 0 ? 1 : 3)) % 4;
          if (this.stepFrame === 0 && w.events.onStep) w.events.onStep(this);
        }
      } else {
        this.stepT = 0;
        this.stepFrame = 0;
      }
    }

    // 막기 시작. 헛막기 직후(parryCdT)에는 받아치기가 안 되고 그냥 막기만 된다
    startBlock() {
      this.setState('block');
      this.blockT = 0;
      this.blockHit = false;
      this.blockNoParry = this.parryCdT > 0;
      this.vx *= 0.5;
    }

    // 막기 끝. 받아치기 시간 안에 아무것도 닿지 않았으면 "헛막기" → 잠깐 받아치기 불가 + 기세 감소
    endBlock() {
      const P = PK.CONFIG.PARRY;
      if (!this.blockHit && this.blockT <= P.WINDOW + 2) {
        this.parryCdT = P.MISS_COOLDOWN;
        this.addMomentum(-P.MISS_MOMENTUM);
      }
    }

    // 지금 막기가 받아치기가 되는가
    get parryActive() {
      return this.state === 'block' && !this.blockNoParry && this.blockT <= PK.CONFIG.PARRY.WINDOW;
    }

    // 밀어걷기: 가속·감속이 있는 미끄러지는 움직임
    applyMove(dir, mul) {
      const MV = PK.CONFIG.MOVE;
      if (dir) {
        const target = dir * MV.MAX * this.speedMul * mul;
        const dv = target - this.vx;
        this.vx += Math.max(-MV.ACCEL, Math.min(MV.ACCEL, dv));
      } else {
        this.vx *= MV.FRICTION;
        if (Math.abs(this.vx) < 0.03) this.vx = 0;
      }
    }

    // 타격 시작: 기합 게이지가 충분하면 소모하고 "유효 기합" 으로 표시
    // debana = 출발기(상대가 나오는 순간 짧게 끊는 타격)
    startStrike(type, w, debana) {
      const C = PK.CONFIG, S = C.STRIKES[type];
      let startup = S.startup / this.strikeSpeedMul;
      let lunge = S.lunge;
      let counter = false;
      if (this.counterT > 0) {
        startup *= C.PARRY.COUNTER_SPEED;
        lunge *= C.PARRY.COUNTER_LUNGE;
        counter = true;
        this.counterT = 0;
      } else if (debana) {
        startup *= C.PARRY.DEBANA_SPEED;
        lunge *= C.PARRY.DEBANA_LUNGE;
      }
      startup = Math.max(4, Math.round(startup));
      const kiaiGauge = Math.round(this.kiai);
      const kiaiOk = this.kiai >= C.KIAI.REQUIRED;
      if (kiaiOk) this.kiai -= C.KIAI.COST;
      this.strike = {
        id: ++STRIKE_ID,
        type: type,
        t: 0,
        startup: startup,
        recover: S.recover,
        lungeStep: lunge / startup,
        extra: 0,
        bad: false,
        result: null,
        counter: counter,
        kiaiOk: kiaiOk,
        kiaiGauge: kiaiGauge,
        moveRelAtStart: this.moveRel,
        momentumAtStart: this.momentum
      };
      this.setState('strike');
      this.vx = 0;
      this.presentTarget = null;
      w.events.onStrikeStart(this);
    }

    updateStrike(w, intent) {
      const C = PK.CONFIG;
      const s = this.strike;
      const S = C.STRIKES[s.type];
      // 페인트: 준비 동작 초반이면 타격을 거둘 수 있다 (기합은 이미 소모)
      if (intent && intent.cancel && s.t < s.startup * C.FEINT_CANCEL_MAX) {
        this.strike = null;
        this.setState('idle');
        return;
      }
      s.t++;
      if (s.t < s.startup) {
        // 들어올리며 앞으로 디딤
        this.x += this.facing * s.lungeStep;
      } else if (s.t === s.startup) {
        // 발구름 + 접촉 판정
        this.x += this.facing * s.lungeStep;
        this.squashT = 4;
        const res = w.events.onStrikeActive(this);
        if (this.state !== 'strike') return;      // 받아치기 당해 무너짐 등
        s.result = res.kind;
        if (res.kind === 'whiff') { s.bad = true; s.extra = S.whiffExtra; }
        else if (res.kind === 'blocked') { s.bad = true; s.extra = C.BLOCKED_EXTRA; }
        else if (res.kind === 'deflected') { s.bad = true; s.extra = C.DEFLECT_EXTRA; }
      } else {
        // 머리·허리는 친 뒤 조금 더 밀고 나간다
        if (s.result === 'contact' && s.t < s.startup + 10) this.x += this.facing * 0.45;
        if (s.t >= s.startup + s.recover + s.extra) {
          this.strike = null;
          this.setState('idle');
        }
      }
    }
  }

  PK.Fighter = Fighter;
})(window.PK = window.PK || {});
