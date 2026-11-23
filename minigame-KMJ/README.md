# 🏛️ 트로이의 노래 — SONG OF TROY (KMJ)

RE:ROLL 미니게임. 트로이 성문 앞에서 울리는 전쟁 북소리에 맞춰 두 영웅이 겨루는 **2인 리듬 배틀**입니다.
P1 아킬레우스(사자)와 P2 헥토르(늑대)가 같은 채보를 동시에 쳐서 점수로 승부해요.

## 실행

```bash
cd minigame-KMJ
npm install
npm run dev
```

브라우저에서 터미널에 나온 주소(보통 http://localhost:5173)를 열면 됩니다. `M` 키로 소리를 켜고 끌 수 있어요.

## 🤖 AI 채보 생성 (아무 노래나 넣기)

시작 화면에서 **노래 불러오기**를 누르거나 노래 파일(mp3, wav, m4a 등)을 화면에 끌어다 놓으면, 그 노래로 채보를 만들어 바로 플레이할 수 있어요.

| 단계 | 하는 일 | 방법 |
|---|---|---|
| 음원 읽기 | 파일을 16kHz 모노로 변환 | Web Audio |
| 박자 추적 | BPM과 박자 위치 찾기 (오차 약 10ms) | 신호 처리: FFT 온셋 검출 + 동적 계획법 박자 추적 |
| AI 음악 분석 | 10초 구간마다 어떤 소리인지 분류 → 격렬함 점수, 장르 | **Hugging Face** [MIT AST](https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593) (AudioSet 527종), transformers.js |
| 채보 생성 | 가장 신나는 60초를 골라 노트 배치 | 격렬한 구간은 엇박·16분음표·동시 노트, 잔잔한 구간은 정박 위주 |

- 모든 처리가 **브라우저 안에서** 돌아가요. 노래 파일은 어디에도 올라가지 않고, API 키도 필요 없어요.
- 모델은 처음 한 번만 내려받고(그래픽카드 사용 시 약 51MB) 브라우저에 저장돼요.
- 그래픽카드(WebGPU)가 되는 브라우저(크롬, 엣지)에서는 분석이 몇 초면 끝나요. WebGPU가 안 되면 CPU로 돌리는데 훨씬 느려서, 분석하는 구간 수를 줄여요.
- AI 분석이 실패해도(인터넷 끊김 등) 박자 분석만으로 채보를 만들어요.
- 같은 노래는 항상 같은 채보가 나와요.

## 조작

| 레인 | ◀ | ▼ | ▲ | ▶ |
|---|---|---|---|---|
| P1 아킬레우스 | A | S | W | D |
| P2 헥토르 | ← | ↓ | ↑ | → |

## 규칙

- 노트가 판정선에 닿는 순간 해당 키를 누릅니다. PERFECT 300 / GREAT 200 / GOOD 100 점입니다.
- 콤보 25마다 점수 배율이 +0.5씩 올라가요 (최대 x2.5). 이때 **신의 창**이 상대에게 날아가고 보너스 500점을 받아요.
- 점수가 앞서는 쪽이 가운데 무대에서 상대를 밀어붙입니다.
- 마지막 구간은 **최후의 결전**이에요. 노트가 더 빽빽하게 나와요.
- 노래는 128 BPM에 약 65초이고, 노트는 258개입니다.

## 메인 보드게임 연결

```jsx
import { TroyRhythmGame } from '../minigame-KMJ/src/index.js';

<TroyRhythmGame
  onFinish={(result) => { /* 주사위 보상 계산 */ }}
  onExit={() => { /* 보드 화면으로 돌아가기 */ }}
/>
```

`onFinish`로 전달되는 값:

```json
{
  "gameId": "minigame-KMJ",
  "scores": [
    { "playerId": "p1", "score": 98250 },
    { "playerId": "p2", "score": 61400 }
  ]
}
```

팀 공통 규격이 정해지면 `src/game/config.js`의 `GAME_ID`와 `src/game/result.js`만 수정하면 됩니다.

## 파일 구조

```
src/
├─ index.js               메인 보드게임에서 import 하는 입구
├─ main.jsx, dev.css      혼자 테스트할 때만 쓰는 화면
├─ styles.css             미니게임 스타일 (클래스는 모두 kmj- 로 시작)
├─ game/
│  ├─ TroyRhythmGame.jsx  미니게임 전체 (시작 → 플레이 → 결과)
│  ├─ GameCanvas.jsx      게임 루프 (노래 재생 → 입력 → 판정 → 그리기)
│  ├─ config.js           판정 범위, 점수, 키 설정, GAME_ID
│  ├─ song.js             노래와 채보 (멜로디를 따라 노트 자동 생성)
│  ├─ audio.js            음악·효과음 (파일 없이 Web Audio 로 생성)
│  ├─ engine.js           판정, 콤보, 점수, 신의 창
│  ├─ renderer.js         노트 레인, 무대, HUD, 연출
│  ├─ scenery.js          트로이 배경
│  ├─ heroes.js           아킬레우스/헥토르 캐릭터 그림
│  └─ result.js           메인으로 넘기는 결과 데이터
├─ ai/                     AI 채보 생성
│  ├─ analyzeSong.js       노래 파일 → 게임용 노래 (입구)
│  ├─ chartWorker.js       무거운 분석을 따로 돌리는 Web Worker
│  ├─ beatTracker.js       박자 추적 (FFT, 온셋, 템포, 박자 위치)
│  ├─ audioTagger.js       Hugging Face AST 모델로 구간 분위기·장르 분석
│  └─ chartMaker.js        하이라이트 고르기 + 노트 배치
├─ input/
│  ├─ keyboardInput.js    키보드 입력 (누른 순간의 노래 시간 기록)
│  ├─ motionInput.js      웹캠 모션 입력 (3단계에서 구현)
│  └─ index.js
└─ screens/
   ├─ TitleScreen.jsx     시작 화면
   ├─ ResultScreen.jsx    결과 화면
   ├─ AnalyzeScreen.jsx   노래 분석 진행 화면
   ├─ Backdrop.jsx        화면 뒤 트로이 배경
   └─ HeroPortrait.jsx    영웅 초상화
```

## 개발 단계

- [x] 1단계 기획
- [x] 2단계 기본 게임 (키보드 조작)
- [ ] 3단계 웹캠 모션 인식 (MediaPipe Pose)
  - 화면 왼쪽 사람 = P1, 오른쪽 사람 = P2
  - 레인 4개를 동작 4개로: ◀ 왼손 뻗기 / ▼ 앉기 / ▲ 두 손 들기 / ▶ 오른손 뻗기
- [ ] 4단계 통합 준비

## AI 기능 아이디어

1. **자세 인식 (MediaPipe Pose)**: 키 대신 몸동작으로 노트를 칩니다. 리듬에 맞춰 춤추듯 싸우는 게임이 돼요.
2. **음악 분석으로 채보 생성** ✅ 구현 완료: 위의 "AI 채보 생성"을 보세요.
3. **생성형 AI 서사시**: 경기 기록으로 호메로스풍 한 줄 서사시를 만들어 결과 화면에 보여줍니다. API 키는 코드에 넣지 않고 서버나 환경변수로 관리합니다.
