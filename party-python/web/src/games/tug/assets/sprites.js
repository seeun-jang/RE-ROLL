// =============================================================
// 스프라이트 픽셀 데이터 (데이터 전용 — 로직 없음)
//
// 캐릭터: 16×32, 2차원 문자열 배열. 한 글자 = 한 픽셀, '.' = 투명.
// 글자는 '팔레트 슬롯'이다. 실제 색은 AssetLoader 가 플레이어 외형/팀에 맞춰 칠한다.
// 모든 프레임은 '오른쪽을 바라보는' 자세. 오른쪽 팀은 SpriteFactory.flipCanvas 로 좌우 반전해서 쓴다.
//
// 기준선 (Layout 과 맞물림):
//   - 캐릭터 발 = 마지막 행(row 31) → 스프라이트를 y = GROUND_Y - 32 에 그리면 발이 땅에 닿는다.
//   - 줄 잡는 손(주먹) = row 16~17, x 13~14 → ROPE_Y(= GROUND_Y - 15) 와 같은 높이.
//
// 나중에 실제 이미지로 바꿀 때: 이 파일은 그대로 두고 AssetLoader.js 의 IMAGE_MANIFEST 를 쓰면 된다.
// =============================================================

/** 캐릭터 한 프레임 크기 (px) */
export const CHAR_W = 16;
export const CHAR_H = 32;

/**
 * 슬롯 문자 → 의미 ('.' 은 투명)
 *  'o' 외곽선(INK)          's' 피부(YELLOW)        'S' 피부 그림자(ORANGE)
 *  'h' 머리카락(외형)        'H' 머리카락 그림자      'c' 셔츠(플레이어 색)   'C' 셔츠 그림자
 *  'b' 머리띠(팀 색)         'B' 머리띠 그림자        'p' 바지(CHARCOAL)      'P' 바지 그림자/밑창(INK)
 *  'f' 신발(PLUM)            'w' 흰자/하이라이트       'e' 눈동자(INK)
 */
export const CHAR_SLOTS = 'osShHcCbBpPfwe';

/** 애니메이션 이름 목록 (config.ANIMS 와 같은 순서) */
export const CHARACTER_ANIMS = ['idle', 'pull', 'slip', 'win', 'fall'];

/**
 * 캐릭터 애니메이션 프레임.
 *  idle ×4 : 줄을 잡고 대기. 1·2 프레임은 머리가 1px 내려가는 숨쉬기, 3 프레임은 눈 깜빡임
 *  pull ×4 : 몸을 뒤로(왼쪽으로) 젖힘 1→2→3→2px. 엉덩이는 앞으로, 발뒤꿈치는 박음. 2 프레임은 힘주는 얼굴
 *            (0 프레임 = 버티기 자세 — 당기기가 끝나면 여기로 돌아온다)
 *  slip ×3 : 줄에 끌려가며 발이 앞으로 미끄러지고 상체가 앞으로 쏠림. 뒤 팔은 허우적, 앞 손은 줄 높이 근처
 *  win  ×4 : 만세 점프 — 웅크림 → 떠오름(팔 올림) → 정점(다리 접음) → 착지
 *  fall ×3 : 앞으로 기우뚱 → 머리부터 쿵(스트레치) → 바닥에 납작 엎어짐(스쿼시, 발은 위로)
 */
