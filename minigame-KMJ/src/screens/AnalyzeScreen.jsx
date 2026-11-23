// 올린 노래를 분석하는 동안 보여주는 화면
import Backdrop from './Backdrop.jsx';
import SongScope from './SongScope.jsx';

const STEPS = [
  { id: 'decode', label: '음원 읽기' },
  { id: 'beats', label: '박자 추적' },
  { id: 'ai', label: 'AI 음악 분석' },
  { id: 'chart', label: '채보 생성' },
];

// 분석 중 들어오는 소식을 화면 상태에 반영
export function applyAnalysisEvent(analysis, event) {
  const viz = analysis.viz ?? {};
  switch (event.type) {
    case 'wave':
      return { ...analysis, viz: { ...viz, peaks: event.peaks, duration: event.duration } };
    case 'beats':
      return { ...analysis, viz: { ...viz, beats: event.beats, bpm: event.bpm } };
    case 'window':
      return { ...analysis, viz: { ...viz, windows: [...(viz.windows ?? []), event.window] } };
    default:
      return { ...analysis, progress: event };
  }
}

function aiDetail(detail) {
  if (!detail) return null;
  if (detail.phase === 'download') {
    const mb = (n) => (n / 1024 / 1024).toFixed(0);
    return `모델 받는 중 ${mb(detail.loaded)} / ${mb(detail.total)}MB`;
  }
  if (detail.phase === 'load') return '모델 준비 중';
  return null;
}

export default function AnalyzeScreen({ fileName, progress, viz, result, error, onStart, onCancel }) {
  const current = result ? STEPS.length : STEPS.findIndex((s) => s.id === progress.step);
  const meta = result?.song.meta;
  const highlight = meta ? { start: meta.segStart, length: meta.length } : null;

  return (
    <div className="kmj-screen">
      <Backdrop />
      <div className="kmj-screen-inner kmj-analyze">
        <div className="kmj-eyebrow">AI CHART MAKER</div>
        <h1 className="kmj-logo kmj-logo-small kmj-song-name">{fileName}</h1>

        <SongScope viz={viz} highlight={highlight} done={!!result || !!error} />

        <ol className="kmj-steps">
          {STEPS.map((s, i) => {
            const state = i < current ? 'done' : i === current ? 'active' : 'wait';
            const ratio = state === 'done' ? 1 : state === 'active' ? progress.ratio ?? 0 : 0;
            const detail = s.id === 'ai' && state === 'active' ? aiDetail(progress.detail) : null;
            return (
              <li key={s.id} className={`kmj-step is-${state}`}>
                <span className="kmj-step-label">{s.label}</span>
                <span className="kmj-step-bar">
                  <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                </span>
                {detail && <span className="kmj-step-detail">{detail}</span>}
              </li>
            );
          })}
        </ol>

        {result && (
          <div className="kmj-song-card">
            <div className="kmj-song-stats">
              <div>
                <b>{Math.round(result.song.bpm)}</b>
                <span>BPM</span>
              </div>
              <div>
                <b>{result.song.notes.length}</b>
                <span>NOTES</span>
              </div>
              <div>
                <b>{Math.round(meta.length)}s</b>
                <span>HIGHLIGHT</span>
              </div>
            </div>
            {meta.genres.length > 0 && (
              <div className="kmj-genres">
                {meta.genres.map((g) => (
                  <span key={g.label}>{g.label}</span>
                ))}
              </div>
            )}
            {result.aiError && <div className="kmj-note">AI 분석 없이 박자만으로 만들었어요</div>}
          </div>
        )}

        {error && <div className="kmj-note">{error}</div>}

        <div className="kmj-btn-row">
          {result && (
            <button className="kmj-btn kmj-btn-primary" onClick={onStart}>
              전투 개시
            </button>
          )}
          <button className="kmj-btn" onClick={onCancel}>
            {result || error ? '돌아가기' : '취소'}
          </button>
        </div>
      </div>
    </div>
  );
}
