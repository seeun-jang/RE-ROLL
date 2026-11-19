# 보드게임 서버 (파이썬)

RE:ROLL 보드게임 서버 원본(`docs/kmj-original/party.js`, Node.js)을 파이썬 asyncio 로 옮긴 것입니다.
화면(`board/` 폴더)은 **한 글자도 바꾸지 않고** 그대로 씁니다. 그래서 주고받는 메시지의 모양은 원본과 같습니다.

- 방: 4자리 번호 · 최대 5명 · 빈 자리는 CPU
- 한 턴: 주사위 고르기 → 모두 같이 굴림 → 동시에 이동 → 도착한 칸 효과 → 다 같이 미니게임 → 순위대로 주사위
- 우승: 결승에 먼저 도착 (마지막 턴까지 아무도 못 가면 결승에 제일 가까운 사람)
- 판정은 전부 서버가 합니다. 화면은 받은 상태를 그리고, 고른 것만 보냅니다.

## 파일

| 파일 | 내용 | 원본에서 온 곳 |
|---|---|---|
| `server/party/board/data.py` · `board_data.json` | 주사위 · 칸 · 미니게임 목록 · 보드판(71칸) · 결승까지 거리 | `board/shared/rules.js` · `board.js` |
| `server/party/board/jsutil.py` | 자바스크립트와 계산 결과를 맞추는 도구 (반올림 · 숫자 변환 · 글자 자르기 · `===`) | — |
| `server/party/board/room.py` | `Room` · `Player` · `Prompt`, 시간 설정 `Timings`, 상태 보내기(`snapshot`), 질문(`ask`/`answer`), 가방, 방장, 나가기 · 방 닫기 | 보내기 · 고르기 · 가방 · 방 |
| `server/party/board/game.py` | 한 판 진행: `start_game` / `run_game` / `phase_roll` / `roll_one` / `move` / `phase_spaces` / `apply_space` / `phase_minigame` / `finish_game` | 이동 · 한 판 · 1) 2) 3) 단계 |
| `server/party/board/manager.py` | `BoardManager`: 모든 방 관리, 메시지 처리, `status()` | `onPartyConnection` · `partyStatus` |
| `server/party/board/router.py` | FastAPI 에 붙이기 `attach_board(app, manager, board_dir)` | `server.js` 의 `/_party` 부분 |
| `server/tools/export_board_data.mjs` | `rules.js` · `board.js` → `board_data.json` 뽑기 (Node) | — |

`rules.js` 나 `board.js` 를 고치면 `node server/tools/export_board_data.mjs` 를 다시 실행합니다. 테스트가 JSON 이 최신인지 확인합니다.

## 붙이는 방법 (main.py)

```python
from party.board import BoardManager, attach_board

board = BoardManager()
attach_board(app, board)        # 맨 끝의 app.mount("/", …) 보다 먼저!
```

| 주소 | 내용 |
|---|---|
| WebSocket `/_party` | 화면과 실시간 통신. JSON 이 아닌 글자 · binary · 64KB 넘는 메시지는 무시 |
| `GET /_party/info` | `{"publicUrl": …}` — 환경 변수 `PUBLIC_URL` (없으면 빈 글자) |
| `GET /_party/status` | `[{code, phase, turn, players:[이름…]}]` |
| `/party/` | `board/` 폴더의 화면 파일 (`/party` 는 `/party/` 로 보냄) |

## 메시지 (모두 `{"t": 종류, …}` 모양의 JSON)

화면 → 서버

| t | 내용 | 조건 |
|---|---|---|
| `hello` | `{token, name}` 접속. 같은 `token` 의 자리가 있으면 그 자리로 | 맨 먼저 보내야 함 |
| `create` / `join` | `{name}` / `{name, code}` 방 만들기 / 들어가기 | 아직 방에 없을 때 |
| `leave` | 방 나가기 → `left` 를 받음 | |
| `name` | `{name}` 이름 바꾸기 (8글자까지) | |
| `turns` | `{n}` 턴 수 (6 · 10 · 15) | 방장 · 대기실 |
| `start` | 게임 시작 | 방장 · 대기실 |
| `lobby` | 끝난 뒤 대기실로 (접속한 사람만 남음) | 방장 · 끝난 뒤 |
| `answer` | `{id, value}` 질문에 대답 | 내 질문 · 보기에 있는 값 |
| `result` | `{score}` 미니게임 점수 (0 이상 정수로 다듬음) | 미니게임 중 · 한 번만 |
| `skipGame` | 결과를 안 보낸 사람을 기다리지 않기 | 방장 |

