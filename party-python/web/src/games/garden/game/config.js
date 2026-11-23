// =====================================================================
// 픽셀 가든 디펜스 — 화면 배치·그림·연출·제스처 설정 (원본 그대로)
// ※ 멀티플레이에서 점수·좀비·웨이브 규칙은 서버(server/party/games/garden/config.py)가 정한다.
//    이 파일의 무기·포탑·아이템·웨이브 값은 쓰이지 않는다(같은 규칙 값은 sim/config.js).
// =====================================================================
export const CONFIG = {
  version: '1.0.0',

  // 기본 해상도 320×180, 정수배 확대. 게임 로직은 60FPS 고정 스텝.
  base: { width: 320, height: 180, logicFps: 60, maxFrameDt: 1 / 20 },

  // 화면 배치: 상단 HUD 30px + 5레인 × 28px + 하단 10px 여백
  layout: {
    hudH: 30,
    laneTop: 30,
    laneH: 28,
    lanes: 5,
    cols: 9,
    cellW: 28,
    gridX: 36,              // 포탑 그리드 시작 x (왼쪽 집 폭 36px)
    gridRight: 36 + 9 * 28, // 288
    bottomY: 170,
    exitX: 36,              // 좀비 앞부분이 여기 도달하면 라이프 감소
    spawnX: 322,            // 좀비 스폰 x (화면 밖)
    playerX: 14,            // 플레이어 스프라이트 왼쪽 x
  },

  player: {
    lives: 3,
    maxLives: 5,
    startCoins: 30,
    laneMoveSpeed: 420,     // 레인 전환 시 시각적 이동 속도 (px/s)
    recoilTime: 0.06,
    muzzleTime: 0.07,
  },

  // ---- 무기 ---------------------------------------------------------
  // pellets: 한 발에 나가는 탄 목록 (laneOffset: 레인 오프셋, yOff: 시각적 높이 차)
  weaponOrder: ['pistol', 'shotgun', 'mg', 'sniper'],
  weapons: {
    pistol: {
      name: 'PISTOL', key: 1, cost: 0, damage: 2, fireRate: 5,
      magazine: Infinity, reserve: Infinity, reloadTime: 0, pierce: 1,
      bulletSpeed: 280, range: Infinity, bulletW: 3, bulletH: 1, color: 11,
      pellets: [{ laneOffset: 0, yOff: 0 }], shake: 0, icon: 'icon_pistol',
    },
    shotgun: {
      name: 'SHOTGUN', key: 2, cost: 40, damage: 3, fireRate: 1.6,
      magazine: 6, reserve: 24, reloadTime: 1.3, pierce: 1,
      bulletSpeed: 230, range: 105, bulletW: 2, bulletH: 2, color: 10,
      pellets: [
        { laneOffset: -1, yOff: 0 }, { laneOffset: 0, yOff: -2 },
        { laneOffset: 0, yOff: 2 }, { laneOffset: 1, yOff: 0 },
      ],
      shake: 2, icon: 'icon_shotgun',
    },
    mg: {
      name: 'MG', key: 3, cost: 60, damage: 1, fireRate: 12,
      magazine: 40, reserve: 160, reloadTime: 1.6, pierce: 1,
      bulletSpeed: 320, range: Infinity, bulletW: 2, bulletH: 1, color: 11,
      pellets: [{ laneOffset: 0, yOff: 0, jitter: 2 }], shake: 0.4, icon: 'icon_mg',
    },
    sniper: {
      name: 'SNIPER', key: 4, cost: 90, damage: 12, fireRate: 1.2,
      magazine: 5, reserve: 25, reloadTime: 1.8, pierce: 4,
      bulletSpeed: 440, range: Infinity, bulletW: 4, bulletH: 1, color: 18,
      pellets: [{ laneOffset: 0, yOff: 0 }], shake: 1.5, icon: 'icon_sniper',
    },
  },

  // ---- 포탑 (식물 역할) ---------------------------------------------
  turretOrder: ['basic', 'slow', 'barricade'],
  turrets: {
    basic: {
      name: 'GUN', cost: 25, hp: 40, damage: 2, fireRate: 1.4, bulletSpeed: 220,
      bulletW: 2, bulletH: 1, color: 10, sprite: 'turret_basic', icon: 'icon_tb', pierce: 1,
    },
    slow: {
      name: 'FROST', cost: 35, hp: 40, damage: 1, fireRate: 0.9, bulletSpeed: 170,
      bulletW: 2, bulletH: 2, color: 18, slowFactor: 0.5, slowTime: 2.2,
      sprite: 'turret_slow', icon: 'icon_ts', pierce: 1,
    },
    barricade: {
      name: 'WALL', cost: 15, hp: 160, damage: 0, fireRate: 0,
      sprite: 'barricade', icon: 'icon_tw',
    },
  },
  turretHitbox: { left: 6, right: 22 }, // 칸 안에서 포탑이 차지하는 x 범위

  // ---- 적 -----------------------------------------------------------
  // speed: px/s, damage: 포탑에 주는 초당 피해, hitL/hitR: 스프라이트 내 히트박스
  enemies: {
    normal: { hp: 10, speed: 9, damage: 10, score: 10, coin: 3, w: 16, h: 24, hitL: 4, hitR: 13, sprite: 'zombie', frames: 4, animFps: 6 },
    runner: { hp: 5, speed: 22, damage: 8, score: 15, coin: 3, w: 16, h: 24, hitL: 1, hitR: 14, sprite: 'runner', frames: 2, animFps: 10 },
    helmet: { hp: 10, helmetHp: 14, speed: 7, damage: 10, score: 25, coin: 5, w: 16, h: 24, hitL: 4, hitR: 13, sprite: 'zombie', frames: 4, animFps: 5 },
    jumper: { hp: 8, speed: 12, damage: 8, score: 20, coin: 4, w: 16, h: 24, hitL: 4, hitR: 13, sprite: 'zombie', frames: 4, animFps: 8, jumps: 1, swap: { P: 'B', p: 'b' } },
    boss: { hp: 340, speed: 4, damage: 30, score: 500, coin: 40, w: 32, h: 40, hitL: 5, hitR: 26, sprite: 'boss', frames: 2, animFps: 3, summonInterval: 6, summonCount: 2, laneSwitchInterval: 9 },
  },
  jump: { duration: 0.55, height: 9 },

  // ---- 아이템 -------------------------------------------------------
  items: {
    lifetime: 6,            // 클릭 가능한 시간 (초)
    coinAutoDelay: 0.55,    // 코인이 자동으로 날아가기까지
    coinFlySpeed: 380,
    drop: { ammo: 0.08, heart: 0.03, bomb: 0.05 }, // 처치 시 드롭 확률 (시드 기반)
    bombDamage: 60,
    ammoRefill: { shotgun: 12, mg: 60, sniper: 12 },
  },

  // ---- 콤보 / 점수 --------------------------------------------------
  combo: { window: 2.0, step: 4, mulPerStep: 0.5, maxMul: 4 },
  score: { waveClearBonus: 100, lifeBonus: 200, helmetBreak: 5 },

  // ---- 웨이브 -------------------------------------------------------
  // spawns: 종류별 마리 수. duration 동안 시드 난수로 시간·레인이 배정된다.
  waveGap: 2.5,
  bannerTime: 1.6,
  waves: [
    { name: 'WAVE 1', duration: 24, speedMul: 1.00, hpMul: 1.0, spawns: { normal: 8 } },
    { name: 'WAVE 2', duration: 28, speedMul: 1.05, hpMul: 1.1, spawns: { normal: 10, runner: 4 } },
    { name: 'WAVE 3', duration: 30, speedMul: 1.10, hpMul: 1.2, spawns: { normal: 10, runner: 5, helmet: 3 } },
    { name: 'WAVE 4', duration: 34, speedMul: 1.15, hpMul: 1.3, spawns: { normal: 12, runner: 6, helmet: 4, jumper: 3 } },
    { name: 'WAVE 5', duration: 36, speedMul: 1.20, hpMul: 1.4, spawns: { normal: 14, runner: 8, helmet: 6, jumper: 5 } },
    { name: 'BOSS WAVE', duration: 32, speedMul: 1.20, hpMul: 1.3, boss: true, spawns: { normal: 8, runner: 5, helmet: 4, jumper: 3 } },
  ],

  // ---- 연출 ---------------------------------------------------------
  fx: {
    hitFlash: 0.06,
    hitStopKill: 0.035,
    hitStopBoss: 0.14,
    knockback: 2,
    shakeKill: 0.8,
    shakeBomb: 5,
    shakeBoss: 6,
    shakeLife: 4,
  },
  night: { maxAlpha: 0.38 }, // 마지막 웨이브에서의 밤 오버레이 농도

  // ---- 제스처 인식 --------------------------------------------------
  gesture: {
    enabled: true,
    laneControl: true,     // 총 모양 손의 높이로 레인 조준
    numHands: 2,
    armFrames: 3,          // 총 모양이 연속 N프레임 유지되면 '조준'
    pullFrames: 2,         // 방아쇠 동작이 연속 N프레임이면 '발사'
    graceTime: 0.8,        // 총 모양이 잠깐 깨져도 조준 상태 유지 시간
    maxPullTime: 2.0,      // 이보다 오래 당기고 있으면(주먹) 손가락을 다시 펴야 재발사
    extendedRatio: 1.2,    // 손가락 펴짐 판정 (끝-손목 / 둘째마디-손목, 곧게 펴면 ~1.3)
    curledRatio: 1.08,     // 손가락 구부림 판정 (90도 굽히면 ~1.05)
    thumbMinAngle: 55,     // 엄지-검지 각도 범위(도) → ㄱ자
    thumbMaxAngle: 140,
    thumbMinLen: 0.55,     // 엄지 끝 ↔ 검지 뿌리 거리 (손 크기 배수) 최소값
    thumbDownDist: 0.4,    // 엄지 끝이 검지 둘째마디에 이 비율 이내 + 각도 작으면 '망치 내림'
    supportDist: 1.7,      // 양손 총: 받침손 손바닥 ↔ 총 손목 거리 (손 크기 배수)
    aimTop: 0.18,          // 손 높이 → 레인 매핑 범위 (정규화 y)
    aimBottom: 0.82,
    aimHysteresis: 0.035,
    mediapipe: {
      version: '0.10.14',
      modelUrl: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    },
  },

  // ---- 멀티플레이 ---------------------------------------------------
  match: { maxPlayers: 5, defaultPlayers: 1 },

  // 플레이어별 팔레트 스왑 (멜빵 색) — 1P 파랑, 2P 빨강, 3P 초록, 4P 주황, 5P 보라
  playerSwaps: [
    null,
    { b: 'r', B: 'R' },
    { b: 'g', B: 'G' },
    { b: 'o', B: 'O' },
    { b: 'p', B: 'P' },
  ],
};
