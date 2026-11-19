// 로직 테스트 — node --test tests/logic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG, mergeConfig, resolvePlayers } from '../../src/games/tug/config.js';
import { BeatJudge } from '../../src/games/tug/systems/BeatJudge.js';
import { Rope } from '../../src/games/tug/systems/Rope.js';
import { Team, TeamAssigner, assignTeams } from '../../src/games/tug/systems/Team.js';
import { ScoreBoard } from '../../src/games/tug/systems/ScoreBoard.js';
import { Fever } from '../../src/games/tug/systems/Fever.js';
import { computePower } from '../../src/games/tug/systems/PowerCalculator.js';
import { Player } from '../../src/games/tug/entities/Player.js';
import { PowerSource, KeyboardPowerSource } from '../../src/games/tug/input/PowerSource.js';
import { KeyboardInput } from '../../src/games/tug/input/KeyboardInput.js';

const cfg = mergeConfig({});
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** 시드 고정 난수 (mulberry32) */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- BeatJudge ----------------

test('BeatJudge: reset 과 박 경계', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  assert.equal(b.interval, 0.5);
  assert.equal(b.lastBeatIndex, 0);
  assert.equal(b.nextBeatIndex, 1);
  assert.equal(b.nextBeatTime, 0.5);
  assert.deepEqual(b.update(0.25), []);
  assert.ok(near(b.phase, 0.5));
  assert.ok(near(b.timeToNextBeat(), 0.25));
  assert.deepEqual(b.update(0.25), [1]);
  assert.equal(b.lastBeatTime, 0.5);
  assert.equal(b.nextBeatTime, 1.0);
  // 큰 dt 는 여러 박을 한 번에 넘긴다
  assert.deepEqual(b.update(1.0), [2, 3]);
});

test('BeatJudge: 60fps 스텝으로도 박 수가 정확하다', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  let count = 0;
  for (let i = 0; i < 600; i++) count += b.update(1 / 60).length; // 10초
  assert.ok(count === 19 || count === 20, `count=${count}`);
});

test('BeatJudge: perfect / good / miss 판정', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  b.update(0.55); // 박 1 (0.5) 지남
  let r = b.judge('a', 0.52);
  assert.equal(r.grade, 'perfect');
  assert.equal(r.beatIndex, 1);
  assert.ok(near(r.offset, 0.02));
  r = b.judge('b', 0.4); // 박 1 보다 0.1 이르다 → good
  assert.equal(r.grade, 'good');
  assert.ok(near(r.offset, -0.1));
  r = b.judge('c', 0.7); // 박 1 과 0.2, 박 2 와 0.3 → miss
  assert.equal(r.grade, 'miss');
  assert.equal(r.beatIndex, 1);
  // 다음 박 직전 누름은 다음 박으로 판정
  r = b.judge('d', 0.97);
  assert.equal(r.grade, 'perfect');
  assert.equal(r.beatIndex, 2);
});

test('BeatJudge: 같은 박 재입력과 과도한 연타는 헛힘', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  b.update(0.55);
  assert.equal(b.judge('a', 0.5).grade, 'perfect');
  assert.equal(b.judge('a', 0.53).grade, 'spam'); // 같은 박 두 번째
  // 다음 박에서는 다시 정상 판정
  b.update(0.5);
  assert.equal(b.judge('a', 1.0).grade, 'perfect');

  // 박 사이 연타: SPAM_MAX_PRESSES_PER_BEAT(2) 초과 → 헛힘
  const b2 = new BeatJudge(cfg);
  b2.reset(120);
  b2.update(0.3);
  assert.equal(b2.judge('x', 0.25).grade, 'miss');
  assert.equal(b2.judge('x', 0.27).grade, 'miss');
  assert.equal(b2.judge('x', 0.29).grade, 'spam');
  // 다른 플레이어는 영향 없음
  assert.equal(b2.judge('y', 0.29).grade, 'miss');
  // clearPlayer 후 기록 초기화
  b2.clearPlayer('x');
  assert.equal(b2.judge('x', 0.3).grade, 'miss');
});

test('BeatJudge: 박마다 한 번씩 정확히 누르면 헛힘이 아니다', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  for (let k = 1; k <= 8; k++) {
    b.update(0.5);
    const t = k * 0.5 + (k % 2 ? 0.04 : -0.05);
    const g = b.judge('a', t).grade;
    assert.equal(g, 'perfect', `beat ${k}`);
  }
});