서버 → 화면

| t | 내용 |
|---|---|
| `welcome` | `{id}` 내 번호 (자리가 없으면 `null`) |
| `room` | 방의 상태 전체 (바뀔 때마다 전원에게) — 아래 참고 |
| `fx` | `{kind:"announce", text, icon, pid, big}` 화면 알림 |
| `error` | `{text}` — `이름을 먼저 정해 주세요` · `그런 방이 없어요` · `이미 게임이 시작된 방이에요` · `방이 꽉 찼어요 (5명)` |
| `left` | 방에서 나감 |

`room` 의 내용: `code` · `phase`(lobby/play/end) · `step`(choose/reveal/move/space/minigame/mgResult) · `turn` · `maxTurns` · `host`
· `players[{id,name,cpu,online,seat,node,dist,bag[주사위 id],flags{skip,mirror,shield,rest}}]`
· `prompts[{id,pid,kind,title,options[{value,label,icon?,desc?,seat?}],deadline,meta?}]`
· `rolls{번호:{dice,face,move,text,skip}}` · `mg{id,name,seed,startAt,done[번호]}` · `mgResult{name,rows[{id,name,score,rank,reward[]}]}`
· `log[최근 8줄]` · `ranking[{id,name,cpu,seat,dist,over,rank}]`

질문(`prompts`)의 `kind`: `dice`(주사위 고르기 · 선물할 주사위) · `branch`(갈림길, `meta.left` = 남은 걸음) · `parity`(홀/짝) · `target`(사람) · `timing`(1~10 숫자) · `reward`(1위 보상).
`deadline` 과 `mg.startAt` 은 1970년부터의 밀리초입니다. 시간이 지나거나 CPU · 끊긴 사람이면 서버가 대신 고릅니다.

## 시간 (밀리초, `room.py` 의 `Timings`)

| 이름 | 값 | 이름 | 값 |
|---|---|---|---|
| 한 칸 이동 `STEP_MS` | 230 | 미니게임 소개 `MG_INTRO_MS` | 3500 |
| 굴린 결과 `REVEAL_MS` | 2600 | 미니게임 최대 대기 `MG_MAX_MS` | 360000 (6분) |
| 칸 효과 `EFFECT_MS` | 1900 | 미니게임 결과 `MG_RESULT_MS` | 6000 |
| 주사위 고르기 `CHOOSE_MS` | 20000 | CPU 생각 `CPU_THINK_MS` | 500~1300 |
| 그 밖의 질문 `ASK_MS` | 12000 | 타이밍 주사위 `TIMING_MS` | 8000 |

위 값들은 환경 변수 `PARTY_SPEED` 로 나뉩니다 (`PARTY_SPEED=4` → 4배 빠름, 1 보다 작으면 1).
아래 값들은 원본 코드에 숫자로 직접 적혀 있던 것이라 `PARTY_SPEED` 의 영향을 받지 않습니다 (원본과 같음).
게임 시작 뒤 1500 · 이동 뒤 400 · 칸 이름 700 · 슬롯 900 · 대왕 주사위 600 · 미니게임 결과 확인 간격 500 · 순위 표시 1500
· 끊긴 사람 자동 대답 300 · 대기실에서 끊긴 사람 빼기 6000 · 빈 방 닫기 15000.
테스트는 `Timings(...)` 를 직접 만들어 전부 0 에 가깝게 줄여서 씁니다.

## 미니게임 끼워 넣기 (runner)

기본 방식은 원본과 같습니다. 서버가 `mg{id,name,seed,startAt}` 를 알리면 화면이 미니게임을 열고, 끝나면 `result{score}` 를 보냅니다.
접속한 사람이 모두 보내거나 · 방장이 `skipGame` 을 보내거나 · 6분이 지나면 순위를 매깁니다.

