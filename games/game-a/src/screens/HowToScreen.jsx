// =============================================================
//  조작법 · 기술표
// =============================================================

import { useEffect } from 'react';
import { KEY_BINDINGS, MATCH, PLAYERS } from '../config.js';
import Showcase from '../ui/Showcase.jsx';
import KeyCap from '../ui/KeyCap.jsx';

// [버튼, 조건, student 기술, 교수 기술]
const MOVES = [
  ['attack', '멀리서', '잽 → 크로스 → 발톱 베기 (연타 콤보)', '매직 미사일'],
  ['attack', '가까이', '〃', '장풍 밀치기'],
  ['skill', '그냥', '타이거 대시 (미사일 튕겨냄)', '파이어볼 (넘어뜨림)'],
  ['skill', '앞 + 기술', '도약 내려찍기 (마법을 뛰어넘음)', '낙뢰 (상대 위치에 예고 후 번개)'],
  ['skill', '뒤 + 기술', '포효 (주변 마법 소멸, 가까우면 기절)', '블링크 (순간이동)'],
  ['skill', '가까이', '니킥', '아케인 폭발 (멀리 밀쳐냄)'],
  ['dodge', '', '구르기 (완전 무적, 상대를 통과)', '백스텝 (짧은 무적)'],
  ['guard', '누르고 있기', '가드 (스태미나 소모)', '마법 방패 (마나 소모)'],
  ['super', '게이지 가득', '백호 난무 (돌진 연타)', '메테오 (운석 낙하)'],
];

function Key({ id, action }) {
  return <KeyCap code={KEY_BINDINGS[id][action][0]} />;
}

export default function HowToScreen({ onBack, onStart }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyH') onBack();
      else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onStart]);

  const [a, b] = PLAYERS;
  return (
    <div className="bc-screen">
      <Showcase states={{ p1: 'idle', p2: 'guard' }} focus={800} zoom={0.95} hype={0.4} />
      <div className="bc-overlay">
        <div className="bc-panel bc-howto">
          <h2>HOW TO DUEL</h2>
          <div className="bc-movelist">
            <div className="bc-movelist__row bc-movelist__row--head">
              <span>버튼</span>
              <span>조건</span>
              <span style={{ color: a.color }}>{a.name} · {a.style}</span>
              <span style={{ color: b.color }}>{b.name} · {b.style}</span>
            </div>
            {MOVES.map(([action, when, tiger, prof], i) => (
              <div key={i} className="bc-movelist__row">
                <span>
                  <Key id="p1" action={action} />
                  <Key id="p2" action={action} />
                </span>
                <span className="bc-movelist__when">{when}</span>
                <span>{tiger}</span>
                <span>{prof}</span>
              </div>
            ))}
          </div>
          <div className="bc-howto__grid bc-howto__grid--small">
            <section className="bc-howto__rules">
              <h3>룰</h3>
              <ul>
                <li><b>{MATCH.roundsToWin}선승제</b>, 한 라운드 {MATCH.roundSeconds}초. 체력 0이면 K.O.</li>
                <li>시간이 끝나면 체력이 더 많이 남은 쪽이 라운드 승리.</li>
                <li>이동: P1 <KeyCap code="KeyA" /><KeyCap code="KeyD" /> · P2 <KeyCap code="ArrowLeft" /><KeyCap code="ArrowRight" /></li>
              </ul>
            </section>
            <section className="bc-howto__rules">
              <h3>이기는 법</h3>
              <ul>
                <li style={{ color: a.color }}><b>student</b>: 구르기·대시·도약으로 마법을 뚫고 붙어서 콤보!</li>
                <li style={{ color: b.color }}><b>교수</b>: 거리를 벌리고 마법으로 견제, 붙으면 폭발·블링크로 탈출!</li>
                <li>맞고 때릴수록 <b>궁극기 게이지</b>가 차오릅니다.</li>
              </ul>
            </section>
          </div>
          <div className="bc-row">
            <button type="button" className="bc-btn" onClick={onBack}>돌아가기 <small>Esc</small></button>
            <button type="button" className="bc-btn bc-btn--primary" onClick={onStart}>FIGHT <small>Space</small></button>
          </div>
        </div>
      </div>
    </div>
  );
}
