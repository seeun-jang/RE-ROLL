// =====================================================
// 마법진 그리기 — 마우스로 마법진을 따라 그리는 1~5인 차례 게임 (설정은 여기서만)
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

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
  DRAW_TIME: 10 * 60,     // 한 사람 그리기 시간 10초
  SPEED_TIME: 5 * 60,     // 번개 마법: 5초
  MEMORY_TIME: 3 * 60,    // 기억 마법: 처음 3초만 안내선을 보여 줌
  SHAKE: { X: 7, Y: 6 },  // 흔들 종이 흔들림 크기 (픽셀)
  SCORE_SHOW: 100,        // 한 사람 채점 연출 시간 (클릭하면 바로 넘어감)
  ROUND_INTRO: 170,       // 라운드 시작 슬롯머신
  GALLERY_TIME: 220,      // 라운드 끝 갤러리 (클릭하면 바로 넘어감)

  CANVAS: 120,            // 종이 크기 120x120 픽셀 (모양은 60 기준 좌표를 2배로)
  BRUSH: 2,               // 펜 굵기

  // 채점: 모양을 얼마나 덮었나(덮기) × 선을 얼마나 안 벗어났나(깔끔)
  //  정확도 = 100 × 덮기 × (0.4 + 0.6 × 깔끔)
  //  일찍 끝내면 남은 초 × 2 (최대 +16, 번개 마법은 ×4) 보너스 — 정확도 50 이상일 때만
  //  라운드 점수 = (정확도 + 보너스) × 배수 (잭팟 라운드 2배)
  SCORE: {
    COVER_RADIUS: 3,
    NEAT_RADIUS: 3,
    TIME_BONUS: 2,
    SUCCESS: 80,          // 이 이상이면 마법 발동!
    OKAY: 50,             // 이 이상이면 그럭저럭, 아래는 펑!
  },

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 조작: 마우스(또는 터치) 왼쪽 버튼을 누른 채 움직이면 그려짐
//  완료: Space / Enter / 오른쪽 클릭 / '완료' 버튼 클릭

