// =============================================================
//  블랙컴뱃 설정값 모음
//  게임 밸런스나 조작 키를 바꾸고 싶으면 이 파일만 수정하면 됩니다.
// =============================================================

export const GAME_ID = 'game-a';
export const GAME_TITLE = '블랙컴뱃';
export const GAME_TITLE_EN = 'BLACK COMBAT';

// 경기 규칙
export const MATCH = {
  roundSeconds: 60,     // 1라운드 시간
  maxHp: 150,           // 체력
  introSeconds: 2.2,    // "ROUND 1" → "FIGHT!" 연출 시간
  koBannerSeconds: 3,   // K.O. 후 결과 화면까지
  timeUpBannerSeconds: 2.6, // TIME UP 후 결과 화면까지
};

// 플레이어 정보 (ID는 메인 게임과 맞추기 위해 p1, p2로 고정)
//   color      : 트렁크, 헤드밴드, 손목 테이프, 코너 색
//   skin       : 피부색 / skinShade: 그늘진 쪽 피부색
//   hair       : 머리색 / hairStyle: 'spiky'(삐죽 머리) | 'short'(짧은 머리)
export const PLAYERS = [
  {
    id: 'p1',
    label: 'P1',
    name: '레드',
    side: 'left',        // 웹캠 화면 왼쪽에 서는 플레이어
    color: '#FF3B5C',
    colorDeep: '#B5162F',
    skin: '#F2C6A2',
    skinShade: '#D9A47E',
    hair: '#1B1B22',
    hairStyle: 'spiky',
  },
  {
    id: 'p2',
    label: 'P2',
    name: '블루',
    side: 'right',       // 웹캠 화면 오른쪽에 서는 플레이어
    color: '#3FB6FF',
    colorDeep: '#0B6FB8',
    skin: '#C98E66',
    skinShade: '#A8704B',
    hair: '#4A2E1C',
    hairStyle: 'short',
  },
];

// 관중 분위기
export const CROWD = {
  baseHype: 0.35,        // 경기 중 기본 열기 (0 ~ 1)
  hitHype: 0.12,         // 타격이 들어갈 때마다 오르는 열기
  hypeDecay: 0.18,       // 초당 식는 정도
  cheers: ['와아!', '나이스!', '한 방 더!', '가자!', '좋아!', '오오!', '대박!'],
};

// 소리 (브라우저에서 직접 합성, 파일 없음)
export const SOUND = {
  enabled: true,  // 처음 시작할 때 소리 켜짐 여부 (경기 화면 오른쪽 아래 버튼으로 끄고 켤 수 있음)
  volume: 0.8,
};

// 링 (화면 기준 1280×720)
export const ARENA = {
  width: 1280,
  height: 720,
  floorY: 615,      // 선수가 서 있는 바닥 높이
  leftBound: 150,   // 왼쪽 로프
  rightBound: 1130, // 오른쪽 로프
  startX: { p1: 440, p2: 840 },
};

// 선수 기본 능력
export const FIGHTER = {
  walkSpeed: 270,        // 이동 속도 (px/초)
  guardWalkSpeed: 90,    // 가드하며 이동할 때
  bodyHalfWidth: 60,     // 몸 폭의 절반 (서로 겹치지 않게)
  staminaMax: 100,
  staminaRegen: 30,      // 초당 회복
  staminaRegenGuard: 6,  // 가드 중 초당 회복
  powerMax: 100,         // 필살기 게이지
};

// 공격 종류
//   startup  : 공격 시작 → 맞힐 수 있게 되기까지 (초)
//   active   : 맞힐 수 있는 시간
//   recovery : 공격 후 다시 움직일 수 있을 때까지
//   reach    : 두 선수 중심 사이 거리가 이 값 이하면 명중
//   hitstun  : 맞은 선수가 못 움직이는 시간
//   guardCost: 상대가 가드로 막을 때 상대 스태미나 소모량
export const ATTACKS = {
  punch: {
    label: '펀치',
    startup: 0.07, active: 0.09, recovery: 0.16,
    reach: 160, damage: 6, stamina: 8,
    knockback: 70, hitstun: 0.26, power: 10, guardCost: 11, shake: 3,
  },
  kick: {
    label: '킥',
    startup: 0.17, active: 0.11, recovery: 0.3,
    reach: 185, damage: 11, stamina: 18,
    knockback: 170, hitstun: 0.42, power: 14, guardCost: 24, shake: 7,
  },
  special: {
    label: '필살기',
    startup: 0.28, active: 0.16, recovery: 0.5,
    reach: 205, damage: 22, stamina: 0,
    knockback: 360, hitstun: 0.8, power: 0, guardCost: 60, shake: 15,
  },
};

// 가드
export const GUARD = {
  damageFactor: 0.15,     // 막으면 데미지가 이 비율로 줄어듦
  knockbackFactor: 0.4,
  blockStun: 0.14,        // 막은 직후 잠깐 경직
  breakStun: 0.8,         // 스태미나가 바닥나 가드가 깨지면 경직
};

// 필살기 게이지 충전량
export const POWER = {
  onTaken: 8,    // 맞았을 때 (역전 기회)
  onBlocked: 4,  // 막았을 때
};

// 점수 (메인 게임에 전달)
export const SCORE = {
  winner: 100,    // 승자 점수
  loserMax: 80,   // 패자 최대 점수 (상대에게 준 데미지 비율)
};

// 키보드 조작 (KeyboardEvent.code 기준, 한/영 상태와 무관)
// 한 동작에 키를 여러 개 지정할 수 있습니다.
export const KEY_BINDINGS = {
  p1: {
    left: ['KeyA'],
    right: ['KeyD'],
    guard: ['KeyS'],
    punch: ['KeyF'],
    kick: ['KeyG'],
    special: ['KeyW'],
  },
  p2: {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    guard: ['ArrowDown'],
    punch: ['Period', 'Numpad1'],
    kick: ['Slash', 'Numpad2'],
    special: ['ArrowUp'],
  },
};

// 화면에 보여줄 키 이름
export const KEY_LABELS = {
  KeyA: 'A',
  KeyD: 'D',
  KeyS: 'S',
  KeyF: 'F',
  KeyG: 'G',
  KeyW: 'W',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowDown: '↓',
  ArrowUp: '↑',
  Period: '.',
  Slash: '/',
  Numpad1: '숫자1',
  Numpad2: '숫자2',
};

// 타이틀 화면에서 게임을 시작하는 키
export const START_KEYS = ['Space', 'Enter'];
