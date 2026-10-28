// 게임 규칙만 담당하는 파일입니다 (화면 그리기 X, 키보드 X, 소리 X).
// 입력은 아래 형식으로 받기 때문에 키보드든 웹캠이든 똑같이 동작합니다.
//   { p1: { presses: [{ lane, t }], held: [bool, bool, bool, bool] }, p2: {...} }
//   t = 노래 시간(초) 기준으로 버튼을 누른 순간
//
// 효과음/연출이 필요한 순간에는 state.events 에 이벤트를 쌓아두고, GameCanvas 가 꺼내 씁니다.

import { PLAYER_IDS, LANES, LANE_COLORS, JUDGE, SCORE, END_DELAY, HIGHWAY, STAGE, GROUND_Y, FINISHER } from './config.js';
import { MOVES, nextMove, isHeavy } from './moves.js';

const rand = (min, max) => min + Math.random() * (max - min);
export const opponentOf = (id) => (id === 'p1' ? 'p2' : 'p1');

function createPlayer(id, chart) {
  return {
    id,
    notes: chart.map((n) => ({ ...n, judged: false, result: null })),
    cursor: 0, // 아직 판정 안 된 첫 노트
    score: 0,
    displayScore: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    held: new Array(LANES).fill(false),
    laneFlash: new Array(LANES).fill(0),
    judgment: null, // { kind, life }
    action: null, // 영웅 공격 동작 { lane, life, maxLife }
    recoil: 0, // 맞아서 밀려남
    hurt: 0,
    blessed: 0, // 신의 가호 오라
  };
}

export function createGameState(song) {
  return {
    song,
    time: -1,
    phase: 'play', // play → end
    endTimer: 0,
    over: false,
    final: false,
    players: { p1: createPlayer('p1', song.notes), p2: createPlayer('p2', song.notes) },
    lead: 0, // -1 ~ 1, P1 이 앞서면 양수
    spears: [], // 신의 창
    particles: [],
    rings: [],
    flares: [], // 퍼펙트 반짝임
    pillars: [], // 하늘에서 내리꽂힌 빛기둥
    pendingHits: [], // 돌진 후 창이 꽂히는 순간을 기다리는 타격
    feeds: [], // 퍼펙트 때 판정선 → 내 영웅으로 날아가는 빛
    javelins: [], // 날아가는 투창
    slashes: [], // 맞은 자리에 남는 베기 자국
    splats: [], // 바닥 핏자국
    cutin: null,
    flash: 0,
    flashColor: '255,255,240',
    impact: 0,
    shake: 0,
    hitstop: 0, // 맞는 순간 화면 속 움직임만 잠깐 멈춤 (노래와 판정은 그대로)
    lastHitstop: -1,
    zoom: 0, // 맞은 곳으로 카메라 줌
    zoomX: 0,
    zoomY: 0,
    kick: 0, // 맞은 방향으로 카메라가 튕김
    aberration: 0, // 강타 때 화면이 겹쳐 보이는 정도
    wounds: [], // 피가 뿜어져 나오는 상처
    pierces: [], // 몸을 뚫고 나온 창끝
    screenBlood: [], // 화면(렌즈)에 튄 피
    events: [],
  };
}

const emit = (state, type, data = {}) => state.events.push({ type, ...data });

export function multiplier(p) {
  return Math.min(SCORE.maxMult, 1 + Math.floor(p.combo / SCORE.comboStep) * 0.5);
}

// ======================================================================

