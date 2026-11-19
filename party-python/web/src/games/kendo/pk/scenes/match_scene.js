(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 시합 장면 (도장 수련도 같은 장면을 mode:'tutorial' 로 사용)
  //
  //  흐름(flow): intro → ready(준거·개시선) → play → stop(한판/반칙/갈려/시간) → ready … → end
  //  play 한 틱:
  //    기록 저장 → 입력/AI 의도 → 선수 갱신(타격 접촉은 onStrikeActive 에서 해석)
  //    → 몸 충돌 → 잔심 확인 중인 타격 처리(→ 판정 → 심판 깃발 → 한판)
  //    → 기세 경직 → 장외 · 코등이 싸움 · 시간
  // ─────────────────────────────────────────────────────────────
  class MatchScene {
    enter(p) {
      const CF = PK.CONFIG;
      this.p = p;
      this.isTutorial = p.mode === 'tutorial';
      this.stage = new PK.Stage(p.stage || (this.isTutorial ? 'dojo' : 'arena'));
      const prof = CF.AI_PROFILES[p.opponent || 'aggressive'];
      this.player = new PK.Player({ name: '한결', side: 'red', facing: 1, x: 0, voicePitch: 1.1 }, PK.Game.input);
      this.opponent = new PK.Opponent({ name: prof.defaultName, side: 'white', facing: -1, x: 0, profileKey: p.opponent || 'aggressive' });
      this.fighters = [this.player, this.opponent];
      this.referees = new PK.Referees();
      this.rules = new PK.MatchRules({ timeSec: CF.MATCH.TIME_SEC, toWin: CF.MATCH.POINTS_TO_WIN });
      this.fx = new PK.FX();
      this.history = new PK.SnapshotHistory(90);
      this.pending = [];
      this.outPending = null;
      this.frame = 0;
      this.hitstop = 0;
      this.flashT = 0;
      this.shakeT = 0;
      this.shakeAmp = 0;
      this.bigText = null;
      this.banner = null;
      this.lastJudge = null;
      this.paused = false;
      this.pauseSel = 0;
      this.pausePressT = 0;
      this.clinchT = 0;
      this.lockMsgT = 0;
      this.phase2Shown = false;
      this.hanteiScore = { red: 0, white: 0 };   // 판정승용: 판정받은 타격 점수 누계
      this.stats = { attempts: 0, contacts: 0, ippons: 0, best: 0, kikentai: 0, parries: 0, whiffs: 0 };
      this.events = this.makeEvents();
      this.world = { frame: 0, events: this.events, history: this.history, scene: this };
      this.resetPositions();
      this.camX = this.camTarget();
      this.tutorial = this.isTutorial ? new PK.TutorialDirector(this) : null;
      PK.Audio.playBgm(p.bgm || (this.isTutorial ? 'dojo' : 'match'));
      if (this.isTutorial) {
        this.setFlow('play');
      } else {
        this.banner = { text: '홍 한결  VS  백 ' + this.opponent.name, t: 0 };
        this.fighters.forEach(function (f) { f.freeze('sonkyo'); });
        this.setFlow('intro', 80, () => this.beginPoint(true));
      }
    }

    // ── 흐름 관리 ──
    setFlow(name, dur, onEnd) {
      this.flow = { name: name, t: 0, dur: dur || 0, onEnd: onEnd || null };
    }

    resetPositions() {
      const CF = PK.CONFIG;
      this.player.reset(CF.COURT_CENTER - CF.START_GAP);
      this.opponent.reset(CF.COURT_CENTER + CF.START_GAP);
      if (this.opponent.controller.reset) this.opponent.controller.reset();
      this.player.controller.clear();
      this.history.clear();
      this.pending = [];
      this.outPending = null;
      this.clinchT = 0;
    }

    // 다음 판 시작 준비 (처음엔 준거 자세에서 일어남)
    beginPoint(first) {
      this.resetPositions();
      this.referees.reset();
      this.fighters.forEach(function (f) { f.freeze(first ? 'sonkyo' : 'frozen'); });
      this.setFlow('ready', first ? 50 : 30, () => this.callHajime());
    }

    callHajime() {
      const label = this.rules.encho ? '연장 시작!' : this.rules.isShobu ? '승부!' : this.rules.totalPoints > 0 ? '두 번째 판!' : '시작!';
      this.referees.hajime(label);
      PK.Audio.voice(this.rules.isShobu ? 'shobu' : 'hajime', 0.62);
      PK.Audio.sfx('taiko');
      this.bigText = { text: label, sub: '', t: 0, dur: 50, color: PK.COL.white, scale: 2 };
      // "시작!" 과 함께 두 선수 모두 기합을 지르며 일어선다
      const K = PK.CONFIG.KIAI;
      this.fighters.forEach(function (f) { f.setState('idle'); f.kiai = Math.max(f.kiai, K.REQUIRED + 15); });
      PK.Audio.voice('kiai', this.opponent.voicePitch);
      this.setFlow('play');
    }

    stopPlay(dur, then) {
      this.pending = [];
      this.outPending = null;
      this.setFlow('stop', dur, then);
    }

    other(f) { return f === this.player ? this.opponent : this.player; }

    // ── 선수가 장면에 알리는 사건들 ──
    makeEvents() {
      const self = this;
      return {
        onKiai(f) {
          PK.Audio.voice('kiai', f.voicePitch * 1.1);
        },
        onStep(f) {
          if (Math.random() < 0.5) PK.Audio.sfx('step');
          self.fx.dust(f.x - f.facing * 4, PK.CONFIG.GROUND_Y, f.facing, 2);
        },
        onStrikeStart(f) {
          if (f === self.player) self.stats.attempts++;
        },
        onStrikeActive(f) { return self.onStrikeActive(f); }
      };
    }

    // 타격이 닿는 틱 — Judge.resolveStrike 결과에 따라 연출과 기세 변화
    onStrikeActive(att) {
      // 시합이 멈춘 뒤(한판 선언 후 등) 마저 내려온 타격은 판정·연출 없이 흘려보낸다
      if (this.flow.name !== 'play') return { kind: 'whiff' };
      // 시계가 0:00 에서 마지막 판정을 기다리는 동안 새 타격은 인정하지 않는다
      if (!this.isTutorial && !this.rules.encho && this.rules.timeLeft === 0) return { kind: 'whiff' };
      const CF = PK.CONFIG, M = CF.MOMENTUM, COL = PK.COL;
      const def = this.other(att);
      const s = att.strike;
      const res = PK.Judge.resolveStrike(att, def);
      const midX = (att.x + def.x) / 2;
      const GY = CF.GROUND_Y;
      att.lastResult = res.kind;
      // 발구름은 언제나
      PK.Audio.sfx('stomp');
      this.fx.dust(att.x + att.facing * 6, GY, att.facing, 6);

      switch (res.kind) {
        case 'whiff':
          PK.Audio.sfx('whiff');
          att.addMomentum(-M.WHIFF);
          if (att === this.player) this.stats.whiffs++;
          this.fx.float('헛침', att.x, GY - 40, COL.lgrey);
          break;
        case 'parried':
          PK.Audio.sfx('parry');
          this.fx.spark(midX, GY - 26, 14);
          att.stagger(CF.PARRY.STAGGER);
          att.addMomentum(-M.PARRIED);
          def.blockHit = true;
          def.onParry();
          if (att.controller.onParried) att.controller.onParried();
          this.hitstop = CF.FX.HITSTOP_CLASH;
          this.shake(1, 4);
          this.fx.float('받아치기!', def.x, GY - 42, COL.gold, { font: 'M' });
          if (def === this.player) this.stats.parries++;
          if (this.tutorial) this.tutorial.onParry(def);
          break;
        case 'blocked':
          PK.Audio.sfx('clash');
          this.fx.spark(midX, GY - 28, 8);
          att.addMomentum(-M.BLOCKED);
          def.addMomentum(M.BLOCK_GAIN);
          def.blockHit = true;
          this.hitstop = 2;
          this.fx.float('막힘', att.x, GY - 40, COL.lgrey);
          break;
        case 'deflected':
          PK.Audio.sfx('clash');
          this.fx.spark(midX, GY - 20, 6);
          att.addMomentum(-M.DEFLECTED);
          this.hitstop = 2;
          this.fx.float('빈틈 없음', att.x, GY - 40, COL.lgrey);
          break;
        case 'contact': {
          PK.Audio.sfx('hit');
          if (s.kiaiOk) PK.Audio.voice(s.type, att.voicePitch);
          const ty = s.type === 'men' ? GY - 30 : s.type === 'kote' ? GY - 17 : GY - 13;
          const tx = def.x + def.facing * (s.type === 'kote' ? 8 : 3);
          this.fx.hit(tx, ty, att.facing);
          this.fx.spark(tx, ty, 5, [COL.white, COL.cream]);
          this.hitstop = CF.FX.HITSTOP_CONTACT;
          this.shake(1, 4);
          def.flinch();
          def.addMomentum(-M.GOT_HIT);
          const rec = {
            att: att, def: def, side: att.side, type: s.type,
            contactFrame: this.frame, dist: res.dist, band: PK.Judge.band(s.type, att.reach),
            tooClose: res.tooClose, opening: res.opening, openReason: res.reason,
            kiaiOk: s.kiaiOk, kiaiGauge: s.kiaiGauge,
            kiaiTimed: (this.frame - att.lastKiaiPress) <= CF.KIAI.TIMING_WINDOW,
            counter: s.counter, debana: res.defPhase === 'windup',
            momentum: s.momentumAtStart, backward: s.moveRelAtStart < 0,
            zanshinT: 0, retreatT: 0, zanshinBroken: null, aiuchi: false
          };
          // 상타: 서로 거의 동시에 "유효할 수 있는" 타격이 맞았으면 둘 다 무효
          const canScore = function (r) { return r.kiaiOk && !r.tooClose; };
          if (canScore(rec)) {
            for (let i = 0; i < this.pending.length; i++) {
              const p = this.pending[i];
              if (p.att !== att && canScore(p) && this.frame - p.contactFrame <= CF.AIUCHI_TICKS) { p.aiuchi = true; rec.aiuchi = true; }
            }
          }
          this.pending.push(rec);
          if (att === this.player) this.stats.contacts++;
          break;
        }
      }
      return res;
    }

    // ── 잔심 확인 → 판정 ──
    updatePending(pi, oi) {
      const CF = PK.CONFIG;
      const list = this.pending.slice();
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        rec.zanshinT++;
        const intent = rec.att === this.player ? pi : oi;
        if (!rec.zanshinBroken) {
          if (intent.attackPressed || intent.blockPressed) rec.zanshinBroken = '잔심 중 다시 공격/막기 입력';
          else if (rec.att.moveRel < 0 && ++rec.retreatT > CF.ZANSHIN.RETREAT_MAX) rec.zanshinBroken = '잔심 중 물러남';
          if (rec.att.state === 'stagger' || rec.att.state === 'stun') rec.zanshinBroken = '자세가 무너짐';
        }
        if (rec.zanshinT >= CF.ZANSHIN.TICKS) {
          this.pending.splice(this.pending.indexOf(rec), 1);
          this.judgeRecord(rec);
          if (this.flow.name !== 'play') return;
        }
      }
    }

    judgeRecord(rec) {
      const COL = PK.COL;
      const ev = PK.Judge.evaluateStrike(rec);
      const votes = this.referees.vote(ev, rec.side);
      const n = votes.filter(function (v) { return v === rec.side; }).length;
      const ippon = ev.valid && n >= 2;
      this.referees.show(votes);
      this.lastJudge = { ev: ev, votes: votes, rec: rec, ippon: ippon, n: n, t: 0 };
      this.hanteiScore[rec.side] += ev.quality * (ev.valid ? 1 : 0.4);
      if (rec.att === this.player) {
        this.stats.best = Math.max(this.stats.best, ev.quality);
        if (ev.tags.indexOf('기검체일치') >= 0) this.stats.kikentai++;
      }
      if (this.tutorial) this.tutorial.onJudgement(rec, ev, ippon);
      if (ippon) { this.awardIppon(rec, ev); return; }
      // 한판이 아님 — 이유를 짧게 띄운다
      if (n === 0 && !votes.some(function (v) { return v === 'wave'; })) PK.Audio.sfx('nope');
      const reason = ev.mainReason || (n === 1 ? '깃발 1개 — 한판 부족' : '판정 점수 부족 (빈틈이 작다)');
      this.fx.float(reason, rec.att.x, PK.CONFIG.GROUND_Y - 48, rec.att === this.player ? COL.yellow : COL.lgrey, { life: 90 });
    }

    awardIppon(rec, ev) {
      const CF = PK.CONFIG, COL = PK.COL;
      const name = CF.STRIKES[rec.type].name;
      this.hitstop = CF.FX.HITSTOP_IPPON;
      this.flashT = CF.FX.FLASH_TICKS;
      this.shake(CF.FX.SHAKE_IPPON, 16);
      PK.Audio.sfx('ippon');
      if (this.stage.kind === 'arena') PK.Audio.sfx('cheer');
      this.stage.cheer();
      this.fx.sparkle(rec.def.x, CF.GROUND_Y - 26, 30);
      const tag = ev.tags.length ? ' · ' + ev.tags.join(' · ') : '';
      this.bigText = { text: '한판!', sub: name + tag, t: 0, dur: 110, color: rec.side === 'red' ? COL.red : COL.white, scale: 3 };
      if (rec.att === this.player) this.stats.ippons++;
      this.fighters.forEach(function (f) { if (f.state !== 'strike') f.freeze('frozen'); });

      if (this.isTutorial) {
        this.stopPlay(100, () => { this.resetPositions(); this.referees.reset(); this.setFlow('play'); });
        return;
      }
      const res = this.rules.award(rec.side, rec.type);
      this.onPointAwarded();
      this.stopPlay(130, () => {
        if (res.winner) this.endMatch(res.winner);
        else this.beginPoint(false);
      });
    }

    // 누구든 한 판을 따면: 사범님은 2판째 패턴으로
    onPointAwarded() {
      const ctrl = this.opponent.controller;
      if (!this.isTutorial && ctrl.enterPhase2 && ctrl.enterPhase2(this.opponent)) this.phase2Shown = true;
    }

    // 장외 반칙
    hansoku(f) {
      const COL = PK.COL;
      PK.Audio.sfx('foul');
      PK.Audio.voice('yame', 0.62);
      const r = this.rules.addHansoku(f.side);
      if (r.converted) this.onPointAwarded();
      this.referees.show(['wave', 'wave', 'wave']);
      this.fighters.forEach(function (x) { x.freeze('frozen'); });
      this.bigText = { text: '장외 반칙!', sub: f.name + (r.converted ? ' · 반칙 2회 — 상대 한 판' : ' · 반칙 ' + r.count + '회'), t: 0, dur: 100, color: COL.gold, scale: 2 };
      this.stopPlay(110, () => {
        if (r.winner) this.endMatch(r.winner);
        else this.beginPoint(false);
      });
    }

    // 코등이 싸움이 길어지면 "갈려!"
    wakare() {
      const CF = PK.CONFIG;
      PK.Audio.voice('wakare', 0.62);
      this.bigText = { text: '갈려!', sub: '코등이 싸움이 길어짐', t: 0, dur: 50, color: PK.COL.white, scale: 2 };
      this.fighters.forEach(function (x) {
        if (x.state === 'stun') x.momentum = Math.max(x.momentum, CF.MOMENTUM.STUN_RECOVER);
        x.freeze('frozen');
      });
      const mid = Math.max(CF.COURT_LEFT + 40, Math.min(CF.COURT_RIGHT - 40, (this.player.x + this.opponent.x) / 2));
      this.stopPlay(50, () => {
        this.player.x = mid - 28;
        this.opponent.x = mid + 28;
        this.clinchT = 0;
        this.history.clear();
        if (this.opponent.controller.reset) this.opponent.controller.reset();
        this.player.controller.clear();
        this.callHajime();
      });
    }

    timeUp() {
      PK.Audio.voice('yame', 0.62);
      PK.Audio.sfx('taiko2');
      this.fighters.forEach(function (x) { x.freeze('frozen'); });
      this.bigText = { text: '그만!', sub: '경기 시간 종료', t: 0, dur: 80, color: PK.COL.white, scale: 2 };
      this.stopPlay(90, () => {
        const w = this.rules.decideOnTime();
        if (w) { this.endMatch(w); return; }
        this.rules.startEncho();
        this.bigText = { text: '연장전!', sub: '먼저 한 판을 따는 쪽이 승리', t: 0, dur: 70, color: PK.COL.gold, scale: 2 };
        this.beginPoint(false);
        this.flow.dur = 70;
      });
    }

    // 연장전 시간 초과 → 심판 판정: 판정받은 타격 내용 + 기세로 각자 깃발
    hantei() {
      const COL = PK.COL, CF = PK.CONFIG;
      PK.Audio.voice('yame', 0.62);
      PK.Audio.sfx('taiko2');
      this.fighters.forEach(function (x) { x.freeze('frozen'); });
      const sc = {
        red: this.hanteiScore.red + this.player.momentum / CF.MOMENTUM.MAX * 0.5,
        white: this.hanteiScore.white + this.opponent.momentum / CF.MOMENTUM.MAX * 0.5
      };
      const votes = this.referees.refs.map(function () {
        const d = sc.red - sc.white + (Math.random() * 2 - 1) * 0.3;
        return d >= 0 ? 'red' : 'white';
      });
      const red = votes.filter(function (v) { return v === 'red'; }).length;
      const winner = this.rules.decideByHantei(red >= 2 ? 'red' : 'white');
      this.referees.show(votes);
      this.bigText = { text: '판정!', sub: '연장 시간 초과 — 심판 판정', t: 0, dur: 90, color: COL.gold, scale: 2 };
      this.stopPlay(100, () => this.endMatch(winner));
    }

    endMatch(winner) {
      const COL = PK.COL;
      this.rules.winner = winner;
      this.pending = [];
      const win = winner === 'red';
      PK.Audio.sfx('taiko2');
      this.bigText = { text: winner === 'red' ? '홍 승!' : '백 승!', sub: (win ? this.player.name : this.opponent.name) + ' 승리', t: 0, dur: 140, color: winner === 'red' ? COL.red : COL.white, scale: 3 };
      this.referees.show([winner, winner, winner]);
      this.setFlow('end', 150, () => {
        PK.Flow.afterMatch(this.p, win, Object.assign({ points: this.rules.points, opponent: this.opponent.name, decidedBy: this.rules.decidedBy }, this.stats));
      });
    }

    finishTutorial() {
      this.setFlow('end', 60, () => { if (this.p.onDone) this.p.onDone(); else PK.Flow.title(); });
    }

    // ── 몸 충돌 (서로 통과하지 못하고, 더 세게 미는 쪽이 민다) ──
    resolveBodies() {
      const CF = PK.CONFIG;
      const a = this.player, b = this.opponent;
      const d = b.x - a.x;
      if (d < CF.BODY_MIN_DIST) {
        const over = CF.BODY_MIN_DIST - d;
        // 버티는 힘(0.5)이 있어 가만히 선 상대는 절반만 밀린다
        const pa = Math.max(0, a.vx) + (a.state === 'strike' ? 0.6 : 0) + 0.5;
        const pb = Math.max(0, -b.vx) + (b.state === 'strike' ? 0.6 : 0) + 0.5;
        const ra = pb / (pa + pb);
        a.x -= over * ra;
        b.x += over * (1 - ra);
        if (a.vx > 0) a.vx *= 0.3;
        if (b.vx < 0) b.vx *= 0.3;
      }
      this.fighters.forEach(function (f) { f.x = Math.max(10, Math.min(CF.WORLD_W - 10, f.x)); });
      if (this.isTutorial) {
        // 수련에서는 장외 없음 — 경기장 안으로만
        this.fighters.forEach(function (f) { f.x = Math.max(CF.COURT_LEFT + 4, Math.min(CF.COURT_RIGHT - 4, f.x)); });
      }
    }

    // 장외: 판정 대기 중인 타격이 있으면 먼저 판정하고(한판이 우선), 그 뒤에 반칙을 준다
    checkOut() {
      const CF = PK.CONFIG;
      for (let i = 0; i < this.fighters.length; i++) {
        const f = this.fighters[i];
        if (f.x < CF.COURT_LEFT - CF.OUT_MARGIN || f.x > CF.COURT_RIGHT + CF.OUT_MARGIN) {
          if (this.pending.length) { if (!this.outPending) this.outPending = f; continue; }
          this.hansoku(f);
          return;
        }
      }
      if (!this.pending.length && this.outPending) {
        const f = this.outPending;
        this.outPending = null;
        this.hansoku(f);
      }
    }

    checkClinch() {
      const CF = PK.CONFIG;
      const d = Math.abs(this.player.x - this.opponent.x);
      if (d < CF.CLINCH_DIST && this.player.state !== 'strike' && this.opponent.state !== 'strike') {
        if (++this.clinchT > CF.CLINCH_WAKARE_TICKS && !this.pending.length) this.wakare();
      } else if (d > CF.CLINCH_DIST + 6) this.clinchT = 0;
    }

    checkStun() {
      this.fighters.forEach((f) => {
        if (f.momentum <= 0 && f.state !== 'stun' && f.state !== 'frozen' && f.state !== 'sonkyo') {
          f.stun();
          PK.Audio.sfx('stun');
          this.fx.float('기세가 꺾였다!', f.x, PK.CONFIG.GROUND_Y - 44, PK.COL.orange, { font: 'S' });
        }
      });
    }

    shake(amp, t) {
      this.shakeAmp = Math.max(this.shakeAmp, amp);
      this.shakeT = Math.max(this.shakeT, t);
    }

    camTarget() {
      const CF = PK.CONFIG;
      const mid = (this.player.x + this.opponent.x) / 2;
      return Math.max(0, Math.min(CF.WORLD_W - CF.SCREEN_W, mid - CF.SCREEN_W / 2));
    }

    // ── 매 틱 ──
    update() {
      const I = PK.Game.input;
      if (PK.Game.scenes.busy && this.flow.name !== 'play') { this.tickVisual(); return; }

      if (this.paused) { this.updatePause(); return; }
      if (I.pressed('pause') && this.flow.name !== 'end') { this.paused = true; this.pauseSel = 0; PK.Audio.sfx('blip'); return; }
      if (this.isTutorial && I.pressed('skip')) { this.tutorial.skip(); PK.Audio.sfx('confirm'); }

      if (this.hitstop > 0) { this.hitstop--; this.tickVisual(true); return; }

      const f = this.flow;
      f.t++;
      if (f.name === 'play') this.stepPlay();
      else this.stepIdle();
      if (this.flow === f && f.dur && f.t >= f.dur && f.onEnd) {
        const cb = f.onEnd;
        f.onEnd = null;
        cb();
      }
      if (this.tutorial) this.tutorial.update();
      this.tickVisual();
    }

    // 연출만 진행 (히트 스톱 중에도)
    tickVisual(frozen) {
      if (!frozen) this.fx.update();
      this.stage.update();
      this.referees.update((this.player.x + this.opponent.x) / 2);
      if (this.flashT > 0) this.flashT--;
      if (this.shakeT > 0) this.shakeT--; else this.shakeAmp = 0;
      if (this.bigText && ++this.bigText.t > this.bigText.dur) this.bigText = null;
      if (this.banner) this.banner.t++;
      if (this.lastJudge) this.lastJudge.t++;
      if (this.lockMsgT > 0) this.lockMsgT--;
      const target = this.camTarget();
      this.camX += (target - this.camX) * 0.12;
    }

    // 시합이 멈춘 동안: 입력 없이 선수만 자연스럽게 정리
    stepIdle() {
      const none = { move: 0 };
      this.frame++;
      this.world.frame = this.frame;
      this.player.update(none, this.world);
      this.opponent.update(none, this.world);
      this.resolveBodies();
    }

    stepPlay() {
      this.frame++;
      this.world.frame = this.frame;
      this.history.push(this.fighters);
      const pi = this.player.controller.getIntent(this.player);
      const oi = this.opponent.controller.getIntent(this.opponent, this.player, this.world);
      if (pi.tsuki) { PK.Audio.sfx('lock'); this.lockMsgT = 90; }
      this.lastIntents = { pi: pi, oi: oi };
      this.player.update(pi, this.world);
      if (this.flow.name !== 'play') return;
      this.opponent.update(oi, this.world);
      if (this.flow.name !== 'play') return;
      this.resolveBodies();
      this.updatePending(pi, oi);
      if (this.flow.name !== 'play') return;
      this.checkStun();
      if (!this.isTutorial) {
        this.checkOut();
        if (this.flow.name !== 'play') return;
        this.checkClinch();
        if (this.flow.name !== 'play') return;
        this.rules.tick();
        if (!this.rules.encho && this.rules.timeLeft === 0 && !this.pending.length) this.timeUp();
        else if (this.rules.enchoOver && !this.pending.length) this.hantei();
      }
    }

    // ── 일시정지 ──
    pauseItems() {
      const items = [
        { label: '계속하기', act: 'resume' },
        { label: '디버그 모드: ' + (PK.Game.debug ? '켜짐' : '꺼짐'), act: 'debug' },
        { label: '소리: ' + (PK.Audio.muted ? '꺼짐' : '켜짐'), act: 'mute' }
      ];
      if (this.isTutorial) items.push({ label: '이번 수련 건너뛰기', act: 'skip' });
      items.push({ label: '타이틀로', act: 'title' });
      return items;
    }

    updatePause() {
      const I = PK.Game.input;
      const items = this.pauseItems();
      if (this.pausePressT > 0) {
        if (--this.pausePressT === 0) this.doPause(items[this.pauseSel].act);
        return;
      }
      if (I.pressed('pause')) { this.paused = false; PK.Audio.sfx('cancel'); return; }
      if (I.pressed('up')) { this.pauseSel = (this.pauseSel + items.length - 1) % items.length; PK.Audio.sfx('blip'); }
      if (I.pressed('down')) { this.pauseSel = (this.pauseSel + 1) % items.length; PK.Audio.sfx('blip'); }
      if (I.pressed('confirm')) { this.pausePressT = 6; PK.Audio.sfx('confirm'); }
    }

    doPause(act) {
      if (act === 'resume') this.paused = false;
      else if (act === 'debug') PK.Game.debug = !PK.Game.debug;
      else if (act === 'mute') PK.Audio.setMuted(!PK.Audio.muted);
      else if (act === 'skip') { this.tutorial.skip(); this.paused = false; }
      else if (act === 'title') { this.paused = false; PK.Flow.title(); }
    }

    // ─────────────────────────────────────────────
    // 그리기
    // ─────────────────────────────────────────────
    render(g) {
      const CF = PK.CONFIG, COL = PK.COL, D = PK.Draw;
      const camX = Math.round(this.camX);
      let sx = 0, sy = 0;
      if (this.shakeT > 0 && this.shakeAmp > 0) {
        sx = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
        sy = Math.round((Math.random() * 2 - 1) * this.shakeAmp * 0.6);
      }
      g.save();
      g.translate(sx, sy);
      this.stage.drawBack(g, camX);
      this.stage.drawCourt(g, camX);
      if (PK.Game.debug || (this.tutorial && this.tutorial.index === 0)) this.drawMaaiGuide(g, camX);
      this.referees.draw(g, camX);
      // 선수 그림자 + 선수 (치는 쪽이 위에)
      const order = this.opponent.state === 'strike' && this.player.state !== 'strike' ? [this.player, this.opponent] : [this.opponent, this.player];
      order.forEach(function (f) { D.shadow(g, Math.round(f.x - camX), CF.GROUND_Y, 22, COL.outline, 9); });
      order.forEach(function (f) { PK.FighterRenderer.draw(g, f, camX, CF.GROUND_Y); });
      this.drawFighterMarks(g, camX);
      this.fx.draw(g, camX);
      this.stage.drawFront(g, camX);
      g.restore();

      // 한판 순간 흰 플래시 → 디더로 사라짐
      if (this.flashT > 0) {
        const lv = this.flashT > CF.FX.FLASH_TICKS - 2 ? 16 : Math.round(16 * this.flashT / CF.FX.FLASH_TICKS);
        D.dither(g, 0, 0, CF.SCREEN_W, CF.SCREEN_H, COL.white, lv);
      }

      this.drawHUD(g);
      if (this.tutorial) this.tutorial.draw(g);
      this.referees.drawCutin(g);
      this.drawBigText(g);
      if (this.banner && this.flow.name === 'intro') this.drawBanner(g);
      if (this.lockMsgT > 0) PK.Font.draw(g, '찌름 — 아직 배우지 않은 기술이다', 160, 100, { font: 'S', color: COL.orange, outline: COL.outline, align: 'center' });
      if (this.phase2Shown && this.flow.name === 'ready') PK.Font.draw(g, '사범님의 기세가 달라졌다…', 160, 100, { font: 'S', color: COL.pink, outline: COL.outline, align: 'center' });
      if ((this.tutorial && this.lastJudge && this.lastJudge.t < 240 && this.lastJudge.rec.att === this.player) || (PK.Game.debug && this.lastJudge)) this.drawJudgeNotes(g);
      if (PK.Game.debug) this.drawDebug(g, camX);
      if (this.paused) this.drawPause(g);
    }

    drawBanner(g) {
      const COL = PK.COL;
      const t = this.banner.t;
      const w = Math.min(240, t * 16);
      PK.UI.box(g, 160 - (w >> 1), 74, w, 26, 'gold');
      if (w >= 240) PK.Font.draw(g, this.banner.text, 160, 81, { font: 'M', color: COL.white, outline: COL.outline, align: 'center' });
    }

    drawBigText(g) {
      const b = this.bigText;
      if (!b) return;
      const COL = PK.COL;
      // 떨어지며 튕기는 등장 (정수 배율만 사용)
      const scale = b.t < 3 ? b.scale + 1 : b.scale;
      const drop = b.t < 6 ? (6 - b.t) * 4 : 0;
      const y = 74 - drop - (scale - 2) * 6;
      PK.Font.draw(g, b.text, 160, y, { font: 'M', scale: scale, color: b.color, outline: COL.outline, align: 'center' });
      if (b.sub && b.t > 6) PK.Font.draw(g, b.sub, 160, y + 13 * scale + 2, { font: 'S', color: COL.yellow, outline: COL.outline, align: 'center' });
    }

    // 머리 위 표시: 잔심 확인 중 / 수련 상대 예고
    drawFighterMarks(g, camX) {
      const COL = PK.COL, GY = PK.CONFIG.GROUND_Y;
      this.pending.forEach(function (rec) {
        const x = Math.round(rec.att.x - camX);
        const dots = '.'.repeat(1 + ((rec.zanshinT >> 3) % 3));
        PK.Font.draw(g, rec.zanshinBroken ? '잔심 ×' : '잔심' + dots, x, GY - 46, { font: 'S', color: rec.zanshinBroken ? COL.orange : COL.cyan, outline: COL.outline, align: 'center' });
      });
      const o = this.opponent;
      if (o.telegraphT > 0) PK.Font.draw(g, '!', Math.round(o.x - camX), GY - 48, { font: 'M', color: COL.red, outline: COL.outline, align: 'center' });
      [this.player, this.opponent].forEach(function (f) {
        if (f.counterT > 0) PK.Font.draw(g, '반격!', Math.round(f.x - camX), GY - 46, { font: 'S', color: COL.gold, outline: COL.outline, align: 'center' });
        if (f.state === 'stun' && (f.stateT >> 3) % 2) PK.Font.draw(g, '경직', Math.round(f.x - camX), GY - 46, { font: 'S', color: COL.orange, outline: COL.outline, align: 'center' });
      });
    }

    // 바닥 위 간격 안내: 상대와의 거리 구간을 색 띠로
    drawMaaiGuide(g, camX) {
      const CF = PK.CONFIG, COL = PK.COL, D = PK.Draw;
      const ox = this.opponent.x;
      const y = CF.GROUND_Y + 4;
      const zones = [[23, 35, COL.orange], [36, 46, COL.green], [47, 60, COL.grey]];
      zones.forEach(function (z) {
        const x0 = PK.Stage.screenX(ox - z[1], y, camX), x1 = PK.Stage.screenX(ox - z[0], y, camX);
        D.dither(g, x0, y, x1 - x0, 3, z[2], 10);
      });
      const px = PK.Stage.screenX(this.player.x, y, camX);
      D.rect(g, px, y - 1, 1, 5, COL.white);
    }

    drawHUD(g) {
      const COL = PK.COL, CF = PK.CONFIG, D = PK.Draw;
      PK.UI.box(g, 0, -3, CF.SCREEN_W, 29, 'dark');
      this.drawSide(g, this.player, false);
      this.drawSide(g, this.opponent, true);
      // 가운데 타이머
      PK.UI.box(g, 136, 1, 48, 20, 'gold');
      if (this.isTutorial) {
        PK.Font.draw(g, '수련', 160, 5, { font: 'M', color: COL.cream, align: 'center' });
      } else {
        const low = !this.rules.encho && this.rules.timeLeft < 30 * 60 && ((PK.Game.tick >> 4) % 2);
        PK.Font.draw(g, this.rules.timeText(), 160, 5, { font: 'M', color: this.rules.encho ? COL.gold : low ? COL.red : COL.white, align: 'center' });
        if (this.rules.encho) PK.Font.draw(g, '연장', 160, 22, { font: 'S', color: COL.gold, outline: COL.outline, align: 'center' });
      }
      // 아래 간격 표시 + 수련 키 안내
      const dist = Math.abs(this.player.x - this.opponent.x);
      const m = PK.Judge.maai(dist);
      const mc = { red: COL.red, orange: COL.orange, green: COL.green, grey: COL.lgrey }[m.color];
      PK.Font.draw(g, '간격 · ' + m.label, 316, 169, { font: 'S', color: mc, outline: COL.outline, align: 'right' });
      if (this.isTutorial) {
        PK.Font.draw(g, 'Shift기합 Z머리 X손목 C허리 Space막기', 4, 169, { font: 'S', color: COL.cream, outline: COL.outline });
      }
      void D;
    }

    // 한쪽 선수 패널: 홍/백 표식, 이름, 딴 판, 반칙, 기세·기합 게이지
    //  왼쪽(홍) 기준 좌표로 배치하고, 오른쪽(백)은 좌우 거울상으로 옮긴다
    drawSide(g, f, right) {
      const COL = PK.COL, CF = PK.CONFIG, D = PK.Draw;
      const W = CF.SCREEN_W;
      const X = function (x, w) { return right ? W - x - w : x; };   // 왼쪽 오프셋 → 실제 좌상단 x
      PK.UI.sideTag(g, X(4, 13), 3, f.side);
      const nameW = PK.Font.measure(f.name, 'M');
      PK.Font.draw(g, f.name, X(20, nameW), 2, { font: 'M', color: COL.white });
      if (!this.isTutorial) {
        // 딴 판 (이름 줄 끝)
        const pts = this.rules.points[f.side];
        for (let i = 0; i < CF.MATCH.POINTS_TO_WIN; i++) PK.UI.pointIcon(g, X(104 + i * 13, 11), 2, f.side, pts[i] || null);
        // 반칙 ▲ (게이지 줄 끝)
        const hs = this.rules.hansoku[f.side];
        const tri = PK.Assets.get('icon_hansoku');
        for (let i = 0; i < hs; i++) g.drawImage(tri.canvas, X(114 + i * 8, 7), 15);
      }
      // 기세(초록, 낮으면 주황) / 기합(하늘색 → 필요량을 넘으면 금색, 빨간 선 = 필요량)
      const mv = f.momentum / CF.MOMENTUM.MAX;
      PK.Font.draw(g, '기세', X(4, 18), 14, { font: 'S', color: COL.lgrey });
      PK.UI.bar(g, X(24, 36), 18, 36, 3, mv, mv < 0.3 ? COL.orange : COL.green, { rtl: right, hi: COL.yellow });
      const kv = f.kiai / CF.KIAI.MAX;
      const ok = f.kiai >= CF.KIAI.REQUIRED;
      PK.Font.draw(g, '기합', X(64, 18), 14, { font: 'S', color: ok ? COL.gold : COL.lgrey });
      PK.UI.bar(g, X(84, 26), 18, 26, 3, kv, ok ? COL.gold : COL.sky, { rtl: right, hi: COL.white, mark: CF.KIAI.REQUIRED / CF.KIAI.MAX, markColor: COL.red });
      if (f.kiaiHolding && (PK.Game.tick >> 2) % 2) D.rect(g, X(111, 2), 18, 2, 3, COL.white);
    }

    // 판정 노트: 왜 한판이 됐는지 / 안 됐는지
    drawJudgeNotes(g) {
      const COL = PK.COL;
      const J = this.lastJudge;
      const ev = J.ev;
      const maxW = PK.Game.debug ? 200 : 260;
      const fit = function (t) {
        if (PK.Font.measure(t, 'S') <= maxW) return t;
        while (t.length > 1 && PK.Font.measure(t + '…', 'S') > maxW) t = t.slice(0, -1);
        return t + '…';
      };
      const who = J.rec.att === this.player ? '나' : '상대';
      const lines = [];
      lines.push(['판정 (' + who + '·' + PK.CONFIG.STRIKES[ev.type].name + ') ' + (J.ippon ? '한판!' : '무효'), J.ippon ? COL.gold : COL.lgrey]);
      ev.items.forEach(function (it) {
        const mark = it.penalty ? '△' : it.ok ? '○' : '×';
        lines.push([mark + ' ' + it.label + ': ' + it.note, it.penalty ? COL.orange : it.ok ? COL.green : COL.red]);
      });
      const flags = J.votes.map(function (v) { return v === 'red' ? '홍' : v === 'white' ? '백' : v === 'wave' ? '흔듦' : '-'; }).join(' ');
      lines.push(['점수 ' + ev.quality.toFixed(2) + ' · 깃발 ' + flags + (ev.tags.length ? ' · ' + ev.tags.join(',') : ''), COL.cream]);
      let w = 0;
      const texts = lines.map(function (l) { const t = fit(l[0]); w = Math.max(w, PK.Font.measure(t, 'S')); return t; });
      const x = 4, y = this.isTutorial ? 64 : 28;
      PK.UI.box(g, x, y, w + 12, 8 + lines.length * 10, 'dark');
      texts.forEach(function (t, i) { PK.Font.draw(g, t, x + 6, y + 4 + i * 10, { font: 'S', color: lines[i][1] }); });
    }

    drawDebug(g, camX) {
      const COL = PK.COL, CF = PK.CONFIG, D = PK.Draw;
      const o = this.opponent, p = this.player;
      const dist = Math.abs(p.x - o.x);
      const O = PK.Judge.getOpenings(o.snapshot());
      const ctrl = o.controller;
      const f2 = function (v) { return v.toFixed(2).replace(/^0/, ''); };
      const lines = [
        '틱 ' + this.frame + ' 간격 ' + dist.toFixed(1),
        '나 ' + p.state + (p.strike ? ' ' + p.strike.t + '/' + p.strike.startup : ''),
        'AI ' + (ctrl.mode || ctrl.modeLabel || '') + (ctrl.phase === 2 ? ' ②' : ''),
        '빈틈 머' + f2(O.men) + ' 손' + f2(O.kote) + ' 허' + f2(O.do)
      ];
      PK.UI.box(g, 212, 28, 104, 46, 'dark');
      lines.forEach(function (s, i) { PK.Font.draw(g, s, 217, 32 + i * 10, { font: 'S', color: i === 0 ? COL.cyan : COL.lgrey }); });
      // 내 기술별 "지금 치면 닿는" 범위 (디딤 포함): 머리=하늘 손목=금 허리=분홍
      const y = CF.GROUND_Y + 9;
      ['men', 'kote', 'do'].forEach(function (t, i) {
        const band = PK.Judge.band(t, p.reach), L = CF.STRIKES[t].lunge;
        const x0 = PK.Stage.screenX(p.x + band.min + L, y + i * 2, camX), x1 = PK.Stage.screenX(p.x + band.max + L, y + i * 2, camX);
        D.rect(g, x0, y + i * 2, Math.max(1, x1 - x0), 1, [COL.cyan, COL.gold, COL.pink][i]);
      });
      D.rect(g, PK.Stage.screenX(o.x, y, camX), y - 2, 1, 8, COL.red);
    }

    drawPause(g) {
      const COL = PK.COL;
      PK.UI.dim(g, 9);
      const items = this.pauseItems();
      const h = 30 + items.length * 18;
      const y0 = 90 - (h >> 1);
      PK.UI.box(g, 90, y0, 140, h, 'gold');
      PK.Font.draw(g, '일시정지', 160, y0 + 6, { font: 'M', color: COL.yellow, align: 'center' });
      items.forEach((it, i) => {
        PK.UI.button(g, 102, y0 + 22 + i * 18, 116, 15, it.label, i === this.pauseSel, i === this.pauseSel && this.pausePressT > 0, { font: 'S' });
      });
    }
  }

  PK.MatchScene = MatchScene;
})(window.PK = window.PK || {});
