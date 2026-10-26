// =============================================================
//  경기 중 화면 위에 겹쳐 보이는 정보
//    - 위쪽: 체력 바(양쪽), 남은 시간(가운데)
//    - 체력 바 아래: 스태미나, 필살기 게이지
//    - 가운데: ROUND 1 / FIGHT! / K.O.! / TIME UP!
// =============================================================

import { PHASE } from '../engine/match.js';
import { FIGHTER, KEY_BINDINGS, KEY_LABELS, MATCH, PLAYERS } from '../config.js';

function PlayerBars({ player, info }) {
  const hpRatio = info.hp / MATCH.maxHp;
  const ready = info.power >= FIGHTER.powerMax;
  const specialKey = KEY_LABELS[KEY_BINDINGS[player.id].special[0]];

  return (
    <div className={`bc-hud-player bc-side-${player.side}`} style={{ '--p-color': player.color, '--p-deep': player.colorDeep }}>
      <div className="bc-hud-name">
        <span className="bc-tag">{player.label}</span>
        <span>{player.name}</span>
        <span className="bc-hud-hp-num">{Math.ceil(info.hp)}</span>
      </div>
      <div className={`bc-hp ${hpRatio <= 0.3 ? 'is-low' : ''}`}>
        <div className="bc-hp-trail" style={{ width: `${hpRatio * 100}%` }} />
        <div className="bc-hp-fill" style={{ width: `${hpRatio * 100}%` }} />
      </div>
      <div className="bc-hud-sub">
        <div className={`bc-stamina ${info.tired ? 'is-tired' : ''}`} title="스태미나">
          <div className="bc-stamina-fill" style={{ width: `${(info.stamina / FIGHTER.staminaMax) * 100}%` }} />
        </div>
        <div className={`bc-power ${ready ? 'is-ready' : ''}`}>
          <div className="bc-power-fill" style={{ width: `${(info.power / FIGHTER.powerMax) * 100}%` }} />
          <span className="bc-power-label">{ready ? `필살기 READY! (${specialKey})` : '필살기'}</span>
        </div>
      </div>
    </div>
  );
}

function CenterMessage({ hud }) {
  if (hud.phase === PHASE.INTRO) {
    const showFight = hud.introTime < 0.9;
    return (
      <div className="bc-center-msg" key={showFight ? 'fight' : 'round'}>
        <span className={`bc-big-text ${showFight ? 'bc-fight' : ''}`}>{showFight ? 'FIGHT!' : 'ROUND 1'}</span>
      </div>
    );
  }
  if (hud.phase === PHASE.KO || hud.phase === PHASE.TIMEUP) {
    const winner = PLAYERS.find((p) => p.id === hud.winnerId);
    let title = 'K.O.!';
    if (hud.phase === PHASE.TIMEUP) title = 'TIME UP!';
    else if (!winner) title = 'DOUBLE K.O.!';
    let sub = '무승부!';
    if (winner) sub = hud.reason === 'decision' ? `${winner.label} ${winner.name} 판정승!` : `${winner.label} ${winner.name} 승리!`;
    return (
      <div className="bc-center-msg bc-end-msg" key="end">
        <span className={`bc-big-text ${hud.phase === PHASE.KO ? 'bc-ko' : ''}`}>{title}</span>
        <span className="bc-end-sub">{sub}</span>
      </div>
    );
  }
  return null;
}

export default function HUD({ hud }) {
  const t = Math.ceil(hud.timeLeft);
  return (
    <div className="bc-hud">
      {PLAYERS.map((p) => (
        <PlayerBars key={p.id} player={p} info={hud.players[p.id]} />
      ))}
      <div className={`bc-timer ${t <= 10 && hud.phase === PHASE.FIGHT ? 'is-hurry' : ''}`}>{t}</div>
      <CenterMessage hud={hud} />
    </div>
  );
}
