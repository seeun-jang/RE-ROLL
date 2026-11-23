# 미니게임 공통 규격과 통신 규약

모든 미니게임이 이 규격을 지키면, 나중에 전체 판(보드)은 이 문서만 알고 게임을 끼울 수 있다.

## 1. 역할 나누기

| 브라우저 (JavaScript) | 서버 (Python) |
|---|---|
| 화면 그리기, 소리, 연출 | 참가자 관리, 게임 시작과 종료 |
| 키보드·카메라·마이크 입력 받기 | 판정, 점수, 승패, 팀 나누기 |
| 입력을 서버로 보내기 | AI 모델 실행(해당 게임만) |
| 서버가 보낸 상태를 그대로 보여주기 | 모든 참가자에게 같은 상태 보내기 |

브라우저는 반응이 느려 보이지 않도록 자기 입력의 결과를 먼저 예상해 보여줄 수 있다. 점수와 승패에는 서버 결과만 쓴다.

## 2. 메시지 형식 (WebSocket, JSON)

모든 메시지는 `{"t": 종류, "d": 내용}` 이다.

### 브라우저 → 서버

| t | d | 설명 |
|---|---|---|
| `hello` | `{name, token?}` | 입장. token 이 있으면 같은 참가자로 재접속 |
| `ping` | `{c}` | 시계 맞추기. c = 보낸 쪽 시각 |
| `lobby.character` | `{character}` | 내 캐릭터 고르기. 한 캐릭터는 한 사람만 |
| `lobby.select` | `{gameId}` | 게임 고르기 (방장만) |
| `lobby.start` | `{}` | 게임 시작 (방장만) |
| `game.input` | `{run, seq, data}` | 미니게임 입력. data 는 게임마다 다름 |
| `game.abort` | `{}` | 게임 중단 (방장만) |

### 서버 → 브라우저

| t | d | 설명 |
|---|---|---|
| `welcome` | `{you: {id, name}, token, serverTime}` | 입장 완료 |
| `pong` | `{c, s}` | s = 서버 시각(초) |
| `room` | `{phase, gameId, run, hostId, maxPlayers, characters, participants, games}` | 대기실 상태. 바뀔 때마다 전원에게. participants 항목: `{id, name, connected, isHost, character}` |
| `game.start` | `{run, gameId, players, options, serverTime, resumed}` | 미니게임 시작. resumed = 재접속으로 다시 받은 경우 |
| `game.state` | `{run, data}` | 현재 상태. 최신 것만 있으면 된다 |
| `game.event` | `{run, data}` | 한 번 일어난 일(판정 결과 등) |
| `game.end` | `{run, gameId, results, aborted}` | 미니게임 종료와 결과 |
| `error` | `{code, message, re}` | 요청 거절. message 는 화면에 보여줄 한국어 문장 |

오류 코드: `not_joined`, `already_joined`, `room_full`, `game_in_progress`, `not_host`, `unknown_game`, `bad_player_count`, `unknown_character`, `character_taken`, `unknown_type`, `replaced`

### 잘못 적용되지 않게 하는 장치

- **참가자 구분:** 서버가 연결마다 참가자 id(`p1`~`p5`)를 정한다. 입력의 주인은 메시지 내용이 아니라 연결로 판단한다.
- **실행 번호 `run`:** 미니게임을 시작할 때마다 1씩 오른다. 번호가 다른 입력과 상태는 버린다.
- **순번 `seq`:** 참가자마다 계속 커지는 수. 이미 처리한 순번 이하의 입력은 버린다.
- **재접속:** 브라우저가 token 을 탭 단위로 보관한다. 게임 중 끊겼다 돌아오면 같은 참가자로 이어진다.

## 3. 세션 (브라우저)

화면 코드는 세션 객체만 쓴다. 종류가 달라도 메서드와 이벤트가 같다.

| 종류 | 쓰임 |
|---|---|
| `RemoteSession` | 실제 서버와 통신 |
| `LocalSession` | 서버 없이 시험용 봇과 화면·입력 확인 (주소에 `?local`) |

```js
await session.connect(name)      // → { id, name }
session.now()                    // 서버 시계(초)
session.selectCharacter(id); session.selectGame(id); session.startGame(); session.abortGame();
session.sendInput(data)          // run, seq 는 세션이 붙인다
session.on(type, fn)             // → 구독 해제 함수
session.me, session.room, session.run, session.lastState
session.close()
```

