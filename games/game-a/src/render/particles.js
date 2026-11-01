// =============================================================
//  파티클 (타격 이펙트)
//    엔진이 보내는 사건(hit, block, cast, strike, roar, blink, ko ...)을 받아
//    불꽃, 충격파, 발톱 자국(student), 룬 문자(교수), 마법진, 폭발, 먼지를 만듭니다.
// =============================================================

import { PLAYERS, STAGE } from '../config.js';

const playerOf = (id) => PLAYERS.find((p) => p.id === id);

export function createParticles() {
  let list = [];
  let flash = 0; // 화면 전체 번쩍임
  let lines = 0; // 집중선 (강한 타격)
  let linesColor = '#FFFFFF';

  const add = (p) => {
    list.push({ age: 0, ...p });
    if (list.length > 500) list.splice(0, list.length - 500);
  };

  function burst(x, y, color, count, speed, life = 0.45, dir = 0) {
    for (let i = 0; i < count; i++) {
      const a = dir ? Math.atan2(0, dir) + (Math.random() - 0.5) * 1.8 : Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      add({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, color, life: life * (0.6 + Math.random() * 0.6), w: 2 + Math.random() * 2 });
    }
  }

  function dust(x, count, power = 1) {
    for (let i = 0; i < count; i++) {
      add({
        type: 'dust', x: x + (Math.random() - 0.5) * 80, y: STAGE.floorY - 2,
        vx: (Math.random() - 0.5) * 300 * power, vy: -30 - Math.random() * 90 * power,
        r: 10 + Math.random() * 14 * power, life: 0.7 + Math.random() * 0.4,
      });
    }
  }

  return {
    /** 엔진 사건 → 이펙트 */
    handle(ev, fighters) {
      const f = ev.fighter ? fighters[ev.fighter] : null;
      switch (ev.type) {
        case 'hit': {
          const att = playerOf(ev.attacker);
          const heavy = ev.big;
          const dir = Math.sign(ev.x - fighters[ev.attacker].x) || 1;
          add({ type: 'flash', x: ev.x, y: ev.y, r: heavy ? 80 : 50, color: att.glow, life: 0.14 });
          add({ type: 'ring', x: ev.x, y: ev.y, r: heavy ? 90 : 50, color: '#FFFFFF', life: 0.3 });
          burst(ev.x, ev.y, '#FFF4D0', heavy ? 18 : 9, heavy ? 620 : 420, 0.4, dir);
          burst(ev.x, ev.y, att.glow, heavy ? 12 : 5, heavy ? 520 : 360, 0.5, dir);
          if (att.kind === 'tiger' && ev.source !== 'area') {
            add({ type: 'claw', x: ev.x, y: ev.y, dir, size: heavy ? 70 : 46, color: att.glow, life: 0.32 });
          } else if (att.kind === 'professor') {
            for (let i = 0; i < (heavy ? 5 : 2); i++) {
              add({
                type: 'glyph', x: ev.x, y: ev.y, vx: dir * (80 + Math.random() * 200), vy: -80 - Math.random() * 160,
                rot: Math.random() * 6, spin: (Math.random() - 0.5) * 8, size: 10 + Math.random() * 10, color: att.glow, life: 0.8,
              });
            }
          }
          for (let i = 0; i < (heavy ? 7 : 3); i++) add({ type: 'drop', x: ev.x, y: ev.y, vx: dir * (120 + Math.random() * 260), vy: -120 - Math.random() * 200, life: 0.7 });
          if (heavy) {
            flash = Math.max(flash, 0.18);
            lines = Math.max(lines, 0.2);
            linesColor = att.glow;
          }
          break;
        }
        case 'block':
          add({ type: 'shield', x: ev.x, y: ev.y, life: 0.25, color: playerOf(ev.defender).kind === 'professor' ? '#B98CFF' : '#9FE8FF' });
          burst(ev.x, ev.y, '#BFF0FF', 6, 300, 0.3, Math.sign(ev.x - fighters[ev.attacker].x) || 1);
          break;
        case 'guardbreak':
          add({ type: 'shatter', x: ev.x, y: ev.y, life: 0.5 });
          burst(ev.x, ev.y, '#BFF0FF', 20, 520, 0.5);
          flash = 0.2;
          break;
        case 'cast':
          if (ev.y) {
            add({ type: 'flash', x: ev.x, y: ev.y, r: ev.kind === 'fireball' ? 70 : 40, color: ev.kind === 'fireball' ? '#FF9A3D' : '#A66BFF', life: 0.18 });
            add({ type: 'sigil', x: ev.x, y: ev.y, r: ev.kind === 'fireball' ? 46 : 28, color: ev.kind === 'fireball' ? '#FFB060' : '#C9A8FF', life: 0.35 });
          }
          if (ev.kind === 'meteor') flash = Math.max(flash, 0.15);
          break;
        case 'explode':
          if (ev.kind === 'fireball') {
            burst(ev.x, ev.y, '#FFB347', 26, 560, 0.6);
            burst(ev.x, ev.y, '#FF5A2A', 16, 380, 0.7);
            add({ type: 'flash', x: ev.x, y: ev.y, r: 120, color: '#FF8A3D', life: 0.22 });
          } else if (ev.kind === 'erase') {
            add({ type: 'puff', x: ev.x, y: ev.y, r: 30, life: 0.5 });
          } else {
            burst(ev.x, ev.y, '#D9C2FF', 10, 380, 0.4);
          }
          break;
        case 'strike':
          if (ev.kind === 'lightning') {
            burst(ev.x, STAGE.floorY - 10, '#E6D9FF', 22, 520, 0.5);
            add({ type: 'floorRing', x: ev.x, y: STAGE.floorY, r: 200, life: 0.5 });
            flash = Math.max(flash, 0.35);
          } else {
            const big = ev.kind === 'meteor';
            burst(ev.x, STAGE.floorY - 30, '#FFB347', big ? 40 : 14, big ? 820 : 480, 0.8);
            burst(ev.x, STAGE.floorY - 30, '#FF4A1A', big ? 24 : 8, big ? 600 : 360, 0.9);
            dust(ev.x, big ? 26 : 10, big ? 1.8 : 1);
            add({ type: 'floorRing', x: ev.x, y: STAGE.floorY, r: big ? 420 : 200, life: 0.7 });
            add({ type: 'flash', x: ev.x, y: STAGE.floorY - 60, r: big ? 260 : 120, color: '#FF8A3D', life: 0.3 });
            if (big) {
              flash = 0.5;
              lines = 0.35;
              linesColor = '#FFB347';
            }
          }
          break;
        case 'roar':
          for (let i = 0; i < 3; i++) add({ type: 'wave', x: f.x, y: STAGE.floorY - 150, r: 300, delay: i * 0.08, age: -i * 0.08, life: 0.55, color: '#FFB347' });
          add({ type: 'word', x: f.x + f.facing * 40, y: STAGE.floorY - 300, text: '어흥!!', life: 0.8, color: '#FFE2A8' });
          break;
        case 'stun':
          add({ type: 'word', x: ev.x, y: ev.y - 60, text: '움찔!', life: 0.7, color: '#FFFFFF' });
          break;
        case 'blink':
          for (const x of [ev.from, ev.to]) {
            burst(x, STAGE.floorY - 140, '#C9A8FF', 14, 300, 0.5);
            add({ type: 'ring', x, y: STAGE.floorY - 140, r: 90, color: '#C9A8FF', life: 0.35 });
          }
          break;
        case 'deflect':
          burst(ev.x, ev.y, '#FFE9A8', 12, 420, 0.4);
          add({ type: 'ring', x: ev.x, y: ev.y, r: 50, color: '#FFE9A8', life: 0.25 });
          break;
        case 'area':
          if (ev.move === 'blast') {
            add({ type: 'wave', x: ev.x, y: STAGE.floorY - 140, r: ev.radius * 1.4, age: 0, life: 0.4, color: '#B98CFF' });
            add({ type: 'flash', x: ev.x, y: STAGE.floorY - 140, r: 140, color: '#A66BFF', life: 0.2 });
            burst(ev.x, STAGE.floorY - 140, '#D9C2FF', 20, 600, 0.45);
          } else {
            dust(ev.x, 14, 1.3);
            add({ type: 'floorRing', x: ev.x, y: STAGE.floorY, r: 260, life: 0.5 });
          }
          break;
        case 'superConnect':
          flash = 0.45;
          lines = 0.9;
          linesColor = '#FFFFFF';
          break;
        case 'land':
          dust(ev.x, 8, 0.9);
          break;
        case 'ko':
          dust(ev.x, 26, 1.6);
          add({ type: 'floorRing', x: ev.x, y: STAGE.floorY, r: 300, life: 0.6 });
          flash = 0.6;
          lines = 0.6;
          linesColor = '#FFFFFF';
          break;
        default:
          break;
      }
    },

    update(dt) {
      flash = Math.max(0, flash - dt * 2.2);
      lines = Math.max(0, lines - dt);
      for (const p of list) {
        p.age += dt;
        if (p.vx !== undefined) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const grav = p.type === 'dust' ? 160 : p.type === 'glyph' ? 120 : 900;
          p.vy += grav * dt;
          p.vx *= Math.exp(-(p.type === 'dust' ? 4 : 1.5) * dt);
          if (p.type === 'drop' && p.y > STAGE.floorY) p.age = p.life;
          if (p.type === 'dust' && p.y > STAGE.floorY) p.y = STAGE.floorY;
        }
        if (p.spin) p.rot += p.spin * dt;
      }
      list = list.filter((p) => p.age < p.life);
    },

    /** 월드 좌표로 그리기 (ctx, glow는 카메라 변환이 적용된 상태) */
    draw(ctx, glow) {
      for (const p of list) {
        const t = p.age / p.life;
        const fade = 1 - t;
        switch (p.type) {
          case 'spark': {
            const len = Math.hypot(p.vx, p.vy) * 0.035;
            const a = Math.atan2(p.vy, p.vx);
            ctx.strokeStyle = p.color;
            ctx.globalAlpha = fade;
            ctx.lineWidth = p.w;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
            ctx.stroke();
            if (glow) {
              glow.strokeStyle = p.color;
              glow.globalAlpha = fade;
              glow.lineWidth = p.w * 3;
              glow.beginPath();
              glow.moveTo(p.x, p.y);
              glow.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
              glow.stroke();
            }
            break;
          }
          case 'flash':
            if (glow) {
              const g = glow.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
              g.addColorStop(0, `rgba(255,255,255,${fade * 0.7})`);
              g.addColorStop(0.4, p.color);
              g.addColorStop(1, 'rgba(0,0,0,0)');
              glow.globalAlpha = fade;
              glow.fillStyle = g;
              glow.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
            }
            ctx.globalAlpha = fade * 0.9;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 0.18 * (1 + t), 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'ring':
            ctx.globalAlpha = fade;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 4 * fade + 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r * (0.3 + t), p.r * (0.3 + t) * 0.85, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
          case 'claw':
            ctx.globalAlpha = fade;
            ctx.strokeStyle = '#FFF2D6';
            ctx.lineCap = 'round';
            for (let k = -1; k <= 1; k++) {
              const off = k * p.size * 0.22;
              const grow = Math.min(1, t * 4);
              ctx.lineWidth = (5 - Math.abs(k)) * fade + 1;
              ctx.beginPath();
              ctx.moveTo(p.x - p.dir * p.size * 0.5 + off, p.y - p.size * 0.55);
              ctx.quadraticCurveTo(
                p.x + off * 0.5, p.y,
                p.x + p.dir * p.size * 0.5 * grow + off, p.y + p.size * 0.55 * grow,
              );
              ctx.stroke();
              if (glow) {
                glow.globalAlpha = fade;
                glow.strokeStyle = p.color;
                glow.lineWidth = 10;
                glow.beginPath();
                glow.moveTo(p.x - p.dir * p.size * 0.5 + off, p.y - p.size * 0.55);
                glow.quadraticCurveTo(p.x + off * 0.5, p.y, p.x + p.dir * p.size * 0.5 * grow + off, p.y + p.size * 0.55 * grow);
                glow.stroke();
              }
            }
            break;
          case 'glyph': {
            const draw = (c, w) => {
              c.save();
              c.translate(p.x, p.y);
              c.rotate(p.rot);
              c.globalAlpha = fade;
              c.strokeStyle = c === ctx ? '#EBDDFF' : p.color;
              c.lineWidth = w;
              c.beginPath();
              c.arc(0, 0, p.size, 0, Math.PI * 2);
              c.moveTo(0, -p.size * 1.4);
              c.lineTo(0, p.size * 1.4);
              c.moveTo(-p.size, 0);
              c.lineTo(p.size * 0.6, p.size * 0.8);
              c.stroke();
              c.restore();
            };
            draw(ctx, 1.6);
            if (glow) draw(glow, 6);
            break;
          }
          case 'drop':
            ctx.globalAlpha = fade;
            ctx.fillStyle = 'rgba(210, 240, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'dust':
            ctx.globalAlpha = fade * 0.5;
            ctx.fillStyle = '#B9AEDC';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * (0.6 + t), 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'floorRing':
            ctx.globalAlpha = fade * 0.8;
            ctx.strokeStyle = '#FFE9A8';
            ctx.lineWidth = 5 * fade + 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r * (0.2 + t), p.r * (0.2 + t) * 0.18, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
          case 'shield': {
            ctx.globalAlpha = fade;
            ctx.strokeStyle = p.color;
            ctx.fillStyle = 'rgba(140, 220, 255, 0.25)';
            ctx.lineWidth = 3;
            const r = 34 + t * 18;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
              ctx.lineTo(p.x + Math.cos(a) * r * 0.7, p.y + Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            if (glow) {
              glow.globalAlpha = fade;
              glow.fillStyle = 'rgba(140, 220, 255, 0.6)';
              glow.beginPath();
              glow.arc(p.x, p.y, r, 0, Math.PI * 2);
              glow.fill();
            }
            break;
          }
          case 'shatter':
            ctx.globalAlpha = fade;
            ctx.strokeStyle = '#DFF6FF';
            ctx.lineWidth = 2.5;
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              const d = 20 + t * 90;
              ctx.beginPath();
              ctx.moveTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
              ctx.lineTo(p.x + Math.cos(a + 0.3) * (d + 16), p.y + Math.sin(a + 0.3) * (d + 16));
              ctx.stroke();
            }
            break;
          case 'sigil': {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(t * 3);
            ctx.globalAlpha = fade;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            const r = p.r * (0.6 + t * 0.6);
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2;
              ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
              ctx.lineTo(Math.cos(a + 2.1) * r, Math.sin(a + 2.1) * r);
            }
            ctx.stroke();
            ctx.restore();
            if (glow) {
              glow.globalAlpha = fade;
              glow.fillStyle = p.color;
              glow.beginPath();
              glow.arc(p.x, p.y, p.r, 0, Math.PI * 2);
              glow.fill();
            }
            break;
          }
          case 'puff':
            ctx.globalAlpha = fade * 0.6;
            ctx.fillStyle = '#CFC6E8';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * (0.6 + t), 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'wave':
            if (t < 0) break;
            ctx.globalAlpha = fade * 0.9;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 8 * fade + 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r * t, p.r * t * 0.9, 0, 0, Math.PI * 2);
            ctx.stroke();
            if (glow) {
              glow.globalAlpha = fade * 0.6;
              glow.strokeStyle = p.color;
              glow.lineWidth = 18;
              glow.beginPath();
              glow.ellipse(p.x, p.y, p.r * t, p.r * t * 0.9, 0, 0, Math.PI * 2);
              glow.stroke();
            }
            break;
          case 'word': {
            const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - Math.min(0.2, (t - 0.15) * 0.4);
            ctx.save();
            ctx.translate(p.x, p.y - t * 30);
            ctx.scale(pop, pop);
            ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
            ctx.font = '400 46px "Do Hyeon", sans-serif';
            ctx.textAlign = 'center';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 8;
            ctx.strokeStyle = '#1A0E08';
            ctx.strokeText(p.text, 0, 0);
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, 0, 0);
            ctx.restore();
            break;
          }
          case 'after':
            ctx.globalAlpha = fade * 0.8;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 20 + t * 40, -0.8, 0.8);
            ctx.stroke();
            break;
          default:
            break;
        }
      }
      ctx.globalAlpha = 1;
      if (glow) glow.globalAlpha = 1;
    },

    /** 화면 전체 효과 값 (renderer가 그림) */
    screen: () => ({ flash, lines, linesColor }),
  };
}