test('BeatJudge: 템포 변경은 다음 박 경계에서 적용', () => {
  const b = new BeatJudge(cfg);
  b.reset(120);
  b.update(0.3);
  b.setBpm(150);
  // 이미 예약된 다음 박 시각은 그대로
  assert.equal(b.bpm, 120);
  assert.equal(b.nextBeatTime, 0.5);
  assert.deepEqual(b.update(0.25), [1]);
  assert.equal(b.bpm, 150);
  assert.ok(near(b.interval, 0.4));
  assert.ok(near(b.nextBeatTime, 0.9));
  assert.deepEqual(b.update(0.4), [2]);
  assert.ok(near(b.lastBeatTime, 0.9));
  assert.ok(near(b.nextBeatTime, 1.3));
  // 다시 원래 템포로
  b.setBpm(120);
  b.update(0.4);
  assert.equal(b.bpm, 120);
  assert.ok(near(b.lastBeatTime, 1.3));
  assert.ok(near(b.nextBeatTime, 1.8));
});

// ---------------- Rope ----------------

test('Rope: 힘 방향, 감쇠, 승자, 우세 팀', () => {
  const r = new Rope(cfg);
  assert.equal(r.winDistance, cfg.WIN_DISTANCE);
  r.addForce('left', 2);
  r.update(1 / 60);
  assert.ok(r.vel < 0, '왼쪽 힘 → 음수 속도');
  assert.ok(r.pos < 0);
  assert.ok(r.leftForce < 2, '힘 감쇠');
  assert.ok(Math.abs(r.vel) <= cfg.ROPE_MAX_SPEED);
  assert.equal(r.winner(), null);

  r.reset();
  r.addForce('right', 100);
  r.update(1 / 60);
  assert.equal(r.vel, cfg.ROPE_MAX_SPEED, '최대 속도 제한');

  r.reset();
  for (let i = 0; i < 600 && !r.winner(); i++) {
    r.addForce('right', 0.2);
    r.update(1 / 60);
  }
  assert.equal(r.winner(), 'right');

  r.reset();
  r.pos = -cfg.WIN_DISTANCE;
  assert.equal(r.winner(), 'left');
  r.pos = -0.5;
  assert.equal(r.leader(), null);
  r.pos = -2;
  assert.equal(r.leader(), 'left');
  r.pos = 3;
  assert.equal(r.leader(), 'right');

  r.reset();
  r.kick(2);
  assert.ok(r.wobble > 0);
  for (let i = 0; i < 120; i++) r.update(1 / 60);
  assert.ok(Math.abs(r.wobble) < 0.1, 'wobble 감쇠');
});

// ---------------- Team / TeamAssigner ----------------

function makePlayers() {
  return resolvePlayers().map((d, i) => new Player(d, i, cfg));
}

test('assignTeams: 멤버·side·slot·인원 보정', () => {
  const players = makePlayers();
  const teams = { left: new Team('left', cfg), right: new Team('right', cfg) };
  assert.equal(teams.left.name, cfg.TEAM_NAMES.left);
  assignTeams(teams, players, { left: ['p2', 'p4'], right: ['p1', 'p3', 'p5'] });
  assert.equal(teams.left.size, 2);
  assert.equal(teams.right.size, 3);
  assert.equal(teams.left.multiplier, cfg.SMALL_TEAM_MULT);
  assert.equal(teams.right.multiplier, 1);
  assert.ok(teams.left.has('p4'));
  assert.ok(!teams.left.has('p1'));
  const p4 = players.find((p) => p.id === 'p4');
  assert.equal(p4.side, 'left');
  assert.equal(p4.slot, 1);
  assert.equal(p4.flip, false);
  assert.equal(players.find((p) => p.id === 'p5').flip, true);
});

const splitKeyOf = (s) => {
  const a = s.left.slice().sort().join(',');
  const b = s.right.slice().sort().join(',');
  return [a, b].sort().join('|');
};

