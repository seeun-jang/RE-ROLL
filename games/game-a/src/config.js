// =============================================================
//  PFC 설정값 모음
//  마법사 교수(원거리 마법) vs student(근접 격투) — 서로 다른 방식으로 이기는 비대칭 대결
//  밸런스, 시간, 키 배치, 캐릭터 색은 이 파일만 고치면 됩니다.
// =============================================================

export const GAME_ID = 'game-a';
export const GAME_TITLE = 'PFC';
export const GAME_TITLE_EN = 'PFC';
export const GAME_SUBTITLE = 'Polytech Fighting Championship';

// ---------------- 경기 규칙 ----------------
export const MATCH = {
  roundsToWin: 2,         // 3판 2선승
  maxRounds: 3,           // 3라운드까지 해도 동점이면 무승부
  roundSeconds: 50,
  introSeconds: 2.8,
  roundEndSeconds: 3.0,   // K.O./TIME 연출
  matchEndSeconds: 3.6,   // 최종 승자 연출 후 결과 화면
};

// ---------------- 선수 ----------------
//  resource: 기술에 쓰는 자원 (교수 = 마나, student = 스태미나)
export const PLAYERS = [
  {
    id: 'p1',
    label: 'P1',
    name: 'student',
    title: '발톱의 격투가',
    style: '근접 돌격형',
    kind: 'tiger',
    side: 'left',
    color: '#FF4B4B',
    glow: '#FF9A3D',
    height: 1.0,
    bulk: 1.0,
    walkSpeed: 270,
    resource: { name: '스태미나', short: 'STA', max: 100, regen: 30, color: '#4EE0A6' },
    palette: {
      fur: '#F28A2E', furLight: '#FFB765', furDark: '#B85A14',
      white: '#FFF4E6', whiteDark: '#E3CDB6',
      stripe: '#2A1610',
      trunks: '#D8172E', trunksDark: '#8E0B1C', trim: '#F5C542',
      band: '#D8172E',
      eye: '#E8F25A',
    },
  },
  {
    id: 'p2',
    label: 'P2',
    name: '황종철 교수',
    title: '대마법사',
    style: '원거리 마법형',
    kind: 'professor',
    side: 'right',
    color: '#8C6BFF',
    glow: '#A66BFF',
    height: 1.24,
    bulk: 1.18,
    walkSpeed: 215,
    resource: { name: '마나', short: 'MP', max: 100, regen: 22, color: '#6FB8FF' },
    palette: {
      skin: '#E7B48E', skinLight: '#F6D2B2', skinDark: '#B47E5C',
      beard: '#F2F0F7', beardDark: '#B9B5C8',
      pants: '#1C1A22', pantsLight: '#34303E', pantsDark: '#0A090D',
      sash: '#0E0D12', trim: '#8C6BFF',
      hat: '#17151D', hatLight: '#2E2A38',
      rune: '#B98CFF',
      eye: '#C7A4FF',
    },
  },
];

// ---------------- 무대 ----------------
export const STAGE = {
  width: 1280,
  height: 720,
  floorY: 560,
  left: 120,
  right: 1480,
  worldWidth: 1600,
  startX: { p1: 560, p2: 1040 },
  zoomNear: 1.15,
  zoomFar: 0.86,
};

// ---------------- 공통 ----------------
export const FIGHTER = {
  maxHp: 160,
  bodyRadius: 62,
  inputBuffer: 0.15,
  comboWindow: 0.42,
  closeRange: 165,        // 이 거리 안이면 "가까운 기술"로 바뀜
  superMax: 100,
  superPerDamageDealt: 0.55,
  superPerDamageTaken: 0.75,
  guardRegenFactor: 0.35, // 가드 중 자원 회복 비율
  knockdownSeconds: 0.75, // 큰 기술에 맞고 넘어져 있는 시간
  getupSeconds: 0.45,
  getupInvuln: 0.6,
};

export const GUARD = {
  chip: 0.2,          // 막아도 들어가는 데미지 비율
  blockStun: 0.16,
  breakStun: 0.9,     // 자원이 바닥나 방어가 깨짐
};

// ---------------- 기술 ----------------
//  공통 필드
//    startup / active / recovery : 시작 → 판정 → 회복 (초)
//    cost      : 자원 소모     damage, hitstun, knockback : 맞았을 때
//    guardCost : 막을 때 상대 자원 소모     heavy : 맞으면 넘어짐
//    reach     : (근접기) 명중 거리
//  student의 이동기
//    speed / travel : 이동 속도와 거리,  immune : 'projectile'(마법 통과) | 'all'(완전 무적)

