// =============================================================
// 음성 퀴즈 — 화면 쪽 설정. 규칙 숫자(시간·점수)는 서버가 정해 보내 준다(ctx.options).
// =============================================================

export const SCREEN = {
  ART_W: 320, // 픽셀 아트 기준 해상도 (16:9)
  ART_H: 180,
  UI_W: 640, // UI(글자) 레이어는 아트의 2배 해상도 — 한글 가독성을 위해
  UI_H: 360,
};

/** 서버 값이 오기 전에 쓰는 기본값 (server/party/games/quiz/config.py 와 같다) */
export const DEFAULT_RULES = {
  QUESTION_COUNT: 10,
  QUESTION_TIME: 45,
  HINT_CHOSUNG_AT: 10,
  HINT_FIRST_AT: 20,
  ANSWER_TIME: 10,
  VOICE_ATTEMPTS: 2,
  MAX_VOICE_SECONDS: 8,
};

export const KEYS = {
  BUZZ: ['Space'],
  MUTE: ['KeyM'],
};

/** 마이크 녹음 — 말이 시작되면 녹음하고, 말이 끝나면(조용해지면) 서버로 보낸다 */
export const MIC = {
  SAMPLE_RATE: 16000,
  START_LEVEL: 0.02,     // 이보다 큰 소리가 나면 말하기 시작으로 본다 (0~1)
  STOP_LEVEL: 0.012,     // 이보다 작으면 조용한 것으로 본다
  SILENCE_MS: 650,       // 이만큼 조용하면 말이 끝난 것으로 본다
  PRE_ROLL_MS: 250,      // 말 시작 직전 소리도 조금 포함한다(첫 음절이 잘리지 않게)
  MIN_SPEECH_MS: 200,    // 이보다 짧은 소리는 잡음으로 보고 버린다
  MAX_MS: 5000,          // 한 번에 보내는 최대 길이
};

export const AUDIO = {
  MASTER: 0.8,
  MUSIC: 0.45,
  SFX: 0.8,
  DUCK_LEVEL: 0.25, // 답변 중에는 배경음을 줄여 마이크 간섭을 줄인다
  DUCK_TIME: 0.25,
  BPM_TITLE: 132,
  BPM_PLAY: 148,
};

export const FX = {
  HIT_STOP_MS: 90, // 버저 순간 화면 정지
  SHAKE_BUZZ: 2,
  SHAKE_WRONG: 3,
  SHAKE_DECAY: 0.86,
  ANIM_FPS: 10,
};
