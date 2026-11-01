// =============================================================
//  경기 화면 (게임 루프)
//    매 프레임: 입력 → 엔진 → 효과음 → 그리기 → HUD
//    Esc/P 일시정지 · M 소리
// =============================================================

import { useEffect, useRef, useState } from 'react';
import { KEY_BINDINGS, PLAYERS, STAGE } from '../config.js';
import { createMatch, takeEvents, updateMatch } from '../engine/match.js';
import { createRenderer } from '../render/renderer.js';
import { expressionFor } from '../render/poses.js';
import { createKeyboardInput } from '../input/keyboardInput.js';
import { createInputManager } from '../input/inputManager.js';
import { createSfx } from '../audio/sfx.js';
import { buildResult } from '../result/buildResult.js';
import Hud from '../ui/Hud.jsx';
import KeyCap from '../ui/KeyCap.jsx';

function snapshot(match) {
  const fighters = {};
  for (const id of match.playerIds) {
    const f = match.fighters[id];
    fighters[id] = { hp: f.hp, res: f.res, super: f.super, expression: expressionFor(f) };
  }
  return {
    phase: match.phase,
    round: match.round,
    timeLeft: match.timeLeft,
    wins: { ...match.wins },
    fighters,
    banner: match.banner ? { ...match.banner } : null,
  };
}

const HINTS = {
  tiger: [['attack', '콤보'], ['skill', '대시'], ['dodge', '구르기'], ['guard', '가드']],
  professor: [['attack', '미사일'], ['skill', '파이어볼'], ['dodge', '백스텝'], ['guard', '방패']],
};

export default function FightScreen({ onMatchEnd, onQuit, inputSources = null }) {
  const canvasRef = useRef(null);
  const pausedRef = useRef(false);
  const sfxRef = useRef(null);
  const [snap, setSnap] = useState(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const match = createMatch();
    const renderer = createRenderer(canvasRef.current);
    const input = createInputManager([createKeyboardInput(), ...(inputSources ?? [])]);
    const sfx = createSfx();
    sfxRef.current = sfx;
    setMuted(sfx.isMuted());

    let raf = 0;
    let last = performance.now();
    let ended = false;
    const loop = (now) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        updateMatch(match, input.read(), dt);
        const events = takeEvents(match);
        for (const ev of events) sfx.play(ev);
        sfx.update(match.hype, dt);
        renderer.render(match, events, dt);
        setSnap(snapshot(match));
      } else {
        input.read();
      }
      if (match.done && !ended) {
        ended = true;
        onMatchEnd(buildResult(match));
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    renderer.render(match, [], 0);
    setSnap(snapshot(match));
    raf = requestAnimationFrame(loop);

    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      } else if (e.code === 'KeyM') {
        sfx.setMuted(!sfx.isMuted());
        setMuted(sfx.isMuted());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      input.dispose();
      sfx.dispose();
    };
  }, [onMatchEnd, inputSources]);

  const toggleMute = () => {
    sfxRef.current?.setMuted(!sfxRef.current.isMuted());
    setMuted(sfxRef.current?.isMuted() ?? false);
  };
  const resume = () => {
    pausedRef.current = false;
    setPaused(false);
  };

  return (
    <div className="bc-screen">
      <canvas ref={canvasRef} className="bc-canvas" width={STAGE.width} height={STAGE.height} />
      {snap && <Hud snap={snap} />}

      <div className="bc-hints">
        {PLAYERS.map((p) => {
          const k = KEY_BINDINGS[p.id];
          return (
            <div key={p.id} className={`bc-hints__row bc-hints__row--${p.side}`} style={{ '--pc': p.color }}>
              <b>{p.label}</b>
              {HINTS[p.kind].map(([key, label]) => (
                <span key={key}>
                  <KeyCap code={k[key][0]} />
                  {label}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <button type="button" className="bc-icon-btn bc-icon-btn--mute" onClick={toggleMute} title="소리 (M)">
        {muted ? '🔇' : '🔊'}
      </button>

      {paused && (
        <div className="bc-overlay">
          <div className="bc-panel bc-pause">
            <h2>PAUSE</h2>
            <button type="button" className="bc-btn bc-btn--primary" onClick={resume}>
              계속하기 <small>Esc</small>
            </button>
            <button type="button" className="bc-btn" onClick={onQuit}>
              타이틀로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
