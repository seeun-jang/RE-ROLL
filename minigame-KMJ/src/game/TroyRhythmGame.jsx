// 미니게임 전체 컴포넌트 (메인 보드게임은 이 컴포넌트만 불러오면 됩니다)
//
// props
//   onFinish(result)  게임이 끝나면 호출. result = { gameId, scores: [{ playerId, score }] }
//   onExit()          결과 화면에서 "메인으로"를 누르면 호출
//   inputType         'keyboard'(기본) | 'motion'
//   playerNames       { p1, p2 } 처음 이름 칸에 채워둘 값 (선택)
import { useCallback, useEffect, useRef, useState } from 'react';
import GameCanvas from './GameCanvas.jsx';
import TitleScreen from '../screens/TitleScreen.jsx';
import ResultScreen from '../screens/ResultScreen.jsx';
import AnalyzeScreen, { applyAnalysisEvent } from '../screens/AnalyzeScreen.jsx';
import { buildSong } from './song.js';
import { analyzeSongFile } from '../ai/analyzeSong.js';
import { buildResult, buildStats } from './result.js';
import { unlockAudio, setMuted, isMuted } from './audio.js';
import { PLAYER_IDS, PLAYER_INFO } from './config.js';

const DEFAULT_SONG = buildSong();

import '../styles.css';

export default function TroyRhythmGame({ onFinish, onExit, inputType = 'keyboard', playerNames }) {
  const [screen, setScreen] = useState('title'); // title | analyze | playing | result
  const [round, setRound] = useState(0);
  const [summary, setSummary] = useState(null);
  const [muted, setMutedState] = useState(isMuted());
  const [song, setSong] = useState(DEFAULT_SONG);
  const [names, setNames] = useState(() => ({ p1: playerNames?.p1 ?? '', p2: playerNames?.p2 ?? '' }));
  // 비워두면 P1 / P2
  const shownNames = Object.fromEntries(PLAYER_IDS.map((id) => [id, names[id].trim() || PLAYER_INFO[id].label]));

  const changeName = useCallback((id, value) => setNames((prev) => ({ ...prev, [id]: value })), []);
  const [analysis, setAnalysis] = useState(null); // { fileName, progress, result, error }
  const jobRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // 노래 파일 → AI 채보 만들기
  const pickFile = useCallback((file) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) return;
    jobRef.current?.cancel();
    const job = analyzeSongFile(file, (event) => {
      if (jobRef.current === job) setAnalysis((a) => applyAnalysisEvent(a, event));
    });
    jobRef.current = job;
    setAnalysis({ fileName: file.name.replace(/\.[^.]+$/, ''), progress: { step: 'decode', ratio: 0 }, viz: {}, result: null, error: null });
    setScreen('analyze');
    job.promise.then(
      (result) => jobRef.current === job && setAnalysis((a) => ({ ...a, result })),
      (err) =>
        jobRef.current === job &&
        setAnalysis((a) => ({ ...a, error: `이 파일은 분석하지 못했어요. ${err.message}` })),
    );
  }, []);

  const closeAnalysis = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
    setAnalysis(null);
    setScreen('title');
  }, []);

  const start = useCallback(() => {
    unlockAudio();
    jobRef.current = null;
    setRound((r) => r + 1);
    setScreen('playing');
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const handleEnd = useCallback(
    (state) => {
      const result = buildResult(state);
      setSummary({ result, stats: buildStats(state) });
      setScreen('result');
      onFinish?.(result);
    },
    [onFinish],
  );

  useEffect(() => {
    const onKey = (e) => {
      // 이름을 입력하는 중에는 Enter(시작)만 받음
      if (e.target instanceof HTMLInputElement && e.code !== 'Enter') return;
      if (e.code === 'KeyM') toggleMute();
      if (screen === 'title' && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, start, toggleMute]);

  return (
    <div className="kmj-root">
      <div
        className={`kmj-stage ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          if (screen !== 'title' && screen !== 'analyze') return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && (screen === 'title' || screen === 'analyze')) pickFile(file);
        }}
      >
        {screen === 'title' && (
          <TitleScreen
            onStart={start}
            onPickFile={pickFile}
            songTitle={song === DEFAULT_SONG ? null : song.title}
            onResetSong={() => setSong(DEFAULT_SONG)}
            names={names}
            onName={changeName}
          />
        )}
        {screen === 'analyze' && analysis && (
          <AnalyzeScreen
            {...analysis}
            onCancel={closeAnalysis}
            onStart={() => {
              setSong(analysis.result.song);
              setAnalysis(null);
              start();
            }}
          />
        )}
        {screen === 'playing' && <GameCanvas key={round} song={song} names={shownNames} inputType={inputType} onEnd={handleEnd} />}
        {screen === 'result' && summary && (
          <ResultScreen summary={summary} names={shownNames} onRetry={start} onExit={onExit} />
        )}
        <button className="kmj-mute" onClick={toggleMute} title="소리 켜기/끄기 (M)">
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}
