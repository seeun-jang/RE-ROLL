// 게임 화면을 캔버스에 그리는 파일입니다.
// (규칙은 engine.js, 배경은 scenery.js, 영웅 그림은 heroes.js)
import {
  WIDTH,
  HEIGHT,
  GROUND_Y,
  PLAYER_IDS,
  PLAYER_INFO,
  LANES,
  LANE_COLORS,
  HIGHWAY,
  NOTE_LEAD,
  STAGE,
  END_DELAY,
  FINISHER,
} from './config.js';
import { multiplier } from './engine.js';
import { MOVES } from './moves.js';
import { drawBackdrop, drawForegroundLayer, planeMatrix, STAGE_Z, CAM0 } from './scenery.js';
import { applyPost } from './post.js';
import { drawHero, drawDivineAura, drawPlantedSpear, spearTip, LOOK } from './heroes.js';

export { createScenery, drawBackdrop } from './scenery.js';

export const FONT_KR = '"Black Han Sans", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const FONT_EPIC = '"Cinzel", "Black Han Sans", serif';
const TAU = Math.PI * 2;
const GOLD = '#f2c35b';
const LANE_ANGLE = [Math.PI, Math.PI / 2, -Math.PI / 2, 0]; // ← ↓ ↑ →
const JUDGE_STYLE = {
  perfect: ['PERFECT', '#ffe07a'],
  great: ['GREAT', '#8fd3ff'],
  good: ['GOOD', '#b8f0a0'],
  miss: ['MISS', '#8a7a70'],
};

// 박자 위치: 박자 직후 1 → 점점 0
function beatPulse(state) {
  const { beat, countIn } = state.song;
  if (state.time < 0) return 0;
  const phase = ((state.time - countIn) / beat) % 1;
  const p = phase < 0 ? phase + 1 : phase;
  return Math.exp(-p * 6);
}

const lerp = (a, b, t) => a + (b - a) * t;

