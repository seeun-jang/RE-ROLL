// =============================================================
//  타이틀 화면 — 대연회장에서 student와 황종철 교수가 마주 선 장면
//  Space/Enter 시작 · H 조작법 · 메인으로(onExit)
// =============================================================

import { useEffect } from 'react';
import { GAME_SUBTITLE, GAME_TITLE, GAME_TITLE_EN, PLAYERS } from '../config.js';
import Showcase from '../ui/Showcase.jsx';

const STATES = { p1: 'guard', p2: 'idle' };
const POSITIONS = { p1: 610, p2: 990 };

export default function TitleScreen({ onStart, onHowTo, onExit }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onStart();
      } else if (e.code === 'KeyH') onHowTo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart, onHowTo]);

  const [a, b] = PLAYERS;
  return (
    <div className="bc-screen bc-title">
      <Showcase states={STATES} positions={POSITIONS} focus={800} zoom={1.08} hype={0.8} />
      <div className="bc-title__shade" />

      <div className="bc-title__logo">
        <div className="bc-title__kicker">RE:ROLL · MINI GAME A</div>
        <h1>{GAME_TITLE_EN}</h1>
        {GAME_TITLE !== GAME_TITLE_EN && <div className="bc-title__ko">{GAME_TITLE}</div>}
        <div className="bc-title__rule">{GAME_SUBTITLE}</div>
      </div>

      <div className="bc-title__plate bc-title__plate--left" style={{ '--pc': a.color }}>
        <span>{a.style}</span>
        <b>{a.name}</b>
        <small>{a.title}</small>
      </div>
      <div className="bc-title__plate bc-title__plate--right" style={{ '--pc': b.color }}>
        <span>{b.style}</span>
        <b>{b.name}</b>
        <small>{b.title}</small>
      </div>

      <div className="bc-title__menu">
        <button type="button" className="bc-btn bc-btn--primary bc-btn--big" onClick={onStart}>
          FIGHT <small>Space</small>
        </button>
        <button type="button" className="bc-btn" onClick={onHowTo}>
          조작법 · 룰 <small>H</small>
        </button>
        {onExit && (
          <button type="button" className="bc-btn bc-btn--ghost" onClick={onExit}>
            메인으로
          </button>
        )}
      </div>
    </div>
  );
}