export function updateGame(state, input, time, dt) {
  if (state.over) return;
  state.time = time;
  const fx = state.hitstop > 0 ? dt * 0.05 : dt;
  state.hitstop = Math.max(0, state.hitstop - dt);
  updateEffects(state, fx, dt);

  if (state.phase === 'end') {
    // 프레임 수가 아니라 노래 시계로 재서, 컴퓨터가 느려도 제때 끝남
    const since = time - state.song.duration;
    state.endTimer = Math.max(0, END_DELAY - since);
    if (state.finisher) updateFinisher(state, since);
    if (state.endTimer <= 0) state.over = true;
    return;
  }

  if (!state.final && time >= state.song.finalStart) {
    state.final = true;
    state.flash = 0.9;
    state.flashColor = '255,40,30';
    state.shake = 18;
    state.impact = 0.08;
    emit(state, 'impact');
  }

  for (const id of PLAYER_IDS) {
    const p = state.players[id];
    const inp = input?.[id];
    if (inp) {
      p.held = inp.held;
      for (const press of inp.presses) judgePress(state, p, press.lane, press.t);
    }
    sweepMisses(state, p, time);
  }

  const { p1, p2 } = state.players;
  const target = (p1.score - p2.score) / (p1.score + p2.score + 2000);
  state.lead += (Math.max(-1, Math.min(1, target * 3)) - state.lead) * Math.min(1, dt * 4);

  if (time >= state.song.duration) {
    state.phase = 'end';
    state.endTimer = END_DELAY;
    const { p1, p2 } = state.players;
    if (p1.score !== p2.score) {
      const winner = p1.score > p2.score ? 'p1' : 'p2';
      state.finisher = { winner, loser: opponentOf(winner), t: 0, struck: false };
    }
    emit(state, 'finish');
  }
}

function judgePress(state, p, lane, t) {
  // 이 레인에서 판정 범위 안에 있는 가장 이른 노트
  let best = null;
  for (let i = p.cursor; i < p.notes.length; i++) {
    const n = p.notes[i];
    if (n.t - t > JUDGE.good) break;
    if (n.judged || n.lane !== lane) continue;
    if (Math.abs(n.t - t) <= JUDGE.good) {
      best = n;
      break;
    }
  }
  if (!best) return; // 빈 타격은 벌점 없음

  const err = Math.abs(best.t - t);
  const kind = err <= JUDGE.perfect ? 'perfect' : err <= JUDGE.great ? 'great' : 'good';
  best.judged = true;
  best.result = kind;
  p.counts[kind] += 1;
  p.combo += 1;
  p.comboPop = 1;
  p.maxCombo = Math.max(p.maxCombo, p.combo);
  p.score += Math.round(SCORE[kind] * multiplier(p));
  p.judgment = { kind, life: 0.45, maxLife: 0.45 };
  p.laneFlash[lane] = 1;
  const move = nextMove(p);
  const M = MOVES[move];
  p.action = { lane, move, life: M.time, maxLife: M.time };
  const power = (kind === 'perfect' ? 1 : kind === 'great' ? 0.7 : 0.45) * M.power;
  state.pendingHits.push({ from: p.id, power, wait: M.impact, move });
  if (move === 'javelin') state.javelins.push({ from: p.id, t: -M.throwAt, dur: M.impact - M.throwAt });

  const x = HIGHWAY.x[p.id] + (lane + 0.5) * HIGHWAY.laneWidth;
  const color = LANE_COLORS[lane];
  ring(state, x, HIGHWAY.judgeY, kind === 'perfect' ? '#fff2a8' : color, kind === 'perfect' ? 70 : 48, kind === 'perfect' ? 7 : 4, true);
  streaks(state, x, HIGHWAY.judgeY, kind === 'perfect' ? 16 : 7, kind === 'perfect' ? '#ffe07a' : color, true);
  if (kind === 'perfect') {
    state.flares.push({ x, y: HIGHWAY.judgeY, color, life: 0.25, maxLife: 0.25 });
    state.feeds.push({ id: p.id, x, y: HIGHWAY.judgeY, color, life: 0.32, maxLife: 0.32 });
  }

  if (p.combo % SCORE.comboStep === 0) divine(state, p);
  advanceCursor(p);
}

