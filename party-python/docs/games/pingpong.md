# 잭팟 탁구왕 (`pingpong`)

옆에서 본 1:1 탁구. 원본(`pingpong-jackpot`)은 한 키보드로 하는 토너먼트 + CPU 3연전이었고,
파티 서버용은 **사람끼리 둘씩 짝지어 동시에 겨루는 리그전**이다. 판정 · 점수 · 진행은 모두 Python 서버가 한다.

조작 설명 한 줄(howTo): `← 후진 · → 전진(탁구대 쪽) · Space 치기 — 톡: 드라이브, 꾹 눌렀다 떼기: 스매시, 전진+톡: 드롭, 후진+톡: 로브 · M: 소리 끄기/켜기`

## 규칙

원본 그대로인 것 (`server/party/games/pingpong/config.py` = 원본 `js/config.js`)

- **3점 먼저 내면 승리.** 2:2 듀스부터는 2점 차가 나야 이기고, 6점을 먼저 내면 무조건 이긴다.
- 서브: 치기 키를 누르면 공을 토스하고 내려올 때 친다. 공은 내 코트에 먼저 튄 뒤 상대 코트에 튀어야 한다.
  서브권은 2점마다(듀스에서는 1점마다) 바뀌고, 4초 동안 서브를 안 넣으면 자동으로 들어간다.
- 득점: 상대 코트에 두 번 튀거나 상대가 못 받으면 친 사람 득점 / 네트에 걸리거나 아웃이면 받는 사람 득점.
- 샷: 톡 = 드라이브, 꾹(20프레임) → 떼기 = 스매시, 전진키 + 톡 = 드롭, 후진키 + 톡 = 로브.
  라켓 한가운데에 맞을수록 좋은 공(나이스!), 타이밍이 나쁘면 찬스볼 · 아웃 · (스매시는) 네트.
- 공 · 선수의 물리 값, 타격 순간의 짧은 멈춤(3프레임, 스매시 7프레임)과 스매시 뒤 슬로모션(24프레임).

원본과 달라진 점

- **CPU 선수 · 개인 화면 3연전 · 대진 정하기 화면 · 토너먼트 대진표 · 일시정지를 없앴다.**
- **리그전**(`palm` · `kendo` 와 같은 방식): 모두가 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 경기하고,
  인원이 홀수면 한 명이 쉬며 첫 경기를 관전한다. 3명 3라운드, 4명 3라운드, 5명 5라운드, 2명은 한 경기 *(임시 값)*.
- **순위**: 이긴 횟수가 많은 순 → **득실차**(딴 점수 − 내준 점수)가 큰 순. 둘 다 같으면 공동 순위.
  결과의 `score` = 경기당 12점 + 승리 100점 + 득실차 × 4점 *(임시 값 — 이긴 횟수가 항상 먼저 반영되도록 정한 숫자)*.
- **조작**: 원본의 플레이어별 키 3개 대신 누구나 `← / →`(또는 A / D), `Space`(또는 Enter · ↑ · Z).
  내 캐릭터는 항상 화면 왼쪽에 보이므로 `→` 가 언제나 전진(탁구대 쪽)이다.
- 한 경기가 2분을 넘기면 그 뒤 첫 득점에서 앞선 쪽이 이긴다 *(임시 값 — 한 경기가 다른 사람들을 오래 기다리게 하지 않으려는 안전장치)*.
- 장면 시간: 대진 안내 5초, 라운드 결과 5초, 최종 결과 10초 *(임시 값)*.
- 타이밍 판정은 서버에 입력이 도착한 시각으로 한다(휘두르는 10프레임 안에 공이 오면 맞으므로 따로 지연 보정을 두지 않았다).

걸리는 시간: 한 경기 약 1분. 3명 약 4분, 5명 약 6~7분.

## 주고받는 메시지

- 시작 옵션(`client_options`): `rounds`, `gamePoints`, `deuceCap`, `matchIntro`, `caster`
- 입력(경기 중인 선수만): `{"k":"in","held":비트,"press":["hit"]}` — `held` 는 누르고 있는 키(1 후진, 2 전진, 4 치기),
  `press` 는 방금 새로 누른 키(한 프레임보다 짧게 톡 친 것도 놓치지 않게). 바뀔 때마다 보낸다.