test('TeamAssigner: 2:3 분할, 직전 분할 반복 없음, 기록', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ta = new TeamAssigner(IDS, seeded(seed));
    let prev = null;
    for (let round = 0; round < 8; round++) {
      const s = ta.next();
      assert.equal(s.left.length + s.right.length, 5);
      assert.ok([2, 3].includes(s.left.length));
      assert.equal(new Set([...s.left, ...s.right]).size, 5);
      const key = splitKeyOf(s);
      assert.notEqual(key, prev, `seed ${seed} round ${round}: 직전 분할 반복`);
      prev = key;
    }
    assert.equal(ta.history.length, 8);
    ta.reset();
    assert.equal(ta.history.length, 0);
  }
});

test('TeamAssigner: 3라운드 이상에서 같은 짝이 몰리지 않는다', () => {
  let leftSmall = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const ta = new TeamAssigner(IDS, seeded(seed));
    const rounds = [ta.next(), ta.next(), ta.next()];
    // 3라운드 동안 어떤 쌍도 3번 모두 같은 팀이 아니어야 하고, 최대 2번
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) {
        assert.ok(ta.pairCount(IDS[i], IDS[j]) <= 2, `seed ${seed}: ${IDS[i]}-${IDS[j]}`);
      }
    }
    // 2인 팀(소수 팀)에 같은 사람이 3번 연속 들어가지 않는다
    const smallCount = new Map();
    for (const s of rounds) {
      const small = s.left.length < s.right.length ? s.left : s.right;
      if (small === s.left) leftSmall++;
      for (const id of small) smallCount.set(id, (smallCount.get(id) || 0) + 1);
    }
    for (const [id, c] of smallCount) assert.ok(c <= 2, `seed ${seed}: ${id} small ${c}`);

    // 4라운드까지도 어떤 쌍도 3번 이상 같은 팀이 아니다
    ta.next();
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) {
        assert.ok(ta.pairCount(IDS[i], IDS[j]) <= 2, `seed ${seed} r4: ${IDS[i]}-${IDS[j]}`);
      }
    }
    // 6라운드: 같은 팀 횟수 최대 3, 소수 팀 횟수 최대 3 (고르게 분산)
    ta.next(); ta.next();
    let maxPair = 0;
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) maxPair = Math.max(maxPair, ta.pairCount(IDS[i], IDS[j]));
    }
    assert.ok(maxPair <= 3, `seed ${seed}: maxPair ${maxPair}`);
    const smallTimes = new Map();
    for (const s of ta.history) {
      const small = s.left.length < s.right.length ? s.left : s.right;
      for (const id of small) smallTimes.set(id, (smallTimes.get(id) || 0) + 1);
    }
    for (const [id, c] of smallTimes) assert.ok(c <= 3, `seed ${seed}: ${id} small ${c} in 6 rounds`);
  }
  // 소수 팀 쪽은 좌우 랜덤
  assert.ok(leftSmall > 150 && leftSmall < 450, `leftSmall=${leftSmall}`);
});

// ---------------- ScoreBoard ----------------

test('ScoreBoard: 콤보, 피버, 헛힘, 0점 하한', () => {
  const sb = new ScoreBoard(IDS, cfg);
  sb.startRound(1);
  const S = cfg.SCORE;
  let r = sb.record('p1', 'perfect');
  assert.deepEqual(r, { points: S.perfect + 1 * S.comboStep, combo: 1 });
  r = sb.record('p1', 'good');
  assert.deepEqual(r, { points: S.good + 2 * S.comboStep, combo: 2 });
  r = sb.record('p1', 'perfect', { fever: true });
  assert.equal(r.points, S.perfect * cfg.FEVER_SCORE_MULT + 3 * S.comboStep);
  r = sb.record('p1', 'miss');
  assert.deepEqual(r, { points: 0, combo: 0 });
  assert.equal(sb.get('p1').maxCombo, 3);

  // 콤보 상한
  for (let i = 0; i < S.comboCap + 5; i++) r = sb.record('p2', 'good');
  assert.equal(r.points, S.good + S.comboCap * S.comboStep);

  // 헛힘: 감점, 0 아래로 내려가지 않음
  r = sb.record('p3', 'spam');
  assert.equal(r.points, S.spam);
  assert.equal(sb.get('p3').total, 0);
  assert.equal(sb.get('p3').round, 0);
  assert.equal(sb.get('p3').spam, 1);
  sb.record('p3', 'perfect');
  sb.record('p3', 'spam');
  assert.equal(sb.get('p3').total, S.perfect + S.comboStep + S.spam);
  assert.equal(sb.get('p3').combo, 0);

  // 보너스 점수
  r = sb.record('p4', 'miss', { bonusPoints: 7 });
  assert.equal(r.points, 7);
  sb.addPower('p4', 1.5);
  assert.equal(sb.get('p4').power, 1.5);
});