function sweepMisses(state, p, time) {
  for (let i = p.cursor; i < p.notes.length; i++) {
    const n = p.notes[i];
    if (n.t + JUDGE.good >= time) break;
    if (n.judged) continue;
    n.judged = true;
    n.result = 'miss';
    p.counts.miss += 1;
    if (p.combo >= 10) emit(state, 'miss');
    p.combo = 0;
    p.judgment = { kind: 'miss', life: 0.45, maxLife: 0.45 };
  }
  advanceCursor(p);
}

function advanceCursor(p) {
  while (p.cursor < p.notes.length && p.notes[p.cursor].judged) p.cursor += 1;
}

// 콤보 달성 → 영웅이 상대에게 신의 창을 던짐
function divine(state, p) {
  p.score += SCORE.divineBonus;
  p.blessed = 1.2;
  state.cutin = { from: p.id, life: 0.8, maxLife: 0.8 };
  state.spears.push({ from: p.id, t: 0, dur: 0.55 });
  emit(state, 'divine', { from: p.id });
}

// ======================================================================

// dt: 히트스톱 중엔 거의 0 (화면 속 움직임), realDt: 실제 흐른 시간 (카메라, 화면 효과)
function updateEffects(state, dt, realDt = dt) {
  state.shake = Math.max(0, state.shake - realDt * 40);
  state.flash = Math.max(0, state.flash - realDt * 2.5);
  state.impact = Math.max(0, state.impact - realDt);
  state.zoom *= Math.exp(-realDt * 9);
  state.kick *= Math.exp(-realDt * 11);
  state.aberration = Math.max(0, state.aberration - realDt * 3.5);
  for (const b of state.screenBlood) {
    b.life -= realDt;
    b.drip += realDt * b.speed;
  }
  state.screenBlood = state.screenBlood.filter((b) => b.life > 0);
  // 상처에서 피가 몇 번 더 뿜어져 나옴
  for (const w of state.wounds) {
    w.life -= dt;
    if (dt > 0.001) bleed(state, w.x, w.y, w.dir, w.heavy ? 3 : 2, w.heavy ? 1.3 : 1);
  }
  state.wounds = state.wounds.filter((w) => w.life > 0);
  if (state.cutin && (state.cutin.life -= dt) <= 0) state.cutin = null;

  for (const id of PLAYER_IDS) {
    const p = state.players[id];
    p.displayScore += (p.score - p.displayScore) * Math.min(1, dt * 12);
    for (let l = 0; l < LANES; l++) p.laneFlash[l] = Math.max(0, p.laneFlash[l] - dt * 6);
    if (p.judgment && (p.judgment.life -= dt) <= 0) p.judgment = null;
    if (p.action && (p.action.life -= dt) <= 0) p.action = null;
    p.hurt = Math.max(0, p.hurt - dt);
    p.recoil = Math.max(0, p.recoil - dt);
    p.stagger = Math.max(0, (p.stagger ?? 0) - dt * 2.4);
    p.blessed = Math.max(0, p.blessed - dt);
  }

  for (const s of state.spears) {
    s.t += dt;
    if (s.t >= s.dur && !s.done) {
      s.done = true;
      const target = state.players[opponentOf(s.from)];
      target.hurt = 0.5;
      const x = STAGE[target.id];
      const color = s.from === 'p1' ? '#ffcf5a' : '#7fe4ff';
      ring(state, x, GROUND_Y - 4, '#ffffff', 220, 10);
      ring(state, x, GROUND_Y - 60, color, 160, 8);
      streaks(state, x, GROUND_Y - 30, 40, color);
      debris(state, x, GROUND_Y - 4, 22);
      bleed(state, x, GROUND_Y - 110, s.from === 'p1' ? 1 : -1, 30);
      state.pillars.push({ x, color, life: 0.6, maxLife: 0.6 });
      state.shake = 22;
      state.flash = 0.6;
      state.flashColor = s.from === 'p1' ? '230,240,255' : '255,220,160';
      state.impact = 0.06;
      emit(state, 'impact');
    }
  }
  state.spears = state.spears.filter((s) => !s.done);

  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    p.life -= dt;
    // 피가 땅에 떨어지면 핏자국
    if (p.kind === 'blood' && p.y >= GROUND_Y) {
      p.life = 0;
      if (state.splats.length < 40) state.splats.push({ x: p.x, r: p.size * rand(1.5, 3), life: 4, maxLife: 4 });
    }
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  // 창이 꽂히는 순간: 상대가 밀려나며 피가 튐
  for (const h of state.pendingHits) {
    h.wait -= dt;
    if (h.wait > 0) continue;
    h.done = true;
    const foe = state.players[opponentOf(h.from)];
    const dir = h.from === 'p1' ? 1 : -1;
    const M = MOVES[h.move];
    const x = STAGE[foe.id] + state.lead * STAGE.push - dir * 14;
    const y = GROUND_Y + M.hitY * STAGE.heroScale + rand(-12, 12);
    foe.recoil = Math.max(foe.recoil, (0.12 + h.power * 0.12) * (M.knock ?? 1));
    bleed(state, x, y, dir, Math.round(6 + h.power * 14));
    state.slashes.push({ x, y, dir, power: h.power, life: 0.18, maxLife: 0.18, angle: rand(-0.6, 0.6) });
    state.shake = Math.max(state.shake, 3 + h.power * 5);
    if (h.move === 'spin') {
      state.slashes.push({ x, y: y - 30, dir, power: h.power, life: 0.22, maxLife: 0.22, angle: rand(-0.3, 0.3) + 0.6 });
    }
    if (h.move === 'bash') ring(state, x, y, '#ffffff', 110, 6);
    if (h.move === 'smash') {
      ring(state, x, GROUND_Y - 2, '#ffd0a0', 150, 8);
      debris(state, x, GROUND_Y - 2, 14);
    }
    const heavy = isHeavy(h.move);
    if (heavy) {
      state.shake = Math.max(state.shake, 16);
      if (h.power >= 1.3) state.impact = Math.max(state.impact, 0.05);
    }

    // 묵직한 타격감
    // 노트가 빽빽해도 계속 멈춰 있지 않게, 가벼운 타격은 0.3초에 한 번만
    if (heavy || state.time - state.lastHitstop > 0.3) {
      state.hitstop = Math.max(state.hitstop, heavy ? 0.12 : 0.045 + h.power * 0.025);
      state.lastHitstop = state.time;
    }
    state.zoom = Math.max(state.zoom, heavy ? 0.1 : 0.035 + h.power * 0.015);
    state.zoomX = x;
    state.zoomY = y;
    state.kick = dir * (heavy ? 26 : 12) * h.power;
    state.aberration = Math.max(state.aberration, heavy ? 1 : 0.35 * h.power);
    foe.stagger = Math.min(1, (foe.stagger ?? 0) + (heavy ? 0.9 : 0.45) * h.power);
    state.wounds.push({ x, y, dir, heavy, life: heavy ? 0.4 : 0.16 });
    mist(state, x, y, dir, heavy ? 12 : 5);
    if (['thrust', 'javelin', 'smash', 'spin'].includes(h.move) && h.power >= 0.8) {
      state.pierces.push({ id: foe.id, dir, y, life: heavy ? 0.45 : 0.25, maxLife: heavy ? 0.45 : 0.25 });
    }
    if (heavy && h.power >= 0.9) splatterScreen(state, dir);
    emit(state, 'hit', { power: h.power, move: h.move, heavy });
  }
  state.pendingHits = state.pendingHits.filter((h) => !h.done);

  for (const p of Object.values(state.players)) p.comboPop = Math.max(0, (p.comboPop ?? 0) - dt * 6);
  for (const pc of state.pierces) pc.life -= dt;
  state.pierces = state.pierces.filter((pc) => pc.life > 0);
  for (const j of state.javelins) j.t += dt;
  state.javelins = state.javelins.filter((j) => j.t < j.dur);
  for (const list of ['rings', 'flares', 'pillars', 'slashes', 'splats', 'feeds']) {
    for (const r of state[list]) r.life -= dt;
    state[list] = state[list].filter((r) => r.life > 0);
  }
}