// 영웅을 비추는 빛: 뒤쪽 위 핏빛 달 + 바깥쪽 화로 불빛
function heroLights(x) {
  const out = x < WIDTH / 2 ? -1 : 1;
  const dx = (700 - x) / 500;
  const len = Math.hypot(dx, 1);
  return [
    { x: dx / len, y: -1 / len, color: 'rgba(255,110,95,0.95)' },
    { x: out, y: 0.1, color: 'rgba(255,150,60,0.75)' },
  ];
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const laneX = (id, lane) => HIGHWAY.x[id] + (lane + 0.5) * HIGHWAY.laneWidth;
const noteY = (dt) => HIGHWAY.judgeY - (dt / NOTE_LEAD) * (HIGHWAY.judgeY - HIGHWAY.top);

export function renderGame(ctx, state, now, scenery) {
  const pulse = beatPulse(state);

  ctx.save();
  if (state.shake > 0) {
    ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }
  // 맞은 곳으로 줌
  if (state.zoom > 0.001) {
    const z = 1 + state.zoom;
    ctx.translate(state.zoomX, state.zoomY);
    ctx.scale(z, z);
    ctx.translate(-state.zoomX, -state.zoomY);
  }
  // 3D 카메라: 천천히 좌우로 돌고, 앞서는 쪽으로 쏠리고, 박자마다 들썩이고,
  // 맞으면 맞은 방향으로 튕기며 앞으로 밀고 들어감
  const cam = {
    x: Math.sin(now * 0.17) * 40 - state.lead * 36 - state.kick * 1.3,
    y: CAM0.y + Math.sin(now * 0.13) * 10 + pulse * 5,
    z: CAM0.z + state.zoom * 260 + (state.finisher ? Math.min(1, state.finisher.t / 1.2) * 120 : 0),
  };
  state.cam = cam;
  const flash = state.pillars.reduce((m, p) => Math.max(m, p.life / p.maxLife), 0);
  // 앞서거나 신의 창을 던진 쪽 군대가 함성
  const { p1, p2 } = state.players;
  const cheer = {
    p1: p1.blessed > 0 || state.lead > 0.25 || state.finisher?.winner === 'p1',
    p2: p2.blessed > 0 || state.lead < -0.25 || state.finisher?.winner === 'p2',
  };
  drawBackdrop(ctx, scenery, now, { final: state.final, pulse, cam, flash, cheer });
  if (state.final) drawSkyLightning(ctx, state);
  // 무대(영웅, 피, 무대 효과)는 영웅 깊이에 맞춰 카메라로 투영
  ctx.save();
  ctx.transform(...planeMatrix(STAGE_Z, cam));
  drawStage(ctx, state, now, pulse);
  drawPillars(ctx, state);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRings(ctx, state, false);
  ctx.restore();
  drawParticles(ctx, state, false);
  ctx.restore();
  drawForegroundLayer(ctx, scenery, cam);
  // 마무리 일격 중에는 노트 레인을 걷어내서 무대가 보이게
  const laneAlpha = state.finisher ? 1 - clamp01(state.finisher.t / 0.4) : 1;
  if (laneAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = laneAlpha;
    for (const id of PLAYER_IDS) drawHighway(ctx, state, id, now, pulse);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawRings(ctx, state, true);
  drawFlares(ctx, state);
  drawFeeds(ctx, state);
  ctx.restore();
  drawParticles(ctx, state, true);
  ctx.restore();

  applyPost(ctx);
  if (state.aberration > 0.02) drawAberration(ctx, state.aberration);
  drawVignette(ctx);
  drawScreenBlood(ctx, state);
  drawLeaderGlow(ctx, state, pulse);
  drawLetterbox(ctx, state);
  drawCutin(ctx, state, now);
  drawHud(ctx, state, now, pulse);
  drawCenter(ctx, state);

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(${state.flashColor},${state.flash * 0.6})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (state.impact > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
}

// ======================================================================
// 노트 레인
// ======================================================================

function drawHighway(ctx, state, id, now, pulse) {
  const p = state.players[id];
  const x0 = HIGHWAY.x[id];
  const w = HIGHWAY.laneWidth * LANES;
  const top = HIGHWAY.top - 10;
  const bottom = HIGHWAY.judgeY + 40;
  const info = PLAYER_INFO[id];

  // 바탕
  const bg = ctx.createLinearGradient(0, top, 0, bottom);
  bg.addColorStop(0, 'rgba(12,4,0,0)');
  bg.addColorStop(0.25, 'rgba(12,4,0,0.72)');
  bg.addColorStop(1, 'rgba(12,4,0,0.88)');
  ctx.fillStyle = bg;
  ctx.fillRect(x0, top, w, bottom - top);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, w, bottom - top);
  ctx.clip();

  // 레인을 누르면 빛기둥
  for (let l = 0; l < LANES; l++) {
    const glow = Math.max(p.laneFlash[l], p.held[l] ? 0.35 : 0);
    if (glow <= 0) continue;
    const lx = x0 + l * HIGHWAY.laneWidth;
    const g = ctx.createLinearGradient(0, HIGHWAY.judgeY, 0, top);
    g.addColorStop(0, hexA(LANE_COLORS[l], 0.55 * glow));
    g.addColorStop(1, hexA(LANE_COLORS[l], 0));
    ctx.fillStyle = g;
    ctx.fillRect(lx, top, HIGHWAY.laneWidth, HIGHWAY.judgeY - top);
  }

  // 박자 선
  const { beat, countIn } = state.song;
  const firstBeat = Math.ceil((state.time - countIn - 0.2) / beat);
  for (let b = firstBeat; b < firstBeat + 12; b++) {
    const t = countIn + b * beat;
    const y = noteY(t - state.time);
    if (y < top) break;
    const bar = b % 4 === 0;
    ctx.fillStyle = bar ? 'rgba(242,195,91,0.35)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(x0, y - (bar ? 1 : 0.5), w, bar ? 2 : 1);
  }

  // 레인 구분선
  ctx.fillStyle = 'rgba(242,195,91,0.18)';
  for (let l = 1; l < LANES; l++) ctx.fillRect(x0 + l * HIGHWAY.laneWidth - 0.5, top, 1, bottom - top);

  // 콤보 숫자 (레인 뒤쪽에 크게)
  if (p.combo >= 5) {
    ctx.save();
    const pop = p.comboPop ?? 0;
    ctx.globalAlpha = 0.22 + pulse * 0.1 + pop * 0.35;
    ctx.fillStyle = pop > 0.5 ? '#ffffff' : '#fff4dc';
    ctx.font = `700 ${64 + pulse * 6 + pop * 18}px ${FONT_EPIC}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.combo), x0 + w / 2, 230);
    ctx.font = `700 14px ${FONT_EPIC}`;
    ctx.fillText('COMBO', x0 + w / 2, 272);
    ctx.restore();
  }

  // 판정선 + 받침
  ctx.fillStyle = hexA(GOLD, 0.6 + pulse * 0.4);
  ctx.fillRect(x0, HIGHWAY.judgeY - 1.5, w, 3);
  for (let l = 0; l < LANES; l++) drawReceptor(ctx, laneX(id, l), HIGHWAY.judgeY, l, p.held[l], p.laneFlash[l], pulse);

  // 노트
  for (let i = Math.max(0, p.cursor - 8); i < p.notes.length; i++) {
    const n = p.notes[i];
    const dt = n.t - state.time;
    if (dt > NOTE_LEAD * 1.05) break;
    if (n.judged && n.result !== 'miss') continue;
    const y = noteY(dt);
    if (y > bottom + 30) continue;
    drawNote(ctx, laneX(id, n.lane), y, n.lane, n.result === 'miss');
  }
  ctx.restore();

  if (multiplier(p) >= 2) drawHighwayFire(ctx, x0, w, top, bottom, LOOK[id].glow, now);

  // 테두리
  ctx.strokeStyle = hexA(info.color, 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, top + 40);
  ctx.lineTo(x0, bottom);
  ctx.lineTo(x0 + w, bottom);
  ctx.lineTo(x0 + w, top + 40);
  ctx.stroke();

  // 판정 글자
  if (p.judgment) {
    const j = p.judgment;
    const u = 1 - j.life / j.maxLife;
    const [text, color] = JUDGE_STYLE[j.kind];
    ctx.save();
    ctx.globalAlpha = u > 0.6 ? (1 - u) / 0.4 : 1;
    ctx.translate(x0 + w / 2, 330 - u * 10);
    const s = u < 0.15 ? 1.3 - u * 2 : 1;
    ctx.scale(s, s);
    ctx.font = `700 26px ${FONT_EPIC}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, 0, 0);
    if (j.kind === 'perfect') {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

// 배율 x2 이상이면 레인 양옆에 불꽃
function drawHighwayFire(ctx, x0, w, top, bottom, rgb, now) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const edge of [x0, x0 + w]) {
    for (let i = 0; i < 14; i++) {
      const phase = (now * 1.3 + i * 0.071) % 1;
      const y = bottom - phase * (bottom - top);
      const x = edge + Math.sin(now * 6 + i * 1.7) * 6;
      const size = (1 - phase) * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
      g.addColorStop(0, `rgba(255,255,240,${0.7 * (1 - phase)})`);
      g.addColorStop(0.4, `rgba(${rgb},${0.5 * (1 - phase)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, size, size * 2, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function arrowPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.2, -size * 0.85);
  ctx.lineTo(-size * 0.2, -size * 0.35);
  ctx.lineTo(-size * 0.9, -size * 0.35);
  ctx.lineTo(-size * 0.9, size * 0.35);
  ctx.lineTo(-size * 0.2, size * 0.35);
  ctx.lineTo(-size * 0.2, size * 0.85);
  ctx.closePath();
}

function drawReceptor(ctx, x, y, lane, held, flash, pulse) {
  ctx.save();
  ctx.translate(x, y);
  const s = held ? 0.88 : 1 + pulse * 0.05;
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.arc(0, 0, 23, 0, TAU);
  ctx.fillStyle = held ? hexA(LANE_COLORS[lane], 0.35) : 'rgba(20,8,2,0.7)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = flash > 0 ? '#ffffff' : GOLD;
  ctx.stroke();
  ctx.rotate(LANE_ANGLE[lane]);
  arrowPath(ctx, 13);
  ctx.lineWidth = 2;
  ctx.strokeStyle = hexA(LANE_COLORS[lane], 0.9);
  ctx.stroke();
  ctx.restore();
}

function drawNote(ctx, x, y, lane, missed) {
  ctx.save();
  ctx.translate(x, y);
  if (missed) ctx.globalAlpha = 0.3;
  // 떨어지며 남는 꼬리
  if (!missed) {
    const tail = ctx.createLinearGradient(0, -70, 0, 0);
    tail.addColorStop(0, hexA(LANE_COLORS[lane], 0));
    tail.addColorStop(1, hexA(LANE_COLORS[lane], 0.55));
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-6, -70);
    ctx.lineTo(6, -70);
    ctx.lineTo(16, 0);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fill();
  }
  // 청동 테두리 원반
  const rim = ctx.createLinearGradient(-22, -22, 22, 22);
  rim.addColorStop(0, '#fbe08a');
  rim.addColorStop(1, '#7a4a14');
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, TAU);
  ctx.fillStyle = rim;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, TAU);
  ctx.fillStyle = LANE_COLORS[lane];
  ctx.fill();
  ctx.rotate(LANE_ANGLE[lane]);
  arrowPath(ctx, 11);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

// ======================================================================
// 가운데 무대 (영웅)
// ======================================================================

function heroX(state, id) {
  return STAGE[id] + state.lead * STAGE.push;
}

// 돌진(앞으로) + 맞고 밀려남(뒤로)을 더한 실제 서 있는 위치
function fightX(state, id) {
  const p = state.players[id];
  const facing = id === 'p1' ? 1 : -1;
  let x = heroX(state, id);
  if (p.action) {
    const u = 1 - p.action.life / p.action.maxLife;
    // 빠르게 튀어나갔다가 천천히 돌아옴
    const reach = u < 0.35 ? Math.sin((u / 0.35) * (Math.PI / 2)) : 1 - (u - 0.35) / 0.65;
    x += facing * MOVES[p.action.move].lunge * reach;
  }
  x -= facing * p.recoil * 120;
  return x;
}

function drawStage(ctx, state, now, pulse) {
  if (state.finisher) {
    drawSplats(ctx, state);
    drawFinisher(ctx, state, now);
    return;
  }
  const xs = { p1: fightX(state, 'p1'), p2: fightX(state, 'p2') };
  const poses = { p1: heroPose(state, 'p1', now), p2: heroPose(state, 'p2', now) };

  drawSplats(ctx, state);
  // 공격 중인 영웅을 앞에 그림
  const order = state.players.p1.action && !state.players.p2.action ? ['p2', 'p1'] : ['p1', 'p2'];
  for (const id of order) drawStageHero(ctx, state, id, xs[id], now, poses[id]);
  if (!state.players.p1.action && !state.players.p2.action) drawBeams(ctx, state, now, pulse, xs, poses);
  for (const id of PLAYER_IDS) drawStrike(ctx, state, id, xs[id], now);
  drawJavelins(ctx, state, now);
  drawSlashes(ctx, state);
  drawSkySpears(ctx, state, now);
}

// 승자가 뛰어올라 진 쪽에게 창을 꽂는 마무리
function drawFinisher(ctx, state, now) {
  const { winner: w, loser: l, t } = state.finisher;
  const dir = w === 'p1' ? 1 : -1;
  const lx = heroX(state, l);
  const wx0 = heroX(state, w);
  const landX = lx - dir * 95;

  // 승자 위치/자세
  let wx = wx0;
  let wy = 0;
  let pose;
  if (t < FINISHER.leapAt) {
    wx = wx0 - dir * 14 * (t / FINISHER.leapAt);
    pose = { windup: true };
  } else if (t < FINISHER.strikeAt) {
    const k = (t - FINISHER.leapAt) / (FINISHER.strikeAt - FINISHER.leapAt);
    wx = lerp(wx0, landX, k);
    wy = Math.sin(k * Math.PI) * 110;
    pose = { airborne: true, windup: true };
  } else {
    wx = landX;
    pose = t < FINISHER.victoryAt ? { thrown: true, noSpear: true } : { victory: true, noSpear: true };
  }

  // 진 쪽: 창에 맞아 뒤로 쓰러짐
  const fall = clamp01((t - FINISHER.strikeAt) / FINISHER.fallTime);
  const fallEase = 1 - (1 - fall) * (1 - fall);
  ctx.save();
  ctx.translate(lx + dir * fallEase * 20, GROUND_Y);
  ctx.rotate(dir * 1.45 * fallEase);
  ctx.scale(-dir * STAGE.heroScale, STAGE.heroScale);
  drawHero(ctx, l, { now, dizzy: true, noSpear: fall > 0, lights: heroLights(lx) });
  ctx.restore();

  // 꽂힌 창: 가슴에서 시작해 쓰러진 몸과 함께 땅에 박힘
  if (t >= FINISHER.strikeAt) {
    const startTip = { x: lx - dir * 6, y: GROUND_Y - 120 };
    const endTip = { x: lx + dir * 120, y: GROUND_Y - 6 };
    const tipX = lerp(startTip.x, endTip.x, fallEase);
    const tipY = lerp(startTip.y, endTip.y, fallEase);
    const startAngle = dir > 0 ? 0 : Math.PI;
    const endAngle = Math.atan2(190, dir * 80);
    drawPlantedSpear(ctx, w, tipX, tipY, lerp(startAngle, endAngle, fallEase), now);
  }

  // 승자
  ctx.fillStyle = 'rgba(20,6,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(wx, GROUND_Y + 2, 58 * (1 - wy / 220), 10, 0, 0, TAU);
  ctx.fill();
  drawDivineAura(ctx, w, wx, GROUND_Y - 100 - wy, now, t >= FINISHER.victoryAt ? 1.5 : 1);
  ctx.save();
  ctx.translate(wx, GROUND_Y - wy);
  ctx.scale(dir * STAGE.heroScale, STAGE.heroScale);
  drawHero(ctx, w, { now, divineReady: true, ...pose, lights: heroLights(wx) });
  ctx.restore();

  // 뛰어오를 때 잔상
  if (wy > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${LOOK[w].glow},0.6)`;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(wx0, GROUND_Y - 100);
    ctx.quadraticCurveTo((wx0 + wx) / 2, GROUND_Y - 260, wx, GROUND_Y - 100 - wy);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSplats(ctx, state) {
  for (const sp of state.splats) {
    ctx.globalAlpha = Math.min(1, sp.life / (sp.maxLife * 0.5)) * 0.85;
    ctx.fillStyle = '#5a0408';
    ctx.beginPath();
    ctx.ellipse(sp.x, GROUND_Y + 1, sp.r * 1.8, sp.r * 0.45, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 창이 꽂힌 자리의 베기 자국
function drawSlashes(ctx, state) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const sl of state.slashes) {
    const u = 1 - sl.life / sl.maxLife;
    const len = 40 + sl.power * 50;
    ctx.save();
    ctx.translate(sl.x, sl.y);
    ctx.rotate(sl.angle);
    ctx.globalAlpha = 1 - u;
    for (const [w, color] of [
      [12 * (1 - u) + 2, 'rgba(255,40,40,0.8)'],
      [4 * (1 - u) + 1, 'rgba(255,255,255,1)'],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(-len * (0.3 + u), 0);
      ctx.lineTo(len * (0.3 + u), 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function heroPose(state, id, now) {
  const p = state.players[id];
  const a = p.action;
  const m = a?.move;
  const u = a ? 1 - a.life / a.maxLife : 0;
  return {
    now,
    shield: m === 'bash',
    bash: m === 'bash' && u > 0.15 && u < 0.65,
    windup: (m === 'thrust' && u < 0.25) || (m === 'javelin' && u < 0.33) || (m === 'smash' && u < 0.45),
    thrown: (m === 'thrust' && u >= 0.25) || (m === 'javelin' && u >= 0.33),
    noSpear: m === 'javelin' && u >= 0.33,
    airborne: m === 'smash' && u < 0.55,
    punch: m === 'punch',
    butt: m === 'butt',
    smashDown: m === 'smash' && u >= 0.45,
    spin: m === 'spin',
    divineReady: p.blessed > 0 || multiplier(p) >= 2,
    dizzy: p.hurt > 0 || p.recoil > 0.08,
    victory: state.phase === 'end' && winnerOf(state) === id,
  };
}

// 창끝 → 가운데 충돌 지점까지 에너지 빔
function drawBeams(ctx, state, now, pulse, xs, poses) {
  const scale = STAGE.heroScale;
  const tips = {};
  for (const id of PLAYER_IDS) {
    const facing = id === 'p1' ? 1 : -1;
    const tip = spearTip(poses[id]);
    tips[id] = { x: xs[id] + tip.x * facing * scale, y: GROUND_Y + tip.y * scale };
  }
  const cx = WIDTH / 2 + state.lead * 34;
  const cy = (tips.p1.y + tips.p2.y) / 2 - 4;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const id of PLAYER_IDS) {
    const p = state.players[id];
    const rgb = LOOK[id].glow;
    const power = 0.45 + Math.min(1, p.combo / 25) * 0.55;
    const { x, y } = tips[id];
    for (const [w, a] of [
      [30 * power + pulse * 8, 0.18],
      [14 * power + pulse * 4, 0.45],
      [5, 0.95],
    ]) {
      ctx.strokeStyle = a > 0.9 ? 'rgba(255,255,255,0.95)' : `rgba(${rgb},${a})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const wob = i === segs ? 0 : Math.sin(now * 40 + i * 2.1 + (id === 'p1' ? 0 : 3)) * 3 * power;
        ctx.lineTo(lerp(x, cx, t), lerp(y, cy, t) + wob);
      }
      ctx.stroke();
    }
  }

  // 충돌 지점
  const r = 26 + pulse * 14 + Math.abs(state.lead) * 10;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 2.6);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, `rgba(${state.lead >= 0 ? LOOK.p1.glow : LOOK.p2.glow},0.7)`);
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.6, 0, TAU);
  ctx.fill();
  // 튀는 전기
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * TAU;
    ctx.strokeStyle = `rgba(${k % 2 ? LOOK.p1.glow : LOOK.p2.glow},0.9)`;
    ctx.lineWidth = 1.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 1; i <= 4; i++) {
      const rr = r * 0.7 * i;
      const j = (Math.random() - 0.5) * 0.7;
      ctx.lineTo(cx + Math.cos(a + j) * rr, cy + Math.sin(a + j) * rr);
    }
    ctx.stroke();
  }
  // 수평 렌즈 플레어
  const flare = ctx.createLinearGradient(cx - 220, 0, cx + 220, 0);
  flare.addColorStop(0, 'rgba(255,255,255,0)');
  flare.addColorStop(0.5, `rgba(255,240,210,${0.35 + pulse * 0.4})`);
  flare.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = flare;
  ctx.fillRect(cx - 220, cy - 1.5 - pulse * 2, 440, 3 + pulse * 4);
  ctx.restore();
}


function drawStageHero(ctx, state, id, x, now, pose) {
  const p = state.players[id];
  const facing = id === 'p1' ? 1 : -1;
  const knock = p.hurt > 0 ? -facing * p.hurt * 50 : 0;
  const scale = STAGE.heroScale;

  const lights = heroLights(x);

  // 젖은 바닥에 비친 모습
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.translate(x + knock, GROUND_Y + 4);
  ctx.scale(facing * scale, -scale * 0.8);
  drawHero(ctx, id, { ...pose, lights });
  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y + 2, 62, 10, 0, 0, TAU);
  ctx.fill();

  if (pose.divineReady) drawDivineAura(ctx, id, x, GROUND_Y - 100, now, p.blessed > 0 ? 1.4 : 0.8);

  // 돌진할 때 잔상
  const a = p.action;
  if (a) {
    const u = 1 - a.life / a.maxLife;
    if (u < 0.5) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [back, alpha] of [
        [34, 0.28],
        [68, 0.14],
      ]) {
        ctx.globalAlpha = alpha * (1 - u * 2);
        ctx.save();
        ctx.translate(x + knock - facing * back, GROUND_Y);
        ctx.scale(facing * scale, scale);
        drawHero(ctx, id, { ...pose, lights });
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // 내려찍기 점프, 회전 베기
  let lift = 0;
  let spinX = 1;
  if (a) {
    const u = 1 - a.life / a.maxLife;
    if (a.move === 'smash' && u < 0.55) lift = Math.sin((u / 0.55) * Math.PI) * MOVES.smash.jump;
    if (a.move === 'spin') {
      const c = Math.cos(Math.min(1, u / 0.6) * TAU);
      spinX = Math.sign(c || 1) * Math.max(0.2, Math.abs(c));
    }
  }

  ctx.save();
  ctx.translate(x + knock, GROUND_Y - lift);
  // 맞으면 몸이 뒤로 젖혀지며 휘청
  const stagger = p.stagger ?? 0;
  if (stagger > 0) ctx.rotate(-facing * stagger * 0.3 * (1 + 0.25 * Math.sin(now * 40)));
  ctx.scale(facing * scale * spinX, scale);
  drawHero(ctx, id, { ...pose, lights });
  ctx.restore();
  drawPierce(ctx, state, id, x + knock);

  // 맞았을 때 붉게 번쩍
  if (p.hurt > 0.3 || p.recoil > 0.1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x + knock, GROUND_Y - 100, 10, x + knock, GROUND_Y - 100, 130);
    g.addColorStop(0, 'rgba(255,60,40,0.6)');
    g.addColorStop(1, 'rgba(255,60,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 140, GROUND_Y - 240, 280, 260);
    ctx.restore();
  }
}

// 노트를 칠 때마다 영웅 앞에 남는 참격 궤적
function drawStrike(ctx, state, id, x, now) {
  const a = state.players[id].action;
  if (!a) return;
  const u = 1 - a.life / a.maxLife;
  const facing = id === 'p1' ? 1 : -1;
  const rgb = LOOK[id].glow;
  const k = STAGE.heroScale;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, GROUND_Y);
  ctx.scale(facing * k, k);
  ctx.globalAlpha = Math.max(0, 1 - u);
  ctx.lineCap = 'round';
  const stroke = (w, color) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  switch (a.move) {
    case 'thrust': {
      // 앞으로 뻗는 빛줄기
      if (u < 0.2) break;
      const len = 60 + u * 140;
      const g = ctx.createLinearGradient(60, 0, 60 + len, 0);
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.beginPath();
      ctx.moveTo(60, -134);
      ctx.lineTo(60 + len, -134);
      stroke(10 * (1 - u) + 2, g);
      break;
    }
    case 'punch': {
      // 주먹 끝에서 터지는 충격
      const cx = 78;
      const cy = -146;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TAU;
        const r0 = 6 + u * 20;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * (r0 + 14), cy + Math.sin(ang) * (r0 + 14));
        stroke(3, 'rgba(255,255,255,0.9)');
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 10 + u * 30, 0, TAU);
      stroke(4 * (1 - u) + 1, `rgba(${rgb},0.9)`);
      break;
    }
    case 'bash': {
      // 방패 앞의 반원 충격파 두 겹
      for (const [off, w] of [
        [0, 9],
        [18, 4],
      ]) {
        ctx.beginPath();
        ctx.ellipse(70 + off, -128, 20 + u * 60, 50 + u * 40, 0, -Math.PI / 2, Math.PI / 2);
        stroke(w * (1 - u) + 1, `rgba(${rgb},0.9)`);
      }
      break;
    }
    case 'butt': {
      // 아래에서 위로 올려치는 호
      ctx.beginPath();
      ctx.arc(30, -120, 70, Math.PI * 0.15, -Math.PI * (0.15 + u * 0.4), true);
      stroke(12 * (1 - u) + 1, `rgba(${rgb},0.8)`);
      stroke(3, 'rgba(255,255,255,0.95)');
      break;
    }
    case 'javelin':
      break; // 날아가는 창은 drawJavelins 에서
    case 'smash': {
      // 위에서 아래로 떨어지는 초승달
      if (u < 0.35) break;
      ctx.beginPath();
      ctx.arc(40, -150, 90, -Math.PI * 0.6, Math.PI * 0.35);
      stroke(16 * (1 - u) + 1, `rgba(${rgb},0.75)`);
      stroke(4, 'rgba(255,255,255,0.95)');
      break;
    }
    case 'spin': {
      // 몸 주위를 한 바퀴 도는 칼바람
      const sweep = Math.min(1, u / 0.6) * TAU;
      ctx.beginPath();
      ctx.ellipse(0, -132, 120, 34, 0, -Math.PI / 2, -Math.PI / 2 + sweep);
      stroke(14 * (1 - u) + 1, `rgba(${rgb},0.7)`);
      stroke(3, 'rgba(255,255,255,0.95)');
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// 몸을 뚫고 등 뒤로 튀어나온 창끝
function drawPierce(ctx, state, id, x) {
  for (const pc of state.pierces) {
    if (pc.id !== id) continue;
    const u = 1 - pc.life / pc.maxLife;
    const out = Math.min(1, u * 6); // 빠르게 튀어나옴
    ctx.save();
    ctx.translate(x + pc.dir * 18, pc.y);
    ctx.scale(pc.dir, 1);
    ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
    // 피범벅 창끝
    ctx.fillStyle = '#5a0008';
    ctx.fillRect(0, -2.5, 46 * out, 5);
    ctx.beginPath();
    ctx.moveTo(40 * out, -7);
    ctx.lineTo(70 * out, 0);
    ctx.lineTo(40 * out, 7);
    ctx.closePath();
    const blade = ctx.createLinearGradient(40 * out, 0, 70 * out, 0);
    blade.addColorStop(0, '#7a0a10');
    blade.addColorStop(0.6, '#d8c8c0');
    blade.addColorStop(1, '#ffffff');
    ctx.fillStyle = blade;
    ctx.fill();
    // 상처에서 흐르는 피
    ctx.fillStyle = 'rgba(160,0,12,0.9)';
    for (let k = 0; k < 3; k++) {
      const dy = (u * 50 + k * 9) % 40;
      ctx.fillRect(8 + k * 9, 4 + dy, 2.5, 6);
    }
    ctx.restore();
  }
}

// 강타 때 화면이 좌우로 겹쳐 보임 (색수차)
function drawAberration(ctx, amount) {
  const c = ctx.canvas;
  const k = amount * 6 * (c.width / WIDTH);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.16 * amount;
  ctx.drawImage(c, -k, 0);
  ctx.drawImage(c, k, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(160,0,10,${0.18 * amount})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();
}

// 화면에 튄 피: 동그랗게 튀고 아래로 흘러내림
function drawScreenBlood(ctx, state) {
  for (const b of state.screenBlood) {
    const a = Math.min(1, b.life / (b.maxLife * 0.5));
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = '#6a0006';
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * TAU;
      const r = b.r * (0.75 + 0.35 * Math.sin(b.seed + i * 2.3));
      ctx.lineTo(b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();
    // 흘러내리는 줄기
    for (let k = 0; k < 2; k++) {
      const dx = (k - 0.5) * b.r * 0.8;
      ctx.fillRect(b.x + dx - 1.5, b.y, 3, b.drip * (0.6 + k * 0.5));
      ctx.beginPath();
      ctx.arc(b.x + dx, b.y + b.drip * (0.6 + k * 0.5), 3, 0, TAU);
      ctx.fill();
    }
    // 젖은 반짝임
    ctx.fillStyle = 'rgba(255,120,120,0.35)';
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.18, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// 투창: 손을 떠나 상대 가슴으로 날아가는 창
function drawJavelins(ctx, state, now) {
  for (const j of state.javelins) {
    if (j.t < 0) continue;
    const k = Math.min(1, j.t / j.dur);
    const dir = j.from === 'p1' ? 1 : -1;
    const x0 = fightX(state, j.from) + dir * 60;
    const x1 = heroX(state, j.from === 'p1' ? 'p2' : 'p1');
    const x = lerp(x0, x1, k);
    const y = GROUND_Y - 160 + k * 25 - Math.sin(k * Math.PI) * 30;
    const rgb = LOOK[j.from].glow;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.rotate(-0.15 + k * 0.3);
    const trail = ctx.createLinearGradient(-260, 0, 0, 0);
    trail.addColorStop(0, `rgba(${rgb},0)`);
    trail.addColorStop(1, `rgba(${rgb},0.85)`);
    ctx.strokeStyle = trail;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-260, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 16 + Math.sin(now * 40) * 4;
    ctx.scale(1.3, 1.3);
    spearShape(ctx, '#ffffff');
    ctx.restore();
  }
}

function winnerOf(state) {
  const { p1, p2 } = state.players;
  if (p1.score === p2.score) return null;
  return p1.score > p2.score ? 'p1' : 'p2';
}

function spearShape(ctx, glow) {
  ctx.strokeStyle = glow;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-84, 0);
  ctx.lineTo(14, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(12, -6);
  ctx.lineTo(36, 0);
  ctx.lineTo(12, 6);
  ctx.closePath();
  ctx.fillStyle = '#fffbe0';
  ctx.fill();
}

// 콤보 달성: 하늘에서 상대 머리 위로 거대한 빛의 창이 내리꽂힘
function drawSkySpears(ctx, state, now) {
  for (const s of state.spears) {
    const k = Math.min(1, s.t / s.dur);
    const target = s.from === 'p1' ? 'p2' : 'p1';
    const tx = heroX(state, target);
    const dir = s.from === 'p1' ? -1 : 1;
    const ease = k * k;
    const x = tx + dir * 160 * (1 - ease);
    const y = lerp(-160, GROUND_Y - 30, ease);
    const angle = Math.atan2(GROUND_Y - 30 + 160, -dir * 160);
    const rgb = LOOK[s.from].glow;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 착탄 지점 표시
    ctx.strokeStyle = `rgba(${rgb},${0.3 + k * 0.6})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(tx, GROUND_Y, 70 * (1.4 - k), 14 * (1.4 - k), 0, 0, TAU);
    ctx.stroke();

    ctx.translate(x, y);
    ctx.rotate(angle);
    const trail = ctx.createLinearGradient(-420, 0, 0, 0);
    trail.addColorStop(0, `rgba(${rgb},0)`);
    trail.addColorStop(1, `rgba(${rgb},0.9)`);
    ctx.strokeStyle = trail;
    ctx.lineCap = 'round';
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(-420, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(-260, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.shadowColor = `rgb(${rgb})`;
    ctx.shadowBlur = 40;
    ctx.scale(2.4, 2.4);
    spearShape(ctx, '#ffffff');
    ctx.restore();
  }
}

function drawPillars(ctx, state) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of state.pillars) {
    const u = 1 - p.life / p.maxLife;
    const w = 90 * (1 - u) + 6;
    const g = ctx.createLinearGradient(p.x - w, 0, p.x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, hexA(p.color, 0.9 * (1 - u)));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - w, 0, w * 2, GROUND_Y + 10);
    ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - u)})`;
    ctx.fillRect(p.x - w * 0.12, 0, w * 0.24, GROUND_Y + 10);
  }
  ctx.restore();
}

// 최후 구간: 마디마다 하늘에 번개
function drawSkyLightning(ctx, state) {
  const { beat, countIn } = state.song;
  const bar = Math.floor((state.time - countIn) / (beat * 4));
  const phase = ((state.time - countIn) / (beat * 4)) % 1;
  if (phase > 0.12) return;
  const a = 1 - phase / 0.12;
  const seed = bar * 7.31;
  const x0 = 200 + ((Math.sin(seed) + 1) / 2) * 560;
  ctx.save();
  ctx.fillStyle = `rgba(255,200,200,${a * 0.18})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255,220,220,${a})`;
  ctx.shadowColor = '#ff6060';
  ctx.shadowBlur = 20;
  ctx.lineWidth = 3;
  ctx.beginPath();
  let x = x0;
  ctx.moveTo(x, 0);
  for (let i = 1; i <= 8; i++) {
    x += Math.sin(seed * 13 + i * 4.7) * 26;
    ctx.lineTo(x, i * 34);
  }
  ctx.stroke();
  ctx.restore();
}


// ======================================================================
// 이펙트
// ======================================================================

function drawRings(ctx, state, hud) {
  for (const r of state.rings) {
    if (!!r.hud !== hud) continue;
    const u = 1 - r.life / r.maxLife;
    ctx.globalAlpha = 1 - u;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * (1 - u) + 0.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius * (0.3 + u * 0.9), 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawParticles(ctx, state, hud) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const p of state.particles) {
    if (!!p.hud !== hud) continue;
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === 'mist') {
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, `rgba(150,6,12,${0.5 * a})`);
      g.addColorStop(1, 'rgba(120,0,8,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      continue;
    }
    if (p.kind === 'blood') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      ctx.stroke();
      continue;
    }
    if (p.kind === 'rock') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.life * 10);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
      continue;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.size;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlares(ctx, state) {
  for (const f of state.flares) {
    const u = 1 - f.life / f.maxLife;
    const s = 70 * (1 - u * 0.5);
    ctx.globalAlpha = 1 - u;
    for (const [w, h] of [
      [s, 3],
      [3, s * 0.7],
    ]) {
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, Math.max(w, h));
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, hexA(f.color, 0.8));
      g.addColorStop(1, hexA(f.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(f.x - w, f.y - h, w * 2, h * 2);
    }
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 34);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, hexA(f.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 34, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}


function drawVignette(ctx) {
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.45, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawLetterbox(ctx, state) {
  const target = state.time < state.song.countIn || state.phase === 'end' ? 1 : 0;
  state.letterbox = (state.letterbox ?? 1) + (target - (state.letterbox ?? 1)) * 0.1;
  const h = 40 * state.letterbox;
  if (h < 0.5) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, h);
  ctx.fillRect(0, HEIGHT - h, WIDTH, h);
}

function drawCutin(ctx, state, now) {
  const c = state.cutin;
  if (!c) return;
  const u = 1 - c.life / c.maxLife;
  const dir = c.from === 'p1' ? 1 : -1;
  const rgb = LOOK[c.from].glow;
  let slide = 0;
  if (u < 0.15) slide = 1 - u / 0.15;
  else if (u > 0.8) slide = -(u - 0.8) / 0.2;
  const cy = 168;
  const h = 110;

  ctx.save();
  ctx.translate(-dir * slide * WIDTH, 0);
  ctx.beginPath();
  ctx.moveTo(0, cy - h / 2 + 18);
  ctx.lineTo(WIDTH, cy - h / 2 - 18);
  ctx.lineTo(WIDTH, cy + h / 2 - 18);
  ctx.lineTo(0, cy + h / 2 + 18);
  ctx.closePath();
  ctx.fillStyle = '#070302';
  ctx.globalAlpha = 0.95;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = `rgb(${rgb})`;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const y = cy - h / 2 - 18 + ((i * 41) % (h + 36));
    const x = ((((now * 3200 * dir + i * 211) % (WIDTH + 300)) + WIDTH + 300) % (WIDTH + 300)) - 150;
    ctx.fillStyle = `rgba(${rgb},0.35)`;
    ctx.fillRect(x, y, 200, 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // 투구를 크게 클로즈업
  const hx = dir > 0 ? 300 : WIDTH - 300;
  ctx.translate(hx, cy + 164 * 2.2 + 6);
  ctx.scale(dir * 2.2, 2.2);
  drawHero(ctx, c.from, { now, divineReady: true });
  ctx.restore();

  // 눈에서 뻗는 빛
  ctx.globalCompositeOperation = 'lighter';
  const ex = (dir > 0 ? 300 : WIDTH - 300) + dir * 19 * 2.2;
  const ey = cy - 2.5 * 2.2 + 6;
  const streak = ctx.createLinearGradient(ex, 0, ex + dir * 600, 0);
  streak.addColorStop(0, 'rgba(255,255,255,0.95)');
  streak.addColorStop(0.2, `rgba(${rgb},0.8)`);
  streak.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = streak;
  ctx.fillRect(Math.min(ex, ex + dir * 600), ey - 3, 600, 6);
  ctx.restore();
}


// ======================================================================
// HUD
// ======================================================================

// 퍼펙트: 판정선에서 내 영웅 가슴으로 빛이 날아감
function drawFeeds(ctx, state) {
  for (const f of state.feeds) {
    const u = 1 - f.life / f.maxLife;
    // 레인(화면)에서 무대(3D) 위 영웅 가슴으로
    const [a, , , d, e, ff] = planeMatrix(STAGE_Z, state.cam ?? CAM0);
    const tx = a * fightX(state, f.id) + e;
    const ty = d * (GROUND_Y - 120) + ff;
    const cx = (f.x + tx) / 2;
    const cy = Math.min(f.y, ty) - 90;
    const at = (k) => [
      (1 - k) * (1 - k) * f.x + 2 * (1 - k) * k * cx + k * k * tx,
      (1 - k) * (1 - k) * f.y + 2 * (1 - k) * k * cy + k * k * ty,
    ];
    const head = Math.min(1, u * 1.4);
    const tail = Math.max(0, head - 0.35);
    ctx.lineCap = 'round';
    for (const [w, color] of [
      [10, hexA(f.color, 0.5)],
      [3, 'rgba(255,255,255,0.95)'],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let k = tail; k <= head + 1e-6; k += 0.05) {
        const [x, y] = at(Math.min(head, k));
        if (k === tail) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const [hx, hy] = at(head);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, hexA(f.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, 18, 0, TAU);
    ctx.fill();
  }
}

// 앞서는 쪽 색으로 화면 가장자리가 물듦
function drawLeaderGlow(ctx, state, pulse) {
  const lead = state.lead;
  if (Math.abs(lead) < 0.05 || state.phase === 'end') return;
  const id = lead > 0 ? 'p1' : 'p2';
  const a = Math.min(0.5, Math.abs(lead) * 0.6) * (0.75 + pulse * 0.25);
  const color = PLAYER_INFO[id].color;
  const edge = id === 'p1' ? 0 : WIDTH;
  const g = ctx.createLinearGradient(edge, 0, id === 'p1' ? 180 : WIDTH - 180, 0);
  g.addColorStop(0, hexA(color, a));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(id === 'p1' ? 0 : WIDTH - 180, 0, 180, HEIGHT);
  const v = ctx.createLinearGradient(0, HEIGHT, 0, HEIGHT - 90);
  v.addColorStop(0, hexA(color, a * 0.7));
  v.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = v;
  ctx.fillRect(0, HEIGHT - 90, WIDTH, 90);
}

// 사선 명판
function plate(ctx, x, y, w, h, slant, left) {
  ctx.beginPath();
  if (left) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - slant, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x + slant, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
}

function drawHud(ctx, state, now, pulse) {
  for (const id of PLAYER_IDS) {
    const p = state.players[id];
    const info = PLAYER_INFO[id];
    const left = id === 'p1';
    const w = 300;
    const h = 52;
    const x = left ? 0 : WIDTH - w;
    const y = 8;

    // 명판 바탕
    const g = ctx.createLinearGradient(left ? x : x + w, 0, left ? x + w : x, 0);
    g.addColorStop(0, hexA(info.color, 0.95));
    g.addColorStop(0.55, hexA(info.color, 0.35));
    g.addColorStop(1, 'rgba(10,4,0,0.0)');
    plate(ctx, x, y, w, h, 22, left);
    ctx.fillStyle = 'rgba(10,4,0,0.75)';
    ctx.fill();
    ctx.fillStyle = g;
    ctx.fill();
    // 아래 금색 선
    ctx.fillStyle = GOLD;
    ctx.fillRect(left ? x : x + 22, y + h, w - 22, 2);

    // 이름 + 점수
    const tx = left ? x + 16 : x + w - 16;
    ctx.textAlign = left ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `15px ${FONT_KR}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(state.names?.[id] || info.label, tx, y + 14);
    ctx.font = `700 26px ${FONT_EPIC}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const scoreText = String(Math.round(p.displayScore)).padStart(6, '0');
    ctx.strokeText(scoreText, tx, y + 36);
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(scoreText, tx, y + 36);

    // 배율 배지
    const mult = multiplier(p);
    if (mult > 1) {
      const bx = left ? x + w - 54 : x + 54;
      ctx.save();
      ctx.translate(bx, y + h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 12 + pulse * 12;
      ctx.fillStyle = mult >= 2 ? '#fff27a' : GOLD;
      ctx.fillRect(-15, -15, 30, 30);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.font = `700 15px ${FONT_EPIC}`;
      ctx.fillStyle = '#2a1004';
      ctx.fillText(`x${mult}`, bx, y + h / 2 + 1);
    }
  }

  // 가운데: 우세 막대 + 진행 막대
  const bx = 330;
  const bw = WIDTH - bx * 2;
  const by = 22;
  const split = bx + bw * ((1 + state.lead) / 2);
  ctx.fillStyle = 'rgba(10,4,0,0.8)';
  ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
  ctx.fillStyle = PLAYER_INFO.p1.color;
  ctx.fillRect(bx, by, split - bx, 10);
  ctx.fillStyle = PLAYER_INFO.p2.color;
  ctx.fillRect(split, by, bx + bw - split, 10);
  ctx.save();
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#fff';
  ctx.fillRect(split - 2, by - 4, 4, 18);
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx - 2, by - 2, bw + 4, 14);

  const { countIn, end } = state.song;
  const progress = Math.max(0, Math.min(1, (state.time - countIn) / (end - countIn)));
  ctx.fillStyle = 'rgba(10,4,0,0.7)';
  ctx.fillRect(bx, by + 18, bw, 3);
  ctx.fillStyle = state.final ? '#ff5a4a' : GOLD;
  ctx.fillRect(bx, by + 18, bw * progress, 3);
}

// ======================================================================
// 가운데 큰 글씨
// ======================================================================

function drawCenter(ctx, state) {
  const cx = WIDTH / 2;
  const cy = 200;
  const { beat } = state.song;

  // 카운트인 마지막 4박: 3 2 1 GO
  const k = state.time / beat;
  if (k >= 4 && k < 8.6) {
    const i = Math.floor(k) - 4;
    const frac = k - Math.floor(k);
    const text = ['3', '2', '1', 'GO!'][Math.min(3, i)];
    const s = 1 + Math.max(0, 0.4 - frac) * 1.2;
    ctx.save();
    ctx.globalAlpha = i >= 4 ? Math.max(0, 1 - (k - 8) / 0.6) : 1;
    bigText(ctx, text, cx, cy, 110 * s, '#fff0b0', '#5a1a04');
    ctx.restore();
  }

  if (state.phase === 'end') {
    const t = END_DELAY - state.endTimer;
    if (t < 0.7) {
      const s = t < 0.25 ? 2 - t / 0.25 : 1;
      ctx.save();
      ctx.globalAlpha = t > 0.5 ? (0.7 - t) / 0.2 : 1;
      bigText(ctx, 'FINISH', cx, cy, 100 * s, '#fff0b0', '#5a1a04');
      ctx.restore();
    }
  }
}

function outlined(ctx, text, x, y, size, fill, stroke, strokeWidth, font = FONT_EPIC) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function bigText(ctx, text, x, y, size, fill, stroke) {
  ctx.save();
  ctx.font = `700 ${size}px ${FONT_EPIC}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = size * 0.12;
  ctx.strokeText(text, x, y);
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, fill);
  g.addColorStop(1, '#c46a10');
  ctx.shadowColor = 'rgba(255,180,60,0.8)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
