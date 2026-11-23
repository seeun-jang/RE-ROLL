// 시작/결과 화면 뒤에 깔리는 움직이는 트로이 배경
import { useEffect, useRef } from 'react';
import { WIDTH, HEIGHT } from '../game/config.js';
import { createScenery, drawBackdrop } from '../game/renderer.js';
import { applyPost } from '../game/post.js';

export default function Backdrop() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scenery = createScenery(dpr);
    let raf = 0;
    const draw = (t) => {
      drawBackdrop(ctx, scenery, t / 1000);
      applyPost(ctx, { bloom: 0.45, grainAmount: 0.04 });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="kmj-backdrop" />;
}
