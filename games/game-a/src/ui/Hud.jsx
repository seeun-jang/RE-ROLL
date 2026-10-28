// =============================================================
//  경기 HUD
//    위: 초상화, 이름, 라운드 승리 표시, 체력, 자원(스태미나/마나), 궁극기 게이지, 시간
//    가운데: 배너 (ROUND, FIGHT!, K.O., TIME, WINNER)
// =============================================================

import { FIGHTER, KEY_BINDINGS, MATCH, PLAYERS } from '../config.js';
import Portrait from './Portrait.jsx';
import KeyCap from './KeyCap.jsx';

const playerById = (id) => PLAYERS.find((p) => p.id === id);

function Side({ player, f, wins, side }) {
  const hp = Math.max(0, f.hp / FIGHTER.maxHp);
  const R = player.resource;
  const res = Math.max(0, f.res / R.max);
  const sup = Math.min(1, f.super / FIGHTER.superMax);
  const full = sup >= 1;
  return (
    <div className={`bc-side bc-side--${side}`} style={{ '--pc': player.color, '--rc': R.color }}>
      <div className="bc-side__portrait">
        <Portrait player={player} expression={f.expression} mirror={side === 'right'} />
      </div>
      <div className="bc-side__info">
        <div className="bc-side__name">
          <span className="bc-side__tag">{player.label}</span>
          <b>{player.name}</b>
          <span className="bc-wins">
            {Array.from({ length: MATCH.roundsToWin }, (_, i) => (
              <i key={i} className={i < wins ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div className={`bc-hp${hp < 0.25 ? ' bc-hp--danger' : ''}`}>
          <div className="bc-hp__ghost" style={{ width: `${hp * 100}%` }} />
          <div className="bc-hp__fill" style={{ width: `${hp * 100}%` }} />
          <div className="bc-hp__ticks" />
        </div>
        <div className="bc-sub">
          <span className="bc-sub__label">{R.short}</span>
          <div className={`bc-res${res < 0.2 ? ' bc-res--low' : ''}`}>
            <div className="bc-res__fill" style={{ width: `${res * 100}%` }} />
          </div>
        </div>
        <div className={`bc-super${full ? ' bc-super--full' : ''}`}>
          <div className="bc-super__bar">
            <div style={{ width: `${sup * 100}%` }} />
          </div>
          <span>
            {full ? (
              <>
                <KeyCap code={KEY_BINDINGS[player.id].super[0]} /> {player.kind === 'professor' ? '메테오' : '백호 난무'}!
              </>
            ) : (
              'SUPER'
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function Clock({ snap }) {
  const s = Math.ceil(snap.timeLeft);
  return (
    <div className="bc-clock">
      <div className="bc-clock__round">ROUND {snap.round}</div>
      <div className={`bc-clock__time${s <= 10 && snap.phase === 'fight' ? ' bc-clock__time--hurry' : ''}`}>{s}</div>
    </div>
  );
}

export function Banner({ banner }) {
  if (!banner) return null;
  const color = banner.color ? playerById(banner.color)?.color : null;
  return (
    <div key={banner.id} className={`bc-banner bc-banner--${banner.kind}`} style={color ? { '--bc': color } : undefined}>
      <div className="bc-banner__slash" />
      <div className="bc-banner__text">{banner.text}</div>
      {banner.sub && <div className="bc-banner__sub">{banner.sub}</div>}
    </div>
  );
}

export default function Hud({ snap }) {
  const [a, b] = PLAYERS;
  return (
    <div className="bc-hud">
      <div className="bc-top">
        <Side player={a} f={snap.fighters[a.id]} wins={snap.wins[a.id]} side="left" />
        <Clock snap={snap} />
        <Side player={b} f={snap.fighters[b.id]} wins={snap.wins[b.id]} side="right" />
      </div>
      <Banner banner={snap.banner} />
    </div>
  );
}
