// =============================================================
//  경기 화면 그리기 (한 프레임)
//
//  1. 카메라: 두 선수를 따라가며 거리에 맞춰 줌, KO/다운 때 쓰러진 선수에게 집중
//  2. 무대 뒤쪽 (벽, 빛줄기, 촛불, 관중, 바닥)
//  3. 바닥 반사 → 심판 → 그림자 → 선수 → 공격 궤적 → 파티클 → 앞 기둥
//  4. 빛 번짐(블룸) 합성 → 비네트, 번쩍임, 집중선, 시네마 바
// =============================================================

import { MATCH, STAGE } from '../config.js';
import { PHASE } from '../engine/match.js';
import { actionPhase } from '../engine/fighter.js';
import { createStage, FLOOR_SCREEN } from './stage.js';
import { drawFigure } from './character.js';
import { createParticles } from './particles.js';
import { drawReferee } from './referee.js';
import { blendPose, resolvePose } from './rig.js';
import { alphaFor, expressionFor, poseFor, poseSpeed, spinFor } from './poses.js';
import { drawSpells } from './spells.js';

const W = STAGE.width;
const H = STAGE.height;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TRAIL_MOVES = new Set(['cross', 'claw', 'knee', 'palm']);
const GHOST_MOVES = new Set(['dash', 'roll', 'whiteTiger', 'backstep', 'pounce']);

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W / 2;
  glowCanvas.height = H / 2;
  const glow = glowCanvas.getContext('2d');
  // 블룸: 빛 레이어를 1/4 크기로 줄여 흐리게 만든 뒤 크게 늘려 더함 (가벼움)
  const bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = W / 4;
  bloomCanvas.height = H / 4;
  const bloom = bloomCanvas.getContext('2d');
  // 느린 컴퓨터면 반사, 블룸 흐림을 자동으로 끔
  let quality = 2;
  let slowFrames = 0;
  const stage = createStage();
  const particles = createParticles();
  const poses = {};
  const trails = {};
  const ghosts = {}; // 잔상 (대시, 구르기, 궁극기)
  const cam = { x: (STAGE.startX.p1 + STAGE.startX.p2) / 2, zoom: 0.9 };
  let time = 0;
  let letterbox = 0;

  function updateCamera(match, dt) {
    const [a, b] = match.playerIds.map((id) => match.fighters[id]);
    let tx = (a.x + b.x) / 2;
    const d = Math.abs(a.x - b.x);
    let tz = lerp(STAGE.zoomNear, STAGE.zoomFar, clamp((d - 260) / 600, 0, 1));
    if (match.focus) {
      const f = match.fighters[match.focus];
      tx = lerp(tx, f.x, 0.6);
      tz = 1.3;
    }
    if (match.phase === PHASE.INTRO) {
      const t = clamp(match.phaseTime / MATCH.introSeconds, 0, 1);
      tz = lerp(0.82, tz, t * t);
    }
    // 마법이 멀리 날아가면 조금 더 넓게
    if (match.strikes.length) tz = Math.min(tz, 0.95);
    // 카메라가 무대 밖을 보지 않게
    const half = W / 2 / tz;
    tx = clamp(tx, STAGE.left - 120 + half * 0.4, STAGE.right + 120 - half * 0.4);
    const k = 1 - Math.exp(-dt * 3.2);
    cam.x += (tx - cam.x) * k;
    cam.zoom += (tz - cam.zoom) * k;
  }

  function worldTransform(c, shake, scale = 1) {
    c.setTransform(
      cam.zoom * scale, 0, 0, cam.zoom * scale,
      (W / 2 - cam.x * cam.zoom + shake[0]) * scale,
      (FLOOR_SCREEN - STAGE.floorY * cam.zoom + shake[1]) * scale,
    );
  }

  function figureArgs(f, match, dt, withPose = true) {
    const P = f.player;
    if (withPose) {
      const target = resolvePose(poseFor(f, time), P.height);
      const k = 1 - Math.exp(-poseSpeed(f) * dt * match.timeScale);
      poses[f.id] = blendPose(poses[f.id], target, k || 0.0001);
    }
    return {
      x: f.x,
      y: STAGE.floorY - f.y * (f.player.height * 1.12),
      facing: f.facing,
      spin: spinFor(f),
      alpha: alphaFor(f),
      pose: poses[f.id],
      player: P,
      expression: expressionFor(f),
      time,
      flash: f.flash,
      fighter: f,
    };
  }

  function drawTrail(f, joints) {
    const tr = (trails[f.id] ??= []);
    const phase = f.state === 'action' ? actionPhase(f) : null;
    if (f.action && phase && phase !== 'recovery' && TRAIL_MOVES.has(f.action.type)) {
      const kick = f.action.type === 'knee';
      const p = kick ? joints.footF : f.action.type === 'cross' ? joints.fistB : joints.fistF;
      tr.push([p[0], p[1]]);
      if (tr.length > 7) tr.shift();
    } else if (tr.length) {
      tr.shift();
    }
    if (tr.length < 3) return;
    const color = f.player.glow;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const t = i / tr.length;
      ctx.strokeStyle = `rgba(255, 255, 255, ${t * 0.55})`;
      ctx.lineWidth = 16 * t;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1][0], tr[i - 1][1]);
      ctx.lineTo(tr[i][0], tr[i][1]);
      ctx.stroke();
      glow.strokeStyle = color;
      glow.globalAlpha = t * 0.8;
      glow.lineWidth = 22 * t;
      glow.beginPath();
      glow.moveTo(tr[i - 1][0], tr[i - 1][1]);
      glow.lineTo(tr[i][0], tr[i][1]);
      glow.stroke();
    }
    glow.globalAlpha = 1;
    ctx.restore();
  }

  function drawStatus(f, joints) {
    const [hx, hy] = joints.head;
    if (f.state === 'down' || f.state === 'ko' || f.state === 'stunned') {
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i / 3) * Math.PI * 2;
        const x = hx + Math.cos(a) * 30;
        const y = hy - 34 * f.player.height + Math.sin(a) * 8;
        ctx.fillStyle = '#FFE27A';
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const aa = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const r = k % 2 ? 3.5 : 8;
          ctx.lineTo(x + Math.cos(aa) * r, y + Math.sin(aa) * r);
        }
        ctx.fill();
        glow.fillStyle = 'rgba(255, 220, 120, 0.7)';
        glow.beginPath();
        glow.arc(x, y, 10, 0, Math.PI * 2);
        glow.fill();
      }
    }
    if (f.tired > 0) {
      for (let i = 0; i < 2; i++) {
        const t = (time * 1.6 + i * 0.5) % 1;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#A8E6FF';
        ctx.beginPath();
        ctx.arc(hx + (i ? 24 : -20) * f.facing, hy - 10 + t * 30, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 궁극기 게이지가 가득 차면 몸 주변이 은은하게 빛남
    if (f.super >= 100 && f.state !== 'ko') {
      glow.fillStyle = f.player.kind === 'professor' ? 'rgba(170, 120, 255, 0.35)' : 'rgba(255, 170, 70, 0.35)';
      glow.beginPath();
      glow.ellipse(hx, hy + 60 * f.player.height, 70 * f.player.height, 120 * f.player.height, 0, 0, Math.PI * 2);
      glow.fill();
    }
  }

  function screenEffects(match) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 비네트
    const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(4, 2, 14, 0.72)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    const fx = particles.screen();
    if (fx.lines > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, fx.lines * 3) * 0.55;
      ctx.strokeStyle = '#FFFFFF';
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 + Math.random() * 0.05;
        const r1 = 300 + Math.random() * 140;
        ctx.lineWidth = 1 + Math.random() * 3;
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1 * 0.7);
        ctx.lineTo(W / 2 + Math.cos(a) * 900, H / 2 + Math.sin(a) * 900 * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255, 250, 240, ${fx.flash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    // 시네마 바 (라운드 시작, 다운, KO)
    const superOn = match.playerIds.some((id) => match.fighters[id].action?.data?.connected || match.fighters[id].action?.type === 'meteor');
    const want = match.phase === PHASE.INTRO || match.phase === PHASE.MATCH_END || match.focus || superOn ? 1 : 0;
    letterbox += (want - letterbox) * 0.08;
    if (letterbox > 0.01) {
      const h = 46 * letterbox;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, h);
      ctx.fillRect(0, H - h, W, h);
    }
  }

  return {
    /**
     * @param match
     * @param events  이번 프레임 엔진 사건 (이펙트 생성용)
     * @param dt      실제 흐른 시간
     */
    render(match, events, dt) {
      // 프레임이 계속 느리면 품질 낮추기
      if (dt > 1 / 40) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 0.5);
      if (slowFrames > 90 && quality > 0) {
        quality -= 1;
        slowFrames = 0;
      }
      time += dt * (match.timeScale < 1 ? match.timeScale + 0.15 : 1);
      for (const ev of events) particles.handle(ev, match.fighters);
      particles.update(dt * (match.hitstop > 0 ? 0.25 : match.timeScale));
      updateCamera(match, dt);
      const shake = match.shake > 0 ? [(Math.random() - 0.5) * match.shake, (Math.random() - 0.5) * match.shake] : [0, 0];

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#07050F';
      ctx.fillRect(0, 0, W, H);
      glow.setTransform(1, 0, 0, 1, 0, 0);
      glow.clearRect(0, 0, W / 2, H / 2);

      stage.drawBack(ctx, glow, cam, time, match.hype);

      // ---- 월드 ----
      worldTransform(ctx, shake);
      worldTransform(glow, shake, 0.5);
      const fighters = match.playerIds.map((id) => match.fighters[id]);
      const order = (f) => (f.state === 'down' || f.state === 'ko' ? 0 : f.state === 'action' ? 2 : 1);
      fighters.sort((a, b) => order(a) - order(b));
      const args = fighters.map((f) => [f, figureArgs(f, match, dt)]);

      // 바닥 반사
      if (quality >= 2) {
        ctx.save();
        ctx.translate(0, STAGE.floorY * 2);
        ctx.scale(1, -1);
        ctx.globalAlpha = 0.2;
        for (const [, a] of args) drawFigure(ctx, null, { ...a, flash: 0 });
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      const fade = ctx.createLinearGradient(0, STAGE.floorY, 0, STAGE.floorY + 260);
      fade.addColorStop(0, 'rgba(30, 24, 56, 0)');
      fade.addColorStop(1, 'rgba(30, 24, 56, 0.85)');
      ctx.fillStyle = fade;
      ctx.fillRect(cam.x - W, STAGE.floorY + 2, W * 2, 300);

      drawReferee(ctx, glow, match.ref, time);
      drawSpells(ctx, glow, match, time);

      // 그림자
      for (const f of fighters) {
        const lying = f.state === 'down' || f.state === 'ko';
        const w = (lying ? 120 : 64) * f.player.height * Math.max(0.4, 1 - f.y / 250);
        const sg = ctx.createRadialGradient(f.x, STAGE.floorY + 2, 4, f.x, STAGE.floorY + 2, w);
        sg.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
        sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.save();
        ctx.translate(0, STAGE.floorY + 2);
        ctx.scale(1, 0.18);
        ctx.translate(0, -(STAGE.floorY + 2));
        ctx.fillStyle = sg;
        ctx.fillRect(f.x - w, STAGE.floorY + 2 - w, w * 2, w * 2);
        ctx.restore();
      }

      // 잔상
      for (const [f, a] of args) {
        const list = (ghosts[f.id] ??= []);
        if (f.action && GHOST_MOVES.has(f.action.type) && actionPhase(f) === 'active') {
          list.push({ ...a, pose: JSON.parse(JSON.stringify(a.pose)), life: 1 });
          if (list.length > 4) list.shift();
        }
        for (const g of list) {
          g.life -= dt * 5;
          if (g.life <= 0) continue;
          ctx.save();
          ctx.globalAlpha = g.life * 0.3;
          ctx.filter = f.player.kind === 'professor' ? 'brightness(1.4) hue-rotate(40deg)' : 'brightness(1.6) saturate(1.5)';
          drawFigure(ctx, null, { ...g, flash: 0 });
          ctx.restore();
        }
        ghosts[f.id] = list.filter((g) => g.life > 0);
      }

      for (const [f, a] of args) {
        const blink = f.invuln > 0 && f.state !== 'action' && Math.floor(time * 18) % 2 === 0;
        if (blink) ctx.globalAlpha = 0.5;
        const joints = drawFigure(ctx, glow, a);
        ctx.globalAlpha = 1;
        drawTrail(f, joints);
        drawStatus(f, joints);
      }
      particles.draw(ctx, glow);

      stage.drawFront(ctx, cam);

      // ---- 빛 번짐 합성 ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      bloom.setTransform(1, 0, 0, 1, 0, 0);
      bloom.clearRect(0, 0, W / 4, H / 4);
      if (quality >= 1) bloom.filter = 'blur(3px)';
      bloom.drawImage(glowCanvas, 0, 0, W / 4, H / 4);
      bloom.filter = 'none';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(bloomCanvas, 0, 0, W, H);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(glowCanvas, 0, 0, W, H);
      ctx.restore();

      screenEffects(match);
    },
  };
}

