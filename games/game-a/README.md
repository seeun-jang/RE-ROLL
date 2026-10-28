# 🐯🧙 game-a · PFC (Polytech Fighting Championship)

RE:ROLL 미니게임 A. 마법사 성 대연회장에서 **🐯 student(근접 격투가)** 와 **🧙 황종철 교수(대마법사)** 가
서로 완전히 다른 방식으로 싸우는 1:1 비대칭 결투입니다.

- **교수**: 마나로 마법을 써서 거리를 벌리고 견제 (미사일, 파이어볼, 낙뢰, 블링크, 아케인 폭발, 메테오)
- **student**: 스태미나로 마법을 뚫고 파고들어 콤보 (구르기, 대시, 도약, 포효, 발톱 콤보, 백호 난무)

## 단독 실행

Node.js 20.19 이상(22 LTS 권장)이 필요합니다.

```bash
cd games/game-a
npm install      # 처음 한 번만
npm run dev      # http://localhost:5173 이 자동으로 열림
```

> Windows PowerShell에서 "스크립트를 실행할 수 없으므로" 오류가 나면 `npm.cmd install`, `npm.cmd run dev`로 실행하세요.

## 게임 규칙

- **3판 2선승**, 한 라운드 50초. 체력 0이면 **K.O.**, 시간이 끝나면 체력이 더 많이 남은 쪽이 라운드 승리
- 큰 기술(발톱 베기, 도약, 파이어볼, 낙뢰, 궁극기)에 맞으면 넘어짐 → 일어날 때 잠깐 무적
- **가드**: 막으면 데미지가 크게 줄지만 자원(스태미나/마나) 소모. 바닥나면 방어가 깨짐
- **궁극기 게이지**: 때리거나 맞으면 차오르고, 가득 차면 궁극기 사용 가능

### 상성 (서로 확실한 파훼법이 있음)

| 교수의 마법 | student의 대처 |
|---|---|
| 매직 미사일 | 타이거 대시로 튕겨내기, 구르기로 통과 |
| 파이어볼 | 도약으로 뛰어넘기, 구르기로 통과, 포효로 소멸 |
| 낙뢰 (바닥에 예고 표시) | 표시를 보고 이동/구르기 |
| 메테오 (그림자 예고) | 범위 밖으로 피하거나 구르기 |

| student의 돌진 | 교수의 대처 |
|---|---|
| 붙어서 콤보 | 아케인 폭발로 멀리 밀쳐내기 |
| 구석에 몰림 | 블링크로 탈출 (벽 쪽이면 상대 뒤로 넘어감) |
| 대시·도약 | 끝나는 지점에 낙뢰를 미리 깔기, 방패로 막기 |

봇끼리 200판씩 시뮬레이션해서 승률을 맞췄습니다 (student:교수 = 회피를 잘하는 student 봇 107:93, 회피를 덜 하는 student 봇 83:117). 수치는 모두 `src/config.js`에 있습니다.

## 조작 (키보드)

| 버튼 | P1 student | P2 황종철 교수 |
|---|---|---|
| 이동 | A / D | ← / → |
| 공격 | F | K (또는 숫자패드 1) |
| 기술 | G | L (또는 숫자패드 2) |
| 회피 | S | ↓ |
| 가드 (누르고 있기) | W | ↑ |
| 궁극기 (게이지 가득) | E | I (또는 숫자패드 3) |

공격·기술 버튼은 **거리와 방향키**에 따라 다른 기술이 나갑니다.

| 버튼 | 조건 | student | 황종철 교수 |
|---|---|---|---|
| 공격 | 멀리서 | 잽 → 크로스 → 발톱 베기 (연타) | 매직 미사일 |
| 공격 | 가까이 | 〃 | 장풍 밀치기 |
| 기술 | 그냥 | 타이거 대시 (미사일 튕겨냄) | 파이어볼 |
| 기술 | 앞 + 기술 | 도약 내려찍기 (마법을 뛰어넘음) | 낙뢰 |
| 기술 | 뒤 + 기술 | 포효 (주변 마법 소멸, 가까우면 기절) | 블링크 (순간이동) |
| 기술 | 가까이 | 니킥 | 아케인 폭발 (밀쳐냄) |
| 회피 | | 구르기 (완전 무적, 상대 통과) | 백스텝 |
| 궁극기 | 게이지 가득 | 백호 난무 (돌진 6연타) | 메테오 (운석 낙하) |

- 타이틀: Space/Enter 시작, H 조작법 · 경기 중: Esc/P 일시정지, M 소리 · 결과: R 다시하기, Enter 결과 확정, Esc 타이틀

## 연출

- 추적 카메라(거리에 따라 줌, K.O. 때 슬로모션 + 집중), 히트스톱, 집중선, 섬광, 잔상(대시·구르기·궁극기)
- 마법 이펙트: 미사일 꼬리, 일렁이는 파이어볼, 바닥 예고 마법진 → 번개, 그림자 → 떨어지는 운석과 폭발
- student의 발톱 자국 / 교수의 룬 문자 타격 이펙트, 포효 충격파, 블링크 잔광
- 무대: 스테인드글라스 빛줄기, 떠다니는 촛불, 학생 관중, 반사되는 바닥, 마법진, 빛 번짐(블룸)
- 느린 컴퓨터에서는 반사/흐림을 자동으로 꺼서 프레임 유지 · 소리는 파일 없이 Web Audio로 합성

## 메인 게임 연동

메인 앱은 `src/index.js`만 import 하면 됩니다.