test('ScoreBoard: 라운드 보너스, 기록, 무승부', () => {
  const players = makePlayers();
  const teams = { left: new Team('left', cfg), right: new Team('right', cfg) };
  const sb = new ScoreBoard(IDS, cfg);
  const S = cfg.SCORE;

  assignTeams(teams, players, { left: ['p1', 'p2'], right: ['p3', 'p4', 'p5'] });
  sb.startRound(1);
  sb.record('p1', 'perfect'); // 105
  const res = sb.endRound(1, 'left', teams);
  assert.equal(res.winnerSide, 'left');
  assert.equal(res.bonus.p1, S.roundWin);
  assert.equal(res.bonus.p3, 0);
  assert.equal(res.roundScores.p1, S.perfect + S.comboStep + S.roundWin);
  assert.equal(sb.get('p1').roundWins, 1);
  assert.equal(sb.get('p3').roundWins, 0);
  assert.deepEqual(sb.get('p1').roundScores, [S.perfect + S.comboStep + S.roundWin]);
  assert.equal(sb.history.length, 1);
  assert.deepEqual(sb.history[0].left, ['p1', 'p2']);
  assert.deepEqual(sb.history[0].right, ['p3', 'p4', 'p5']);
  assert.equal(sb.history[0].round, 1);

  // 라운드 2: 무승부 → 전원 roundDraw, 라운드 점수는 새로 시작
  assignTeams(teams, players, { left: ['p3', 'p4', 'p5'], right: ['p1', 'p2'] });
  sb.startRound(2);
  assert.equal(sb.get('p1').round, 0);
  const res2 = sb.endRound(2, null, teams);
  assert.equal(res2.winnerSide, null);
  for (const id of IDS) assert.equal(res2.bonus[id], S.roundDraw);
  assert.deepEqual(sb.get('p3').roundScores, [0, S.roundDraw]);
  assert.equal(sb.get('p1').total, S.perfect + S.comboStep + S.roundWin + S.roundDraw);
});

test('ScoreBoard: results 정렬, 동점 순위, 공동 우승', () => {
  const players = makePlayers();
  const sb = new ScoreBoard(IDS, cfg);
  sb.startRound(1);
  // p2, p4 동점 최고 / p1, p5 동점 / p3 최저
  sb.record('p2', 'perfect');
  sb.record('p4', 'perfect');
  sb.record('p1', 'good');
  sb.record('p5', 'good');
  const res = sb.results(players);
  assert.deepEqual(res.map((r) => r.playerId), ['p2', 'p4', 'p1', 'p5', 'p3']);
  assert.deepEqual(res.map((r) => r.rank), [1, 1, 3, 3, 5]);
  assert.deepEqual(res.map((r) => r.isWinner), [true, true, false, false, false]);
  assert.equal(res[0].name, 'P2');
  assert.equal(res[0].score, cfg.SCORE.perfect + cfg.SCORE.comboStep);
  assert.equal(res[0].stats.perfect, 1);
  assert.ok(Array.isArray(res[0].stats.roundScores));

  sb.reset();
  assert.equal(sb.get('p2').total, 0);
  assert.equal(sb.history.length, 0);
});

// ---------------- Fever ----------------

