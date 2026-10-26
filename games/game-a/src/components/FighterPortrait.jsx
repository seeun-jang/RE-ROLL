// =============================================================
//  파이터 그림 (타이틀, 결과 화면용)
//  경기 화면과 같은 그리기 함수(drawFighter)를 작은 캔버스에 사용합니다.
//
//  props
//    player : config.js의 PLAYERS 항목
//    pose   : 'idle' | 'win' | 'lose' | 'demo'(펀치/킥/가드를 번갈아 보여줌)
//    facing : 1(오른쪽을 봄) | -1(왼쪽을 봄)
// =============================================================

import { useEffect, useRef } from 'react';
import { drawFighter } from '../engine/drawFighter.js';
import { attackDuration } from '../engine/fighter.js';

const VIEW_HEIGHT = 405; // 캐릭터 전체가 들어가는 높이 (게임 좌표, 만세 자세 포함)

// 데모 동작 순서
const DEMO = [
  { state: 'idle', time: 0.9 },
  { state: 'attack', type: 'punch' },
  { state: 'idle', time: 0.25 },
  { state: 'attack', type: 'punch' },
  { state: 'idle', time: 0.7 },
  { state: 'attack', type: 'kick' },
  { state: 'idle', time: 0.6 },
  { state: 'guard', time: 1.0 },
  { state: 'idle', time: 0.6 },
  { state: 'attack', type: 'special' },
  { state: 'idle', time: 0.8 },
];

export default function FighterPortrait({ player, pose = 'idle', facing = 1, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const fighter = { x: 0, facing, state: pose === 'demo' ? 'idle' : pose, stateTime: 0, attack: null, flash: 0, walkPhase: 0, tired: 0 };
    let step = 0;
    let stepTime = 0;
    let clock = Math.random() * 3; // 두 캐릭터가 똑같이 움직이지 않게
    let last = performance.now();
    let rafId = 0;

    const advanceDemo = (dt) => {
      const cur = DEMO[step];
      stepTime += dt;
      const length = cur.state === 'attack' ? attackDuration(cur.type) : cur.time;
      if (stepTime >= length) {
        step = (step + 1) % DEMO.length;
        stepTime = 0;
        const next = DEMO[step];
        fighter.state = next.state;
        fighter.stateTime = 0;
        fighter.attack = next.state === 'attack' ? { type: next.type, t: 0, hasHit: false } : null;
      } else if (fighter.attack) {
        fighter.attack.t = stepTime;
      }
    };

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      clock += dt;
      fighter.stateTime += dt;
      if (pose === 'demo') advanceDemo(dt);

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const s = h / VIEW_HEIGHT;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      // 발차기가 잘리지 않도록 보는 방향 반대쪽으로 살짝 옮겨 그림
      fighter.x = w / s / 2 - facing * 30;
      drawFighter(ctx, fighter, player, clock, VIEW_HEIGHT - 16);

      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [player, pose, facing]);

  return <canvas ref={canvasRef} className={`bc-portrait ${className}`} aria-label={`${player.label} ${player.name}`} />;
}
