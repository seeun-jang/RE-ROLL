// =============================================================
//  블랙컴뱃 최상위 컴포넌트 — 지금 어떤 화면을 보여줄지만 관리합니다.
//
//    title ─▶ howto ─▶ fight ─▶ result ─┬─ 다시하기 ─▶ fight
//      │                                 ├─ 결과 확정 ─▶ onFinish(result)
//      └─ 메인으로 ─▶ onExit()            └─ 타이틀 ─▶ title
// =============================================================

import { useCallback, useState } from 'react';
import TitleScreen from './screens/TitleScreen.jsx';
import HowToScreen from './screens/HowToScreen.jsx';
import FightScreen from './screens/FightScreen.jsx';
import ResultScreen from './screens/ResultScreen.jsx';
import './styles/blackcombat.css';

/**
 * @param onFinish      결과 확정 시 한 번 호출 (메인 게임으로 결과 전달)
 * @param onExit        타이틀에서 [메인으로] (결과 없이 나가기)
 * @param inputSources  추가 입력 장치 (예: 웹캠 모션). 키보드는 항상 켜져 있음
 */
export default function BlackCombatGame({ onFinish, onExit, inputSources = null }) {
  const [scene, setScene] = useState('title');
  const [matchId, setMatchId] = useState(0);
  const [result, setResult] = useState(null);

  const start = useCallback(() => {
    setMatchId((n) => n + 1);
    setScene('fight');
  }, []);
  const toTitle = useCallback(() => setScene('title'), []);
  const toHowTo = useCallback(() => setScene('howto'), []);
  const handleEnd = useCallback((r) => {
    setResult(r);
    setScene('result');
  }, []);
  const confirm = useCallback(() => {
    if (onFinish) onFinish(result);
    else setScene('title');
  }, [onFinish, result]);

  return (
    <div className="bc-root">
      <div className="bc-stage">
        {scene === 'title' && <TitleScreen onStart={start} onHowTo={toHowTo} onExit={onExit} />}
        {scene === 'howto' && <HowToScreen onBack={toTitle} onStart={start} />}
        {scene === 'fight' && <FightScreen key={matchId} onMatchEnd={handleEnd} onQuit={toTitle} inputSources={inputSources} />}
        {scene === 'result' && result && <ResultScreen result={result} onRetry={start} onConfirm={confirm} onTitle={toTitle} />}
      </div>
    </div>
  );
}