export const CHARACTER_FRAMES = Object.freeze({
  idle: Object.freeze([
    // idle 0: 기본 (줄 잡고 대기)
    Object.freeze([
      '................', //  0
      '................', //  1
      '.....ooooooo....', //  2
      '...oohhhhhhhoo..', //  3
      '.ooHhhhhhhhhhho.', //  4
      'obbbbbbbbbbbbbo.', //  5
      'oBbBBBbbbbbbbbo.', //  6
      '.obohhhhsssssso.', //  7
      '.oBoHhSssewseso.', //  8
      '..oHhhSsseeseso.', //  9
      '..oHhsssSssssso.', // 10
      '..oHSssssssSsso.', // 11
      '...oSsssssssso..', // 12
      '....ooSSSoooo...', // 13
      '....oCcscccoo...', // 14
      '....oCccccccsoo.', // 15
      '....oCcccCCCSsso', // 16
      '....oCcccooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPopppo....', // 24
      '....oSSoosso....', // 25
      '....oSSoosso....', // 26
      '....oSSoosso....', // 27
      '....oSSoossoo...', // 28
      '...offfooffffo..', // 29
      '...oPPPooPPPPo..', // 30
      '....ooo..oooo...', // 31
    ]),
    // idle 1: 숨 들이쉼 — 머리 1px 아래
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '.....ooooooo....', //  3
      '...oohhhhhhhoo..', //  4
      '.ooHhhhhhhhhhho.', //  5
      'obbbbbbbbbbbbbo.', //  6
      'oBbBBBbbbbbbbbo.', //  7
      '.obohhhhsssssso.', //  8
      '.oBoHhSssewseso.', //  9
      '..oHhhSsseeseso.', // 10
      '..oHhsssSssssso.', // 11
      '..oHSssssssSsso.', // 12
      '...oSsssssssso..', // 13
      '....oCSSSccoo...', // 14
      '....oCccccccsoo.', // 15
      '....oCcccCCCSsso', // 16
      '....oCcccooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPopppo....', // 24
      '....oSSoosso....', // 25
      '....oSSoosso....', // 26
      '....oSSoosso....', // 27
      '....oSSoossoo...', // 28
      '...offfooffffo..', // 29
      '...oPPPooPPPPo..', // 30
      '....ooo..oooo...', // 31
    ]),
    // idle 2: 숨 유지 — 머리 1px 아래
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '.....ooooooo....', //  3
      '...oohhhhhhhoo..', //  4
      '.ooHhhhhhhhhhho.', //  5
      'obbbbbbbbbbbbbo.', //  6
      'oBbBBBbbbbbbbbo.', //  7
      '.obohhhhsssssso.', //  8
      '.oBoHhSssewseso.', //  9
      '..oHhhSsseeseso.', // 10
      '..oHhsssSssssso.', // 11
      '..oHSssssssSsso.', // 12
      '...oSsssssssso..', // 13
      '....oCSSSccoo...', // 14
      '....oCccccccsoo.', // 15
      '....oCcccCCCSsso', // 16
      '....oCcccooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPopppo....', // 24
      '....oSSoosso....', // 25
      '....oSSoosso....', // 26
      '....oSSoosso....', // 27
      '....oSSoossoo...', // 28
      '...offfooffffo..', // 29
      '...oPPPooPPPPo..', // 30
      '....ooo..oooo...', // 31
    ]),
    // idle 3: 눈 깜빡임
    Object.freeze([
      '................', //  0
      '................', //  1
      '.....ooooooo....', //  2
      '...oohhhhhhhoo..', //  3
      '.ooHhhhhhhhhhho.', //  4
      'obbbbbbbbbbbbbo.', //  5
      'oBbBBBbbbbbbbbo.', //  6
      '.obohhhhsssssso.', //  7
      '.oBoHhSssssssso.', //  8
      '..oHhhSsseeseso.', //  9
      '..oHhsssSssssso.', // 10
      '..oHSssssssSsso.', // 11
      '...oSsssssssso..', // 12
      '....ooSSSoooo...', // 13
      '....oCcscccoo...', // 14
      '....oCccccccsoo.', // 15
      '....oCcccCCCSsso', // 16
      '....oCcccooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPopppo....', // 24
      '....oSSoosso....', // 25
      '....oSSoosso....', // 26
      '....oSSoosso....', // 27
      '....oSSoossoo...', // 28
      '...offfooffffo..', // 29
      '...oPPPooPPPPo..', // 30
      '....ooo..oooo...', // 31
    ]),
  ]),
  pull: Object.freeze([
    // pull 0: 버티기 (뒤로 1px)
    Object.freeze([
      '................', //  0
      '................', //  1
      '.....ooooooo....', //  2
      '...oohhhhhhhoo..', //  3
      '.ooHhhhhhhhhhho.', //  4
      'obbbbbbbbbbbbbo.', //  5
      'oBbBBBbbbbbbbbo.', //  6
      '.obohhhhsssssso.', //  7
      '.oBoHhSssewseso.', //  8
      '..oHhhSsseeseso.', //  9
      '..oHhsssSssssso.', // 10
      '..oHSssssssSsso.', // 11
      '...oSsssssssso..', // 12
      '....ooSSSoooo...', // 13
      '....oCcscccoo...', // 14
      '....oCccccccsoo.', // 15
      '....oCcccCCCSsso', // 16
      '....oCcccooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPoppppo...', // 24
      '....oSSooossso..', // 25
      '....oSSo..osso..', // 26
      '...oSSo...osso..', // 27
      '...oSSo....osso.', // 28
      '..offfo...offfo.', // 29
      '..oPPPo..oPPPPo.', // 30
      '...ooo....oooo..', // 31
    ]),
    // pull 1: 젖힘 2px
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '....ooooooo.....', //  3
      '..oohhhhhhhoo...', //  4
      '.oHhhhhhhhhhho..', //  5
      'obbbbbbbbbbbbo..', //  6
      'obBBBbbbbbbbbo..', //  7
      'obohhhhsssssso..', //  8
      'oBoHhSssewseso..', //  9
      '.oHhhSsseeseso..', // 10
      '.oHhsssSssssso..', // 11
      '.oHSssssssSsso..', // 12
      '..oSsssssssso...', // 13
      '...oCSSSccooo...', // 14
      '...oCccccccssoo.', // 15
      '...oCcccCCCSSsso', // 16
      '...oCcccoooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '.....oCccccco...', // 20
      '.....oCCCCCCo...', // 21
      '.....oPpppppo...', // 22
      '.....oPpppppo...', // 23
      '.....oPPoppppo..', // 24
      '....oSSo.oossso.', // 25
      '....oSSo...osso.', // 26
      '...oSSo....osso.', // 27
      '...oSSo.....osso', // 28
      '..offfo....offfo', // 29
      '..oPPPo...oPPPPo', // 30
      '...ooo.....oooo.', // 31
    ]),
    // pull 2: 최대로 젖힘 3px + 힘주는 얼굴
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '....ooooooo.....', //  3
      '..oohhhhhhhoo...', //  4
      '.oHhhhhhhhhhho..', //  5
      'obbbbbbbbbbbbo..', //  6
      'obBBBbbbbbbbbo..', //  7
      'obohhhhssessso..', //  8
      'oBoHhSssssssso..', //  9
      '.oHhhSsseeseso..', // 10
      '.oHhssssssssso..', // 11
      '.oHSsssssowoso..', // 12
      '..oSsssssssso...', // 13
      '...oCSSSccoo....', // 14
      '...oCcccccooooo.', // 15
      '...oCccccccsssso', // 16
      '....oCccCCCSSSso', // 17
      '....oCccooooooo.', // 18
      '.....oCccccco...', // 19
      '.....oCccccco...', // 20
      '......oCCCCCCo..', // 21
      '......oPpppppo..', // 22
      '......oPpppppo..', // 23
      '.....oPPPoppsso.', // 24
      '....oSSoo.ooosso', // 25
      '....oSSo....osso', // 26
      '...oSSo.....osso', // 27
      '...oSSo.....osso', // 28
      '..offfo....offfo', // 29
      '..oPPPo...oPPPPo', // 30
      '...ooo.....oooo.', // 31
    ]),
    // pull 3: 돌아오는 중 2px
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '....ooooooo.....', //  3
      '..oohhhhhhhoo...', //  4
      '.oHhhhhhhhhhho..', //  5
      'obbbbbbbbbbbbo..', //  6
      'obBBBbbbbbbbbo..', //  7
      'obohhhhsssssso..', //  8
      'oBoHhSssewseso..', //  9
      '.oHhhSsseeseso..', // 10
      '.oHhsssSssssso..', // 11
      '.oHSssssssSsso..', // 12
      '..oSsssssssso...', // 13
      '...oCSSSccooo...', // 14
      '...oCccccccssoo.', // 15
      '...oCcccCCCSSsso', // 16
      '...oCcccoooooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '.....oCccccco...', // 20
      '.....oCCCCCCo...', // 21
      '.....oPpppppo...', // 22
      '.....oPpppppo...', // 23
      '.....oPPoppppo..', // 24
      '....oSSo.oossso.', // 25
      '....oSSo...osso.', // 26
      '...oSSo....osso.', // 27
      '...oSSo.....osso', // 28
      '..offfo....offfo', // 29
      '..oPPPo...oPPPPo', // 30
      '...ooo.....oooo.', // 31
    ]),
  ]),
  slip: Object.freeze([
    // slip 0: 앞으로 쏠림, 뒤 팔 위로 허우적
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '......ooooooo...', //  3
      '....oohhhhhhhoo.', //  4
      '..ooHhhhhhhhhhho', //  5
      '.obbbbbbbbbbbbbo', //  6
      '.oBbBBBbbbbbbbbo', //  7
      '..obohhhhseessso', //  8
      '..oBoHhSssewseso', //  9
      '...oHhhSsseeseso', // 10
      '.oooHhssssssosso', // 11
      'ossoHSssssssosso', // 12
      'ossooSsssssssso.', // 13
      '.oSoooCSSSccoo..', // 14
      '..oCCoCccccccoo.', // 15
      '...oooCcccCCCsso', // 16
      '.....oCcccoooSso', // 17
      '....oCccccco.oo.', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppoo...', // 23
      '....oPPopppppo..', // 24
      '...oSSo.ooossso.', // 25
      '..oSSo.....osso.', // 26
      '.oSSo......osso.', // 27
      '.oSSo.......osso', // 28
      'offfo.......offo', // 29
      'oPPo.......oPPPo', // 30
      '.oo.........ooo.', // 31
    ]),
    // slip 1: 더 끌려감, 뒷발 들림, 뒤 팔 아래로
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '......ooooooo...', //  4
      '....oohhhhhhhoo.', //  5
      '..ooHhhhhhhhhhho', //  6
      '.obbbbbbbbbbbbbo', //  7
      '.oBbBBBbbbbbbbbo', //  8
      '..obohhhhseessso', //  9
      '..oBoHhSssewseso', // 10
      '...oHhhSsseeseso', // 11
      '...oHhssssssosso', // 12
      '...oHSssssssosso', // 13
      '....oSsssssssso.', // 14
      '.....oCSSSccoo..', // 15
      '...oooCccccccoo.', // 16
      '.ooCCoCcccCCCsso', // 17
      'ossooCccccoooSso', // 18
      'oSsooCccccco.oo.', // 19
      '.oo.oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppoo...', // 23
      '....oPPopppppo..', // 24
      '...oSSo.ooossso.', // 25
      '..oSSo.....osso.', // 26
      '.oSSo.......osso', // 27
      'offfo.......osso', // 28
      'oPPo........offo', // 29
      '.oo........oPPPo', // 30
      '............ooo.', // 31
    ]),
    // slip 2: 발 버둥 (다시 디딤), 뒤 팔 위로
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '......ooooooo...', //  3
      '....oohhhhhhhoo.', //  4
      '..ooHhhhhhhhhhho', //  5
      '.obbbbbbbbbbbbbo', //  6
      '.oBbBBBbbbbbbbbo', //  7
      '..obohhhhseessso', //  8
      '..oBoHhSssewseso', //  9
      '..ooHhhSsseeseso', // 10
      '.ossHhssssssosso', // 11
      '.ossHSssssssosso', // 12
      '.oSooSsssssssso.', // 13
      '..oCooCSSSccooo.', // 14
      '...oCoCccccccsso', // 15
      '....ooCcccCCCSso', // 16
      '.....oCcccooooo.', // 17
      '....oCccccco....', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCCCCCCo....', // 21
      '....oPpppppo....', // 22
      '....oPpppppo....', // 23
      '....oPPopppo....', // 24
      '....oSSoossso...', // 25
      '....oSSo.osso...', // 26
      '...oSSo...osso..', // 27
      '...oSSo...osso..', // 28
      '..offfo...offfo.', // 29
      '..oPPPo...oPPPo.', // 30
      '...ooo.....ooo..', // 31
    ]),
  ]),
  win: Object.freeze([
    // win 0: 웅크림 (스쿼시)
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '................', //  4
      '.....ooooooo....', //  5
      '...oohhhhhhhoo..', //  6
      '.ooHhhhhhhhhhho.', //  7
      'obbbbbbbbbbbbbo.', //  8
      'oBbBBBbbbbbbbbo.', //  9
      '.obohhhhsssssso.', // 10
      '.oBoHhSssesseso.', // 11
      '..oHhhSsesesseo.', // 12
      '..oHhsssSsososo.', // 13
      '..oHSssssssosso.', // 14
      '...oSsssssssso..', // 15
      '....ooSSSoooo...', // 16
      '....oCcsccco....', // 17
      '....oCccccco....', // 18
      '...oCCccccco....', // 19
      '..osoCcccccCoo..', // 20
      '.osSoCcccccosso.', // 21
      '..oooCcccccoSso.', // 22
      '....oCcccccooo..', // 23
      '....oPpppppoo...', // 24
      '...oPPPopppppo..', // 25
      '...oSSo.ooosso..', // 26
      '..oSSo.....osso.', // 27
      '..oSSo.....osso.', // 28
      '.offfo....offfo.', // 29
      '.oPPPo....oPPPo.', // 30
      '..ooo......ooo..', // 31
    ]),
    // win 1: 떠오름 — 만세 (발 1px 뜸)
    Object.freeze([
      '................', //  0
      '.....oo...oo....', //  1
      '....osso.osso...', //  2
      '....osSo.oSSo...', //  3
      '....osSoooSSo...', //  4
      '...oosSohhhhoo..', //  5
      '.ooHosSohhhhhho.', //  6
      'obbbosSobbbbbbo.', //  7
      'oBbBosSobbbbbbo.', //  8
      '.oboosSosssssso.', //  9
      '.oBoosSosesseso.', // 10
      '..oHosSoesesseo.', // 11
      '..oHosSoSsososo.', // 12
      '..oHosSosssosso.', // 13
      '...oosSossssso..', // 14
      '....ocCSSoooo...', // 15
      '....ocCsccco....', // 16
      '....oCccccco....', // 17
      '....oCccccco....', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCccccco....', // 21
      '....oCccccco....', // 22
      '....oCCCCCCo....', // 23
      '....oPpppppo....', // 24
      '....oPPopppo....', // 25
      '....oSSoosso....', // 26
      '....oSSoossoo...', // 27
      '...offfooffffo..', // 28
      '...oPPPooPPPPo..', // 29
      '....ooo..oooo...', // 30
      '................', // 31
    ]),
    // win 2: 정점 — 다리 접고 크게 웃음 (발 3px 뜸)
    Object.freeze([
      '.....oo...oo....', //  0
      '....osso.osso...', //  1
      '....osSo.oSSo...', //  2
      '....osSoooSSo...', //  3
      '...oosSohhhhoo..', //  4
      '.ooHosSohhhhhho.', //  5
      'obbbosSobbbbbbo.', //  6
      'oBbBosSobbbbbbo.', //  7
      '.oboosSosssssso.', //  8
      '.oBoosSosesseso.', //  9
      '..oHosSoesesseo.', // 10
      '..oHosSoSsoooso.', // 11
      '..oHosSosssosso.', // 12
      '...oosSossssso..', // 13
      '....ocCSSoooo...', // 14
      '....ocCsccco....', // 15
      '....oCccccco....', // 16
      '....oCccccco....', // 17
      '....oCccccco....', // 18
      '....oCccccco....', // 19
      '....oCccccco....', // 20
      '....oCccccco....', // 21
      '....oCCCCCCo....', // 22
      '....oPpppppo....', // 23
      '...oPPPpppppo...', // 24
      '..oSSSPoppssso..', // 25
      '.offfoo.ooffffo.', // 26
      '.oPPPo....oPPPo.', // 27
      '..ooo......ooo..', // 28
      '................', // 29
      '................', // 30
      '................', // 31
    ]),
    // win 3: 착지 (살짝 스쿼시)
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '.....ooooooo....', //  4
      '...oohhhhhhhoo..', //  5
      '.ooHhhhhhhhhhho.', //  6
      'obbbbbbbbbbbbbo.', //  7
      'oBbBBBbbbbbbbbo.', //  8
      '.obohhhhsssssso.', //  9
      '.oBoHhSssesseso.', // 10
      '..oHhhSsesesseo.', // 11
      '..oHhsssSsososo.', // 12
      '..oHSssssssosso.', // 13
      '...oSsssssssso..', // 14
      '....ooSSSoooo...', // 15
      '....oCcsccco....', // 16
      '....oCccccco....', // 17
      '....oCcccccCoo..', // 18
      '....oCcccccosso.', // 19
      '....oCcccccoSso.', // 20
      '....oCcccccooo..', // 21
      '....oCccccco....', // 22
      '....oPpppppoo...', // 23
      '...oPPPopppppo..', // 24
      '...oSSo.ooosso..', // 25
      '..oSSo.....osso.', // 26
      '..oSSo.....osso.', // 27
      '..oSSo.....osso.', // 28
      '.offfo....offfo.', // 29
      '.oPPPo....oPPPo.', // 30
      '..ooo......ooo..', // 31
    ]),
  ]),
  fall: Object.freeze([
    // fall 0: 앞으로 기우뚱 (뒷발 들림, 팔 앞으로)
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '................', //  4
      '......ooooooo...', //  5
      '....oohhhhhhhoo.', //  6
      '..ooHhhhhhhhhhho', //  7
      '.obbbbbbbbbbbbbo', //  8
      '.oBbBBBbbbbbbbbo', //  9
      '..obohhhhseessso', // 10
      '..oBoHhSssewseso', // 11
      '...oHhhSsseeseso', // 12
      '...oHhssssssosso', // 13
      '...oHSssssssosso', // 14
      '....oSsssssssso.', // 15
      '.....ooSSSccco..', // 16
      '......oCccccco..', // 17
      '.....oCccccco...', // 18
      '.....oCcccccCo..', // 19
      '.....oCcccccsso.', // 20
      '....oCcccccoosso', // 21
      '....oCCCCCCooSso', // 22
      '....oPpppppo.oo.', // 23
      '...oPPPopppo....', // 24
      '..oSSooossso....', // 25
      '.oSSo...osso....', // 26
      'oSSo....osso....', // 27
      'ofPo....osso....', // 28
      'ofPo...offffo...', // 29
      '.oo....oPPPPo...', // 30
      '........oooo....', // 31
    ]),
    // fall 1: 머리부터 쿵 — 몸이 대각선으로 늘어남 (스트레치)
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '..oo............', //  4
      '.ofPo...........', //  5
      '.ofPo...........', //  6
      '.osso...........', //  7
      '.osso...........', //  8
      '.osso...........', //  9
      'oPppo...........', // 10
      'oPpppo..........', // 11
      'oPPpppo.........', // 12
      '.oCccco.........', // 13
      '.oCccco.........', // 14
      '..oCccco........', // 15
      '..oCccco........', // 16
      '...oCccco.......', // 17
      '...oCccco.......', // 18
      '....oCccSo.oo...', // 19
      '...o.ooooooBbo..', // 20
      '..osooHHhhhBbho.', // 21
      '..oSoHhhhhhBbhho', // 22
      '...oSShhhhhBbhho', // 23
      '...ossShhhhBbhho', // 24
      '...osssShhhBbhho', // 25
      '...osssssShBbhho', // 26
      '...osSsssssBbhho', // 27
      '...osseesssBbhho', // 28
      '...ossssssSBbhho', // 29
      '....ossssSSBbhso', // 30
      '.....oooooooooo.', // 31
    ]),
    // fall 2: 바닥에 납작 엎어짐 (스쿼시, 발은 위로)
    Object.freeze([
      '................', //  0
      '................', //  1
      '................', //  2
      '................', //  3
      '................', //  4
      '................', //  5
      '................', //  6
      '................', //  7
      '................', //  8
      '................', //  9
      '................', // 10
      '................', // 11
      '................', // 12
      '................', // 13
      '................', // 14
      '................', // 15
      '................', // 16
      '................', // 17
      '................', // 18
      '................', // 19
      '.ooo............', // 20
      'offfo........o..', // 21
      'oPPfo......oobo.', // 22
      '.osso.oooooBbo..', // 23
      '.ossooHHhhhBbho.', // 24
      'oPppCHhhhhhBbhho', // 25
      'oPppSShhhhhBbhho', // 26
      'oPppsssShhhBbhho', // 27
      'oPPpssssssSBbhho', // 28
      '.oCCsseessSBbhho', // 29
      '..ooosssssSBbhso', // 30
      '.....oooooooooo.', // 31
    ]),
  ]),
});

