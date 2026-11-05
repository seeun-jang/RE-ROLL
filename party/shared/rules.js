// =====================================================
// RE:ROLL 파티 — 규칙 데이터 (서버와 화면이 같이 씀)
//  - 주사위: basic(늘 있음) · fun(미니게임 보상) · normal(3위 보상 · 주사위 칸) · trash(받으면 다음 턴에 무조건 굴림)
//  - 칸: 도착한 칸의 효과만 받음 (지나가는 칸은 없음)
//  - 미니게임: 매 턴 모두 같은 게임을 동시에 → 순위대로 주사위
// =====================================================

export const MAX_PLAYERS = 5;
export const BAG_MAX = 4;          // 갖고 있을 수 있는 주사위 (넘치면 제일 오래된 것부터 버림)
export const TURN_CHOICES = [6, 10, 15];
export const DEFAULT_TURNS = 10;

// 캐릭터 (미니게임의 char=1~5 와 같은 순서)
export const CHARACTERS = [
  { id: 'bear', sprite: 'bear', color: '#ef7d57' },
  { id: 'cat', sprite: 'cat', color: '#b13e53' },
  { id: 'duck', sprite: 'duck', color: '#ffcd75' },
  { id: 'tiger', sprite: 'tiger', color: '#41a6f6' },
  { id: 'shiba', sprite: 'shiba', color: '#a7f070' },
];

// 미니게임 (re-roll 폴더 이름 → 이름)
export const MINIGAMES = {
  'jackpot-bowling': '잭팟 볼링',
  'claw-jackpot': '잭팟 인형뽑기',
  'fight-night': '매직 파이트 나이트',
  hanomano: '하노마노',
  'jackpot-groove': '잭팟 그루브',
  'jackpot-homerun': '잭팟 홈런 더비',
  'live-fire': '실거리 사격',
  'magic-sigil': '마법진 그리기',
  'pingpong-jackpot': '잭팟 탁구왕',
  'sneaky-dance': '교수님 몰래 댄스!',
};

// 미니게임 순위 보상: 1위 재밌는 주사위 3개 중 고르기 · 2위 재밌는 주사위 랜덤 · 3위 보통 주사위 랜덤
export const REWARDS = ['pick-fun', 'fun', 'normal'];

