// 혼자 테스트할 때만 쓰는 시작 파일입니다 (npm run dev).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TroyRhythmGame } from './index.js';
import './dev.css';

function DevApp() {
  const [lastResult, setLastResult] = useState(null);
  const [exited, setExited] = useState(false);

  return (
    <div className="kmj-dev">
      {exited ? (
        <div className="kmj-dev-exit">
          <p>메인 보드로 돌아갔어요 (onExit 호출됨)</p>
          <button className="kmj-btn kmj-btn-primary" onClick={() => setExited(false)}>
            미니게임 다시 열기
          </button>
        </div>
      ) : (
        <TroyRhythmGame onFinish={setLastResult} onExit={() => setExited(true)} />
      )}
      <details className="kmj-dev-panel" open={!!lastResult}>
        <summary>메인으로 전달되는 결과 (onFinish)</summary>
        <pre>{lastResult ? JSON.stringify(lastResult, null, 2) : '아직 결과 없음'}</pre>
      </details>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DevApp />
  </StrictMode>,
);
