// =============================================================
// Flight — 타구 연출 한 번 (원본 scenes/play.js 의 startFlight · updateFlight · updateThrow)
//
// 맞은 순간부터 한 프레임씩 step() 으로 진행한다. 화면은 이 객체의 값(공 · 수비수 · 주자)을 그린다.
// 소리 · 판정 글자처럼 "한 번 일어나는 일"은 step() 이 돌려주는 신호 목록으로 알린다:
//   'safe'(세이프!) · 'catch'(내야수가 잡음) · 'throw'(1루 송구) · 'shown'(결과 글자) · 'out'(1루 아웃)
// 길이는 sim/rules.js 의 flightFrames 와 같다(서버가 그 값으로 다음 공 시각을 정한다).
// =============================================================
import { CONFIG } from '../config.js';
import { BASE1, BASE_DIST, FIELDERS, FIELD_PAUSE, RUN_SPEED, THROW_SPEED, fielderById, polar, stepToward } from '../sim/rules.js';

export const HOLD = CONFIG.FLIGHT_HOLD; // 맞는 순간은 중계 화면에서 잠깐

export class Flight {
  constructor(hit) {
    const dur = Math.max(CONFIG.FLIGHT_MIN, Math.round((hit.hang * 60) / CONFIG.FLIGHT_SPEED));
    const f = fielderById(hit.fielder);
    this.hit = hit;
    this.dur = dur;
    this.t = 0;
    this.extra = hit.result === 'hr' ? 1.12 : 1;
    this.trail = [];
    this.apex = hit.ground ? 0 : Math.max(2, ((hit.v0 * Math.sin((hit.angle * Math.PI) / 180)) ** 2 / (2 * CONFIG.GRAV)) * 0.8);
    this.fielder = f ? { ...polar(f.dir, f.r) } : null;
    this.caught = ['fly', 'pop', 'ground'].includes(hit.result);
    this.shown = false;
    this.showT = 0;
    this.done = false;
    this.ball = null;
    this.moving = false;
    this.runner = null;
    this.cover = null;
    this.play = null;
    this.tag = null;
    // 땅볼: 타자가 1루로 뛰고, 아웃이면 내야수가 잡아서 1루로 던짐 (1루수는 베이스로)
    if (hit.ground && (hit.result === 'ground' || hit.result === 'single')) {
      this.runner = { d: 0, speed: RUN_SPEED };
      this.base = BASE1;
      if (hit.result === 'ground') {
        const isFirst = f && f.id === '1B';
        this.play = 'roll';
        if (!isFirst) {
          const c = FIELDERS.find((q) => q.id === '1B');
          this.cover = { ...polar(c.dir, c.r) };
        }
        // 공이 1루에 닿는 시각을 미리 계산해서, 주자가 조금 늦게 도착하게 맞춤
        const field = polar(hit.dir, Math.min(hit.dist, 38));
        const to = Math.hypot(BASE1.x - field.x, BASE1.z - field.z);
        const arrive = isFirst ? dur + Math.ceil(to / RUN_SPEED) : dur + FIELD_PAUSE + Math.max(14, Math.ceil(to / THROW_SPEED));
        this.runner.speed = Math.min(RUN_SPEED * 1.3, BASE_DIST / (arrive + 12));
      }
    }
  }

