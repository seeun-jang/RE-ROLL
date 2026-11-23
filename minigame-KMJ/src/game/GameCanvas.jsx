// 게임 루프를 돌리는 컴포넌트입니다: 노래 재생 → 입력 읽기 → 판정 → 화면 그리기
import { useEffect, useRef } from 'react';
import { WIDTH, HEIGHT } from './config.js';
import { createGameState, updateGame } from './engine.js';
import { renderGame, createScenery } from './renderer.js';
import { startSong, audioClock, playSfx } from './audio.js';
import { createInput } from '../input/index.js';

export default function GameCanvas({ song, names, inputType, onEnd }) {
  const canvasRef = useRef(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scenery = createScenery(dpr);

    // 노래 시계: 소리가 나면 오디오 시계(박자에 정확), 아니면 일반 시계
    const player = startSong(song);
    const perfStart = performance.now() / 1000 + 0.4;
    const clock = () => {
      const a = audioClock();
      if (player && a !== null) return a - player.startAt;
      return performance.now() / 1000 - perfStart;
    };

    const input = createInput(inputType, clock);
    input.start();
    const state = createGameState(song);
    state.names = names;
    let last = performance.now();
    let raf = 0;

    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      updateGame(state, input.read(), clock(), dt);
      for (const ev of state.events) playSfx(ev);
      state.events.length = 0;

      renderGame(ctx, state, now / 1000, scenery);
      if (state.over) {
        onEndRef.current(state);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      player?.stop();
      input.stop();
    };
  }, [song, inputType]);

  return <canvas ref={canvasRef} className="kmj-canvas" />;
}
