// =============================================================
//  경기 진행 관리 (1라운드)
//    intro(ROUND 1 → FIGHT!) → fight → ko 또는 timeup → done
//
//  관중 분위기도 여기서 관리합니다.
//    hype   : 관중 열기 0~1 (타격이 들어가면 오르고 시간이 지나면 식음)
//    events : 소리를 낼 사건 목록 (FightScreen이 꺼내서 효과음 재생)
// =============================================================

import { ARENA, CROWD, MATCH, PLAYERS } from '../config.js';
import { createFighter, updateFighter, isControllable, setState } from './fighter.js';
import { resolveAttacks, separateFighters } from './combat.js';

export const PHASE = {
  INTRO: 'intro',
  FIGHT: 'fight',
  KO: 'ko',
  TIMEUP: 'timeup',
};

const NO_INPUT = { move: 0, guard: false, punch: false, kick: false, special: false };
const MAX_EFFECTS = 260;
const MAX_EVENTS = 40;

// 공격 종류별로 관중이 얼마나 열광하는지
const HYPE_GAIN = { punch: 1, kick: 1.6, special: 3 };

export function createMatch(playerIds = ['p1', 'p2']) {
  const [idA, idB] = playerIds;
  return {
    phase: PHASE.INTRO,
    introTime: MATCH.introSeconds,
    timeLeft: MATCH.roundSeconds,
    elapsed: 0,
    playerIds,
    fighters: {
      [idA]: createFighter(idA, ARENA.startX[idA] ?? 440, 1),
      [idB]: createFighter(idB, ARENA.startX[idB] ?? 840, -1),
    },
    winnerId: null, // 무승부면 null
    reason: null, // 'ko' | 'decision' | 'draw'
    bannerTime: 0,
    winPoseDelay: 0,
    timeScale: 1, // K.O. 순간 슬로모션
    slowmoTime: 0,
    shake: 0, // 화면 흔들림 세기
    hype: 0.6, // 입장할 때부터 관중이 들떠 있음
    effects: [],
    events: [{ type: 'crowd-start' }],
    done: false,
  };
}

// ---------------- 관중 연출 ----------------

function pushEvent(match, event) {
  match.events.push(event);
  if (match.events.length > MAX_EVENTS) match.events.shift();
}

function addHype(match, amount) {
  match.hype = Math.min(1, match.hype + amount);
}

// 관중석에서 "와아!" 같은 함성 글자 띄우기
function spawnCheers(match, count, favorId = null) {
  for (let i = 0; i < count; i++) {
    // 응원하는 선수 쪽 관중석에서 더 많이 나옴
    let x = 80 + Math.random() * (ARENA.width - 160);
    if (favorId && Math.random() < 0.7) {
      const left = PLAYERS.find((p) => p.id === favorId)?.side === 'left';
      x = left ? 80 + Math.random() * 560 : 640 + Math.random() * 560;
    }
    match.effects.push({
      type: 'cheer',
      text: CROWD.cheers[Math.floor(Math.random() * CROWD.cheers.length)],
      x,
      y: 170 + Math.random() * 90, // 위쪽 관중석 (선수 머리와 겹치지 않게)
      tilt: (Math.random() - 0.5) * 0.4,
      size: 22 + Math.random() * 14,
      age: -Math.random() * 0.25, // 조금씩 시간차를 두고 등장
      life: 1.1,
    });
  }
}

// 꽃가루 (K.O., 판정승)
function spawnConfetti(match, count) {
  const colors = ['#ffd45e', '#ffffff', PLAYERS[0].color, PLAYERS[1].color, '#8ef0a8'];
  for (let i = 0; i < count; i++) {
    match.effects.push({
      type: 'confetti',
      x: Math.random() * ARENA.width,
      y: -20 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 80,
      vy: 120 + Math.random() * 140,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 12,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      color: colors[i % colors.length],
      age: -Math.random() * 1.2,
      life: 4.5,
    });
  }
}

// 이번 프레임에 생긴 타격 사건에 관중이 반응
function reactToEvents(match, fromIndex) {
  for (let i = fromIndex; i < match.events.length; i++) {
    const ev = match.events[i];
    if (ev.type === 'hit' || ev.type === 'break') {
      addHype(match, CROWD.hitHype * (HYPE_GAIN[ev.attack] ?? 1));
      spawnCheers(match, ev.attack === 'punch' ? 1 : ev.attack === 'kick' ? 2 : 5, ev.attacker);
    } else if (ev.type === 'block') {
      addHype(match, CROWD.hitHype * 0.3);
    }
  }
}

// ---------------- 경기 종료 ----------------

