// 시작 화면: 격투게임 캐릭터 선택창처럼 양쪽에서 영웅이 들어오고 가운데 VS
import { useRef } from 'react';
import { GAME_TITLE, GAME_SUBTITLE, PLAYER_INFO, LANE_COLORS, NAME_MAX } from '../game/config.js';
import Backdrop from './Backdrop.jsx';
import HeroPortrait from './HeroPortrait.jsx';

function Side({ id, name, onName }) {
  const info = PLAYER_INFO[id];
  const ready = name.trim().length > 0;
  return (
    <div className={`kmj-side is-${id} ${ready ? 'is-ready' : ''}`} style={{ '--kmj-accent': info.color }}>
      <div className="kmj-side-panel" />
      <HeroPortrait
        id={id}
        mood={ready ? 'victory' : 'ready'}
        facing={id === 'p1' ? 1 : -1}
        size={480}
        className="kmj-side-hero"
      />
      <div className="kmj-plate">
        <span className="kmj-plate-tag">{info.label}</span>
        <input
          className="kmj-name-input"
          value={name}
          maxLength={NAME_MAX}
          placeholder="이름"
          spellCheck={false}
          onChange={(e) => onName(id, e.target.value)}
        />
        <div className="kmj-keys">
          {info.keyLabels.map((key, lane) => (
            <kbd key={key} style={{ '--kmj-lane': LANE_COLORS[lane] }}>
              {key}
            </kbd>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TitleScreen({ onStart, onPickFile, songTitle, onResetSong, names, onName }) {
  const inputRef = useRef(null);

  return (
    <div className="kmj-screen kmj-select">
      <Backdrop />
      <Side id="p1" name={names.p1} onName={onName} />
      <Side id="p2" name={names.p2} onName={onName} />

      <div className="kmj-select-top">
        <div className="kmj-eyebrow">{GAME_SUBTITLE}</div>
        <h1 className="kmj-logo">{GAME_TITLE}</h1>
      </div>

      <div className="kmj-vs-wrap">
        <svg className="kmj-bolt" viewBox="0 0 40 300" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="22,0 12,70 26,110 10,170 28,220 16,300" />
        </svg>
        <div className="kmj-vs">VS</div>
      </div>

      <div className="kmj-select-bottom">
        <div className="kmj-song-pick">
          {songTitle ? (
            <>
              <span className="kmj-song-chip">♪ {songTitle}</span>
              <button className="kmj-link" onClick={onResetSong}>
                기본 곡
              </button>
            </>
          ) : (
            <span className="kmj-song-hint">노래 파일을 끌어다 놓으면 AI가 채보를 만들어요</span>
          )}
        </div>
        <div className="kmj-btn-row">
          <button className="kmj-btn kmj-btn-primary" onClick={onStart}>
            전투 개시
          </button>
          <button className="kmj-btn" onClick={() => inputRef.current?.click()}>
            노래 불러오기
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPickFile(file);
        }}
      />
    </div>
  );
}