// =============================================================
// 아이콘 — { w, h, rows: string[], colors: { 문자: 팔레트 인덱스 } }  ('.' 투명)
// 팔레트 인덱스는 src/palette.js 의 PALETTE 순서 (0 INK, 2 RED, 3 ORANGE, 4 YELLOW, 12 WHITE, 13 SILVER, 14 SLATE ...)
// =============================================================
const INK = 0, PLUM = 1, RED = 2, ORANGE = 3, YELLOW = 4, WHITE = 12, SILVER = 13, SLATE = 14;

export const ICONS = Object.freeze({
  // 왕관 (최종 우승자 표시) 9×7
  crown: Object.freeze({
    w: 9, h: 7,
    rows: Object.freeze([
      '.o..o..o.',
      'oyooyooyo',
      'oyyyyyyyo',
      'oyryryryo',
      'oyyyyyyyo',
      'orrrrrrro',
      'ooooooooo',
    ]),
    colors: Object.freeze({ o: INK, y: YELLOW, r: ORANGE }),
  }),

  // 스피커 켜짐 (음소거 버튼) 9×8 — 소리 물결은 SILVER (밝은/어두운 버튼 모두에서 보이게)
  speakerOn: Object.freeze({
    w: 9, h: 8,
    rows: Object.freeze([
      '....o....',
      '...owo.v.',
      '.oowwo..v',
      'owwwwov.v',
      'owwssov.v',
      '.oosso..v',
      '...oso.v.',
      '....o....',
    ]),
    colors: Object.freeze({ o: INK, w: WHITE, s: SILVER, v: SILVER }),
  }),

  // 스피커 꺼짐 (음소거) 9×8 — 빨간 X
  speakerOff: Object.freeze({
    w: 9, h: 8,
    rows: Object.freeze([
      '....o....',
      '...owo...',
      '.oowwo...',
      'owwwwor.r',
      'owwsso.r.',
      '.oossor.r',
      '...oso...',
      '....o....',
    ]),
    colors: Object.freeze({ o: INK, w: WHITE, s: SILVER, r: RED }),
  }),

  // 별 (Perfect·콤보 강조) 5×5
  star: Object.freeze({
    w: 5, h: 5,
    rows: Object.freeze([
      '..y..',
      '..y..',
      'yywyy',
      '.yyy.',
      '.y.y.',
    ]),
    colors: Object.freeze({ y: YELLOW, w: WHITE }),
  }),

  // 깃발 (진영 선·승리 표시) 8×10 — 깃대 + 펄럭이는 천
  flag: Object.freeze({
    w: 8, h: 10,
    rows: Object.freeze([
      'y.......',
      'trrr....',
      'trrrrrr.',
      'trrwrrrr',
      'tRrrrrrr',
      'tRRrrrr.',
      't..RRr..',
      't.......',
      't.......',
      'k.......',
    ]),
    colors: Object.freeze({ y: YELLOW, t: SILVER, k: SLATE, r: RED, R: PLUM, w: WHITE }),
  }),
});

/** 아이콘 이름 목록 */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