export const TIGER_MOVES = {
  jab: {
    label: '잽', kind: 'melee', startup: 0.07, active: 0.07, recovery: 0.12,
    reach: 168, lunge: 90, damage: 5, hitstun: 0.24, knockback: 14, guardCost: 7, cost: 0,
  },
  cross: {
    label: '크로스', kind: 'melee', startup: 0.1, active: 0.08, recovery: 0.18,
    reach: 182, lunge: 170, damage: 8, hitstun: 0.32, knockback: 30, guardCost: 12, cost: 0,
  },
  claw: {
    label: '발톱 베기', kind: 'melee', startup: 0.14, active: 0.1, recovery: 0.3,
    reach: 180, lunge: 140, damage: 10, hitstun: 0.5, knockback: 70, guardCost: 18, cost: 8, heavy: true,
  },
  knee: {
    label: '니킥', kind: 'melee', startup: 0.1, active: 0.09, recovery: 0.24,
    reach: 158, lunge: 140, damage: 11, hitstun: 0.45, knockback: 40, guardCost: 16, cost: 14,
  },
  dash: {
    label: '타이거 대시', kind: 'dash', startup: 0.05, active: 0.3, recovery: 0.16,
    speed: 980, damage: 7, hitstun: 0.36, knockback: 60, guardCost: 14, cost: 20, immune: 'projectile',
    reach: 120,
  },
  pounce: {
    label: '도약 내려찍기', kind: 'pounce', startup: 0.14, active: 0.48, recovery: 0.3,
    travel: 380, jump: 150, damage: 15, hitstun: 0.5, knockback: 50, guardCost: 22, cost: 24,
    radius: 120, immune: 'projectile', heavy: true,
  },
  roar: {
    label: '포효', kind: 'roar', startup: 0.18, active: 0.16, recovery: 0.34,
    radius: 300, stunRadius: 190, stun: 0.7, damage: 3, cost: 22, superGain: 12,
  },
  roll: {
    label: '구르기', kind: 'roll', startup: 0.02, active: 0.34, recovery: 0.14,
    speed: 560, cost: 20, immune: 'all',
  },
  whiteTiger: {
    label: '백호 난무', kind: 'super', startup: 0.3, active: 0.55, recovery: 0.4,
    speed: 1150, reach: 150, damage: 42, hits: 6, hitstun: 1.0, knockback: 120, guardCost: 40, heavy: true,
    immune: 'all',
  },
};

export const PROFESSOR_MOVES = {
  missile: {
    label: '매직 미사일', kind: 'cast', startup: 0.12, active: 0.02, recovery: 0.2,
    cost: 8, projectile: { type: 'missile', speed: 840, radius: 16, height: 175, damage: 8, hitstun: 0.26, knockback: 18, guardCost: 7, life: 1.6 },
  },
  palm: {
    label: '장풍 밀치기', kind: 'melee', startup: 0.08, active: 0.07, recovery: 0.2,
    reach: 170, lunge: 60, damage: 5, hitstun: 0.26, knockback: 70, guardCost: 8, cost: 0,
  },
  fireball: {
    label: '파이어볼', kind: 'cast', startup: 0.3, active: 0.02, recovery: 0.34,
    cost: 24, projectile: { type: 'fireball', speed: 430, radius: 40, height: 120, damage: 17, hitstun: 0.55, knockback: 70, guardCost: 22, life: 3.2, heavy: true },
  },
  lightning: {
    label: '낙뢰', kind: 'lightning', startup: 0.26, active: 0.02, recovery: 0.32,
    cost: 28, delay: 0.75, width: 100, damage: 18, hitstun: 0.6, knockback: 20, guardCost: 24, heavy: true,
  },
  blink: {
    label: '블링크', kind: 'blink', startup: 0.08, active: 0.04, recovery: 0.24,
    cost: 20, distance: 340, invuln: 0.2,
  },
  blast: {
    label: '아케인 폭발', kind: 'blast', startup: 0.12, active: 0.1, recovery: 0.36,
    cost: 22, radius: 185, damage: 6, hitstun: 0.4, knockback: 520, guardCost: 10,
  },
  backstep: {
    label: '백스텝', kind: 'roll', startup: 0.02, active: 0.26, recovery: 0.12,
    speed: 430, cost: 9, immune: 'all', back: true,
  },
  meteor: {
    label: '메테오', kind: 'super', startup: 0.5, active: 0.05, recovery: 0.5,
    delay: 1.05, radius: 160, damage: 38, hitstun: 0.9, knockback: 140, guardCost: 40, heavy: true,
    shards: 2, shardDamage: 8, shardRadius: 80,
  },
};

export const MAX_MISSILES = 3; // 동시에 날아갈 수 있는 미사일 수

// ---------------- 메인 게임에 전달할 점수 ----------------
//  점수 = 준 데미지 + 명중 수 + 이긴 라운드×25 + 최종 승리 +30
//  승자 점수는 항상 패자보다 높음 / 무승부는 같은 점수
export const RESULT_SCORE = { damage: 1, landed: 1, roundWin: 25, matchWin: 30 };

export const CROWD = { baseHype: 0.3, hypeDecay: 0.16 };
export const SOUND = { enabled: true, volume: 0.7 };

// ---------------- 키보드 조작 ----------------
//  공격 / 기술 버튼은 거리와 방향키에 따라 바뀝니다 (조작법 화면 참고)
//  궁극기: 게이지가 가득 차면 사용
export const KEY_BINDINGS = {
  p1: { left: ['KeyA'], right: ['KeyD'], guard: ['KeyW'], dodge: ['KeyS'], attack: ['KeyF'], skill: ['KeyG'], super: ['KeyE'] },
  p2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], guard: ['ArrowUp'], dodge: ['ArrowDown'],
    attack: ['KeyK', 'Numpad1'], skill: ['KeyL', 'Numpad2'], super: ['KeyI', 'Numpad3'],
  },
};

export const KEY_LABELS = {
  KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S', KeyF: 'F', KeyG: 'G', KeyE: 'E',
  KeyK: 'K', KeyL: 'L', KeyI: 'I',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Numpad1: 'Num1', Numpad2: 'Num2', Numpad3: 'Num3',
};
