# 🥊 game-a · 블랙컴뱃 (BLACK COMBAT)

RE:ROLL 미니게임 A. 레드 코너와 블루 코너 두 선수가 관중의 함성 속에서 1라운드 킥복싱 대결을 펼칩니다.

## 단독 실행

Node.js 20.19 이상(22 LTS 권장)이 필요합니다.

```bash
cd games/game-a
npm install      # 처음 한 번만
npm run dev      # http://localhost:5173 이 자동으로 열림
```

> Windows PowerShell에서 "스크립트를 실행할 수 없으므로" 오류가 나면 `npm.cmd install`, `npm.cmd run dev`로 실행하세요.

## 게임 규칙

- **1라운드 60초**. "ROUND 1 → FIGHT!" 후 시작
- 상대 체력(150)을 0으로 만들면 **K.O. 승리**
- 시간이 끝나면 남은 체력이 많은 쪽이 **판정승**, 같으면 무승부
- **펀치**: 빠르고 약함 / **킥**: 느리지만 강하고 사거리가 김
- **가드**: 막으면 데미지가 크게 줄지만 스태미나를 씀. 스태미나가 바닥나면 **가드 브레이크**(잠깐 어지러움)
- **스태미나**: 공격할 때도 쓰고, 시간이 지나면 회복 (부족하면 공격이 안 나가고 땀이 남)
- **필살기 게이지**: 때리거나 맞으면 차오름. 가득 차면 회전 돌려차기(큰 데미지) 사용 가능

## 조작 (키보드)

| 동작 | P1 (레드, 왼쪽) | P2 (블루, 오른쪽) |
|---|---|---|
| 이동 | A / D | ← / → |
| 펀치 | F | . (마침표) 또는 숫자패드 1 |
| 킥 | G | / (슬래시) 또는 숫자패드 2 |
| 가드 (누르고 있기) | S | ↓ |
| 필살기 | W | ↑ |

- 타이틀: Space 또는 Enter로 시작
- 결과 화면: R = 다시하기, Enter = 결과 확정
- 경기 중 M 또는 오른쪽 아래 🔊 버튼: 소리 켜기/끄기
- 키 배치, 체력, 데미지, 시간, 선수 외형(피부/머리/색), 관중 열기, 소리 등은 모두 `src/config.js`에서 바꿀 수 있습니다.

## 분위기 연출

- **관중**: 경기 열기(hype)에 따라 들썩이고 팔을 흔들며, 응원봉과 피켓을 선수 색으로 흔듭니다. 카메라 플래시와 움직이는 조명도 열기에 비례해 많아집니다.
- **함성 글자**: 타격이 들어가면 "와아!", "나이스!" 같은 글자가 관중석에 떠오릅니다.
- **K.O./판정승**: 슬로모션, 화면 흔들림, 꽃가루, 결과 화면 꽃가루
- **효과음**: 소리 파일 없이 브라우저(Web Audio)로 합성합니다. 관중 함성, 펀치/킥/필살기 타격음, 가드 소리, 공 소리(시작 땡, 종료 땡땡땡)

## 메인 게임 연동

메인 앱은 `src/index.js`만 import 하면 됩니다.

```jsx
import BlackCombatGame, { gameMeta } from '../games/game-a/src';

<BlackCombatGame
  onFinish={(result) => {}}  // 결과 화면에서 [결과 확정]을 눌렀을 때 (한 번만 호출)
  onExit={() => {}}          // 타이틀에서 [메인으로]를 눌렀을 때 (결과 없이 나가기)
/>
```

결과 데이터:

```json
{
  "gameId": "game-a",
  "scores": [
    { "playerId": "p1", "score": 100 },
    { "playerId": "p2", "score": 74 }
  ],
  "details": {
    "winner": "p1",
    "reason": "ko",
    "fightTimeMs": 41234,
    "players": [
      { "playerId": "p1", "rank": 1, "hp": 37, "damageDealt": 150, "hitsLanded": 17, "blocked": 2 },
      { "playerId": "p2", "rank": 2, "hp": 0, "damageDealt": 139, "hitsLanded": 12, "blocked": 0 }
    ]
  }
}
```