이벤트: `room`, `game.start`, `game.state`, `game.event`, `game.end`, `error`, `status`

## 4. 미니게임 규격

### 브라우저 쪽 — `web/src/games/<id>/minigame.js`

```js
export const meta = { id, title, minPlayers, maxPlayers };
export function mount(container, ctx) { ...; return { destroy() {} }; }
// ctx = { session, run, players: [{ id, name, index, character }], me: { id }, options }
// character = 대기실에서 고른 동물 id. 그림은 web/src/shared/animals.js(기본 그림)와 chibi.js(동작)를 쓴다.
```

- `mount` 는 container 안에 화면을 만들고 `session.on('game.state' | 'game.event')` 를 듣는다.
- `destroy` 는 루프, 키 입력, 타이머, 소리, 카메라, 마이크, 세션 구독을 모두 정리한다.
- 게임을 `web/src/games/registry.js` 에 등록한다.
- LocalSession 용 시험용 진행기(`loadSim`)는 서버 게임과 같은 모양의 메시지를 만들어야 한다.

### 서버 쪽 — `server/party/games/<id>/game.py`

`party.minigame.MiniGame` 을 상속한다.

```python
class SomeGame(MiniGame):
    id = "..."; title = "..."; min_players = 2; max_players = 5; tick_hz = 30
    def client_options(self) -> dict        # game.start 의 options
    def start(self, now)                    # 시작
    def tick(self, now)                     # 주기 호출
    def on_input(self, player_id, data, now)
    def state_for(self, player_id, now)     # 재접속한 참가자에게 줄 상태
    # 도구: self.send_state(data), self.send_event(data), self.finish(results)
```

- 시각 `now` 는 방이 넘겨준다. 게임이 직접 시계를 읽지 않는다(테스트하기 쉽게).
- 게임을 `server/party/games/__init__.py` 의 `GAMES` 에 등록한다.

### 공통 결과 형식

```json
[{ "playerId": "p1", "name": "성원", "score": 4710, "rank": 1, "isWinner": true, "stats": {} }]
```

점수 내림차순이고, 동점은 같은 순위다. `stats` 는 게임마다 자유롭게 쓴다. 판은 `rank` 와 `score` 로 포인트를 계산하면 된다.

## 5. 줄다리기에서 주고받는 내용

| 방향 | 내용 |
|---|---|
| 입력 | `{k: "pull", t}` — t 는 라운드 시작 후 경과 시간으로 나타낸 누른 시각 |
| 입력 | `{k: "confirm"}` — 점수 기록 화면의 '결과 확인' |
| 이벤트 | `{type: "judge", playerId, grade, t, offset, beatIndex, points, combo, power}` |
| 상태 | `{phase, round, rounds, now, teams, countdownAt, startAt, endedAt, simT, rope, winnerSide, result, scores, results}` |

- 진행 중 계속 공유: 줄 위치와 힘, 점수, 장면(phase). 플레이 중 초당 30번, 그 외에는 장면이 바뀔 때와 1초마다.
- 최종 결과만 전달: `game.end` 의 `results`.
- 누른 시각은 브라우저가 서버 시계 기준으로 계산해 보낸다. 서버 시각과 0.35초 넘게 다르면 서버 시각으로 바꿔 판정한다. 통신 지연이 판정에 불리하게 작용하지 않게 하려는 것이다.
- 박자 격자와 피버 구간은 시간에 대한 공식이라 서버와 브라우저가 따로 계산해도 같다.

## 5-2. 손바닥 밀치기에서 주고받는 내용

- 입력 `game.input.data`: `{"k":"in","lean":-1|0|1,"push":bool,"hold":bool,"feint":true(누른 순간만)}` — 누르고 있는 키 상태가 바뀔 때만 보낸다.
- 상태 `game.state`: `phase`(intro/countdown/fight/result/final/done), `round`, `rounds`, `countdownAt`, `startAt`, `matches[{a,b}]`, `resting[]`, `duels[]`(경기별 시간·두 선수의 균형/동작), `standings`, `roundResults`, `results`.
- 사건 `game.event`: `{type, match(경기 번호), who/attacker/defender…('a'|'b')}` — 화면 효과·소리용.
- 서버는 1/60초 단위로 계산하고 초당 30번 상태를 보낸다.

## 5-3. 음성 퀴즈에서 주고받는 내용

- 입력 `game.input.data`
  - `{"k":"buzz","t":누른 시각(서버 시계)}`
  - `{"k":"voice","pcm":"base64(16비트 PCM)","rate":16000}` — 버저를 잡은 사람만. 말 한 토막(최대 5초).
  - `{"k":"typed","text":"..."}` — 버저를 잡은 사람만.
