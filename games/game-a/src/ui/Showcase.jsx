// =============================================================
//  움직이는 무대 배경 + 선수 연출 (타이틀, 결과 화면)
// =============================================================

import { useEffect, useRef } from 'react';
import { STAGE } from '../config.js';
import { createShowcase } from '../render/showcase.js';

export default function Showcase({ states, positions, focus, zoom, hype }) {
  const canvasRef = useRef(null);
  const key = JSON.stringify({ states, positions, focus, zoom, hype });

  useEffect(() => {
    const show = createShowcase(canvasRef.current, { states, positions, focus, zoom, hype });
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      show.render(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);

  }, [key]);

  return <canvas ref={canvasRef} className="bc-canvas" width={STAGE.width} height={STAGE.height} />;
}