test('Fever: 시작/종료 시점, 예고, 배율', () => {
  const f = new Fever(cfg);
  const step = 1 / 60;
  const events = [];
  let warnedBeforeFirst = false;
  for (let i = 0; i < 30 * 60; i++) {
    const e = f.update(step);
    if (f.warning && f.elapsed < cfg.FEVER_FIRST) warnedBeforeFirst = true;
    if (e) events.push({ e, t: f.elapsed });
  }
  assert.ok(warnedBeforeFirst);
  // 30초 라운드: 8~12, 18~22, 28~32(진행 중)
  assert.deepEqual(events.map((x) => x.e), ['start', 'end', 'start', 'end', 'start']);
  const starts = events.filter((x) => x.e === 'start').map((x) => x.t);
  const ends = events.filter((x) => x.e === 'end').map((x) => x.t);
  const close = (a, b) => Math.abs(a - b) <= step + 1e-6;
  assert.ok(close(starts[0], 8) && close(starts[1], 18) && close(starts[2], 28), `starts ${starts}`);
  assert.ok(close(ends[0], 12) && close(ends[1], 22), `ends ${ends}`);

  f.reset();
  assert.equal(f.active, false);
  assert.equal(f.powerMult, 1);
  assert.equal(f.scoreMult, 1);
  assert.equal(f.update(7.5), null);
  assert.equal(f.warning, true);
  assert.equal(f.update(0.5), 'start');
  assert.equal(f.active, true);
  assert.equal(f.warning, false);
  assert.equal(f.remaining, cfg.FEVER_DURATION);
  assert.equal(f.powerMult, cfg.FEVER_POWER_MULT);
  assert.equal(f.scoreMult, cfg.FEVER_SCORE_MULT);
  assert.equal(f.update(1), null);
  assert.equal(f.remaining, cfg.FEVER_DURATION - 1);
  assert.equal(f.update(3), 'end');
  assert.equal(f.remaining, 0);
});

// ---------------- PowerCalculator ----------------

test('computePower: 등급, 팀 보정, 피버, 보너스', () => {
  assert.equal(computePower({ grade: 'perfect', config: cfg }), cfg.POWER.perfect);
  assert.equal(computePower({ grade: 'good', config: cfg, teamMultiplier: 1.5 }), cfg.POWER.good * 1.5);
  assert.equal(
    computePower({ grade: 'perfect', config: cfg, teamMultiplier: 1.5, fever: true }),
    cfg.POWER.perfect * 1.5 * cfg.FEVER_POWER_MULT,
  );
  // 피버는 박자 판정에만
  assert.equal(computePower({ grade: 'miss', config: cfg, fever: true }), cfg.POWER.miss);
  assert.equal(computePower({ grade: 'spam', config: cfg, fever: true }), cfg.POWER.spam);
  assert.equal(computePower({ grade: 'good', config: cfg, bonus: { powerMult: 2 } }), cfg.POWER.good * 2);
  assert.equal(computePower({ grade: 'good', config: cfg, bonus: {} }), cfg.POWER.good);
});

// ---------------- Player ----------------

test('Player: 기본 필드와 애니메이션 상태 머신', () => {
  const [def] = resolvePlayers();
  const p = new Player(def, 0, cfg);
  assert.equal(p.label, 'P1');
  assert.equal(p.y, cfg.LAYOUT.GROUND_Y);
  assert.equal(p.anim, 'idle');
  assert.equal(p.flip, false);
  assert.deepEqual(p.appearance(), { shirt: def.color, shirtShade: p.shade, hair: def.hair });

  // idle 반복
  const idle = cfg.ANIMS.idle;
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  assert.ok(p.frame >= 0 && p.frame < idle.frames);
  p.setAnim('idle', true);
  p.update(1.5 / idle.fps); // 1.5프레임 경과 → 1프레임
  assert.equal(p.frame, 1);

  // pull: 처음부터 재생 → 끝나면 0프레임 유지
  p.onPull('perfect');
  assert.equal(p.anim, 'pull');
  assert.equal(p.frame, 0);
  assert.deepEqual(p.pop, { grade: 'perfect', t: 0 });
  assert.equal(p.pressT, 0);
  p.update(0.1); // 12fps → 1프레임
  assert.equal(p.frame, 1);
  p.update(0.1, true); // 히트스톱: 애니 정지, 팝업 진행
  assert.equal(p.frame, 1);
  assert.ok(p.pop.t > 0.19);
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  assert.equal(p.frame, 0);
  assert.equal(p.pop, null, '0.6초 후 팝업 사라짐');

  // spam 은 팝업만
  p.setAnim('idle');
  p.onPull('spam');
  assert.equal(p.anim, 'idle');
  assert.equal(p.pop.grade, 'spam');

  // slip/fall/win 중에는 pull 로 바뀌지 않음
  p.setAnim('slip');
  p.onPull('good');
  assert.equal(p.anim, 'slip');

  // fall: 마지막 프레임에서 멈춤
  p.setAnim('fall');
  for (let i = 0; i < 120; i++) p.update(1 / 60);
  assert.equal(p.frame, cfg.ANIMS.fall.frames - 1);

  // setAnim 같은 이름은 restart 일 때만 처음부터
  p.setAnim('win');
  p.update(0.2);
  const f = p.frame;
  p.setAnim('win');
  assert.equal(p.frame, f);
  p.setAnim('win', true);
  assert.equal(p.frame, 0);

  p.side = 'right';
  assert.equal(p.flip, true);
  p.resetForRound();
  assert.equal(p.anim, 'pull');
  assert.equal(p.frame, 0);
  assert.equal(p.pop, null);
  p.update(0.5);
  assert.equal(p.frame, 0, '라운드 시작 버티기 자세 유지');
});