function endMatch(match, reason) {
  const [a, b] = match.playerIds.map((id) => match.fighters[id]);
  match.reason = reason;

  if (reason === 'ko') {
    match.phase = PHASE.KO;
    match.bannerTime = MATCH.koBannerSeconds;
    const aDown = a.hp <= 0;
    const bDown = b.hp <= 0;
    if (aDown) setState(a, 'ko');
    if (bDown) setState(b, 'ko');
    if (aDown && bDown) {
      match.winnerId = null; // 동시 K.O.
      match.reason = 'draw';
    } else {
      match.winnerId = aDown ? b.id : a.id;
      match.winPoseDelay = 0.7;
    }
    match.timeScale = 0.3;
    match.slowmoTime = 0.9;
    match.shake = Math.max(match.shake, 16);
    match.hype = 1;
    spawnCheers(match, 10, match.winnerId);
    spawnConfetti(match, 140);
    pushEvent(match, { type: 'ko' });
    return;
  }

  // 시간 종료 → 판정
  match.phase = PHASE.TIMEUP;
  match.bannerTime = MATCH.timeUpBannerSeconds;
  pushEvent(match, { type: 'timeup' });
  if (a.hp === b.hp) {
    match.winnerId = null;
    match.reason = 'draw';
    addHype(match, 0.3);
  } else {
    const winner = a.hp > b.hp ? a : b;
    const loser = winner === a ? b : a;
    match.winnerId = winner.id;
    match.reason = 'decision';
    match.winPoseDelay = 0.9;
    loser.attack = null;
    setState(loser, 'lose');
    match.hype = Math.max(match.hype, 0.85);
    spawnCheers(match, 6, winner.id);
    spawnConfetti(match, 70);
  }
}

/**
 * 한 프레임 진행
 * @param {object} match
 * @param {{p1: object, p2: object}} inputs
 * @param {number} realDt  실제 흐른 시간(초)
 */
export function updateMatch(match, inputs, realDt) {
  // 슬로모션
  if (match.slowmoTime > 0) {
    match.slowmoTime -= realDt;
    if (match.slowmoTime <= 0) match.timeScale = 1;
  }
  const dt = realDt * match.timeScale;

  match.shake = Math.max(0, match.shake - realDt * 40);
  for (const fx of match.effects) fx.age += fx.type === 'confetti' || fx.type === 'cheer' ? realDt : dt;
  match.effects = match.effects.filter((fx) => fx.age < fx.life).slice(-MAX_EFFECTS);

  // 관중 열기는 서서히 기본값으로 식음
  const floor = match.phase === PHASE.FIGHT ? CROWD.baseHype : 0.5;
  if (match.hype > floor) match.hype = Math.max(floor, match.hype - CROWD.hypeDecay * realDt);
  else match.hype = Math.min(floor, match.hype + 0.3 * realDt);

  const [idA, idB] = match.playerIds;
  const a = match.fighters[idA];
  const b = match.fighters[idB];

  if (match.phase === PHASE.INTRO) {
    match.introTime -= realDt;
    if (match.introTime <= 0) {
      match.phase = PHASE.FIGHT;
      pushEvent(match, { type: 'bell' });
      addHype(match, 0.3);
      spawnCheers(match, 4);
    }
  }
  const fighting = match.phase === PHASE.FIGHT;

  // 서로 마주 보기 (자유롭게 움직일 수 있을 때만 방향 전환)
  if (isControllable(a)) a.facing = b.x >= a.x ? 1 : -1;
  if (isControllable(b)) b.facing = a.x >= b.x ? 1 : -1;

  updateFighter(a, fighting ? inputs[idA] ?? NO_INPUT : NO_INPUT, dt, fighting);
  updateFighter(b, fighting ? inputs[idB] ?? NO_INPUT : NO_INPUT, dt, fighting);

  if (fighting) {
    const before = match.events.length;
    resolveAttacks(a, b, match);
    reactToEvents(match, Math.min(before, match.events.length));
    if (match.events.length > MAX_EVENTS) match.events.splice(0, match.events.length - MAX_EVENTS);
  }
  separateFighters(a, b);

  if (fighting) {
    match.elapsed += dt;
    match.timeLeft = Math.max(0, match.timeLeft - dt);
    if (a.hp <= 0 || b.hp <= 0) endMatch(match, 'ko');
    else if (match.timeLeft <= 0) endMatch(match, 'timeup');
    return;
  }

  if (match.phase === PHASE.KO || match.phase === PHASE.TIMEUP) {
    if (match.winPoseDelay > 0) {
      match.winPoseDelay -= realDt;
      const winner = match.fighters[match.winnerId];
      if (match.winPoseDelay <= 0 && winner) {
        winner.attack = null;
        setState(winner, 'win');
        pushEvent(match, { type: 'cheer' });
        spawnCheers(match, 6, winner.id);
      }
    }
    match.bannerTime -= realDt;
    if (match.bannerTime <= 0) match.done = true;
  }
}

/** 소리 재생용 사건 꺼내기 (꺼낸 사건은 목록에서 지워짐) */
export function takeEvents(match) {
  const list = match.events;
  match.events = [];
  return list;
}