// hud: 노트 레인(화면 고정)에서 생긴 효과. 아니면 무대(3D 카메라를 따라 움직임)
function ring(state, x, y, color, radius, width, hud = false) {
  state.rings.push({ x, y, color, radius, width, hud, life: 0.3, maxLife: 0.3 });
}

function streaks(state, x, y, count, color, hud = false) {
  for (let i = 0; i < count; i++) {
    const a = rand(-Math.PI, 0);
    const speed = rand(250, 600);
    const life = rand(0.15, 0.35);
    state.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, gravity: 600, color, size: rand(2, 3.5), life, maxLife: life, hud });
  }
}

// 승자가 뛰어올라 진 쪽에게 창을 꽂음
function updateFinisher(state, since) {
  const f = state.finisher;
  f.t = since;
  if (f.struck || f.t < FINISHER.strikeAt) return;
  f.struck = true;
  const dir = f.winner === 'p1' ? 1 : -1;
  const x = STAGE[f.loser] + state.lead * STAGE.push;
  const loser = state.players[f.loser];
  loser.recoil = 0;
  bleed(state, x, GROUND_Y - 110, dir, 60);
  bleed(state, x, GROUND_Y - 60, -dir, 20);
  debris(state, x + dir * 120, GROUND_Y - 4, 16);
  ring(state, x, GROUND_Y - 100, '#ffffff', 240, 10);
  ring(state, x, GROUND_Y - 4, '#ff3030', 180, 8);
  state.splats.push({ x: x + dir * 110, r: 24, life: 10, maxLife: 10 });
  state.flash = 1;
  state.flashColor = '255,30,20';
  state.impact = 0.12;
  state.shake = 28;
  emit(state, 'impact');
}

