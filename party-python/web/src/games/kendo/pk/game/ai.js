(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 상대 AI
  //  - SnapshotHistory: 매 틱 두 선수 상태를 기록. AI는 "반응 지연(reaction)" 만큼 과거의 상대를 본다.
  //    → 사람처럼 늦게 알아채고, 빠른 손목 치기에는 반응하지 못하는 경우가 생긴다.
  //  - AIController: CONFIG.AI_PROFILES 의 유형별 수치로 행동이 달라지는 범용 두뇌
  //      ① 반응: 상대 타격 준비를 보면 막기(타이밍이 맞으면 받아치기) / 출발기 / 물러나기 / 무대응
  //      ② 공격: 상대 빈틈 × 부위 선호도가 기준을 넘고 간격이 맞으면 친다 (+가끔 탐색 돌진)
  //      ③ 연속기·받아치기 후 반격 예약
  //      ④ 이동: 선호 간격 유지 + 가끔 압박(세메), 장외 경계
  //  - TrainerController: 도장 수련용 상대 (부위 열어 주기 / 정해진 박자로 머리 치기)
  // ─────────────────────────────────────────────────────────────
  class SnapshotHistory {
    constructor(n) {
      this.n = n;
      this.buf = {};
    }
    push(fighters) {
      for (let i = 0; i < fighters.length; i++) {
        const f = fighters[i];
        const arr = this.buf[f.side] || (this.buf[f.side] = []);
        arr.push(f.snapshot());
        if (arr.length > this.n) arr.shift();
      }
    }
    get(f, delay) {
      const arr = this.buf[f.side];
      if (!arr || !arr.length) return f.snapshot();
      return arr[Math.max(0, arr.length - 1 - delay)];
    }
    clear() { this.buf = {}; }
  }

  function blankIntent() {
    return { move: 0, attack: null, attackPressed: false, block: false, blockPressed: false, kiai: false, kiaiPressed: false, present: null, tsuki: false, debana: false, cancel: false };
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  class AIController {
    constructor(profileKey) {
      this.key = profileKey;
      this.base = PK.CONFIG.AI_PROFILES[profileKey];
      this.P = this.base;
      this.phase = 1;
      this.parried = 0;      // 내 공격이 받아치기 당한 횟수 (서서히 잊는다) — 많을수록 머리·손목을 자제
      this.oppBlocks = 0;    // 상대가 막기를 시작한 횟수 (서서히 잊는다) — 많으면 페인트 후 허리
      this.reset();
    }

    reset() {
      this.reactedId = 0;
      this.blockFrom = -1;
      this.blockUntil = -1;
      this.plainBlock = false;
      this.retreatUntil = -1;
      this.queued = null;
      this.queuedUntil = -1;
      this.queuedDebana = false;
      this.queuedFrom = -1;
      this.feintAt = -1;
      this.jitter = 0;
      this.jitterT = 0;
      this.semeUntil = -1;
      this.decideT = 10;
      this.kiaiHold = false;
      this.clinchDir = -1;
      this.clinchUntil = -1;
      this.checkedStrikeId = 0;
      this.counterChecked = false;
      this.atkDist = 99;
      this.closeV = 0;
      this.mode = '대기';
      this.debug = '';
    }

    // 내 타격이 받아치기 당함 (시합 장면이 알려 줌)
    onParried() { this.parried += 1; }

    // 사범님 2판째 패턴 전환
    enterPhase2(self) {
      if (this.phase === 2 || !this.base.phase2) return false;
      this.phase = 2;
      this.P = Object.assign({}, this.base, this.base.phase2);
      if (this.base.phase2.strikeSpeedMul) self.strikeSpeedMul = this.base.phase2.strikeSpeedMul;
      return true;
    }

    getIntent(self, opp, w) {
      const C = PK.CONFIG, P = this.P, f = w.frame;
      const it = blankIntent();
      if (this.parried > 0) this.parried = Math.max(0, this.parried - 1 / 900);   // 15초에 1회씩 잊음
      if (this.oppBlocks > 0) this.oppBlocks = Math.max(0, this.oppBlocks - 1 / 900);
      if (opp.state === 'block' && opp.stateT === 1) this.oppBlocks += 1;
      if (!(self.canAct || self.state === 'block' || self.state === 'strike')) {
        this.mode = self.state === 'stun' ? '경직' : '무너짐';
        this.blockFrom = this.blockUntil = -1;
        this.plainBlock = false;
        return it;
      }
      // 반응 지연만큼 과거의 상대를 본다 (빈틈·타격 준비 읽기용)
      const s = w.history.get(opp, P.reaction);
      const dist = Math.abs(self.x - s.x);
      // 간격 재기는 현재 위치 + 다가오는 속도로 (발놀림은 눈으로 계속 따라가므로)
      this.atkDist = Math.abs(self.x - opp.x);
      this.closeV = opp.vx * opp.facing;   // + 다가옴 / − 멀어짐

      // ── ① 상대 타격 준비 감지 → 대응 ──
      if (s.state === 'strike' && s.phase === 'windup' && s.strikeId !== this.reactedId) {
        this.reactedId = s.strikeId;
        // 접촉까지 남은 틱(추정). 공격자가 먼저 갱신되므로 1틱 여유를 뺀다
        const left = s.startup - s.strikeT - P.reaction - 1;
        if (left > 0 && (self.canAct || self.state === 'block')) this.respond(self, s, left, f);
      }

      // ── ③ 연속기 / 받아치기 당함 기억 / 받아치기 후 반격 예약 ──
      if (self.strike && self.strike.result && self.strike.id !== this.checkedStrikeId) {
        this.checkedStrikeId = self.strike.id;
        const bad = self.strike.result === 'whiff' || self.strike.result === 'blocked' || self.strike.result === 'deflected';
        if (bad && Math.random() < P.renzoku) {
          this.queued = Math.random() < 0.6 ? 'men' : 'kote';
          this.queuedUntil = f + 60;
          this.mode = '연속기';
        }
      }
      if (self.counterT > 0 && !this.counterChecked) {
        this.counterChecked = true;
        if (Math.random() < P.counterAfterParry) {
          this.queued = 'men';
          this.queuedUntil = f + C.PARRY.COUNTER_TICKS;
          this.blockUntil = f;   // 반격하려면 막기를 푼다
          this.mode = '받아치고 반격';
        }
      }
      if (self.counterT === 0) this.counterChecked = false;

      // ── 예약된 막기 ──
      if (f >= this.blockFrom && f <= this.blockUntil) {
        it.block = true;
        if (f === this.blockFrom || self.state !== 'block') it.blockPressed = true;
        // 타이밍이 어긋난 막기: 받아치기가 아니라 그냥 막기가 된다
        if (this.plainBlock && self.state === 'block') self.blockT = Math.max(self.blockT, C.PARRY.WINDOW + 1);
      }
      // ── 예약된 후퇴 ──
      if (f < this.retreatUntil && this.backSpace(self) > 12) it.move = -self.facing;

      // 기합 관리
      this.manageKiai(self, it, dist);

      // ── 페인트: 들어올리다 멈춤 ──
      if (this.feintAt >= 0 && f >= this.feintAt) {
        this.feintAt = -1;
        if (self.state === 'strike') { it.cancel = true; this.mode = '페인트'; }
      }

      // ── ② 공격 ──
      if ((self.canAct || (self.state === 'block' && this.queued)) && f >= this.retreatUntil) {
        const atk = this.decideAttack(self, s, dist, f);
        if (atk) {
          it.attack = atk;
          it.attackPressed = true;
          it.block = false;
          it.debana = this.queuedDebana;
          this.queuedDebana = false;
          if (Math.random() < P.kiaiTiming) it.kiaiPressed = true;
          this.blockFrom = this.blockUntil = -1;
          this.plainBlock = false;
          // 가끔은 치는 척만 하고 거둔 뒤, 상대가 막느라 굳은 사이 다른 부위를 친다
          const feintP = (P.feint || 0) + 0.12 * Math.min(this.parried, 3);   // 받아치기를 당할수록 페인트를 섞는다
          if (!it.debana && !self.counterT && this.mode !== '페인트 후 공격' && Math.random() < feintP) {
            const st = Math.round(C.STRIKES[atk].startup / self.strikeSpeedMul);
            this.feintAt = f + Math.max(2, Math.floor(st * C.FEINT_CANCEL_MAX) - 2);
            this.queued = 'auto';   // 그때 상대 모습을 보고 부위를 고른다 (막고 있으면 허리)
            this.queuedFrom = this.feintAt + 4 + (Math.random() * 5 | 0);
            this.queuedUntil = this.queuedFrom + 30;
          }
        }
      }

      // ── ④ 이동 ──
      if (!it.attack && !it.block && f >= this.retreatUntil && self.canAct) it.move = this.decideMove(self, s, dist, f);

      // ── 잔심: 내 타격이 판정 대기 중이면 물러나거나 다시 치지 않는다 ──
      const sc = w.scene;
      if (sc && sc.pending && sc.pending.some(function (r) { return r.att === self && !r.zanshinBroken; })) {
        if (it.move * self.facing < 0) it.move = 0;
        it.attack = null; it.attackPressed = false; it.debana = false;
        it.block = false; it.blockPressed = false;
        this.mode = '잔심';
      }
      return it;
    }

    // 상대 타격 준비를 봤을 때 대응 고르기
    respond(self, s, left, f) {
      const C = PK.CONFIG, P = this.P, R = P.response;
      let r = Math.random();
      let choice = 'none';
      if ((r -= R.guard) < 0) choice = 'guard';
      else if ((r -= R.debana) < 0) choice = 'debana';
      else if ((r -= R.retreat) < 0) choice = 'retreat';

      // 허리는 막기로 못 막는다 → 물러나거나 맞는다
      if (choice === 'guard' && s.strikeType === 'do') choice = Math.random() < 0.6 ? 'retreat' : 'none';
      // 등 뒤가 경계선이면 물러나지 않는다 (장외 반칙 회피)
      if (choice === 'retreat' && this.backSpace(self) < 34 && Math.random() < P.edgeAwareness) {
        choice = s.strikeType === 'do' ? 'none' : 'guard';
      }
      if (choice === 'debana') {
        // 출발기: 상대가 치러 나오는 순간을 짧고 빠른 손목으로 끊는다 (먼저 닿을 수 있을 때만)
        const kStart = Math.max(4, Math.round(C.STRIKES.kote.startup / self.strikeSpeedMul * C.PARRY.DEBANA_SPEED));
        const kc = PK.Judge.band('kote', self.reach);
        const d = this.atkDist - C.STRIKES.kote.lunge * C.PARRY.DEBANA_LUNGE;
        if (kStart >= left || !self.canAct || d > kc.max + 4 || d < kc.min) choice = Math.random() < 0.5 ? 'guard' : 'none';
        else { this.queued = 'kote'; this.queuedUntil = f + 2; this.queuedDebana = true; }
      }
      if (choice === 'guard') {
        // parrySkill: 받아치기(정확) / 일찍 눌러 그냥 막기 / 늦어서 맞음
        const roll = Math.random();
        const start = f + Math.max(0, left - C.PARRY.WINDOW + 3);
        this.plainBlock = false;
        if (roll < P.parrySkill) { this.blockFrom = start; this.blockUntil = start + 22; }
        else if (roll < P.parrySkill + (1 - P.parrySkill) * 0.7) { this.blockFrom = f; this.blockUntil = f + left + 22; this.plainBlock = true; choice = 'block'; }
        else { this.blockFrom = f + left + 2; this.blockUntil = this.blockFrom + 10; choice = 'late'; }
      }
      if (choice === 'retreat') this.retreatUntil = f + left + 12;
      this.mode = { guard: '받아치기', block: '막기', late: '늦은 막기', debana: '출발기', retreat: '물러남', none: '무대응' }[choice];
    }

    decideAttack(self, s, dist, f) {
      const C = PK.CONFIG, P = this.P;
      if (this.queued) {
        if (f > this.queuedUntil) { this.queued = null; this.queuedDebana = false; }
        else if (f >= this.queuedFrom) {
          let q = this.queued;
          this.queued = null;
          if (this.queuedFrom > 0) this.mode = '페인트 후 공격';
          this.queuedFrom = -1;
          if (q === 'auto') {
            // 막기 버릇이 보이는 상대면 허리, 아니면 지금 보이는 빈틈으로
            if (Math.random() < Math.min(0.85, 0.3 * this.oppBlocks)) q = 'do';
            else {
              const Oq = PK.Judge.getOpenings(s);
              q = Oq.do >= Oq.men && Oq.do >= Oq.kote ? 'do' : (Oq.kote > Oq.men ? 'kote' : 'men');
            }
          }
          return q;
        } else return null;
      }
      if (!self.canAct) return null;
      // 상대가 다가오는 중이면 매 틱 간격을 본다 (들어오는 순간을 놓치지 않도록)
      if (this.closeV <= 0.3 && --this.decideT > 0) return null;
      this.decideT = P.decisionEvery + (Math.random() * 4 | 0);

      const O = PK.Judge.getOpenings(s);
      const adist = this.atkDist, closeV = this.closeV;
      // 받아치기를 많이 당했으면 머리·손목을 자제하고 허리 비중을 높인다
      const wary = Math.pow(0.75, this.parried);
      const pref = { men: P.targetPref.men * wary, kote: P.targetPref.kote * wary, do: P.targetPref.do * (1 + 0.3 * this.parried) };
      let best = null;
      ['men', 'kote', 'do'].forEach(function (type) {
        const band = PK.Judge.band(type, self.reach);
        const st = Math.round(C.STRIKES[type].startup / self.strikeSpeedMul);
        // 디딤 + 준비 동안 상대가 다가올 거리까지 계산한 예상 접촉 거리
        const predicted = adist - C.STRIKES[type].lunge - closeV * st;
        if (predicted < band.min + 1 || predicted > band.max - 1) return;
        const ideal = predicted >= band.idealLo && predicted <= band.idealHi;
        const sc = O[type] * pref[type] * (ideal ? 1 : 0.8);
        if (!best || sc > best.sc) best = { type: type, sc: sc };
      });
      if (!best) return null;
      const kiaiReady = self.kiai >= C.KIAI.REQUIRED || Math.random() > P.kiaiDiscipline;
      if (!kiaiReady) return null;
      const cornered = this.backSpace(self) < 30 ? 0.7 : 1;   // 경계선에 몰리면 더 적극적으로
      if (best.sc >= (P.attackThreshold + this.parried * 0.08) * cornered) { this.mode = '빈틈 공격'; return best.type; }
      // 탐색 돌진 (빈틈이 적어도 가끔 먼저 들어간다)
      if (Math.random() < P.probeChance * P.decisionEvery * wary * wary * wary) {
        this.mode = '돌진';
        return best.type === 'do' ? 'men' : best.type;
      }
      return null;
    }

    decideMove(self, s, dist, f) {
      const C = PK.CONFIG, P = this.P;
      if (--this.jitterT <= 0) {
        this.jitterT = 40 + (Math.random() * 60 | 0);
        this.jitter = rnd(-1, 1) * P.distJitter;
        if (Math.random() < P.semeChance * 40) this.semeUntil = f + 25 + (Math.random() * 20 | 0);
      }
      const adist = this.atkDist;
      let target = P.prefDist + this.jitter;
      if (f < this.semeUntil) { target -= 10; this.mode = '압박(세메)'; }
      // 상대가 무너졌으면 다가간다
      if (s.recoverBad || s.state === 'stun' || s.state === 'stagger') target = Math.min(target, 40);
      let mv = 0;
      if (adist > target + 3) mv = 1;
      else if (adist < target - 3) mv = -1;
      // 상대가 밀고 들어오면 물러나며 간격을 되찾는다 (그래야 칠 수 있다)
      const menBand = PK.Judge.band('men', self.reach);
      const menSt = Math.round(C.STRIKES.men.startup / self.strikeSpeedMul);
      if (this.closeV > 0.3 && adist - C.STRIKES.men.lunge - this.closeV * menSt < menBand.min - 2) {
        mv = -1;
        this.mode = '간격 되찾기';
      }
      // 코등이 싸움: 상대가 밀면 빠지고, 아니면 가끔 밀어붙인다 (20틱마다 결정)
      if (adist < C.CLINCH_DIST + 2) {
        if (f >= this.clinchUntil) {
          this.clinchDir = this.closeV > 0.2 ? -1 : (Math.random() < P.clinchPush * 0.5 ? 1 : -1);
          this.clinchUntil = f + 20;
        }
        mv = this.clinchDir;
        this.mode = mv > 0 ? '코등이 밀기' : '코등이 빠지기';
      }
      // 등 뒤 경계선 인식 (장외 반칙 피하기)
      const back = this.backSpace(self);
      if (mv < 0 && back < 30 && Math.random() < P.edgeAwareness) mv = adist > 30 ? 0 : 1;
      if (mv < 0 && back < 12) mv = 0;
      return mv * self.facing;
    }

    // 등 뒤 경계선까지 남은 거리
    backSpace(self) {
      const C = PK.CONFIG;
      return self.facing > 0 ? self.x - C.COURT_LEFT : C.COURT_RIGHT - self.x;
    }

    manageKiai(self, it, dist) {
      const P = this.P;
      if (this.kiaiHold) {
        it.kiai = true;
        if (self.kiai >= Math.min(100, P.kiaiKeep + 25)) this.kiaiHold = false;
      } else if (self.kiai < P.kiaiKeep && self.state !== 'strike' && Math.random() < (self.kiai < PK.CONFIG.KIAI.REQUIRED ? 0.2 : 0.05)) {
        this.kiaiHold = true;
        it.kiai = true;
        it.kiaiPressed = true;
      }
    }
  }

  // ── 도장 수련 상대 ──
  class TrainerController {
    constructor() {
      this.mode = 'still';
      this.target = 'men';
      this.t = 0;
      this.home = null;
      this.nextAttack = 120;
      this.debug = '';
      this.mode2 = '';
    }

    setMode(mode, target) {
      this.mode = mode;
      this.target = target || null;
      this.t = 0;
      this.nextAttack = 110;
    }

    get modeLabel() { return { still: '정지', present: '부위 열기', attack: '머리 공격' }[this.mode] || this.mode; }

    getIntent(self, opp, w) {
      const C = PK.CONFIG;
      const it = blankIntent();
      self.kiai = 100;          // 수련 상대는 기합이 항상 충분
      self.momentum = 100;
      this.t++;
      if (!self.canAct && self.state !== 'block') return it;
      const dist = Math.abs(self.x - opp.x);
      if (this.home === null) this.home = self.x;

      if (this.mode === 'still' || this.mode === 'present') {
        // 제자리 유지
        if (Math.abs(self.x - this.home) > 2) it.move = Math.sign(this.home - self.x);
        if (this.mode === 'present') {
          const cyc = this.t % 170;
          if (cyc >= 50) it.present = this.target;   // 50틱 겨눔 → 120틱 부위 열기
        }
      } else if (this.mode === 'attack') {
        // 간격을 맞추고 일정한 박자로 머리 치기 (기합으로 미리 알려 줌)
        const want = 44;
        if (this.t < this.nextAttack - 30) {
          if (dist > want + 3) it.move = self.facing;
          else if (dist < want - 3) it.move = -self.facing;
        }
        if (this.t === this.nextAttack - 26) { it.kiaiPressed = true; it.kiai = true; self.telegraphT = 26; }
        if (this.t >= this.nextAttack && self.canAct) {
          const band = PK.Judge.band('men', 0);
          const pred = dist - C.STRIKES.men.lunge;
          if (pred <= band.max - 1 && pred >= band.min) {
            it.attack = 'men';
            it.attackPressed = true;
            this.nextAttack = this.t + 130 + (Math.random() * 40 | 0);
          } else {
            it.move = pred > band.max - 1 ? self.facing : -self.facing;
            if (this.t > this.nextAttack + 40) this.nextAttack = this.t + 40;
          }
        }
      }
      return it;
    }
  }

  class Opponent extends PK.Fighter {
    constructor(opts) {
      const P = PK.CONFIG.AI_PROFILES[opts.profileKey];
      super(Object.assign({
        reach: P.reach, swordLen: P.swordLen, speedMul: P.speedMul,
        strikeSpeedMul: P.strikeSpeedMul, voicePitch: P.voice, swapKey: P.swap
      }, opts));
      this.profileKey = opts.profileKey;
      this.profile = P;
      this.controller = opts.profileKey === 'trainer' ? new TrainerController() : new AIController(opts.profileKey);
    }
  }

  PK.SnapshotHistory = SnapshotHistory;
  PK.AIController = AIController;
  PK.TrainerController = TrainerController;
  PK.Opponent = Opponent;
})(window.PK = window.PK || {});
