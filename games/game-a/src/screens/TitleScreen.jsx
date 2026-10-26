// =============================================================
//  타이틀 화면
//  게임 이름, P1·P2 조작 안내, 규칙 요약, 시작 버튼을 보여줍니다.
//  Space 또는 Enter 키로도 시작할 수 있습니다.
// =============================================================

import { useEffect } from 'react';
import FighterPortrait from '../components/FighterPortrait.jsx';
import { CONTROL_ROWS } from './controls.js';
import { GAME_TITLE, GAME_TITLE_EN, KEY_BINDINGS, KEY_LABELS, MATCH, PLAYERS, START_KEYS } from '../config.js';

function KeyCaps({ codes }) {
  return codes.map((c) => (
    <kbd key={c} className="bc-key">
      {KEY_LABELS[c] ?? c}
    </kbd>
  ));
}

function PlayerCard({ player }) {
  const keys = KEY_BINDINGS[player.id];
  return (
    <section className={`bc-player-card bc-side-${player.side}`} style={{ '--p-color': player.color, '--p-deep': player.colorDeep }}>
      <header className="bc-player-head">
        <span className="bc-tag">{player.label}</span>
        <span className="bc-player-name">{player.name}</span>
        <span className="bc-player-side">카메라 {player.side === 'left' ? '왼쪽' : '오른쪽'}</span>
      </header>
      <div className="bc-player-portrait">
        <FighterPortrait player={player} pose="demo" facing={player.side === 'left' ? 1 : -1} />
      </div>
      <dl className="bc-controls">
        {CONTROL_ROWS.map(({ action, label }) => (
          <div className="bc-control-row" key={action}>
            <dt>{label}</dt>
            <dd>{action === 'move' ? <KeyCaps codes={[...keys.left, ...keys.right]} /> : <KeyCaps codes={keys[action].slice(0, 1)} />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function TitleScreen({ onStart, onExit }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.repeat) return;
      if (START_KEYS.includes(e.code)) {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStart]);

  return (
    <div className="bc-screen bc-title">
      <div className="bc-title-glow" aria-hidden="true" />

      <header className="bc-title-head">
        <p className="bc-eyebrow">RE:ROLL MINI GAME · A</p>
        <h1 className="bc-logo">{GAME_TITLE}</h1>
        <p className="bc-logo-en">{GAME_TITLE_EN}</p>
      </header>

      <div className="bc-title-main">
        <PlayerCard player={PLAYERS[0]} />

        <div className="bc-title-center">
          <div className="bc-vs">VS</div>
          <ul className="bc-rules">
            <li>
              <b>1라운드 {MATCH.roundSeconds}초</b> · K.O. 또는 판정승
            </li>
            <li>
              <b>가드</b>로 막으면 데미지 대폭 감소
            </li>
            <li>
              공격·가드는 <b>스태미나</b>를 써요
            </li>
            <li>
              게이지가 차면 <b>필살기!</b>
            </li>
          </ul>
          <button type="button" className="bc-btn bc-btn-start" onClick={onStart}>
            FIGHT!
          </button>
          <p className="bc-hint">
            <kbd className="bc-key">Space</kbd> 또는 <kbd className="bc-key">Enter</kbd> 로 시작
          </p>
          {onExit && (
            <button type="button" className="bc-btn bc-btn-ghost" onClick={onExit}>
              ← 메인으로
            </button>
          )}
        </div>

        <PlayerCard player={PLAYERS[1]} />
      </div>
    </div>
  );
}