- 상태 `game.state`: `phase`(ready/intro/open/answering/judging/wrong/reveal/final/done), `index`, `total`, `category`, `question`,
  `hints`(열린 것만), `answer`(reveal 때만), `timeLeft`+`timeRunning`, `answerLeft`+`answerRunning`, `buzzer`, `locked[]`, `scores`, `last`, `voice`, `source`, `results`.
- 사건 `game.event`: `intro, open, hint, buzz, heard(들린 말), retry, unheard, sttFail, voiceOff, wrong, reopen, correct, timeup, allWrong, final`.

## 5-5. 주문을 외쳐라에서 주고받는 내용

- 입력 `game.input.data`
  - `{"k":"cast","id":"fireball"}` — 숫자키·클릭
  - `{"k":"voice","pcm":"base64(16비트 PCM)","rate":16000}` — 외친 말 한 토막(최대 3초). 인식 중에 겹쳐 온 말은 버린다.
- 상태 `game.state`: 손바닥 밀치기와 같은 틀(`phase`, `round`, `matches`, `resting`, `standings`, `roundResults`, `results`) +
  `duels[]`(`state`, `timeLeft`, `hitstop`, `a`/`b`의 `hp`·`mana`·`shield`·`cd`(쿨다운)·`combo`, `proj[]`(투사체 위치·속도)), `voice`.
- 사건 `game.event`: `{type, match, …}` — `cast, castFail, heard(들린 말과 인정된 주문), clash, blocked, strike, hit, end`. 자리 이름은 `'a'`(왼쪽) / `'b'`(오른쪽).
- 마이크 녹음은 `web/src/shared/MicCapture.js` 를 음성 퀴즈와 함께 쓴다.

## 5-6. 무궁화 꽃이 피었습니다에서 주고받는 내용

- 시작 설정 `options`: `taggerId`(술래), `phrase`, `minKeyChant`, `voice`, `config`(MOVE·RULES·FLOW·SCORE).
- 입력 `game.input.data`
  - 도망자 `{"k":"move","on":bool}`
  - 술래 `{"k":"mic","on":bool,"lv":0~1}`(말하는 중인지), `{"k":"voice","pcm":"base64","rate":16000}`(외친 말 한 토막), `{"k":"chant","on":bool}`(키로 외치기)
- 상태 `game.state`: `phase`(intro/countdown/play/end/final/done), `timeLeft`, `meters`, `taggerId`,
  `tagger{phase(back/turning/watching/turnBack), t, clock, chanting, level, keyTime, looks, caught}`,
  `runners[{id, dist, speed, alive, finished, elimDist}]`, `result{winner('runners'|'tagger'), reason, finishers}`, `results`, `voice`.
- 사건 `game.event`: `chant, heard(들린 말·인정 여부), turn, turnBack, caught(ids), finish(id), end(result), voiceOff`.

## 5-7. 소리 따라하기에서 주고받는 내용

- 입력(지금 차례인 사람만, `record`·`scoring` 단계): `{"k":"audio","pcm":"<16비트 PCM base64>","rate":16000}` 또는 `{"k":"nomic"}`
- 상태: `phase`(intro/listen/turn/cue/count/record/scoring/reveal/roundEnd/final/done), `now`, `since`, `until`, `round`, `rounds`, `sound{id,name,difficulty,icon,duration}`, `order`, `turn`, `current`, `scores{id:[{score,valid,grade}|null]}`, `totals`, `last`, `scorer`(whisper/spectral/sim), `results`
- 사건: `{"type":"reveal","playerId","round","score","valid","grade","reason","pcm"?,"rate"?}` — `pcm` 은 모두에게 들려줄 녹음
- 시작 옵션(`client_options`): `rounds`, `order`, `recExtra`, `flow`(단계별 시간), `grades`, `sounds`
- 소리 재생 시점은 화면이 `phase`·`since` 로 계산한다(듣기: `since + ROUND_LEAD` 부터 `LISTEN_REPEATS` 번).
- `stats`: `rounds`(라운드별 점수), `best`

## 5-8. 과일자르기에서 주고받는 내용

