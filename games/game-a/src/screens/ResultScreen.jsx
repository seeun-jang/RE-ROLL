// =============================================================
//  결과 화면
//    - 승자, 승리 방식(K.O./판정), 남은 체력, 준 데미지, 점수 표시
//    - [다시하기]  같은 두 사람이 한 판 더
//    - [결과 확정]  메인 게임에 결과 전달 (onConfirm)
//  키보드: R = 다시하기, Enter = 결과 확정
// =============================================================

import { useEffect, useState } from 'react';
import FighterPortrait from '../components/FighterPortrait.jsx';
import { MATCH, PLAYERS } from '../config.js';

const KEY_GUARD_MS = 1200; // 경기 중 누르던 키로 바로 넘어가지 않도록 잠깐 대기

const REASON_TEXT = {
  ko: 'K.O. 승리',
  decision: '판정승',
  draw: '무승부',
};

function ResultCard({ player, info, score, outcome }) {
  const pose = outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : 'idle';
  return (
    <section
      className={`bc-result-card is-${outcome}`}
      style={{ '--p-color': player.color, '--p-deep': player.colorDeep }}
    >
      <div className="bc-result-badge">{outcome === 'win' ? 'WIN' : outcome === 'lose' ? 'LOSE' : 'DRAW'}</div>
      <div className="bc-result-portrait">
        <FighterPortrait player={player} pose={pose} facing={player.side === 'left' ? 1 : -1} />
      </div>
      <div className="bc-result-name">
        <span className="bc-tag">{player.label}</span> {player.name}
      </div>
      <dl className="bc-result-stats">
        <div>
          <dt>남은 체력</dt>
          <dd>
            {info.hp}
            <small>/{MATCH.maxHp}</small>
          </dd>
        </div>
        <div>
          <dt>준 데미지</dt>
          <dd>{info.damageDealt}</dd>
        </div>
        <div>
          <dt>적중</dt>
          <dd>{info.hitsLanded}</dd>
        </div>
      </dl>
      <div className="bc-result-score">
        <b>{score}</b>점
      </div>
    </section>
  );
}

export default function ResultScreen({ result, onRetry, onConfirm }) {
  const [keysReady, setKeysReady] = useState(false);
  const { details } = result;
  const winner = PLAYERS.find((p) => p.id === details.winner);

  useEffect(() => {
    const timer = setTimeout(() => setKeysReady(true), KEY_GUARD_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!keysReady) return undefined;
    const onKeyDown = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyR') onRetry();
      if (e.code === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keysReady, onRetry, onConfirm]);

  // 카드는 P1(왼쪽), P2(오른쪽) 순서 고정 → 웹캠 위치와 같은 쪽
  const cards = PLAYERS.map((player) => {
    const info = details.players.find((p) => p.playerId === player.id);
    const score = result.scores.find((s) => s.playerId === player.id).score;
    let outcome = 'draw';
    if (details.winner) outcome = details.winner === player.id ? 'win' : 'lose';
    return { player, info, score, outcome };
  });

  return (
    <div className="bc-screen bc-result">
      <div className="bc-title-glow" aria-hidden="true" />
      <div className="bc-confetti" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{ '--i': i, '--c': ['#ffd45e', '#ffffff', PLAYERS[0].color, PLAYERS[1].color][i % 4] }} />
        ))}
      </div>
      <header className="bc-result-head">
        <p className="bc-eyebrow">{REASON_TEXT[details.reason] ?? '경기 결과'}</p>
        <h2 className="bc-result-title">{winner ? `${winner.label} ${winner.name} 승리!` : '무승부!'}</h2>
      </header>

      <div className="bc-result-cards">
        {cards.map((c) => (
          <ResultCard key={c.player.id} {...c} />
        ))}
      </div>

      <div className="bc-result-actions">
        <button type="button" className="bc-btn bc-btn-ghost bc-btn-wide" onClick={onRetry}>
          ↻ 다시하기 <kbd className="bc-key">R</kbd>
        </button>
        <button type="button" className="bc-btn bc-btn-start bc-btn-confirm" onClick={onConfirm}>
          결과 확정 ▶ <kbd className="bc-key">Enter</kbd>
        </button>
      </div>
    </div>
  );
}