- 상태(경기 중 초당 30번, 그 외에는 장면이 바뀔 때와 1초마다):
  `phase`(intro/fight/result/final/done), `round`, `rounds`, `now`, `startAt`, `simFrame`, `matches[{a,b}]`, `resting[]`,
  `duels[]`, `standings{id:{wins,losses,scored,conceded,matches,bestRally,score}}`, `roundResults`, `results`, `verdict`
  - `duels[i]`: `frame`, `state`(intro/serve/rally/point/end), `stateT`, `hitstop`, `slow`, `server`(0 왼쪽/1 오른쪽), `rally`, `pts[왼,오]`, `winner`, `over`,
    `ball{x,y,vx,vy,state(held/toss/flight/dead),fast,chance,netHit,lastHitter,bounces,rest,serveStage,ticks}`,
    `left`·`right{x,vx,state(ready/charge/swing/win/lose),chargeT,swingT,shot}`
  - 서버는 1/60초 단위로 계산한다. 화면은 0.08초 늦게 그리며, 두 상태 사이의 공 위치를 같은 물리식으로 이어 그린다.
- 사건(`match` = 경기 번호): `serve{side}`, `toss{side}`, `swing{side,shot}`, `smashReady{side}`,
  `hit{side,shot,q,smash,popup(oops/nice/smash),chance,rally,x,y}`, `bounce{side}`, `net`, `floor`,
  `point{side,reason(serveFault/ownCourt/smash/unreturned/net/missed/out),pts,rally,shot,hitter}`, `end{winner,pts}`,
  `say{text,source,who,kind,match}`, `verdict{headline,mvp,cheer}`
- `stats`: `wins`, `losses`, `scored`, `conceded`, `matches`, `bestRally`

## AI 가 쓰인 곳 (서버의 Gemini, 없으면 기본 대사)

- **해설 대사** — 시작할 때 `LineBook` 으로 이 판의 대사 묶음을 한 번 받아 두고, 경기 중 상황에 맞는 한 줄을 `say` 사건으로 보낸다.
  말하는 인물은 "해설자". 상황 9가지: 경기 시작(`start`), 긴 랠리(`rally`, 8번 이상), 스매시 득점(`smash`), 드롭샷 득점(`drop`),
  네트 · 아웃 실수(`miss`), 듀스(`deuce`), 매치포인트(`matchpoint`), 역전(`comeback`), 경기 승리(`win`).
  같은 경기에서는 3초 안에 다시 말하지 않는다. 화면은 **점수판 바로 아래 띠**(원본의 대기 선수 · 랠리 띠 자리)에 보여 주고, AI 가 쓴 줄에는 "AI" 표시를 붙인다.
- **AI 총평** — 최종 순위가 정해지는 순간 `ask_verdict` 를 한 번 요청하고, 최종 결과 화면(10초) 동안 답이 오면 `verdict` 사건과 상태로 보낸다.
- 시험용 진행기(`?local`)에는 AI 가 없다: 기본 대사만 나오고 총평은 없다.

## 파일

- 서버: `server/party/games/pingpong/` — `config.py`(숫자), `rules.py`(공 · 선수 · 한 경기), `game.py`(리그전 · 해설 · 총평)
- 화면: `web/src/games/pingpong/` — `net/PingpongScreen.js`(상태 그리기 · 입력), `net/hall.js` · `views.js` · `text.js` · `sprites.js` · `particles.js` · `audio.js`(원본 그림 · 소리),
  `sim/rules.js`(서버 규칙과 같은 내용, 화면의 공 보간과 시험용 진행기가 쓴다), `sim/Sim.js`(시험용 진행기 + 원본 CPU 를 옮긴 시험용 봇)
- 테스트: `server/tests/test_pingpong_game.py`(규칙 · 진행 · AI · JS 진행기와 결과 비교), `web/tests/pingpong-sim.mjs`
