// =============================================================
//  단독 실행용 파일 (npm run dev)
//  메인 보드게임이 없을 때 game-a만 따로 테스트하기 위한 래퍼입니다.
//  메인 게임에 통합될 때는 사용되지 않습니다.
//
//  결과를 확정하면 메인 게임 대신 오른쪽 아래에 "전달될 데이터"를 보여주고
//  게임을 타이틀로 되돌립니다.
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
  background: 'rgba(30, 26, 46, 0.92)',
  color: '#e9e4ff',
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
    setGameKey((k) => k + 1); // 게임을 처음(타이틀)으로
  };

  const handleExit = () => {
    console.log('[game-a] 메인으로 돌아가기 요청 (단독 실행 중이라 실제 이동은 없음)');
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <BlackCombatGame key={gameKey} onFinish={handleFinish} onExit={handleExit} />

      {lastResult && (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <b>메인 게임에 전달될 데이터</b>
            <button
              type="button"
              onClick={() => setLastResult(null)}
              style={{ background: 'none', border: 'none', color: '#e9e4ff', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify({ gameId: lastResult.gameId, scores: lastResult.scores }, null, 2)}
          </pre>
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