- 시작 옵션(`client_options`): `duration`, `countdown`, `intro`, `endDelay`, `objects`(한 판에 던질 물체 전부. 한 줄 = `[id, kind, def, t, x, vx, vy, r, life, mode, group]`)
  - 위치는 시각만으로 계산한다: `x + vx·age`, `198 + vy·age + 75·age²` (`age` = 던진 뒤 초)
  - `mode` 0 = 모두에게, 1 = "과일 3배" 효과 중인 사람에게만, 2 = "과일 3배" 를 벤 사람에게 바로 쏟아지는 묶음(`t` 는 효과가 켜진 뒤 지연, `group` 은 그 아이템 id)
- 입력: `{"k":"cut","segs":[[t0,x0,y0,t1,x1,y1], ...]}` — 칼이 지나간 선분. `t` 는 게임 시각(= 서버 시계 − `startAt`), 좌표는 320×180 기준
  - 서버는 `t1` 을 (지금 − 0.35초) ~ 지금 사이로 맞춘 뒤 그 시각의 물체 위치와 비교한다. 선분 속도가 60px/s 미만이면 무시.
- 상태(초당 5번): `phase`(intro/countdown/play/timeup/final/done), `now`, `startAt`, `duration`, `players{id:{score,sliced,bombs,maxCombo}}`, `results`
  - 다시 접속한 사람에게는 `me{cut, doubleFrom, doubleUntil, triples, bursts}` 가 함께 간다.
- 사건(본인에게만): `{"type":"slice","id","kind","t","pts","score"}`, `{"type":"combo","n","bonus","score"}`
- `stats`: `sliced`, `bombs`, `maxCombo`, `items`

## 5-9. 가든 디펜스에서 주고받는 내용

- 시작 옵션(`client_options`): `duration`, `countdown`, `intro`, `waves[{name,start,boss}]`, `total`, `penalty`, `fireRate`, `bulletSpeed`
- 입력: `{"k":"in","lane":0~4,"fire":true|false}` — 바뀔 때마다. 서버는 그 시각까지 정원을 진행한 뒤 반영한다.
- 상태(초당 20번, 참가자마다 따로): `phase`(intro/countdown/play/timeup/final/done), `now`, `startAt`, `duration`, `players{id:{score,kills,breaches}}`, `results`, 그리고 내 정원 `me`:
  - `frame`, `lane`, `score`, `combo`, `comboLeft`, `mul`, `kills`, `breaches`
  - `enemies`: 한 줄 = `[id, 종류 번호(normal/runner/helmet/jumper/boss), lane, x, hp, maxHp, helmetHp, maxHelmet, 문 앞에 섰는지(0/1), 속도]`
  - `bullets`: 한 줄 = `[id, lane, x]`
  - 화면은 마지막 상태에서 속도만큼 이어 그린다(좀비는 왼쪽으로 `속도`, 총알은 오른쪽으로 `bulletSpeed`).
- 사건(본인에게만): `{"type":"kill","id","etype","lane","x","pts","mul","combo"}`, `{"type":"helmet","id","lane","x"}`, `{"type":"breach","lane","boss","lost"}`, `{"type":"summon","lane","x"}`
- `stats`: `kills`, `breaches`, `bestCombo`, `accuracy`(%), `bossKilled`

## 5-10. 검도에서 주고받는 내용

- 시작 옵션(`client_options`): `rounds`, `practice`(연습 시간), `timeSec`, `toWin`
- 입력(경기 중에만): `{"k":"in","held":비트,"press":[...]}` — `held` 는 누르고 있는 키(1 왼쪽, 2 오른쪽, 4 기합, 8 막기), `press` 는 방금 새로 누른 키(`men`/`kote`/`do`/`block`/`kiai`)
- 상태(경기 중 초당 30번): `phase`(practice/intro/fight/result/final/done), `round`, `rounds`, `now`, `practiceUntil`, `startAt`, `matches[{red,white}]`, `resting`, `duels`, `standings{id:{wins,losses,ippons,lost,matches,score}}`, `roundResults`, `results`
  - `duels[i]`: `frame`, `flow[이름, 틱, 길이]`(intro/ready/play/stop/end), `hitstop`, `timeLeft`(틱), `points{red,white}`, `hansoku`, `winner`, `decidedBy`(points/time/hantei), `over`, `pending[[side, 잔심 틱, 깨짐]]`, `red`·`white`
  - 선수: `x`, `state`, `stateT`, `momentum`, `kiai`, `kiaiHolding`, `strike[type, t, startup, recover, extra, bad, result]`|null, `blockT`, `counterT`, `flinchT`, `squashT`, `stepFrame`