- 점수: 승자 100점, 패자는 상대에게 준 데미지 비율 × 80점(0~80), 무승부는 둘 다 100점
- `details`는 참고용입니다. 메인 게임은 `scores`만 써도 됩니다.
- `reason`: `"ko"`(K.O.), `"decision"`(판정승), `"draw"`(무승부)

통합 시 참고:
- 이 폴더의 `package.json`, `index.html`, `src/main.jsx`, `vite.config.js`는 **단독 테스트용**입니다.
- 메인 앱과 React가 두 벌 로드되지 않도록 메인 Vite 설정에 `resolve: { dedupe: ['react', 'react-dom'] }`를 추가해 주세요.
- 모든 CSS 클래스는 `bc-`로 시작해서 다른 게임 스타일과 겹치지 않습니다. 글꼴(Black Han Sans, Jua)은 CSS에서 직접 불러옵니다.
- 게임은 부모 요소 크기에 맞춰 16:9로 자동 확대/축소됩니다. 부모 요소에 너비와 높이를 지정해 주세요.

## AI/모션 연결 지점 (통합 후 작업)

입력은 `src/input/`에 분리되어 있습니다. 웹캠 모션 인식을 붙일 때는
`read()`가 `{ p1: { move, guard, punch, kick, special }, p2: {...} }`를 돌려주는 입력 장치를 만들어
`FightScreen.jsx`의 `createInputManager([...])` 목록에 추가하면 됩니다. 게임 엔진은 바꿀 필요가 없습니다.

| 게임 동작 | 어울리는 몸동작 |
|---|---|
| 펀치 | 팔을 앞으로 뻗기 |
| 킥 | 다리 들어 올리기 |
| 가드 | 두 손을 얼굴 앞으로 |
| 이동 | 좌우로 스텝 |
| 필살기 | 두 팔 머리 위로 들기 |

## 폴더 구조

```
games/game-a/
├── index.html, vite.config.js, package.json   # 단독 실행용
└── src/
    ├── index.js               # ★ 메인 게임이 import 하는 진입점
    ├── main.jsx               # 단독 실행용 래퍼 (결과 JSON 미리보기)
    ├── config.js              # 시간, 체력, 공격 수치, 가드, 키 배치, 점수
    ├── BlackCombatGame.jsx    # 화면 전환 (타이틀 → 경기 → 결과)
    ├── screens/
    │   ├── TitleScreen.jsx    # 타이틀 + 조작 안내
    │   ├── FightScreen.jsx    # 게임 루프 (입력 → 계산 → 그리기)
    │   ├── HUD.jsx            # 체력, 스태미나, 필살기, 시간, ROUND/K.O. 문구
    │   ├── ResultScreen.jsx   # 결과 + 다시하기/결과 확정
    │   └── controls.js        # 조작 안내 문구 도우미
    ├── engine/                # React와 무관한 게임 로직
    │   ├── fighter.js         # 선수 상태, 이동, 공격 시작, 스태미나
    │   ├── combat.js          # 타격/가드 판정, 밀어내기
    │   ├── match.js           # 라운드 진행, K.O./판정, 승패, 관중 열기
    │   ├── drawFighter.js     # 사람 캐릭터 그리기 (관절 계산, 자세별 애니메이션)
    │   └── renderer.js        # 링, 움직이는 관중, 조명, 플래시, 타격 효과, 꽃가루
    ├── audio/
    │   └── crowdAudio.js      # 관중 함성, 타격음, 공 소리 (Web Audio 합성)
    ├── input/
    │   ├── keyboardInput.js   # 키보드 → 조작 값
    │   └── inputManager.js    # 여러 입력 장치 합치기
    ├── result/
    │   └── buildResult.js     # 메인 게임 전달용 결과 데이터
    ├── components/
    │   └── FighterPortrait.jsx # 타이틀/결과 화면 캐릭터
    └── styles/
        └── blackcombat.css
```

## 진행 상황

- [x] 기획, 단독 실행 환경
- [x] 이동, 펀치, 킥, 가드, 필살기, 스태미나
- [x] 타격 판정, 가드 브레이크, K.O. 슬로모션, 판정승
- [x] 타이틀, HUD, 결과 화면, 다시하기, 결과 데이터
- [x] 사람 캐릭터 (관절 길이 기반 자세), 환호하는 관중, 효과음
- [ ] 통합 후: 웹캠 모션 인식, AI 기능
