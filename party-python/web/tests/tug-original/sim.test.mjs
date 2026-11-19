// =============================================================
// 헤드리스 시뮬레이션 테스트 — 가짜 DOM 위에서 mount() 부터 onFinish 까지 전체 흐름을 돌린다.
//
// - window / document / canvas / 2D 컨텍스트 / requestAnimationFrame / performance.now 를 테스트가 직접 만든다.
// - AudioContext 는 없음 → 오디오는 조용히 무음으로 동작해야 한다.
// - rAF 는 테스트가 frame() 으로 한 프레임씩 직접 돌리고, performance.now() 도 그때만 진행한다 (결정적).
// - 게임 코드에는 전역 훅을 두지 않는다: mount() 핸들의 game 으로만 상태를 확인한다.
// =============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------
// 가짜 시계 + rAF
// ---------------------------------------------------------------
const FRAME_MS = 1000 / 60;
const clock = { now: 1000 };
const rafQueue = new Map(); // id → callback
let rafSeq = 0;

const realPerfDesc = Object.getOwnPropertyDescriptor(globalThis, 'performance');
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => clock.now, timeOrigin: 0 },
  configurable: true,
  writable: true,
});
globalThis.requestAnimationFrame = (cb) => {
  const id = ++rafSeq;
  rafQueue.set(id, cb);
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  rafQueue.delete(id);
};

/** 한 프레임 진행: 시계를 ms 만큼 옮기고 대기 중인 rAF 콜백을 모두 호출 */
function frame(ms = FRAME_MS) {
  clock.now += ms;
  const pending = [...rafQueue.entries()];
  rafQueue.clear();
  for (const [, cb] of pending) cb(clock.now);
}

// ---------------------------------------------------------------
// 이벤트 대상 (리스너를 기록하고 직접 dispatch 할 수 있다)
// ---------------------------------------------------------------
class FakeTarget {
  constructor() {
    this._listeners = new Map(); // type → Set<fn>
  }
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }
  dispatch(type, props = {}) {
    const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of [...(this._listeners.get(type) || [])]) fn.call(this, ev);
    return ev;
  }
  listenerCount() {
    let n = 0;
    for (const set of this._listeners.values()) n += set.size;
    return n;
  }
}

