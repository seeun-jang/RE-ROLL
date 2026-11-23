// =====================================================
// 잭팟 홈런 더비 — 한 명씩 타석에 서서 같은 공을 쳐서 점수 대결 (설정은 여기서만)
//  화면: 포수 뒤 중계 구도 (멀리 딜러 투수, 앞에 타자 뒷모습, 가운데 스트라이크 존)
//  ← → = 배트(노란 막대) 옮기기 · 가운데 = 스윙
//  공이 지나갈 줄에 배트를 맞추고, 홈 플레이트에 올 때 딱! → 멀리 · 일찍 치면 왼쪽, 늦으면 오른쪽
//  볼(존 밖)은 안 치면 기회가 안 줄어듦 / 잭팟 볼(금색)은 점수 2배
//  모든 타자가 똑같은 순서의 공을 받음 → 개인 화면 점수끼리도 비교 가능
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  CHANCES: 8,               // 타자 한 명이 칠 수 있는 기회 (볼을 골라내면 안 줄어듦)
  GOLD_AT: 5,               // 몇 번째 기회의 공이 잭팟 볼인지 (0부터)
  GOLD_MULT: 2,

  // 중계 화면 투영 (포수 뒤 카메라): 단위 m
  CAM_H: 1.4,               // 카메라 높이
  CAM_BACK: 3,              // 홈 플레이트 뒤로 떨어진 거리
  FOCAL: 300,               // 클수록 크게 보임
  HORIZON: 60,              // 화면 지평선 y
  MOUND: 18.4,              // 투수판 거리
  ZONE: { HALF_W: 0.215, LOW: 0.5, HIGH: 1.1 }, // 스트라이크 존

  // 배트 (노란 막대)
  BAT_SPEED: 2.4,           // 한 프레임에 움직이는 px
  BAT_RANGE: 34,            // 가운데에서 좌우로 갈 수 있는 px
  SWING_TIME: 16,           // 스윙 동작 길이
  HIT_DX: 14,               // 배트와 공이 이 px 안이면 맞음 (넓힘)
  HIT_DT: 11,               // 타이밍이 이 프레임 안이면 맞음 (넓힘)

  // 투구
  WINDUP: 70,               // 와인드업 (공 나오기 전)
  AFTER: 40,                // 공이 지나간 뒤 다음 공까지 쉬는 시간

  // 타구 (단순한 포물선 + 공기 저항 비율)
  GRAV: 9.8,
  DRAG: 0.62,
  EXIT_MIN: 26,             // 빗맞으면 m/s
  EXIT_MAX: 53,             // 정타 m/s
  FENCE_LINE: 98,           // 좌우 펜스 m
  FENCE_CENTER: 122,        // 가운데 펜스 m
  FIELDER_RUN: 5.6,         // 외야수 달리기 m/s
  FLIGHT_SPEED: 2.2,        // 타구 화면 빨리감기 배율

  // 점수
  POINTS: { single: 10, double: 20, triple: 30 }, // 홈런 = 비거리(m)

  INTRO_TIME: 90,           // 타자 소개
  RESULT_TIME: 80,          // 타구 결과 글자

  // CPU (자동 시연 · 개인 화면에서 기록 비교용)
  CPU_SKILL: [0.4, 0.85],

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개: ← → = 배트 옮기기, 가운데 = 스윙
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', keys: ['Q', 'W', 'E'] },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', keys: ['R', 'T', 'Y'] },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', keys: ['U', 'I', 'O'] },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', keys: ['Z', 'X', 'C'] },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', keys: ['<', '^', '>'] },
];

// 개인 화면: ← → + Space / ↑
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: [],
  skill: ['Space', 'Enter', 'ArrowUp', 'KeyW'],
};