```jsx
import BlackCombatGame, { gameMeta } from '../games/game-a/src';

<BlackCombatGame
  onFinish={(result) => {}}  // 결과 화면에서 [결과 확정]을 눌렀을 때 (한 번만 호출)
  onExit={() => {}}          // 타이틀에서 [메인으로]를 눌렀을 때 (결과 없이 나가기)
/>
```

결과 데이터 (공통 형식 + 참고용 `details`):

```json
{
  "gameId": "game-a",
  "scores": [
    { "playerId": "p1", "score": 212 },
    { "playerId": "p2", "score": 158 }
  ],
  "details": {
    "winner": "p1",
    "wins": { "p1": 2, "p2": 1 },
    "rounds": [
      { "winner": "p2", "method": "ko", "time": 31.2 },
      { "winner": "p1", "method": "time", "time": 50 },
      { "winner": "p1", "method": "ko", "time": 22.8 }
    ],
    "fightTimeSec": 104.0,
    "players": [{ "playerId": "p1", "character": "tiger", "rank": 1, "damage": 312, "landed": 58 }]
  }
}
```

- **점수** = 준 데미지 + 명중 수 + 이긴 라운드×25 + 최종 승리 +30
- 승자 점수는 항상 패자보다 높습니다 → **점수 순위 = 경기 승패**. 무승부면 두 점수가 같습니다.
- 주사위 보상과 보드 이동은 메인 시스템이 담당합니다.

통합 시 참고:
- 이 폴더의 `package.json`, `index.html`, `src/main.jsx`, `vite.config.js`는 **단독 테스트용**입니다.
- 메인 Vite 설정에 `resolve: { dedupe: ['react', 'react-dom'] }`를 추가해 React가 두 벌 로드되지 않게 해 주세요.
- 모든 CSS 클래스는 `bc-`로 시작합니다. 글꼴(Bebas Neue, Do Hyeon)은 CSS에서 직접 불러옵니다.
- 게임은 부모 요소 크기에 맞춰 16:9로 자동 확대/축소됩니다. 부모 요소에 너비와 높이를 지정해 주세요.
- 추가 라이브러리 없음 (React만 사용). API 키나 모델 파일 없음.

## 웹캠 모션 연결 지점 (3단계)

입력은 `src/input/`에 분리되어 있습니다. `read()`가 아래 형식을 돌려주는 입력 장치를 만들어
`<BlackCombatGame inputSources={[motionInput]} />`으로 넘기면 키보드와 함께 동작합니다.

```js
{ p1: { move, guard, dodge, attack, skill, super }, p2: { ... } }
```

| 게임 동작 | 몸동작 (예정) |
|---|---|
| 공격 | 팔을 상대 쪽으로 빠르게 뻗기 (교수는 손바닥 내밀기) |
| 기술 | 무릎 들기 (student) / 두 손 모아 내밀기 (교수) |
| 회피 | 몸을 빠르게 숙이기 |
| 가드 | 두 손을 얼굴 앞으로 |
| 궁극기 | 두 팔을 머리 위로 들기 |
| 이동 | 좌우로 스텝 |

AI 기능 확장 아이디어는 [`src/ai/README.md`](src/ai/README.md)를 참고하세요.

## 폴더 구조

```
games/game-a/
├── index.html, vite.config.js, package.json   # 단독 실행용
└── src/
    ├── index.js               # ★ 메인 게임이 import 하는 진입점
    ├── main.jsx               # 단독 실행용 래퍼 (결과 JSON 미리보기)
    ├── config.js              # ★ 규칙, 두 캐릭터의 기술 수치, 자원, 키 배치, 색
    ├── BlackCombatGame.jsx    # 화면 전환 (타이틀 → 조작법 → 경기 → 결과)
    ├── screens/               # TitleScreen, HowToScreen, FightScreen(게임 루프), ResultScreen
    ├── ui/                    # Hud(체력·자원·궁극기·라운드), Showcase(연출 배경), Portrait, KeyCap
    ├── engine/                # 게임 규칙 (React·그림과 무관)
    │   ├── match.js           # 라운드(2선승), 마법 생성, 관중, 심판 위치
    │   ├── fighter.js         # 선수 상태, 버튼+거리+방향 → 기술 선택, 이동기, 자원, 궁극기 게이지
    │   └── combat.js          # 근접·범위·투사체·낙뢰·메테오·포효 판정, 가드, 무적
    ├── render/
    │   ├── renderer.js        # 카메라, 그리는 순서, 반사, 잔상, 블룸, 화면 효과
    │   ├── spells.js          # 미사일, 파이어볼, 낙뢰, 메테오 그리기
    │   ├── particles.js       # 타격·마법 이펙트
    │   ├── stage.js           # 성 대연회장, 빛줄기, 촛불, 학생 관중, 바닥
    │   ├── rig.js, poses.js   # 관절 계산, 기술별 자세
    │   ├── tiger.js, professor.js, parts.js, character.js  # 캐릭터 그리기
    │   ├── referee.js         # 유령 심판
    │   └── showcase.js        # 타이틀/결과 배경, HUD 초상화
    ├── input/                 # actions(입력 형식), keyboardInput, inputManager
    ├── audio/sfx.js           # 효과음 합성
    ├── result/buildResult.js  # 메인 게임 전달용 결과 데이터
    ├── ai/README.md           # AI 기능 확장 계획
    └── styles/blackcombat.css
```

## 진행 상황

- [x] 1단계 기획
- [x] 2단계 기본 게임: 비대칭 기술 17종 (student 9 · 교수 8), 마법 투사체·범위기, 2선승 라운드, 연출, HUD, 결과 데이터
- [ ] 3단계 웹캠 모션 인식 (MediaPipe Pose Landmarker, 두 명 동시 인식)
- [ ] 4단계 통합 준비, AI 기능