// ---------------------------------------------------------------
// 가짜 2D 컨텍스트 (Proxy: 모르는 메서드는 no-op) + 좌표/색 검사
// ---------------------------------------------------------------
const PALETTE_SET = new Set();
const violations = { nonInteger: [], offPalette: new Set() };
const drawCalls = { fillRect: 0, drawImage: 0 };
let checkDrawing = true;

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function makeContext(canvas) {
  const state = {
    canvas,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    textBaseline: 'alphabetic',
    textAlign: 'start',
    lineWidth: 1,
  };
  const noop = () => {};
  const imageData = (w, h) => {
    const W = Math.max(0, w | 0), H = Math.max(0, h | 0);
    return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  };
  const methods = {
    measureText: (text) => ({ width: String(text).length * 6 }),
    getImageData: (x, y, w, h) => imageData(w, h),
    createImageData: (w, h) => (typeof w === 'object' && w ? imageData(w.width, w.height) : imageData(w, h)),
    putImageData: noop,
    createPattern: () => ({ pattern: true }),
    fillRect: (x, y, w, h) => {
      drawCalls.fillRect++;
      if (!checkDrawing) return;
      if (!isInt(x) || !isInt(y) || !isInt(w) || !isInt(h)) {
        if (violations.nonInteger.length < 20) violations.nonInteger.push(`fillRect(${x}, ${y}, ${w}, ${h})`);
      }
      const col = String(state.fillStyle).toLowerCase();
      if (typeof state.fillStyle === 'string' && !PALETTE_SET.has(col)) violations.offPalette.add(col);
    },
    drawImage: (img, ...args) => {
      drawCalls.drawImage++;
      if (!checkDrawing) return;
      // drawImage(img, dx, dy) / (img, dx, dy, dw, dh) / (img, sx, sy, sw, sh, dx, dy, dw, dh)
      const dest = args.length >= 8 ? args.slice(4, 8) : args;
      if (!dest.every(isInt)) {
        if (violations.nonInteger.length < 20) violations.nonInteger.push(`drawImage(${dest.join(', ')})`);
      }
    },
  };
  return new Proxy(state, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(methods, key)) return methods[key];
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      return noop; // 그 밖의 메서드(save/restore/translate/scale/fillText/clearRect/setTransform ...)
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

let documentRef = null;

class FakeCanvas extends FakeTarget {
  constructor(w = 300, h = 150) {
    super();
    this.tagName = 'CANVAS';
    this.width = w;
    this.height = h;
    this.style = {};
    this.parentElement = null;
    this.offsetHeight = 0;
    this.ownerDocument = documentRef;
    this._ctx = null;
  }
  getContext(type) {
    if (type !== '2d') return null;
    if (!this._ctx) this._ctx = makeContext(this);
    return this._ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
  }
  focus() {}
}

class FakeElement extends FakeTarget {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.style = {};
    // <link> 는 이미 로딩된 스타일시트처럼 보이게 (AssetLoader 가 load 이벤트를 기다리지 않도록)
    if (this.tagName === 'LINK') this.sheet = {};
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) {
    if (k === 'href' && this.href !== undefined) return this.href;
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  appendChild(child) { this.children.push(child); return child; }
}

// ---------------------------------------------------------------
// window / document
// ---------------------------------------------------------------
const win = new FakeTarget();
win.innerWidth = 1280;
win.innerHeight = 720;
// AudioContext 는 일부러 없음 → 무음

const fontFaces = ['Galmuri7', 'Galmuri9', 'Galmuri11', 'Galmuri14'].map((family) => ({ family, status: 'loaded' }));
const doc = new FakeTarget();
documentRef = doc;
doc.defaultView = win;
doc.hidden = false;
doc.readyState = 'complete';
doc.baseURI = 'http://localhost/';
doc.activeElement = null;
doc.head = new FakeElement('head');
doc.body = new FakeElement('body');
doc.documentElement = new FakeElement('html');
doc.createElement = (tag) => (String(tag).toLowerCase() === 'canvas' ? new FakeCanvas() : new FakeElement(tag));
doc.querySelectorAll = (sel) => (sel === 'link' ? doc.head.children.filter((c) => c.tagName === 'LINK') : []);
doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
doc.getElementById = () => null;
doc.fonts = {
  load: () => Promise.resolve([{}]),
  check: () => true,
  ready: Promise.resolve(),
  [Symbol.iterator]: function* () { yield* fontFaces; },
};
win.document = doc;

globalThis.window = win;
globalThis.document = doc;

// 게임 코드가 삼킨 오류(console.error)도 실패로 잡는다 (마지막 테스트에서 검사)
const consoleErrors = [];
const realConsoleError = console.error;
console.error = (...args) => {
  consoleErrors.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
};

after(() => {
  console.error = realConsoleError;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  if (realPerfDesc) Object.defineProperty(globalThis, 'performance', realPerfDesc);
});

// 게임 모듈은 가짜 전역을 만든 뒤 import (최상위 DOM 접근이 없어야 하므로 순서는 상관없지만 안전하게)
const { mount } = await import('../../src/games/tug/index.js');
const { PALETTE } = await import('../../src/games/tug/palette.js');
for (const c of PALETTE) PALETTE_SET.add(c.toLowerCase());

// ---------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------
const tick = () => new Promise((r) => setImmediate(r));

function keyDown(code) {
  return win.dispatch('keydown', { code, key: code, repeat: false, timeStamp: clock.now, target: doc.body });
}
function keyUp(code) {
  return win.dispatch('keyup', { code, key: code, repeat: false, timeStamp: clock.now, target: doc.body });
}
/** 한 번 눌렀다 떼기 (사이에 한 프레임) */
function tap(code) {
  keyDown(code);
  frame();
  keyUp(code);
}

/** 에셋 로딩이 끝나고 타이틀 장면이 될 때까지 (비동기) */
async function waitForTitle(game, maxIter = 500) {
  for (let i = 0; i < maxIter; i++) {
    if (game.sceneName === 'title' && !game.loading) return;
    await tick();
    frame();
  }
  throw new Error(`타이틀 장면에 도달하지 못함 (scene=${game.sceneName}, loading=${game.loading}, failed=${game.loadFailed})`);
}

/** pred() 가 참이 될 때까지 프레임 진행. 매 프레임 전에 perFrame(i) 호출 */
function runUntil(pred, maxFrames, perFrame = null, what = '') {
  for (let i = 0; i < maxFrames; i++) {
    if (pred()) return i;
    if (perFrame) perFrame(i);
    frame();
  }
  if (pred()) return maxFrames;
  throw new Error(`시간 안에 조건 도달 실패: ${what}`);
}

function totalListeners(...targets) {
  return targets.reduce((n, t) => n + t.listenerCount(), 0);
}

const STEP_S = 1 / 60;

// ---------------------------------------------------------------
// 1) 전체 흐름: 타이틀 → (팀배정 → 카운트다운 → 플레이 → 라운드결과) × 3 → 점수기록 → 최종결과
// ---------------------------------------------------------------
test('전체 흐름 시뮬레이션: mount → 3라운드 → 결과 확인 → onFinish 1회', async () => {
  const canvas = new FakeCanvas(1280, 720);
  const baseline = totalListeners(win, doc, canvas);
  const finishes = [];
  const ROUND_TIME = 14; // 피버(8초~)를 포함하는 짧은 라운드
  const handle = mount(canvas, {
    config: { ROUND_TIME },
    onFinish: (results) => finishes.push(results),
  });
  const game = handle.game;
  assert.ok(game, 'mount 핸들에 game 이 있다');
  for (const k of ['destroy', 'pause', 'resume', 'setMuted', 'getResults', 'applyBonus']) {
    assert.equal(typeof handle[k], 'function', `handle.${k}`);
  }
  assert.ok(totalListeners(win, doc, canvas) > baseline, '리스너를 등록했다');

  await waitForTitle(game);
  assert.equal(game.audio.ctx, null, 'AudioContext 없으면 무음');

  // ---- 타이틀: 5명 모두 자기 키로 준비 ----
  const keys = game.players.map((p) => p.key);
  assert.deepEqual(keys, ['KeyQ', 'KeyR', 'KeyU', 'KeyP', 'Space']);
  for (const k of keys) {
    tap(k);
    frame();
  }
  assert.ok(game.players.every((p) => p.ready), '모두 준비 상태');

  // 오디오 잠금 해제 시도가 있어도 (AudioContext 없음) 예외 없이 진행
  const onBeatIds = new Set([game.players[0].id, game.players[1].id]); // P1, P2 는 박자에 맞춰
  const mashIds = new Set([game.players[2].id, game.players[3].id]);   // P3, P4 는 마구 연타
  // P5 는 아무것도 안 함

  let pauseChecked = false;
  const rounds = game.config.ROUNDS;
  assert.equal(rounds, 3);

  for (let round = 1; round <= rounds; round++) {
    // ---- 팀 배정 ----
    runUntil(() => game.sceneName === 'teamAssign' && game.round === round, 600, null, `teamAssign ${round}`);
    assert.equal(game.teams.left.size + game.teams.right.size, 5, '5명 모두 팀 배정');
    assert.ok([2, 3].includes(game.teams.left.size), '2:3 배정');
    assert.equal(game.background.timeOfDay, game.timeOfDayFor(round));

    // ---- 카운트다운 → 플레이 ----
    // (1라운드) 음악 박 예약을 기록: 카운트다운 → 플레이로 넘어갈 때 같은 박이 두 번 예약되면 안 된다
    const scheduled = [];
    const origSchedule = game.music.scheduleBeat;
    if (round === 1) {
      game.music.scheduleBeat = function (index, delay, interval, opts) {
        scheduled.push({ scene: game.sceneName, index, at: game.time + delay, mode: opts && opts.mode });
        return origSchedule.call(this, index, delay, interval, opts);
      };
    }
    runUntil(() => game.sceneName === 'countdown', 600, null, `countdown ${round}`);
    runUntil(() => game.sceneName === 'play', 600, null, `play ${round}`);
    const play = game.scene;
    if (round === 1) {
      runUntil(() => game.beat.time > 1.6, 200, null, 'play 1.6초');
      game.music.scheduleBeat = origSchedule;
      const seq = scheduled.filter((s) => s.mode === 'play');
      assert.deepEqual(seq.map((s) => s.index), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4],
        '카운트다운(-5..0) → 플레이(1..) 박 index 가 끊김·중복 없이 이어진다');
      for (let i = 1; i < seq.length; i++) {
        const gap = seq[i].at - seq[i - 1].at;
        assert.ok(Math.abs(gap - 0.5) < 0.02, `박 예약 간격 ${gap.toFixed(3)}s (index ${seq[i].index})`);
      }
    }

    const pressDownAt = new Map(); // code → frame index when pressed
    let f = 0;
    const perFrame = () => {
      f++;
      if (play.ended) return;
      const beat = game.beat;
      // 키 떼기
      for (const [code, at] of pressDownAt) {
        if (f - at >= 2) {
          keyUp(code);
          pressDownAt.delete(code);
        }
      }
      const ttn = beat.timeToNextBeat();
      for (const p of game.players) {
        if (pressDownAt.has(p.key)) continue;
        if (onBeatIds.has(p.id)) {
          // 다음 박 직전 한 스텝 안 → 바로 다음 스텝에서 박을 넘으며 Perfect
          if (ttn > 0 && ttn <= STEP_S) {
            keyDown(p.key);
            pressDownAt.set(p.key, f);
          }
        } else if (mashIds.has(p.id)) {
          if (f % 3 === 0) {
            keyDown(p.key);
            pressDownAt.set(p.key, f);
          }
        }
      }
    };

    // ---- (1라운드) 일시정지 / 재개 ----
    if (!pauseChecked) {
      runUntil(() => game.beat.time > 2, 300, perFrame, 'play 2초');
      for (const code of pressDownAt.keys()) keyUp(code);
      pressDownAt.clear();
      tap('Escape');
      assert.equal(game.paused, true, 'Escape → 일시정지');
      const bt = game.beat.time;
      const gt = game.time;
      const tl = play.timeLeft;
      for (let i = 0; i < 30; i++) frame();
      assert.equal(game.beat.time, bt, '일시정지 중 박자 시계 정지');
      assert.equal(game.time, gt, '일시정지 중 game.time 정지');
      assert.equal(play.timeLeft, tl, '일시정지 중 남은 시간 정지');
      assert.equal(game.sceneName, 'play');
      // 일시정지 중 플레이어 키는 판정되지 않는다
      const before = game.scoreBoard.get(game.players[0].id);
      tap(game.players[0].key);
      frame();
      const afterPause = game.scoreBoard.get(game.players[0].id);
      assert.equal(afterPause.perfect + afterPause.good + afterPause.miss + afterPause.spam,
        before.perfect + before.good + before.miss + before.spam, '일시정지 중 입력 무시');
      tap('Escape');
      assert.equal(game.paused, false, 'Escape → 재개');
      frame();
      assert.ok(game.beat.time > bt, '재개 후 박자 시계 진행');
      // handle.pause()/resume() 도 동작
      handle.pause();
      assert.equal(game.paused, true);
      handle.resume();
      assert.equal(game.paused, false);
      pauseChecked = true;
    }

    // ---- 플레이: 라운드 끝까지 ----
    runUntil(() => play.ended, Math.ceil((ROUND_TIME + 2) * 60), perFrame, `play end ${round}`);
    for (const code of pressDownAt.keys()) keyUp(code);
    pressDownAt.clear();

    // ---- 라운드 결과 ----
    runUntil(() => game.sceneName === 'roundResult', 200, null, `roundResult ${round}`);
    const s1 = game.scoreBoard.get(game.players[0].id);
    assert.equal(s1.roundScores.length, round, `라운드 ${round} 점수 기록`);
  }

  // ---- 점수 기록 → '결과 확인' (Enter) ----
  runUntil(() => game.sceneName === 'scoreSummary' && !game.fx.transitioning
    && game.scene.revealed >= game.players.length, 800, null, 'scoreSummary');
  assert.equal(finishes.length, 0, '결과 확인 전에는 onFinish 없음');
  tap('Enter');
  runUntil(() => game.sceneName === 'finalResult', 120, null, 'finalResult');
  frame();

  // ---- onFinish 검사 ----
  assert.equal(finishes.length, 1, 'onFinish 정확히 1회');
  const results = finishes[0];
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 5);
  const ids = new Set(game.players.map((p) => p.id));
  for (const r of results) {
    assert.equal(typeof r.playerId, 'string');
    assert.ok(ids.has(r.playerId), `알 수 없는 playerId ${r.playerId}`);
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.score, 'number');
    assert.ok(Number.isFinite(r.score) && r.score >= 0);
    assert.equal(typeof r.isWinner, 'boolean');
    assert.equal(typeof r.rank, 'number');
  }
  assert.equal(new Set(results.map((r) => r.playerId)).size, 5, 'playerId 중복 없음');
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score, '점수 내림차순');
  }
  const top = results[0].score;
  for (const r of results) assert.equal(r.isWinner, r.score === top, '최고점자만 우승');
  assert.equal(results[0].rank, 1);
  assert.ok(top > 0, '누군가는 점수를 얻었다');

  // 박자 맞춘 선수는 Perfect, 연타한 선수는 헛힘이 기록돼야 한다 (timeStamp → 박자 시각 변환 검사)
  for (const id of onBeatIds) {
    const st = results.find((r) => r.playerId === id).stats;
    assert.ok(st.perfect > 10, `${id} perfect=${st.perfect}`);
    assert.ok(st.perfect > st.miss + st.spam, `${id} 대부분 Perfect (p${st.perfect} g${st.good} m${st.miss} s${st.spam})`);
  }
  for (const id of mashIds) {
    const st = results.find((r) => r.playerId === id).stats;
    assert.ok(st.spam > 10, `${id} spam=${st.spam}`);
  }
  // getResults 도 같은 결과
  assert.deepEqual(handle.getResults().map((r) => r.playerId), results.map((r) => r.playerId));

  // 더 진행해도 onFinish 는 다시 불리지 않는다
  for (let i = 0; i < 120; i++) frame();
  assert.equal(finishes.length, 1);

  // ---- '다시 하기' (Enter) → 타이틀, 점수 초기화 ----
  tap('Enter');
  runUntil(() => game.sceneName === 'title' && !game.fx.transitioning, 200, null, 'restart → title');
  assert.equal(game.scoreBoard.get(game.players[0].id).total, 0, '재시작 시 점수 초기화');
  assert.ok(game.players.every((p) => !p.ready));
  assert.equal(finishes.length, 1);

  // ---- 그리기 규칙: 정수 좌표, 팔레트 색 ----
  assert.ok(drawCalls.fillRect > 100000 && drawCalls.drawImage > 10000, `실제로 그렸다 (${JSON.stringify(drawCalls)})`);
  assert.deepEqual(violations.nonInteger, [], '정수가 아닌 좌표로 그림');
  assert.deepEqual([...violations.offPalette], [], '팔레트 밖 색');

  // ---- destroy ----
  handle.destroy();
  assert.equal(game.loop.running, false, '루프 정지');
  assert.equal(totalListeners(win, doc, canvas), baseline, 'destroy 가 등록한 리스너를 모두 해제');
  assert.equal(rafQueue.size, 0, '대기 중인 rAF 없음');
  const t0 = game.time;
  for (let i = 0; i < 10; i++) frame();
  keyDown('KeyQ');
  frame();
  keyUp('KeyQ');
  assert.equal(game.time, t0, 'destroy 후 진행 없음');
  assert.doesNotThrow(() => handle.destroy(), '두 번째 destroy 안전');
  assert.equal(totalListeners(win, doc, canvas), baseline);
});

