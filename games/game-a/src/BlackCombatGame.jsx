// =============================================================
//  블랙컴뱃 최상위 컴포넌트
//  지금 어떤 화면(장면)을 보여줄지만 관리합니다.
//
//  화면 흐름
//    title ──FIGHT!──▶ fight ──경기 끝──▶ result
//      │                                  ├─ 다시하기 ──▶ fight (새 경기)
//      └─ 메인으로 → onExit()              └─ 결과 확정 ──▶ onFinish(result)
// =============================================================

import { useCallback, useState } from 'react';
import TitleScreen from './screens/TitleScreen.jsx';
import FightScreen from './screens/FightScreen.jsx';
import ResultScreen from './screens/ResultScreen.jsx';
import './styles/blackcombat.css';

const SCENES = {
  TITLE: 'title',
  FIGHT: 'fight',
  RESULT: 'result',
};

export default function BlackCombatGame({ onFinish, onExit }) {
  const [scene, setScene] = useState(SCENES.TITLE);
  const [matchId, setMatchId] = useState(0); // 바뀌면 경기 화면을 새로 만듦 (다시하기)
  const [result, setResult] = useState(null);

  const startMatch = useCallback(() => {
    setMatchId((n) => n + 1);
    setScene(SCENES.FIGHT);
  }, []);

  const handleMatchEnd = useCallback((matchResult) => {
    setResult(matchResult);
    setScene(SCENES.RESULT);
  }, []);

  const handleConfirm = useCallback(() => {
    if (onFinish) {
      onFinish(result);
    } else {
      setScene(SCENES.TITLE); // 메인 게임 없이 쓰일 때는 타이틀로
    }
  }, [onFinish, result]);

  return (
    <div className="bc-root">
      <div className="bc-stage">
        {scene === SCENES.TITLE && <TitleScreen onStart={startMatch} onExit={onExit} />}
        {scene === SCENES.FIGHT && <FightScreen key={matchId} onMatchEnd={handleMatchEnd} />}
        {scene === SCENES.RESULT && result && (
          <ResultScreen result={result} onRetry={startMatch} onConfirm={handleConfirm} />
        )}
      </div>
    </div>
  );
}
