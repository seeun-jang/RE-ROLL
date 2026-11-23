// 시작/결과 화면용 영웅 그림 (mood: 'ready' | 'victory' | 'defeat')
import { useEffect, useRef } from 'react';
import { drawHero, drawDivineAura } from '../game/heroes.js';

const BASE = 240;

// size: 캔버스 해상도 (크게 보여줄수록 크게)
export default function HeroPortrait({ id, mood = 'ready', facing = 1, size = BASE, className = 'kmj-portrait' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const k = size / BASE;
    let raf = 0;

    const draw = (t) => {
      const now = t / 1000;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      ctx.clearRect(0, 0, BASE, BASE);
      if (mood !== 'defeat') drawDivineAura(ctx, id, BASE / 2, BASE * 0.5, now, mood === 'victory' ? 1.2 : 0.6);
      ctx.save();
      ctx.translate(BASE / 2 + facing * 8, BASE * 0.97);
      if (mood === 'defeat') {
        ctx.globalAlpha = 0.55;
        ctx.rotate(-facing * 0.12);
      }
      ctx.scale(facing * 1.08, 1.08);
      drawHero(ctx, id, {
        now,
        victory: mood === 'victory',
        divineReady: mood !== 'defeat',
        dizzy: mood === 'defeat',
        shield: mood === 'ready' && Math.sin(now * 1.5) > 0.6,
      });
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id, mood, facing, size]);

  return <canvas ref={ref} className={className} />;
}