// ---------------------------------------------------------------
// 2) 로딩 중 destroy
// ---------------------------------------------------------------
test('에셋 로딩 중 destroy 해도 안전하다', async () => {
  const canvas = new FakeCanvas(1280, 720);
  const baseline = totalListeners(win, doc, canvas);
  const handle = mount(canvas, {});
  handle.destroy();
  for (let i = 0; i < 20; i++) {
    await tick();
    frame();
  }
  assert.equal(handle.game.scene, null);
  assert.equal(handle.game.loop.running, false);
  assert.equal(totalListeners(win, doc, canvas), baseline);
  assert.equal(rafQueue.size, 0);
  assert.doesNotThrow(() => handle.destroy());
});

// ---------------------------------------------------------------
// 3) 두 게임 동시 mount — 서로 독립
// ---------------------------------------------------------------
test('두 게임을 동시에 띄워도 서로 독립적으로 동작한다', async () => {
  const canvasA = new FakeCanvas(1280, 720);
  const canvasB = new FakeCanvas(1280, 720);
  const baseline = totalListeners(win, doc, canvasA, canvasB);
  const finA = [];
  const finB = [];
  const a = mount(canvasA, { onFinish: (r) => finA.push(r) });
  const afterA = totalListeners(win, doc, canvasA, canvasB);
  const b = mount(canvasB, {
    onFinish: (r) => finB.push(r),
    players: [
      { name: '가', key: 'Digit1' },
      { name: '나', key: 'Digit2' },
      { name: '다', key: 'Digit3' },
      { name: '라', key: 'Digit4' },
      { name: '마', key: 'Digit5' },
    ],
  });
  await waitForTitle(a.game);
  await waitForTitle(b.game);
  assert.notEqual(a.game, b.game);
  assert.notEqual(a.game.scoreBoard, b.game.scoreBoard);
  assert.deepEqual(b.game.players.map((p) => p.keyLabel), ['1', '2', '3', '4', '5']);
  assert.equal(b.game.players[0].name, '가');

  // A 의 키만 누른다 → A 는 모두 준비, B 는 아무도 준비 안 됨
  for (const p of a.game.players) {
    tap(p.key);
    frame();
  }
  assert.ok(a.game.players.every((p) => p.ready), 'A 모두 준비');
  assert.ok(b.game.players.every((p) => !p.ready), 'B 영향 없음');

  // B 의 일부만 준비
  tap('Digit2');
  frame();
  assert.equal(b.game.players.filter((p) => p.ready).length, 1);
  assert.ok(a.game.players.every((p) => p.ready), 'B 입력은 A 준비 상태를 바꾸지 않음');

  // A 는 팀 배정으로 넘어가고 B 는 타이틀에 남는다
  runUntil(() => a.game.sceneName === 'teamAssign', 300, null, 'A teamAssign');
  assert.equal(b.game.sceneName, 'title');

  // B 음소거는 A 에 영향 없음
  b.setMuted(true);
  assert.equal(b.game.muted, true);
  assert.equal(a.game.muted, false);

  // A 만 destroy → B 는 계속 돈다
  a.destroy();
  const bt = b.game.time;
  for (let i = 0; i < 10; i++) frame();
  assert.ok(b.game.time > bt, 'B 는 계속 진행');
  assert.equal(b.game.loop.running, true);
  assert.equal(a.game.loop.running, false);
  // A 를 destroy 한 뒤 남은 리스너 = B 가 등록한 것 (A 와 같은 개수)
  assert.equal(totalListeners(win, doc, canvasA, canvasB) - baseline, afterA - baseline, 'A 의 리스너만 해제됨');
  tap('Digit3');
  frame();
  assert.equal(b.game.players.filter((p) => p.ready).length, 2, 'B 입력은 계속 동작');

  b.destroy();
  assert.equal(totalListeners(win, doc, canvasA, canvasB), baseline, '모두 해제');
  assert.equal(rafQueue.size, 0);
  assert.equal(finA.length, 0);
  assert.equal(finB.length, 0);
});

