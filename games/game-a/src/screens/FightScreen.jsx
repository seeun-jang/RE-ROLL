// =============================================================
//  경기 화면
//    - 캔버스에 링, 관중, 선수를 그리고
//    - 매 프레임 입력 → 경기 계산 → 그리기 → 효과음 을 반복합니다 (게임 루프)
//    - 경기가 끝나면 결과를 onMatchEnd로 넘깁니다.
//
//  ※ 선수 위치처럼 매 프레임 바뀌는 값은 React state에 넣지 않습니다.
//    (넣으면 1초에 60번 화면 전체를 다시 그려서 느려짐)
//    화면 위 글자(HUD)만 1초에 20번 정도 갱신합니다.
// =============================================================

import { useEffect, useRef, useState } from 'react';
import HUD from './HUD.jsx';
import { CONTROL_ROWS, keyText } from './controls.js';
import { KEY_BINDINGS, PLAYERS, SOUND } from '../config.js';
import { createMatch, updateMatch, takeEvents, PHASE } from '../engine/match.js';
import { createRenderer } from '../engine/renderer.js';
import { createKeyboardInput } from '../input/keyboardInput.js';
import { createInputManager } from '../input/inputManager.js';
import { createCrowdAudio } from '../audio/crowdAudio.js';
import { buildResult } from '../result/buildResult.js';

const HUD_UPDATES_PER_SECOND = 20;
const MAX_FRAME_TIME = 1 / 30; // 창이 잠깐 멈췄다 돌아와도 한 번에 크게 진행되지 않게
const MUTE_KEY = 'KeyM';

// 소리 켜기/끄기 상태 (다시하기를 해도 유지)
let soundOn = SOUND.enabled;

function makeHudSnapshot(match) {
  const players = {};
  for (const id of match.playerIds) {
    const f = match.fighters[id];
    players[id] = { hp: f.hp, stamina: f.stamina, power: f.power, tired: f.tired > 0 };
  }
  return {
    phase: match.phase,
    introTime: match.introTime,
    timeLeft: match.timeLeft,
    winnerId: match.winnerId,
    reason: match.reason,
    players,
  };
}

export default function FightScreen({ onMatchEnd }) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [hud, setHud] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(soundOn);

  // onMatchEnd가 바뀌어도 게임 루프를 다시 시작하지 않도록 ref에 보관
  const onMatchEndRef = useRef(onMatchEnd);
  onMatchEndRef.current = onMatchEnd;

  const toggleSound = () => {
    soundOn = !soundOn;
    setSoundEnabled(soundOn);
    audioRef.current?.setMuted(!soundOn);
  };
  const toggleSoundRef = useRef(toggleSound);
  toggleSoundRef.current = toggleSound;

  useEffect(() => {
    const match = createMatch(PLAYERS.map((p) => p.id));
    const renderer = createRenderer(canvasRef.current, PLAYERS);
    const input = createInputManager([createKeyboardInput()]);
    const audio = createCrowdAudio({ enabled: soundOn, volume: SOUND.volume });
    audioRef.current = audio;

    const onKeyDown = (e) => {
      if (e.code === MUTE_KEY && !e.repeat) toggleSoundRef.current();
    };
    window.addEventListener('keydown', onKeyDown);

    let rafId = 0;
    let lastNow = performance.now();
    let clock = 0;
    let hudTimer = Infinity;

    const frame = (now) => {
      const dt = Math.min((now - lastNow) / 1000, MAX_FRAME_TIME);
      lastNow = now;
      clock += dt * match.timeScale;

      updateMatch(match, input.read(), dt);
      for (const event of takeEvents(match)) audio.play(event);
      audio.update(match.hype, dt);
      renderer.draw(match, clock);

      hudTimer += dt;
      if (hudTimer >= 1 / HUD_UPDATES_PER_SECOND) {
        hudTimer = 0;
        setHud(makeHudSnapshot(match));
      }

      if (match.done) {
        onMatchEndRef.current?.(buildResult(match));
        return;
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      input.dispose();
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  return (
    <div className="bc-screen bc-fight">
      <canvas ref={canvasRef} className="bc-canvas" />
      {hud && <HUD hud={hud} />}
      {hud?.phase === PHASE.INTRO && (
        <div className="bc-fight-tip">
          {PLAYERS.map((p) => {
            const k = KEY_BINDINGS[p.id];
            return (
              <span key={p.id} style={{ '--p-color': p.color }}>
                <b>{p.label}</b>{' '}
                {CONTROL_ROWS.map(({ action, label }) =>
                  action === 'move' ? `${keyText([...k.left, ...k.right])} ${label}` : `${keyText(k[action].slice(0, 1))} ${label}`,
                ).join(' · ')}
              </span>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="bc-sound-btn"
        onClick={toggleSound}
        aria-label={soundEnabled ? '소리 끄기' : '소리 켜기'}
        title="소리 켜기/끄기 (M)"
      >
        {soundEnabled ? '🔊' : '🔇'} <span>M</span>
      </button>
    </div>
  );
}
