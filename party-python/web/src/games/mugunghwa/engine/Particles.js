// ============================================================
// Particles.js — 픽셀 사각형 파티클 (먼지, 반짝임, 꽃잎, 색종이)
// ============================================================

import { C, SWEETIE16 } from '../assets/palette.js';

export class Particles {
  constructor() {
    this.list = [];
  }

  clear() { this.list.length = 0; }

  // 달릴 때 발밑 먼지
  dust(x, y) {
    for (let i = 0; i < 2; i++) {
      this.list.push({
        x: x + (Math.random() * 8 - 4), y: y - Math.random() * 2,
        vx: Math.random() * 10 - 5, vy: -Math.random() * 8 - 2, g: 10,
        life: 0.3 + Math.random() * 0.2, t: 0, size: Math.random() < 0.4 ? 2 : 1,
        color: Math.random() < 0.5 ? C.silver : C.white, kind: 'dust',
      });
    }
  }

  // 도착 반짝임 (십자 모양)
  sparkle(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 15 + Math.random() * 30;
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, g: 20,
        life: 0.5 + Math.random() * 0.4, t: 0, size: 1,
        color: Math.random() < 0.5 ? C.yellow : C.white, kind: 'spark',
      });
    }
  }

  // 탈락 충격 (사방으로 튀는 조각)
  burst(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.list.push({
        x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 30, g: 0, drag: 4,
        life: 0.35, t: 0, size: 2, color: i % 2 ? color : C.white, kind: 'dust',
      });
    }
  }

  // 결과 화면 색종이
  confetti(x, y, count = 30) {
    for (let i = 0; i < count; i++) {
      this.list.push({
        x: x + Math.random() * 40 - 20, y, vx: Math.random() * 80 - 40, vy: -40 - Math.random() * 60, g: 70, drag: 1,
        life: 1.6 + Math.random(), t: 0, size: 2,
        color: SWEETIE16[2 + Math.floor(Math.random() * 10)], kind: 'confetti',
      });
    }
  }

  // 타이틀 화면에 흩날리는 꽃잎
  petal(x, y) {
    this.list.push({
      x, y, vx: -8 - Math.random() * 8, vy: 6 + Math.random() * 6, g: 0,
      life: 6, t: 0, size: 2, color: Math.random() < 0.6 ? C.red : C.white, kind: 'petal',
      phase: Math.random() * 6,
    });
  }

  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      if (p.drag) { p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'petal') p.x += Math.sin(p.t * 3 + p.phase) * 0.3;
    }
    this.list = this.list.filter(p => p.t < p.life);
  }

  render(ctx) {
    for (const p of this.list) {
      const k = p.t / p.life;
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        // 처음엔 십자, 나중엔 점
        if (k < 0.5) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        } else ctx.fillRect(x, y, 1, 1);
      } else if (p.kind === 'confetti') {
        const flip = Math.floor(p.t * 10) % 2;
        ctx.fillRect(x, y, flip ? 2 : 1, flip ? 1 : 2);
      } else {
        const s = k > 0.6 ? 1 : p.size; // 수명이 다해 가면 작아짐
        ctx.fillRect(x, y, s, s);
      }
    }
  }
}
