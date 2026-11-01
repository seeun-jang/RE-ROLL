// 선수 얼굴 (HUD). 표정이 바뀔 때만 다시 그립니다.
import { useEffect, useRef } from 'react';
import { drawPortrait } from '../render/showcase.js';

export default function Portrait({ player, expression = 'fierce', mirror = false }) {
  const ref = useRef(null);
  useEffect(() => {
    drawPortrait(ref.current, player, expression);
  }, [player, expression]);
  return <canvas ref={ref} width={160} height={160} className={`bc-portrait${mirror ? ' bc-portrait--mirror' : ''}`} />;
}