// 맞은 곳에 퍼지는 붉은 피 안개
function mist(state, x, y, dir, count) {
  for (let i = 0; i < count; i++) {
    const life = rand(0.35, 0.7);
    state.particles.push({ kind: 'mist', x, y, vx: dir * rand(40, 220), vy: rand(-80, 30), gravity: 60, color: '#a00810', size: rand(14, 30), life, maxLife: life });
  }
}

// 강타: 화면(렌즈)에 피가 튀어 흘러내림
function splatterScreen(state, dir) {
  const n = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < n; i++) {
    const side = dir > 0 ? rand(520, 940) : rand(20, 440);
    state.screenBlood.push({ x: side, y: rand(60, 420), r: rand(8, 34), life: 1.8, maxLife: 1.8, drip: 0, speed: rand(20, 70), seed: Math.random() * 100 });
  }
}

// 맞은 방향으로 튀는 피
function bleed(state, x, y, dir, count, force = 1) {
  for (let i = 0; i < count; i++) {
    const life = rand(0.5, 1.1);
    state.particles.push({
      kind: 'blood',
      x,
      y,
      vx: (dir * rand(80, 460) + rand(-60, 60)) * force,
      vy: rand(-420, 60) * force,
      gravity: 1400,
      color: i % 3 ? '#b3101c' : '#e82a2a',
      size: rand(2, 5),
      life,
      maxLife: life,
    });
  }
}

// 땅이 깨지며 튀는 돌 조각
function debris(state, x, y, count) {
  for (let i = 0; i < count; i++) {
    const life = rand(0.5, 1.0);
    state.particles.push({ kind: 'rock', x, y, vx: rand(-380, 380), vy: rand(-620, -160), gravity: 1500, color: i % 2 ? '#7a5230' : '#c4925a', size: rand(3, 7), life, maxLife: life });
  }
}

export function finalScore(state, id) {
  return state.players[id].score;
}
