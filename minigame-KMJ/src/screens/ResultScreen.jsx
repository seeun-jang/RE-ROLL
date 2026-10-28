// 결과 화면: 승자 뒤로 빛이 쏟아지고, 랭크 도장이 찍히고, 판정 통계가 막대로 차오름
import { useEffect, useState } from 'react';
import { PLAYER_INFO } from '../game/config.js';
import { getWinner } from '../game/result.js';
import Backdrop from './Backdrop.jsx';
import HeroPortrait from './HeroPortrait.jsx';

const JUDGES = [
  ['perfect', 'PERFECT', '#ffe07a'],
  ['great', 'GREAT', '#8fd3ff'],
  ['good', 'GOOD', '#b8f0a0'],
  ['miss', 'MISS', '#8a7a70'],
];

function useCountUp(target, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// 판정 정확도로 랭크
function rankOf(stat) {
  const total = stat.perfect + stat.great + stat.good + stat.miss;
  if (!total) return 'C';
  const acc = (stat.perfect + stat.great * 0.7 + stat.good * 0.4) / total;
  if (acc >= 0.9) return 'S';
  if (acc >= 0.75) return 'A';
  if (acc >= 0.55) return 'B';
  return 'C';
}

function Side({ stat, winner, name }) {
  const id = stat.playerId;
  const info = PLAYER_INFO[id];
  const isWinner = id === winner;
  const isLoser = winner !== null && !isWinner;
  const mood = winner === null ? 'ready' : isWinner ? 'victory' : 'defeat';
  const score = useCountUp(stat.score);
  const total = Math.max(1, stat.perfect + stat.great + stat.good + stat.miss);
  const rank = rankOf(stat);

  return (
    <div
      className={`kmj-side kmj-result-side is-${id} ${isWinner ? 'is-winner' : ''} ${isLoser ? 'is-loser' : ''}`}
      style={{ '--kmj-accent': info.color }}
    >
      <div className="kmj-side-panel" />
      {isWinner && <div className="kmj-rays" />}
      <HeroPortrait id={id} mood={mood} facing={id === 'p1' ? 1 : -1} size={420} className="kmj-side-hero" />
      <div className={`kmj-rank is-${rank}`}>{rank}</div>

      <div className="kmj-result-card">
        <div className="kmj-result-name">{name}</div>
        <div className="kmj-big-score">{score.toLocaleString()}</div>
        <div className="kmj-stat-bars">
          {JUDGES.map(([key, label, color], i) => (
            <div className="kmj-stat-row" key={key} style={{ '--kmj-bar': color, '--kmj-delay': `${0.5 + i * 0.12}s` }}>
              <span>{label}</span>
              <span className="kmj-stat-track">
                <span style={{ width: `${(stat[key] / total) * 100}%` }} />
              </span>
              <b>{stat[key]}</b>
            </div>
          ))}
          <div className="kmj-stat-row is-combo">
            <span>MAX COMBO</span>
            <b>{stat.maxCombo}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultScreen({ summary, names, onRetry, onExit }) {
  const winner = getWinner(summary.result);

  return (
    <div className="kmj-screen kmj-select kmj-result">
      <Backdrop />
      {summary.stats.players.map((s) => (
        <Side key={s.playerId} stat={s} winner={winner} name={names[s.playerId]} />
      ))}

      <div className="kmj-select-top">
        <div className="kmj-eyebrow">{winner ? 'VICTORY' : 'DRAW'}</div>
        <h1 className="kmj-logo kmj-logo-small">{winner ? `${names[winner]} 승리` : '무승부'}</h1>
      </div>

      <div className="kmj-select-bottom">
        <div className="kmj-btn-row">
          <button className="kmj-btn kmj-btn-primary" onClick={onRetry}>
            다시 결투
          </button>
          {onExit && (
            <button className="kmj-btn" onClick={onExit}>
              메인으로
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
