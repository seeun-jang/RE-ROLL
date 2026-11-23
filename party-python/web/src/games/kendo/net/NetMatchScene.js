// =============================================================
// 검도 시합 장면 2종 — 둘 다 원본 MatchScene 의 그리기(HUD·선수·심판·연출)를 그대로 쓴다.
//
//  NetMatchScene  서버가 진행하는 경기를 비춰 보여 주는 장면. 스스로 판정하지 않고,
//                 서버 상태(duel snapshot)를 선수·규칙에 옮겨 담고 서버 사건에 맞춰 소리·효과만 낸다.
//  PracticeScene  시작 전 연습용. 원본 그대로 브라우저 안에서 AI(공격형)와 겨룬다(순위에 들어가지 않는다).
// =============================================================
import { PK } from '../pk/full.js';

const SIDE_KO = { red: '홍', white: '백' };

export class NetMatchScene extends PK.MatchScene {
  /** o: { redName, whiteName, timeSec, toWin } */
  constructor(o) {
    super();
    const CF = PK.CONFIG;
    this.p = {};
    this.isTutorial = false;
    this.tutorial = null;
    this.stage = new PK.Stage('arena');
    // 원본 장면은 왼쪽 선수를 player, 오른쪽 선수를 opponent 라고 부른다 → 홍 = player, 백 = opponent
    this.player = new PK.Fighter({ name: o.redName, side: 'red', facing: 1, x: CF.COURT_CENTER - CF.START_GAP, voicePitch: 1.1 });
    this.opponent = new PK.Fighter({ name: o.whiteName, side: 'white', facing: -1, x: CF.COURT_CENTER + CF.START_GAP, voicePitch: 0.9 });
    this.fighters = [this.player, this.opponent];
    this.bySide = { red: this.player, white: this.opponent };
    for (const f of this.fighters) f.setState('sonkyo');
    this.referees = new PK.Referees();
    this.rules = new PK.MatchRules({ timeSec: o.timeSec, toWin: o.toWin });
    this.fx = new PK.FX();
    this.pending = [];
    this.frame = 0;
    this.hitstop = 0;
    this.flashT = 0;
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.bigText = null;
    this.banner = { text: `홍 ${o.redName}  VS  백 ${o.whiteName}`, t: 0 };
    this.lastJudge = null;
    this.paused = false;
    this.lockMsgT = 0;
    this.phase2Shown = false;
    this.flow = { name: 'intro', t: 0, dur: 0, onEnd: null };
    this.camX = this.camTarget();
    this.fresh = true;
  }

  /** 서버가 보낸 경기 상태를 옮겨 담는다 */
  applySnapshot(d) {
    this.frame = d.frame;
    this.hitstop = d.hitstop;
    this.flow.name = d.flow[0];
    this.flow.t = d.flow[1];
    this.flow.dur = d.flow[2];
    this.rules.timeLeft = d.timeLeft;
    this.rules.points = d.points;
    this.rules.hansoku = d.hansoku;
    this.rules.winner = d.winner;
    for (const side of ['red', 'white']) {
      const v = d[side];
      const f = this.bySide[side];
      // 위치는 살짝 이어 붙인다(서버 상태는 초당 30번 온다). 크게 벌어지면 바로 맞춘다
      f.x = this.fresh || Math.abs(v.x - f.x) > 8 ? v.x : f.x + (v.x - f.x) * 0.6;
      f.state = v.state;
      f.stateT = v.stateT;
      f.momentum = v.momentum;
      f.kiai = v.kiai;
      f.kiaiHolding = v.kiaiHolding;
      f.strike = v.strike
        ? { type: v.strike[0], t: v.strike[1], startup: v.strike[2], recover: v.strike[3], extra: v.strike[4], bad: v.strike[5], result: v.strike[6] }
        : null;
      f.blockT = v.blockT;
      f.counterT = v.counterT;
      f.flinchT = v.flinchT;
      f.squashT = v.squashT;
      f.stepFrame = v.stepFrame;
    }
    this.pending = d.pending.map(([side, zanshinT, broken]) => ({ att: this.bySide[side], zanshinT, zanshinBroken: broken }));
    this.fresh = false;
  }