// ---------------------------------------------------------------
// 4) 포인터(클릭)·창 blur·applyBonus·일시정지 '처음으로'
// ---------------------------------------------------------------
test('클릭(음소거·시작·처음으로), 창 blur 자동 일시정지, applyBonus', async () => {
  const canvas = new FakeCanvas(1280, 720); // SCALE 4 → 논리 좌표 = 클라이언트 좌표 / 4
  const baseline = totalListeners(win, doc, canvas);
  const handle = mount(canvas, {});
  const game = handle.game;
  await waitForTitle(game);
  assert.equal(game.renderer.scale, 4);

  /** 논리 좌표 (x, y) 클릭: 캔버스 pointerdown → 한 프레임 → 창 pointerup → 한 프레임 */
  const click = (x, y) => {
    const ev = { clientX: x * 4 + 2, clientY: y * 4 + 2, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    canvas.dispatch('pointerdown', ev);
    frame();
    win.dispatch('pointerup', ev);
    frame();
  };

  // 음소거 버튼 (모든 장면 위)
  assert.equal(game.muted, false);
  click(310, 9);
  assert.equal(game.muted, true, '음소거 버튼 클릭 → 음소거');
  assert.equal(game.sceneName, 'title', '음소거 클릭은 장면에 전달되지 않음');
  click(310, 9);
  assert.equal(game.muted, false);
  // M 키
  tap('KeyM');
  assert.equal(game.muted, true, 'M 키 → 음소거');
  tap('KeyM');
  assert.equal(game.muted, false);

  // 타이틀 '시작' 버튼 클릭 (준비 안 해도 바로 시작)
  click(160, 168);
  runUntil(() => game.sceneName === 'teamAssign', 120, null, '시작 버튼 → teamAssign');
  assert.equal(game.round, 1);

  // play 장면이 아니면 applyBonus 는 무시
  assert.equal(handle.applyBonus(game.players[0].id, { scorePoints: 50 }), false);

  runUntil(() => game.sceneName === 'play', 900, null, 'play');
  for (let i = 0; i < 30; i++) frame();

  // applyBonus: 점수 장부 + 힘
  const p = game.players[0];
  const before = game.totalScore(p.id);
  const force = game.rope[p.side === 'left' ? 'leftForce' : 'rightForce'];
  assert.equal(handle.applyBonus(p.id, { scorePoints: 50, powerMult: 2, reason: 'quiz' }), true);
  assert.equal(game.totalScore(p.id), before + 50);
  assert.ok(game.rope[p.side === 'left' ? 'leftForce' : 'rightForce'] > force, '보너스 힘이 줄에 더해짐');
  assert.ok(handle.getResults().find((r) => r.playerId === p.id).score >= 50);

  // 창 포커스를 잃으면 자동 일시정지
  win.dispatch('blur', {});
  frame();
  assert.equal(game.paused, true, 'blur → 자동 일시정지');
  assert.equal(handle.applyBonus(p.id, { scorePoints: 10 }), false, '일시정지 중 보너스 무시');

  // 일시정지 오버레이 '처음으로' 클릭 → 점수 초기화 후 타이틀
  click(160, 114);
  assert.equal(game.paused, false);
  runUntil(() => game.sceneName === 'title' && !game.fx.transitioning, 200, null, '처음으로 → title');
  assert.equal(game.totalScore(p.id), 0, '보너스 장부도 초기화');
  assert.ok(game.players.every((q) => q.side === null));

  handle.destroy();
  assert.equal(totalListeners(win, doc, canvas), baseline);
  assert.equal(rafQueue.size, 0);
});

// ---------------------------------------------------------------
// 5) 시간 종료 무승부 → 전원 공동 우승 (1라운드 설정)
// ---------------------------------------------------------------
test('아무도 안 누르면 시간 종료 무승부 → 전원 roundDraw, 공동 우승', async () => {
  const canvas = new FakeCanvas(1280, 720);
  const finishes = [];
  const handle = mount(canvas, {
    config: { ROUNDS: 1, ROUND_TIME: 3, SCALE: 'auto' },
    onFinish: (r) => finishes.push(r),
  });
  const game = handle.game;
  await waitForTitle(game);
  assert.ok(game.renderer.scale >= 1);

  tap('Enter'); // 타이틀 '시작' 단축키
  runUntil(() => game.sceneName === 'play', 900, null, 'play');
  runUntil(() => game.sceneName === 'roundResult', 6 * 60, null, 'time up → roundResult');
  const res = game.scene.result;
  assert.equal(res.winnerSide, null, '무승부');
  const draw = game.config.SCORE.roundDraw;
  for (const p of game.players) assert.equal(res.bonus[p.id], draw);

  runUntil(() => game.sceneName === 'scoreSummary' && !game.fx.transitioning
    && game.scene.revealed >= 5, 600, null, 'scoreSummary (ROUNDS=1)');
  tap('Enter');
  runUntil(() => finishes.length > 0, 120, null, 'onFinish');
  const results = finishes[0];
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.equal(r.score, draw);
    assert.equal(r.rank, 1, '동점은 같은 순위');
    assert.equal(r.isWinner, true, '최고점 동점자 모두 우승');
  }
  handle.destroy();
  assert.equal(rafQueue.size, 0);
});

// ---------------------------------------------------------------
// 6) 위 시뮬레이션 동안 게임 코드가 console.error 로 삼킨 오류가 없어야 한다
// ---------------------------------------------------------------
test('시뮬레이션 중 console.error 없음', () => {
  assert.deepEqual(consoleErrors, []);
});
