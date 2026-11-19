# RE:ROLL 파티 서버

보드게임(메인 화면 → 방 → 보드 → 미니게임) 전체를 이 서버 하나가 돌립니다. 컴퓨터 1대에 1명씩 접속합니다.

## 실행

```bash
cd server
npm install
npm start
```

- 서버를 켠 컴퓨터: `https://localhost:8443` (또는 `http://localhost:8080`)
- 다른 컴퓨터: 서버 창에 찍힌 `https://<IP>:8443`
  - 처음 한 번 "안전하지 않음" 경고가 뜨면 **고급 → 계속**을 누르세요 (자체 서명 인증서).
  - 카메라, 마이크, WebGPU(AI 기능)는 HTTPS에서만 됩니다.
- 주소로 들어오면 바로 메인 화면(`/party/`)이 뜹니다.
- 시험할 때 `PARTY_SPEED=5 npm start`로 켜면 연출 시간이 5배 빨라집니다.

## 아무 컴퓨터에서나 접속 (인터넷)

```bash
cd server
npm run share
```

- 서버를 켜고, Cloudflare 무료 터널로 `https://….trycloudflare.com` 주소를 만들어 창에 크게 보여줍니다. 대기실 화면에도 이 주소가 나옵니다.
- 가입이 필요 없습니다. 진짜 HTTPS라서 경고 없이 카메라, 마이크, AI 기능이 됩니다.
- 처음 한 번은 `brew install cloudflared`가 필요합니다. 윈도우는 `winget install Cloudflare.cloudflared`입니다.
- 주의할 점
  - 이 창을 끄거나 컴퓨터가 잠들면 접속이 끊깁니다.
  - 켤 때마다 주소가 바뀝니다.
  - 주소를 아는 사람은 누구나 게임 파일을 받을 수 있습니다.
- 모든 사람의 게임 파일과 AI 모델이 이 컴퓨터에서 나갑니다. 그래서 AI 모델을 처음 켤 때는 느릴 수 있습니다(볼링 모델은 약 580MB).

### 클라우드에 올리기 (컴퓨터를 꺼도 되게)

- Render, Railway, Fly.io처럼 WebSocket을 계속 유지하는 곳에 `server/`를 Node 앱으로 올립니다. Vercel은 WebSocket을 유지하지 못해서 안 됩니다.
- 그런 곳이 주는 `PORT`를 서버가 알아서 씁니다. HTTPS도 그쪽이 해 주므로 자체 인증서는 만들지 않습니다.
- 저장소가 3GB를 넘어서 `*/models` 폴더는 빼고 올리는 걸 추천합니다. 로컬 모델이 없으면 AI 기능은 Hugging Face에서 바로 받아 옵니다.

## 게임 흐름

1. 메인 화면에서 이름을 정하고 **방 만들기**를 누르면 4자리 방 번호가 생깁니다. 다른 사람은 그 번호로 **방 참가**를 합니다.
2. 대기실은 최대 5명입니다. 빈 자리는 CPU가 채웁니다. 방장이 턴 수(6/10/15)를 고르고 시작합니다.
3. 한 턴은 이렇게 진행됩니다.
   1. 각자 주사위를 고릅니다. 쓰레기 주사위가 있으면 무조건 그걸 굴립니다.
   2. 5명이 동시에 굴리고 동시에 이동합니다. 갈림길에서는 길을 고릅니다.
   3. 도착한 칸의 효과를 받습니다.
   4. 다 같이 같은 랜덤 미니게임을 합니다. 화면 전체 iframe으로 열립니다.
   5. 순위대로 주사위를 받습니다. 1위는 재밌는 주사위 3개 중에서 고르고, 2위는 재밌는 주사위 랜덤, 3위는 보통 주사위 랜덤입니다.
4. 결승에 먼저 도착하면 우승입니다. 마지막 턴까지 아무도 못 가면 결승에 제일 가까운 사람이 이깁니다.

- 새로고침하거나 잠깐 끊겨도 같은 자리로 돌아옵니다.
- 게임 중에 나간 사람은 CPU처럼 자동으로 진행됩니다.
- 미니게임을 안 끝내는 사람이 있으면, 방장이 "기다리지 않고 진행"을 누를 수 있습니다.

## 파일

| 파일 | 내용 |
|---|---|
| `server/server.js` | 파일 내보내기 · HTTPS · WebSocket 연결 |
| `server/party.js` | 방 · 턴 진행 · 주사위 · 칸 효과 · 미니게임 순위와 보상 (판정은 전부 서버) |
| `party/shared/rules.js` | 주사위 · 칸 · 미니게임 목록 (서버와 화면이 같이 씀) |
| `party/shared/board.js` | 보드판 칸 배치와 갈림길 |
| `party/main.js` · `party/board-view.js` | 화면 |

- 미니게임은 `/<게임폴더>/?mode=personal&autostart=1&embed=1&char=<1~5>&name=<이름>&seed=<같은 수>&net=0`으로 엽니다.
- 미니게임이 내보내는 `RE_MINIGAME_RESULT` 메시지에서, `cpu`가 아닌 줄의 `score`를 점수로 씁니다.
- 주사위나 칸을 추가하려면 `rules.js`에 정의를 넣고, `party.js`의 `rollOne`(주사위)이나 `applySpace`(칸)에 효과를 넣으면 됩니다.

## 메시지 (WebSocket `/_party`)

클라이언트 → 서버

| t | 내용 |
|---|---|
| `hello` | `{ token, name }` 접속. `token`이 같으면 원래 자리로 |
| `create` / `join` | `{ name }` / `{ name, code }` 방 만들기 / 참가 |
| `turns` | `{ n }` 방장만. 턴 수 |
| `start` | 방장만. 시작 |
| `answer` | `{ id, value }` 서버가 물어본 것(prompt)에 대한 답 |
| `result` | `{ score }` 내 미니게임 점수 |
| `skipGame` | 방장만. 미니게임 안 끝낸 사람 기다리지 않기 |
| `lobby` / `leave` | 방장만, 끝난 뒤 대기실로 / 방 나가기 |

서버 → 클라이언트

| t | 내용 |
|---|---|
| `welcome` | `{ id }` 내 번호 (방에 없으면 null) |
| `room` | 전체 상태: `phase`, `step`, `turn`, `players[{id, name, seat, node, dist, bag, flags}]`, `prompts`, `rolls`, `mg`, `mgResult`, `ranking` |
| `fx` | `{ kind: 'announce', text, icon, big }` 화면 알림 |
| `error` | `{ text }` |

## 미니게임 하나만 차례대로 (예전 방식)

게임 주소로 바로 들어가면(예: `/jackpot-bowling/`) 그 게임 하나만 한 명씩 차례대로 하고 관전하는 방식이 됩니다. 이때는 WebSocket `/_net`을 씁니다. 보드게임 안에서 열 때는 이 방식이 꺼집니다.