  shakeNow(amp, t) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, t);
  }

  /** 서버 사건 → 소리·효과 (원본 장면의 연출 부분) */
  handleEvent(e) {
    const CF = PK.CONFIG;
    const COL = PK.COL;
    const GY = CF.GROUND_Y;
    const att = e.side ? this.bySide[e.side] : null;
    const def = att ? this.other(att) : null;
    switch (e.type) {
      case 'hajime':
        this.referees.hajime(e.label);
        PK.Audio.voice(e.shobu ? 'shobu' : 'hajime', 0.62);
        PK.Audio.sfx('taiko');
        this.bigText = { text: e.label, sub: '', t: 0, dur: 50, color: COL.white, scale: 2 };
        PK.Audio.voice('kiai', this.opponent.voicePitch);
        break;
      case 'kiai':
        PK.Audio.voice('kiai', att.voicePitch * 1.1);
        break;
      case 'step':
        if (Math.random() < 0.5) PK.Audio.sfx('step');
        this.fx.dust(att.x - att.facing * 4, GY, att.facing, 2);
        break;
      case 'strike': {
        const midX = (att.x + def.x) / 2;
        PK.Audio.sfx('stomp');
        this.fx.dust(att.x + att.facing * 6, GY, att.facing, 6);
        if (e.kind === 'whiff') {
          PK.Audio.sfx('whiff');
          this.fx.float('헛침', att.x, GY - 40, COL.lgrey);
        } else if (e.kind === 'parried') {
          PK.Audio.sfx('parry');
          this.fx.spark(midX, GY - 26, 14);
          this.shakeNow(1, 4);
          this.fx.float('받아치기!', def.x, GY - 42, COL.gold, { font: 'M' });
        } else if (e.kind === 'blocked') {
          PK.Audio.sfx('clash');
          this.fx.spark(midX, GY - 28, 8);
          this.fx.float('막힘', att.x, GY - 40, COL.lgrey);
        } else if (e.kind === 'deflected') {
          PK.Audio.sfx('clash');
          this.fx.spark(midX, GY - 20, 6);
          this.fx.float('빈틈 없음', att.x, GY - 40, COL.lgrey);
        } else {
          PK.Audio.sfx('hit');
          if (e.kiaiOk) PK.Audio.voice(e.strike, att.voicePitch);
          const ty = e.strike === 'men' ? GY - 30 : e.strike === 'kote' ? GY - 17 : GY - 13;
          const tx = def.x + def.facing * (e.strike === 'kote' ? 8 : 3);
          this.fx.hit(tx, ty, att.facing);
          this.fx.spark(tx, ty, 5, [COL.white, COL.cream]);
          this.shakeNow(1, 4);
        }
        break;
      }
      case 'judge': {
        this.referees.show(e.votes);
        if (e.ippon) {
          const name = CF.STRIKES[e.strike].name;
          this.flashT = CF.FX.FLASH_TICKS;
          this.shakeNow(CF.FX.SHAKE_IPPON, 16);
          PK.Audio.sfx('ippon');
          PK.Audio.sfx('cheer');
          this.stage.cheer();
          this.fx.sparkle(def.x, GY - 26, 30);
          const tag = e.tags.length ? ` · ${e.tags.join(' · ')}` : '';
          this.bigText = { text: '한판!', sub: name + tag, t: 0, dur: 110, color: e.side === 'red' ? COL.red : COL.white, scale: 3 };
        } else {
          if (!e.votes.some((v) => v === 'wave' || v === e.side)) PK.Audio.sfx('nope');
          this.fx.float(e.reason || '', att.x, GY - 48, COL.yellow, { life: 90 });
        }
        break;
      }
      case 'hansoku':
        PK.Audio.sfx('foul');
        PK.Audio.voice('yame', 0.62);
        this.referees.show(['wave', 'wave', 'wave']);
        this.bigText = {
          text: '장외 반칙!', sub: att.name + (e.converted ? ' · 반칙 2회 — 상대 한 판' : ` · 반칙 ${e.count}회`),
          t: 0, dur: 100, color: COL.gold, scale: 2,
        };
        break;
      case 'wakare':
        PK.Audio.voice('wakare', 0.62);
        this.bigText = { text: '갈려!', sub: '코등이 싸움이 길어짐', t: 0, dur: 50, color: COL.white, scale: 2 };
        break;
      case 'timeup':
        PK.Audio.voice('yame', 0.62);
        PK.Audio.sfx('taiko2');
        this.bigText = { text: '그만!', sub: '경기 시간 종료', t: 0, dur: 80, color: COL.white, scale: 2 };
        break;
      case 'hantei':
        PK.Audio.sfx('taiko2');
        this.referees.show(e.votes);
        this.bigText = { text: '판정!', sub: '동점 — 심판 판정', t: 0, dur: 90, color: COL.gold, scale: 2 };
        break;
      case 'end': {
        const w = this.bySide[e.winner];
        PK.Audio.sfx('taiko2');
        this.bigText = { text: `${SIDE_KO[e.winner]} 승!`, sub: `${w.name} 승리`, t: 0, dur: 140, color: e.winner === 'red' ? COL.red : COL.white, scale: 3 };
        this.referees.show([e.winner, e.winner, e.winner]);
        break;
      }
      case 'stun':
        PK.Audio.sfx('stun');
        this.fx.float('기세가 꺾였다!', att.x, GY - 44, COL.orange, { font: 'S' });
        break;
      default:
        break;
    }
  }

  /** 매 틱: 판정은 하지 않고 연출만 진행한다 */
  update() {
    for (const f of this.fighters) f.animT++;
    this.tickVisual(this.hitstop > 0);
  }
}

/** 시작 전 연습: 원본 시합 장면 그대로, 상대는 AI. 끝나면 onEnd 를 부른다(다시 시작용). */
export class PracticeScene extends PK.MatchScene {
  constructor(o) {
    super();
    this.enter({ mode: 'match', opponent: o.profile, stage: 'dojo', bgm: 'dojo', onEnd: o.onEnd });
    this.player.name = o.name;
    if (this.banner) this.banner.text = `홍 ${o.name}  VS  백 ${this.opponent.name} (연습)`;
  }

  endMatch(winner) {
    const mine = winner === 'red';
    super.endMatch(winner);
    if (this.bigText) this.bigText.sub = `${(mine ? this.player : this.opponent).name} 승리`;
  }
}

// 원본 장면은 경기가 끝나면 PK.Flow.afterMatch 를 부른다 → 연습 장면이 넘겨준 onEnd 로 잇는다
PK.Flow = PK.Flow || {
  afterMatch(p) {
    if (p && p.onEnd) p.onEnd();
  },
  title() {},
};
