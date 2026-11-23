// 프론트엔드 숫자 상수 모음. 시간 단위는 초, 음량 단위는 dBFS.

// ── 디버그 모드 ─────────────────────────────────────────
// DEBUG_FORCE를 true로 바꾸면 항상 켜진다. 기본은 꺼짐.
// 개발 서버에서는 ?debug, 빌드에서도 ?debug=1 로 켤 수 있다.
export const DEBUG_FORCE = false;
const _qs = typeof location !== 'undefined'
  ? new URLSearchParams(location.search)
  : new URLSearchParams('');
const _dev = !!(import.meta.env && import.meta.env.DEV);
export const DEBUG = DEBUG_FORCE || (_dev && _qs.has('debug')) || _qs.get('debug') === '1';

// ── 화면 ────────────────────────────────────────────────
export const VW = 320; // 내부 가상 해상도 가로
export const VH = 180; // 내부 가상 해상도 세로
export const TILE = 16; // 타일 크기 (11줄 = 176px + 아래 4px 띠)
export const MIN_SCALE_OK = 2; // 배율이 이보다 작으면 '창을 더 크게' 경고

// ── 플레이어 ────────────────────────────────────────────
export const PLAYER_MIN = 1;
export const PLAYER_MAX = 6;
export const PLAYER_DEFAULT = 2;
export const NAME_MAX = 4; // 이름 최대 글자 수

// ── 난이도 ──────────────────────────────────────────────
export const DIFFICULTIES = ['easy', 'normal', 'hard'];
export const DIFFICULTY_DEFAULT = 'normal';

// ── 차례 진행 시간 ──────────────────────────────────────
export const TIMING = {
  turnIntro: 1.6,       // 차례 안내 배너 시간 (안내음 포함)
  orderReveal: 2.5,     // 첫 차례 전 순서 공개 시간
  promptRepeats: 2,     // 원본 재생 횟수
  promptGap: 1.0,       // 원본 재생 사이 간격
  preCountdownGap: 0.5, // 원본 재생 후 카운트다운 전 무음
  countdownBeeps: 3,    // 3-2-1
  beepInterval: 0.8,    // 비프 시작 간격
  beepLen: 0.12,        // 비프 길이
  beepToRec: 0.2,       // 마지막 비프 끝 ~ 녹음 시작 (여기에 출력 장치 지연을 더한다)
  latencyMax: 0.4,      // 출력 지연 보정 상한(초)
  recExtra: 1.5,        // 녹음 길이 = 원본 길이 + recExtra
  recEndSfx: 0.4,       // 녹음 종료음 길이
  revealSec: 4.0,       // 점수 공개 시간
  noSoundMsg: 1.6,      // '소리가 감지되지 않았어요' 표시 시간
  retries: 1,           // 무음 재녹음 횟수
  countUpSec: 1.2,      // 점수 카운트업 시간
  scoreRetries: 1,      // 네트워크 오류 자동 재전송 횟수
  scoreErrorMsg: 1.2,   // 채점 오류 안내 표시 시간
};

// ── 소리 감지(VAD)·소음 측정 ────────────────────────────
export const VAD = { marginDb: 10, holdSec: 0.3, minFloorDb: -60 };
export const NOISE = { measureSec: 2.0, warnDb: -45 };
// 마이크 테스트 입력 크기 경고 (holdSec 이상 이어질 때 표시)
export const LEVEL_WARN = { quietDb: -45, loudDb: -3, holdSec: 1.0 };

// ── 오디오 볼륨 ─────────────────────────────────────────
export const AUDIO = { fadeOut: 0.3, fadeIn: 0.5, sfxDb: -6, bgmDb: -12, promptDb: 0 };
export const VOLUME_DEFAULTS = { master: 0.8, bgm: 0.6, sfx: 0.8, prompt: 1.0 };
export const AUDIO_STATES = {
  TITLE: { bgm: 'title' }, SETUP: { bgm: 'title' }, MIC_TEST: { bgm: null }, ORDER: { bgm: 'title' },
  TURN_INTRO: { bgm: null }, WAIT_READY: { bgm: null }, PROMPT_PLAY: { bgm: null }, COUNTDOWN: { bgm: null },
  RECORDING: { bgm: null }, ANALYZING: { bgm: null }, RESULT: { bgm: 'result' }, FINAL: { bgm: 'result' },
};

// getUserMedia 오디오 옵션 (deviceId는 MicManager가 붙인다)
export const MIC_CONSTRAINTS = {
  echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
};

// ── 채점·결과 ───────────────────────────────────────────
export const GRADES = [['S', 90], ['A', 75], ['B', 60], ['C', 0]];
export const SOLO_CLEAR = 70; // 1인 클리어 기준
export const HAPPY_SCORE = 75; // 이 점수 이상이면 기쁨 리액션
export const API_BASE = '';
export const STORAGE_KEY = 'sori-best-v1';

// ── 레벨 미터 ───────────────────────────────────────────
export const METER = { cells: 10, cellW: 4, cellH: 6, gap: 1, minDb: -60, maxDb: 0, okDb: -30, hotDb: -6 };

// ── 루프·애니메이션 ─────────────────────────────────────
export const ANIM_FPS = 10;       // 스프라이트 애니메이션 속도
export const LOGIC_HZ = 60;       // 고정 스텝 로직 주기
export const MAX_STEPS_PER_FRAME = 5; // 한 프레임에 따라잡을 최대 스텝 수
export const TRANSITION_SEC = 0.45;
export const SHAKE = { intensity: 2, sec: 0.25 };
export const HITSTOP_FRAMES = 3;
export const PARTICLE_MAX = 600;

// ── UI ──────────────────────────────────────────────────
export const CURSOR_BLINK = 0.5;  // ▶ 커서 깜빡임 반주기
export const PRESS_SEC = 0.12;    // 버튼 눌림 표시 시간
export const TEXT_CACHE_MAX = 500; // 텍스트 비트맵 캐시 최대 개수
export const FONT = {
  body: { css: '12px Galmuri11', family: 'Galmuri11', size: 12, lineH: 12 },
  small: { css: '10px Galmuri9', family: 'Galmuri9', size: 10, lineH: 10 },
};
export const TEXT_ALPHA_THRESHOLD = 128; // 글자 알파 이진화 기준
