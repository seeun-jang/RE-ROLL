// =====================================================
// 마법진 그리기 — 숫자 모음 (원본 js/config.js 값 그대로, 시간은 초 단위)
// 같은 값이 server/party/games/sigil/config.py 에 있다(테스트가 비교한다).
// 실제 게임에서는 서버가 시작할 때 보내 주는 값(options)을 쓴다.
// =====================================================
export const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 화면 로직 60 FPS 고정

  CANVAS: 120,            // 종이 크기 120x120 픽셀 (모양은 60 기준 좌표를 2배로)
  BRUSH: 2,               // 펜 굵기

  // 라운드: 난이도 묶음에서 마법진을 뽑고, 저주 슬롯머신이 저주 하나를 뽑음
  ROUNDS: [
    { tier: 'easy', twists: ['none'], mult: 1 },                               // 1. 연습 마법
    { tier: 'mid', twists: ['mirror', 'ghost', 'shake', 'speed'], mult: 1 },     // 2. 저주 라운드
    { tier: 'hard', twists: ['memory', 'mirror', 'ghost', 'shake'], mult: 2 },   // 3. 잭팟 라운드 (점수 2배)
  ],
  // 저주 종류
  TWISTS: {
    none: { name: '정직한 마법', desc: '흐릿한 선을 따라 그리기', color: 'e' },
    memory: { name: '기억 마법', desc: '3초 뒤 안내선이 사라짐!', color: '5' },
    mirror: { name: '거울 저주', desc: '펜이 좌우 반대로 움직임!', color: 'h' },
    ghost: { name: '투명 잉크', desc: '내가 그린 선이 안 보임!', color: 'k' },
    shake: { name: '흔들 종이', desc: '종이가 이리저리 흔들림!', color: '8' },
    speed: { name: '번개 마법', desc: '단 5초! 빨리 보너스 2배', color: '9' },
  },
  DRAW_TIME: 10,          // 그리기 시간 10초
  SPEED_TIME: 5,          // 번개 마법: 5초
  MEMORY_TIME: 3,         // 기억 마법: 처음 3초만 안내선을 보여 줌
  SHAKE: { X: 7, Y: 6 },  // 흔들 종이 흔들림 크기 (픽셀)

  // 채점: 정확도 = 100 × 덮기 × (0.4 + 0.6 × 깔끔)
  //  일찍 끝내면 남은 초 × 2 (최대 +16, 번개 마법은 ×4) 보너스 — 정확도 50 이상일 때만
  //  라운드 점수 = (정확도 + 보너스) × 배수 (잭팟 라운드 2배)
  SCORE: {
    COVER_RADIUS: 3,
    NEAT_RADIUS: 3,
    TIME_BONUS: 2,
    BONUS_MAX: 16,
    SUCCESS: 80,          // 이 이상이면 마법 발동!
    OKAY: 50,             // 이 이상이면 그럭저럭, 아래는 펑!
  },

  // 진행 시간(초)
  FLOW: {
    INTRO_TIME: 3,
    SLOT_TIME: 170 / 60,
    READY_TIME: 1.5,
    DONE_LOCK: 20 / 60,
    INK_GRACE: 0.35,
    SCORE_TIME: 100 / 60,
    GALLERY_TIME: 8,
    FINAL_TIME: 9,
    STATE_HZ: 5,
  },
  LIMITS: { PACKET_POINTS: 400, ROUND_POINTS: 8000 },
  SAY_GAP: 3,
};

/** 조작 설명 한 줄 (대기실에 보인다) */
export const HOW_TO = '마우스 왼쪽 버튼을 누른 채 마법진을 따라 그리기 (터치 가능) · 다 그리면 Space/Enter/오른쪽 클릭/완료 버튼 · M: 소리 끄기/켜기';
