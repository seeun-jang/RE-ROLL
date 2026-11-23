// =============================================================
//  단독 실행용 파일 (npm run dev)
//  메인 보드게임 없이 game-a만 테스트하기 위한 래퍼입니다. 통합 시에는 사용되지 않습니다.
//  결과를 확정하면 "메인 게임에 전달될 데이터"를 오른쪽 아래에 보여주고 타이틀로 돌아갑니다.
// =============================================================

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BlackCombatGame from './index.js';

const panelStyle = {
  position: 'fixed',
  right: 12,
  bottom: 12,
  maxWidth: 360,
  padding: '10px 14px 12px',
  background: 'rgba(14, 10, 28, 0.94)',
  color: '#ECE6FF',
  borderRadius: 12,
  font: '12px/1.45 ui-monospace, Consolas, monospace',
  zIndex: 10,
};

function StandaloneApp() {
  const [gameKey, setGameKey] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const handleFinish = (result) => {
    console.log('[game-a] 결과 데이터:', result);
    setLastResult(result);
    setGameKey((k) => k + 1);
  };
  const handleExit = () => console.log('[game-a] 메인으로 돌아가기 요청 (단독 실행이라 이동 없음)');

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <BlackCombatGame key={gameKey} onFinish={handleFinish} onExit={handleExit} />
      {lastResult && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <b>메인 게임에 전달될 데이터</b>
            <button type="button" onClick={() => setLastResult(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
              ✕
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify({ gameId: lastResult.gameId, scores: lastResult.scores }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StandaloneApp />
  </StrictMode>,
);