- 사건(모두에게, `match` = 경기 번호): `hajime{label,shobu}`, `kiai{side}`, `step{side}`, `strike{side,kind,strike,kiaiOk}`(kind: whiff/parried/blocked/deflected/contact), `judge{side,strike,ippon,votes,quality,tags,reason}`, `hansoku{side,converted,count}`, `wakare`, `timeup`, `hantei{votes,winner}`, `end{winner,decidedBy}`, `stun{side}`
- 연습(`practice`) 동안에는 서버로 아무것도 보내지 않는다(브라우저 안에서만 돈다).
- `stats`: `wins`, `losses`, `ippons`, `matches`

## 5-11. 레이싱에서 주고받는 내용

- 시작 옵션(`client_options`): `laps`, `countdown`, `intro`, `grace`, `scores`, `world{W,H}`, `track{x[], y[], half, limit}`(가운데 선을 잘게 나눈 점들, 첫 점이 출발선)
- 입력: `{"k":"in","steer":-1~1,"throttle":-1~1,"drift":0~1}` — 바뀔 때마다(초당 20번까지)
- 상태(경기 중 초당 30번): `phase`(intro/countdown/race/ending/final/done), `now`, `startAt`, `frame`, `laps`, `deadline`(1등 도착 + 30초, 경기 시각), `order`(지금 순위), `results`, `cars`
  - `cars[id]` = `[x, y, 각도, vx, vy, 미끄러지는 중(0/1), 지금 바퀴, 진행도(바퀴 단위), 순위, 도착(0/1), 도착 시각]`
- 사건: `{"type":"lap","playerId","lap","time"}`, `{"type":"finish","playerId","place","time"}`, `{"type":"wall","playerId","speed"}`
- `stats`: `finished`, `time`, `laps`, `progress`, `bestLap`
- 서버와 브라우저가 같은 위치를 내도록 sin·cos 은 사칙연산으로 직접 계산한다(`track.py` 의 `det_sin`, `rules.js` 의 `detSin`).

## 5-4. 공용 AI 서비스 (`server/party/services/`)

- 서버가 켜질 때 한 번 만들어 방(Hub)에 넘기고, 게임은 `self.services["stt"]`, `self.services["gemini"]` 로 쓴다. 없거나 꺼져 있어도 게임은 진행돼야 한다.
- `stt.submit(pcm16, rate)` → `Future`(문장). 인식은 별도 스레드에서 돌고, 게임은 `tick` 에서 끝났는지만 본다(진행을 막지 않는다).
- `gemini.generate_json(prompt, schema)` 는 네트워크 호출이므로 게임 진행 중에 직접 부르지 않고 스레드에서 미리 불러 둔다.
- 게임 클래스의 `prepare(services)` 는 서버 시작 때 한 번 불린다(미리 준비할 것이 있을 때만 구현).
- `stt.can_embed`, `stt.submit_embed(pcm16, rate) → Future[ndarray [T, D]]`: Whisper 인코더 특징(초당 50프레임). 소리 따라하기 채점에 쓴다.

## 5-12. 두 번째 묶음(미니게임 10개)

`claw`, `fight`, `hanomano`, `bowling`, `groove`, `homerun`, `livefire`, `sigil`, `pingpong`, `sneaky` 의
입력 · 상태 · 사건 · options · stats 는 게임마다 `docs/games/<id>.md` 에 적혀 있다. 공통으로 쓰는 사건 두 가지:

- `{"type":"say","text","source":"gemini"|"canned","who","kind"}` — AI 해설/대사 한 줄
- `{"type":"verdict","headline","mvp","cheer"}` — 최종 결과 화면의 AI 총평(상태의 `verdict` 에도 들어 있다)

게임은 `services/caster.py` 의 `LineBook`(대사 묶음을 미리 받아 둠) · `ask_verdict` · `ask_async` 로 Gemini 를 쓴다.
## 6. 아직 정하지 않은 것

- 판(보드)이 미니게임 결과를 포인트로 바꾸는 방식
- 연결이 끊긴 참가자를 게임별로 어떻게 처리할지 (지금은 자리를 유지하고 게임은 계속 진행)
- 손 인식 공용 모듈은 `web/src/shared/HandTracker.js` (가든 디펜스·레이싱이 쓴다. 과일자르기는 원본 입력 모듈을 그대로 쓴다)
- 낮은 해상도 캔버스에 한글을 찍는 공용 도우미는 `web/src/shared/pixelText.js` (레이싱이 쓴다)