다른 방식으로 돌리고 싶으면 함수를 끼워 넣습니다.

```python
async def runner(room, mg) -> dict | None:
    mg["url"] = f"/play/{room.code}"      # mg 에 넣은 값은 화면으로 그대로 나감 (results · skip 만 빼고)
    room.broadcast()
    ...                                    # 여기서 게임을 돌린다
    return {player_id: {"score": 120, "rank": 1}, ...}

BoardManager(minigame_runner=runner, minigames=[{"id": "tug", "name": "줄다리기"}, ...])
```

- 부르는 때: `room.mg` 를 만들고 `step="minigame"` 상태를 전원에게 보낸 바로 뒤.
- 쓸 수 있는 것: `room.code`, `room.mg`(= `mg`), `room.humans()` → 사람 목록 (`id` · `name` · `seat` · `token` · `online`), `room.players`(CPU 포함), `room.broadcast()`.
- 돌려주는 값: `{참가자 id: {"score": 숫자, "rank": 정수}}`. `score` 는 `result` 와 같은 규칙으로 0 이상 정수가 됩니다.
- 결과에 없는 사람: CPU 와 끊긴 사람은 원본처럼 "평균 근처 랜덤 점수", 접속해 있는데 없는 사람은 0점.
- 순위: 먼저 원본처럼 점수순(같으면 랜덤)으로 줄을 세웁니다. 결과의 **모든** 사람에게 `rank` 가 있으면, 그 사람들이 차지한 자리를 `rank` 순서대로(같으면 랜덤) 다시 나눠 앉힙니다. `rank` 가 없거나 일부만 있으면 점수로 정합니다.
- `None` · 빈 dict 를 돌려주거나 오류가 나면 그 턴은 기본 방식(`result` 기다리기)으로 진행합니다.
- `minigames` 를 주면 그 목록에서 고릅니다 (바로 전 턴의 게임은 제외, 하나뿐이면 같은 게임을 계속).

## 원본과 다른 점

- `room` 의 `mg` · `mgResult` · `ranking`: 원본은 값이 생기기 전에는 키 자체가 없고, 여기서는 항상 `null` 로 나갑니다 (화면은 둘을 똑같이 봄). 원본에 이름만 있던 `players[].ready` 는 원래도 전송되지 않아서 넣지 않았습니다.
- 난수는 방마다 `random.Random` 하나(`room.rng`), 시각은 `room.clock()` 을 씁니다 → 테스트에서 고정할 수 있습니다. 난수를 쓰는 순서는 원본과 같습니다. 최종 순위의 동점 처리만 "한 사람에 난수 하나"로 바꿨습니다 (원본은 비교할 때마다 `Math.random() - 0.5`).
- 방이 닫히면 진행 중이던 게임 작업을 취소합니다. 동시에 하던 일 중 하나가 오류로 멈추면 나머지도 취소합니다 (원본은 버려 둠).
- 잘못된 입력: `{…}` 모양이 아닌 JSON 은 무시합니다 (원본은 서버 오류). 점수가 무한대면 0점. `NaN` · `Infinity` 가 든 JSON 은 거절. 64KB 넘는 메시지는 무시합니다 (원본은 연결을 끊음).
- 반올림은 자바스크립트 `Math.round`(0.5 는 올림)와 같게, 이름은 자바스크립트처럼 UTF-16 기준 8칸으로 자릅니다 (이모지가 반으로 잘리면 그 반쪽은 버림).
- `/_party/info` 는 `PUBLIC_URL` 만 봅니다 (원본의 `public-url.txt` 는 읽지 않음). `/` → `/party/` 이동과 옛 `/_net` 모드는 옮기지 않았습니다.

## 테스트

```powershell
cd server
$env:PYTHONUTF8='1'; .venv\Scripts\python.exe -m pytest -q tests\test_board_game.py tests\test_board_router.py
```

`test_board_router.py` 의 TestClient 테스트는 `httpx` 가 없으면 건너뜁니다 (같은 내용을 ASGI 직접 호출로도 확인합니다).