// ---------------- Input / PowerSource (가짜 이벤트 대상) ----------------

class FakeTarget {
  constructor() { this.l = {}; }
  addEventListener(t, f) { (this.l[t] ||= new Set()).add(f); }
  removeEventListener(t, f) { this.l[t]?.delete(f); }
  fire(t, e) { for (const f of this.l[t] || []) f(e); }
}
const keyEv = (code, extra = {}) => ({ code, repeat: false, timeStamp: 0, preventDefault() { this.prevented = true; }, ...extra });

test('KeyboardInput: auto-repeat 무시, 동시 입력, 스텝 단위 이벤트', () => {
  const t = new FakeTarget();
  const kb = new KeyboardInput(t, { preventCodes: ['Space'] });
  const sp = keyEv('Space');
  t.fire('keydown', sp);
  assert.equal(sp.prevented, true);
  t.fire('keydown', keyEv('KeyQ'));
  t.fire('keydown', keyEv('KeyQ', { repeat: true })); // auto-repeat
  t.fire('keydown', keyEv('KeyQ'));                   // keyup 없이 다시 → 무시
  assert.equal(kb.pressed('KeyQ'), false, 'beginFrame 전에는 반영 안 됨');
  kb.beginFrame();
  assert.equal(kb.presses('KeyQ').length, 1);
  assert.equal(kb.pressed('Space'), true);
  assert.equal(kb.anyPressed(['KeyR', 'KeyQ']), true);
  assert.equal(kb.isDown('KeyQ'), true);
  assert.ok(typeof kb.presses('KeyQ')[0].timeStamp === 'number');
  kb.beginFrame();
  assert.equal(kb.pressed('KeyQ'), false, '이전 스텝 이벤트는 버린다');
  t.fire('keyup', keyEv('KeyQ'));
  assert.equal(kb.isDown('KeyQ'), false);
  t.fire('keydown', keyEv('KeyQ'));
  t.fire('blur', {});
  assert.equal(kb.isDown('KeyQ'), false);
  kb.beginFrame();
  assert.equal(kb.pressed('KeyQ'), true);
  // 입력란 포커스 중이면 무시
  t.fire('keydown', keyEv('KeyR', { target: { tagName: 'INPUT' } }));
  kb.beginFrame();
  assert.equal(kb.pressed('KeyR'), false);
  kb.dispose();
  t.fire('keydown', keyEv('KeyP'));
  kb.beginFrame();
  assert.equal(kb.pressed('KeyP'), false);
});

test('PowerSource: 기본/키보드 입력원', () => {
  const t = new FakeTarget();
  const kb = new KeyboardInput(t);
  const [def] = resolvePlayers();
  const p = new Player(def, 0, cfg);
  const base = new PowerSource(p);
  assert.equal(base.kind, 'base');
  assert.deepEqual(base.poll({}), []);
  const src = new KeyboardPowerSource(p, kb);
  assert.equal(src.kind, 'keyboard');
  t.fire('keydown', keyEv(def.key, { timeStamp: 1 }));
  kb.beginFrame();
  const tries = src.poll({});
  assert.equal(tries.length, 1);
  assert.equal(tries[0].timeStamp, 1);
  src.onRoundStart({ round: 1, side: 'left', teammates: [], opponents: [] });
  src.onRoundEnd({ round: 1, winnerSide: null });
  src.dispose();
  kb.dispose();
});

test('config 기본값이 그대로 쓰인다', () => {
  assert.equal(cfg.BPM, DEFAULT_CONFIG.BPM);
});