  /** 한 프레임 진행. 이번 프레임에 일어난 일의 이름 목록을 돌려준다. */
  step() {
    const cues = [];
    if (this.done) return cues;
    const fl = this;
    fl.t++;
    if (fl.t <= HOLD) return cues;
    // 주자 · 1루 커버
    if (fl.runner && fl.runner.d < BASE_DIST) {
      fl.runner.d = Math.min(BASE_DIST, fl.runner.d + fl.runner.speed);
      if (fl.runner.d >= BASE_DIST && fl.hit.result === 'single') {
        fl.tag = { text: '세이프!', col: 'e', t: 0 };
        cues.push('safe');
      }
    }
    if (fl.cover) stepToward(fl.cover, BASE1, RUN_SPEED * 1.1);
    if (fl.tag) fl.tag.t++;
    if (fl.play && fl.play !== 'roll') {
      this._throw(cues);
      return cues;
    }
    const k = Math.min(fl.extra, (fl.t - HOLD) / fl.dur);
    const h = fl.hit;
    // 땅볼 아웃은 내야수가 잡는 자리까지만 굴러감
    const r = (fl.play === 'roll' ? Math.min(h.dist, 38) : h.dist) * k;
    const pos = polar(h.dir, r);
    const height = h.ground ? Math.abs(Math.sin(k * Math.PI * 3)) * 1.5 * (1 - Math.min(1, k)) : 4 * fl.apex * k * (1 - Math.min(1, k));
    fl.ball = { x: pos.x, z: pos.z, h: Math.max(0, height) };
    fl.trail.push([pos.x, pos.z, Math.max(0, height)]);
    if (fl.trail.length > 30) fl.trail.shift();
    // 수비수가 떨어지는 곳으로 달려감 (잡을 땐 딱 맞춰, 못 잡으면 조금 늦게)
    if (fl.fielder) {
      const land = polar(h.dir, h.ground ? Math.min(h.dist, 38) : h.dist);
      const tx = land.x - fl.fielder.x;
      const tz = land.z - fl.fielder.z;
      const dist = Math.hypot(tx, tz);
      const left = Math.max(1, fl.dur - (fl.t - HOLD));
      const sp = fl.caught ? dist / left : Math.min(dist / left, (CONFIG.FIELDER_RUN * CONFIG.FLIGHT_SPEED) / 60) * 0.8;
      if (dist > 0.3) {
        fl.fielder.x += (tx / dist) * sp;
        fl.fielder.z += (tz / dist) * sp;
        fl.moving = true;
      } else fl.moving = false;
    }
    if (k >= 1 && fl.play === 'roll') {
      fl.play = 'field';
      fl.playT = 0;
      cues.push('catch');
      return cues;
    }
    if (k >= 1 && !fl.shown) {
      fl.shown = true;
      fl.showT = fl.t;
      cues.push('shown');
    }
    if (fl.shown && fl.t - fl.showT >= CONFIG.RESULT_TIME) fl.done = true;
    return cues;
  }

  // 땅볼 아웃: 잡음 → (잠깐) → 1루로 송구 (1루수가 잡았으면 직접 베이스로 뜀) → 아웃!
  _throw(cues) {
    const fl = this;
    fl.playT++;
    const f = fl.fielder;
    const isFirst = fl.hit.fielder === '1B';
    if (fl.play === 'field') {
      fl.ball = { x: f.x, z: f.z, h: 1 };
      fl.trail.length = 0;
      if (isFirst) {
        fl.moving = stepToward(f, BASE1, RUN_SPEED);
        fl.ball = { x: f.x, z: f.z, h: 1 };
        if (!fl.moving) this._outAtFirst(cues);
      } else if (fl.playT >= FIELD_PAUSE) {
        fl.play = 'throw';
        fl.playT = 0;
        fl.from = { x: f.x, z: f.z };
        const d = Math.hypot(BASE1.x - f.x, BASE1.z - f.z);
        fl.throwDur = Math.max(14, Math.ceil(d / THROW_SPEED));
        fl.throwArc = Math.min(4, 1 + d / 12);
        fl.moving = false;
        cues.push('throw');
      }
      return;
    }
    if (fl.play === 'throw') {
      const k = Math.min(1, fl.playT / fl.throwDur);
      const tgt = fl.cover || BASE1;
      const x = fl.from.x + (tgt.x - fl.from.x) * k;
      const z = fl.from.z + (tgt.z - fl.from.z) * k;
      const h = 1.5 + 4 * fl.throwArc * k * (1 - k);
      fl.ball = { x, z, h };
      fl.trail.push([x, z, h]);
      if (fl.trail.length > 14) fl.trail.shift();
      if (k >= 1) this._outAtFirst(cues);
      return;
    }
    if (fl.play === 'out') {
      const tgt = fl.cover || fl.fielder;
      fl.ball = { x: tgt.x, z: tgt.z, h: 1 };
      if (fl.playT >= CONFIG.RESULT_TIME) fl.done = true;
    }
  }

  _outAtFirst(cues) {
    const fl = this;
    fl.play = 'out';
    fl.playT = 0;
    fl.shown = true;
    fl.showT = fl.t;
    fl.trail.length = 0;
    fl.tag = { text: '아웃!', col: '5', t: 0 };
    cues.push('out');
  }
}
