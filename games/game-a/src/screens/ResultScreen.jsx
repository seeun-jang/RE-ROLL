// =============================================================
//  결과 화면 — 승자 연출 + 라운드 기록 + 메인 게임에 전달할 점수
//  R 다시하기 · Enter 결과 확정(onFinish) · Esc 타이틀
// =============================================================

import { useEffect } from 'react';
import { PLAYERS } from '../config.js';
import Showcase from '../ui/Showcase.jsx';

const STATS = [
  ['준 데미지', (p) => p.damage],
  ['명중', (p) => p.landed],
  ['넘어뜨림', (p) => p.knockdowns],
  ['피하기·튕겨내기', (p) => p.dodged],
  ['막은 공격', (p) => p.blocked],
  ['궁극기', (p) => p.supers],
];
const METHOD = { ko: 'K.O.', time: 'TIME', draw: 'DRAW' };

export default function ResultScreen({ result, onRetry, onConfirm, onTitle }) {
  const { details, scores } = result;
  const winner = PLAYERS.find((p) => p.id === details.winner);

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyR') onRetry();
      else if (e.code === 'Enter') onConfirm();
      else if (e.code === 'Escape') onTitle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRetry, onConfirm, onTitle]);

  const [a, b] = PLAYERS;
  const stats = Object.fromEntries(details.players.map((p) => [p.playerId, p]));
  const loserId = winner ? (winner.id === 'p1' ? 'p2' : 'p1') : null;
  const states = winner ? { [winner.id]: 'win', [loserId]: 'lose' } : { p1: 'lose', p2: 'lose' };
  const positions = winner ? { [winner.id]: winner.side === 'left' ? 600 : 1000, [loserId]: winner.side === 'left' ? 1180 : 420 } : undefined;
  const focus = winner ? (winner.side === 'left' ? 860 : 740) : 800;

  return (
    <div className="bc-screen bc-result">
      <Showcase states={states} positions={positions} focus={focus} zoom={1.02} hype={1} />
      <div className="bc-result__hero" style={{ '--pc': winner?.color ?? '#FFD55E' }}>
        <div className="bc-result__method">{winner ? 'VICTORY' : 'DRAW'}</div>
        {winner && <div className="bc-result__winner">WINNER</div>}
        <div className="bc-result__name">{winner ? winner.name : '무승부'}</div>
        <div className="bc-result__sub">
          {a.name} {details.wins[a.id]} : {details.wins[b.id]} {b.name}
        </div>
      </div>

      <div className={`bc-panel bc-result__panel bc-result__panel--${winner?.side === 'right' ? 'left' : 'right'}`}>
        <div className="bc-rounds">
          {details.rounds.map((r, i) => {
            const p = PLAYERS.find((x) => x.id === r.winner);
            return (
              <div key={i} className="bc-rounds__item" style={{ '--pc': p?.color ?? '#8d86a8' }}>
                <span>R{i + 1}</span>
                <b>{p ? p.name : '무승부'}</b>
                <small>{METHOD[r.method]}{r.method === 'ko' ? ` ${r.time}s` : ''}</small>
              </div>
            );
          })}
        </div>
        <div className="bc-stats">
          <div className="bc-stats__row bc-stats__row--head">
            <span style={{ color: a.color }}>{a.name}</span>
            <span />
            <span style={{ color: b.color }}>{b.name}</span>
          </div>
          {STATS.map(([label, pick]) => {
            const va = pick(stats[a.id]);
            const vb = pick(stats[b.id]);
            return (
              <div key={label} className="bc-stats__row">
                <span className={va > vb ? 'hi' : ''}>{va}</span>
                <span className="bc-stats__label">{label}</span>
                <span className={vb > va ? 'hi' : ''}>{vb}</span>
              </div>
            );
          })}
        </div>
        <div className="bc-result__scores">
          <span>메인 게임 점수</span>
          {PLAYERS.map((p) => (
            <b key={p.id} style={{ color: p.color }}>
              {p.label} {scores.find((s) => s.playerId === p.id)?.score ?? 0}
            </b>
          ))}
        </div>
        <div className="bc-row">
          <button type="button" className="bc-btn" onClick={onRetry}>다시하기 <small>R</small></button>
          <button type="button" className="bc-btn bc-btn--primary" onClick={onConfirm}>결과 확정 <small>Enter</small></button>
          <button type="button" className="bc-btn bc-btn--ghost" onClick={onTitle}>타이틀 <small>Esc</small></button>
        </div>
      </div>
    </div>
  );
}