// ---------------- 주사위 ----------------
// faces: 굴리면 이 중 하나. 특별한 동작은 서버 game.js 의 rollDice 에서 처리
export const DICE = {
  basic: { kind: 'basic', icon: '🎲', name: '기본 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '1~6' },

  // 보통 (3위 · 🎁 칸)
  d8: { kind: 'normal', icon: '🎱', name: '8면 주사위', faces: [1, 2, 3, 4, 5, 6, 7, 8], desc: '1~8' },
  safe: { kind: 'normal', icon: '🛡️', name: '안전 주사위', faces: [3, 3, 4, 4, 5, 5], desc: '3 3 4 4 5 5' },
  turtle: { kind: 'normal', icon: '🐢', name: '거북이 주사위', faces: [1, 1, 2, 2, 3, 3], desc: '1 1 2 2 3 3 (딱 맞춰 멈출 때)' },
  double: { kind: 'normal', icon: '🎲🎲', name: '더블 주사위', faces: null, desc: '두 개 굴려서 더함' },

  // 재밌는 (1·2위)
  timing: { kind: 'fun', icon: '⏱️', name: '타이밍 주사위', faces: null, desc: '1~10이 돌아감 · Space 로 멈춤', input: 'timing' },
  parity: { kind: 'fun', icon: '☯️', name: '홀짝 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '홀/짝 맞히면 ×2, 틀리면 0', input: 'parity' },
  magnet: { kind: 'fun', icon: '🧲', name: '자석 주사위', faces: null, desc: '바로 앞사람 칸으로 붙음' },
  envy: { kind: 'fun', icon: '😤', name: '질투 주사위', faces: null, desc: '1등과 거리의 절반만큼' },
  copy: { kind: 'fun', icon: '📋', name: '복사 주사위', faces: null, desc: '이번 턴 1등이 굴린 수 그대로' },
  roulette: { kind: 'fun', icon: '🎡', name: '룰렛 주사위', faces: null, desc: '1~20 · 13이면 출발점으로' },
  allin: { kind: 'fun', icon: '🎯', name: '모 아니면 도', faces: [1, 6, 6, 6, 6, 6], desc: '1 6 6 6 6 6' },
  gamble: { kind: 'fun', icon: '🃏', name: '도박 주사위', faces: [0, 0, 0, 10, 10, 10], desc: '0 0 0 10 10 10' },
  sniper: { kind: 'fun', icon: '🔫', name: '저격 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '나는 제자리 · 고른 사람을 그만큼 뒤로', input: 'target' },
  shield: { kind: 'fun', icon: '🔰', name: '방패 주사위', faces: [1, 2, 3, 4], desc: '1~4 · 이번 턴 나쁜 효과 막음' },

  // 개쓰레기 (받으면 다음 턴에 무조건 굴림)
  poop: { kind: 'trash', icon: '💩', name: '똥 주사위', faces: [0, 0, 0, 0, 0, 1], desc: '0 0 0 0 0 1' },
  reverse: { kind: 'trash', icon: '🔙', name: '역주행 주사위', faces: [-1, -2, -3, -1, -2, -3], desc: '나온 수만큼 뒤로' },
  sticky: { kind: 'trash', icon: '🍯', name: '끈끈이 주사위', faces: [0, 1, 1, 1, 2, 2], desc: '0 1 1 1 2 2 · 두 번 굴려야 떨어짐', uses: 2 },
  helper: { kind: 'trash', icon: '🤡', name: '남 좋은 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '꼴찌가 그만큼 감 · 나는 제자리' },
  loyal: { kind: 'trash', icon: '1️⃣', name: '일편단심 주사위', faces: [1, 1, 1, 1, 1, 1], desc: '1 1 1 1 1 1' },
  slow: { kind: 'trash', icon: '🐌', name: '질질 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '나온 수의 절반만' },
  banana: { kind: 'trash', icon: '🍌', name: '바나나 주사위', faces: [1, 2, 3, 4, 5, 6], desc: '앞으로 갈지 뒤로 갈지 랜덤' },
  sleepy: { kind: 'trash', icon: '😴', name: '졸음 주사위', faces: [1, 2, 3], desc: '50% 확률로 쿨쿨… 안 움직임' },
};

export const diceOf = (kind) => Object.keys(DICE).filter((id) => DICE[id].kind === kind);

// ---------------- 칸 ----------------
// group: 화면 색 · tier: 'fun'(ㅈㄴ 재밌는) · 'wild'(개쌈뽕)
export const SPACES = {
  start: { icon: '🏁', name: '출발', color: '#566c86', desc: '출발점' },
  goal: { icon: '🏆', name: '결승', color: '#ffcd75', desc: '먼저 도착하면 우승!' },
  plain: { icon: '', name: '발판', color: '#333c57', desc: '아무 일도 없음' },
  fork: { icon: '🔀', name: '갈림길', color: '#3b5dc9', desc: '지나갈 때 길을 고름' },
  dice: { icon: '🎁', name: '주사위 칸', color: '#38b764', desc: '보통 주사위 1개' },
  trash: { icon: '💩', name: '쓰레기 칸', color: '#5d275d', desc: '쓰레기 주사위 1개' },
  trap: { icon: '⚠️', name: '함정', color: '#b13e53', desc: '3칸 뒤로' },

  // ㅈㄴ 재밌는 칸
  slot: { tier: 'fun', icon: '🎰', name: '슬롯머신', color: '#a7f070', desc: '777 = 5칸 앞 · 💩💩💩 = 출발점 · 그 밖엔 주사위' },
  point: { tier: 'fun', icon: '👉', name: '지목', color: '#a7f070', desc: '고른 사람이 다음 턴에 쉼' },
  drill: { tier: 'fun', icon: '📢', name: '단체 기합', color: '#a7f070', desc: '나만 빼고 모두 2칸 뒤로' },
  gift: { tier: 'fun', icon: '🎀', name: '선물', color: '#a7f070', desc: '내 주사위 하나를 랜덤한 사람에게 줌' },
  slide: { tier: 'fun', icon: '🛝', name: '미끄럼틀', color: '#a7f070', desc: '6칸 앞으로' },
  capsule: { tier: 'fun', icon: '🔮', name: '캡슐 뽑기', color: '#a7f070', desc: '꽝 · 쓰레기 · 재밌는 주사위 중 하나' },
  thief: { tier: 'fun', icon: '🦹', name: '도둑', color: '#a7f070', desc: '고른 사람의 주사위 1개를 뺏음' },
  taxi: { tier: 'fun', icon: '🚕', name: '택시', color: '#a7f070', desc: '고른 사람의 칸으로 이동' },
  rest: { tier: 'fun', icon: '☕', name: '쉼터', color: '#a7f070', desc: '다음 미니게임 보상 2배' },
  mirror: { tier: 'fun', icon: '🪞', name: '거울', color: '#a7f070', desc: '다음 턴엔 굴린 만큼 뒤로' },

  // 개쌈뽕한 칸
  quake: { tier: 'wild', icon: '🌋', name: '지진', color: '#ef7d57', desc: '모두의 위치가 섞임' },
  hole: { tier: 'wild', icon: '🕳️', name: '블랙홀', color: '#ef7d57', desc: '앞뒤 5칸 안의 사람을 빨아들임' },
  rocket: { tier: 'wild', icon: '🚀', name: '로켓', color: '#ef7d57', desc: '12칸 앞 · 30% 확률로 폭발해서 6칸 뒤' },
  revolt: { tier: 'wild', icon: '👑', name: '혁명', color: '#ef7d57', desc: '1등과 꼴등 자리 바꾸기' },
  jackpot: { tier: 'wild', icon: '💰', name: '잭팟', color: '#ef7d57', desc: '모두에게서 주사위 1개씩 뺏음' },
  tornado: { tier: 'wild', icon: '🌪️', name: '회오리', color: '#ef7d57', desc: '앞뒤 1~15칸 랜덤으로 날아감' },
  bigdice: { tier: 'wild', icon: '🎲', name: '대왕 주사위', color: '#ef7d57', desc: '1~30 대왕 주사위를 굴림' },
  timemachine: { tier: 'wild', icon: '⏪', name: '타임머신', color: '#ef7d57', desc: '모두 3턴 전 위치로' },
};
