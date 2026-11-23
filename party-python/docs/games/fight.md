# 매직 파이트 나이트 (`fight`)

마법성 카지노 특설 링의 1:1 복싱. 원본 `fight-night` 를 파티 서버 규격으로 옮겼다.
본보기로 삼은 기존 게임: `palm`(리그전 · 내 선수는 항상 왼쪽), `kendo`(누르고 있는 키 비트 + 새로 누른 키 목록).

조작(howTo): `←→ 이동(상대 쪽으로 톡톡 = 대시) · Space 펀치(톡 = 잽, 꾹 눌렀다 떼기 = 강펀치) · ↓ 가드(맞기 직전에 누르면 슥 피하고 카운터) · M: 소리 끄기/켜기`
(A/D · Z · S/X 도 같은 동작)

## 규칙

한 경기 규칙은 원본 값 그대로다(`server/party/games/fight/config.py`).

- 한 경기 45초. 체력 100. 체력이 0 이 되면 KO(심판 카운트 뒤 종료), 시간이 끝나면 남은 체력 → 맞힌 횟수 → 무작위 순으로 판정.
- 잽: 피해 5 / 강펀치(20프레임 이상 눌렀다 떼기): 피해 14, 가드를 깨고 비틀거리게 함.
- 가드: 피해 15%. 펀치가 닿기 8프레임 안에 가드를 시작하면 "슥" 하고 완전히 피하고, 40프레임 안에 맞히는 펀치는 피해 2배(카운터).
- 대시: 상대 쪽 키를 9프레임 안에 두 번.

### 원본과 달라진 점

- **토너먼트 → 리그전.** 라운드마다 둘씩 짝지어 **동시에** 경기하고 모두가 서로 한 번씩 만난다(3명 3라운드, 4명 3라운드, 5명 5라운드). 홀수면 한 명이 쉬며 첫 경기를 관전한다. 2명은 같은 상대와 3판 *(임시 값)*.
- **CPU 복서 · 개인 화면 3연전 · 대진 직접 정하기 · 대진표 나무 · 일시정지 · 게임패드는 없다.**
- **순위**: 이긴 횟수가 많은 순 → 같으면 `KO 승 × 50 + 이긴 경기에서 남은 체력 합`이 높은 순(원본 개인 모드의 KO 보너스 50 · 체력 1당 1점). 둘 다 같으면 공동 순위.
  점수 = `승수 × 1000 + KO 승 × 50 + 남은 체력 합` *(1승 1000점은 임시 값 — 원본 100. 승수가 항상 먼저 비교되게 키웠다)*.
- **조작 키 통일**: 원본의 플레이어별 키 4개 대신 모두 ←→ · Space · ↓.
- **내 선수는 항상 왼쪽(홍코너 색)** 에 보인다. 서버에서 청코너인 사람은 화면과 좌우 키를 뒤집어 보여 준다(그래서 두 사람이 서로 자기가 홍코너로 보인다).
- 판정은 서버가 1/60초 단위로 한다(원본 `fighter.js` · `bout.js` 의 규칙 부분을 Python 으로 옮김). 브라우저는 서버 상태(초당 30번)를 원본 링 · 선수 · 중계 UI 코드로 그린다. 내 입력을 먼저 그려 보이는 예측은 하지 않는다.
- 원본 자막(슥! 카운터 찬스 등)은 서버가 보내는 **AI 해설**로 바꿨다.
- 시간 *(임시 값)*: 대진 안내 4초, 라운드 결과 4초, 최종 결과 9초. 한 라운드 약 1분 → 2~4명 약 3분, 5명 약 5분.

## 주고받는 메시지

- 시작 옵션(`client_options`): `config`(수치 전부), `rounds`
- 입력(경기 중에만): `{"k":"in","held":비트,"press":[...]}` — `held` 는 누르고 있는 키(1 왼쪽, 2 오른쪽, 4 펀치, 8 가드), `press` 는 방금 새로 누른 키(`left`/`right`/`punch`/`guard`). 한 프레임보다 짧게 친 키도 한 프레임 동안 누른 것으로 본다.
- 상태(경기 중 초당 30번, 그 외에는 장면이 바뀔 때와 1초마다): `phase`(intro/fight/result/final/done), `round`, `rounds`, `now`, `startAt`, `matches[{red,blue}]`, `resting`, `bouts`, `standings{id:{wins,losses,kos,hpLeft,damage,hits,matches,score}}`, `roundResults[{red,blue,winner,byKO,hp,hits}]`, `results`, `verdict`
  - `bouts[i]`: `frame`, `state`(intro/fight/ko/decision), `stateT`, `time`(남은 프레임), `hitstop`, `slowmo`, `count`(KO 카운트), `winner`('red'|'blue'), `byKO`, `done`, `red`·`blue`
  - 선수: `x`, `vx`, `hp`, `facing`, `state`(idle/walk/guard/charge/punch/stun/ko/win), `t`, `punch[종류, 프레임]`|null, `chargeT`, `flash`, `squash`, `blockShake`, `slipT`, `counterT`, `hits`, `damage`
- 사건(모두에게, `match` = 경기 번호): `cue{name}`(bell/call/fight/countdown/koBell 소리), `start`, `dash{side}`, `punch{side,kind}`, `hit{side,kind,dmg,blocked,slip,counter,broken,x,dir,ko}`, `hurry`, `count{n}`, `ko{winner}`, `decision{winner}`, `end{winner,byKO}`, `say{text,source,who,kind}`, `verdict{headline,mvp,cheer}`(match 없음)
- `stats`: `wins`, `losses`, `kos`, `hpLeft`, `damage`, `hits`, `matches`

## AI 가 쓰인 곳

- **해설(LineBook)** — 말하는 인물 "해설자"(링 아나운서). 시작할 때 대사 묶음을 한 번 요청하고, 경기 중 9가지 상황에 한 줄씩 `say` 로 보낸다:
  `start`(경기 시작), `big_hit`(강펀치 적중), `slip`(슥 피함), `counter`(카운터 적중), `guard_break`(가드 깨짐), `comeback`(체력 15 이상 뒤지다 역전), `hurry`(10초 남음), `ko`, `decision`(판정승).
  경기마다 3초 간격을 두고(시작 · KO · 판정은 항상), 화면은 원본 링 아나운서 자막 자리(시계 아래 띠, 경기가 끝난 뒤에는 승리 띠 아래)에 보여 준다. Gemini 가 쓴 줄에는 "AI" 표시가 붙는다.
- **총평(ask_verdict)** — 마지막 라운드가 끝나 순위가 정해지면 한 번 요청하고, 최종 결과 화면(9초) 동안 답이 오면 `verdict` 사건과 상태의 `verdict` 로 보낸다. 화면은 순위표 아래 "AI 총평" 칸에 보여 준다.
- Gemini 가 꺼져 있으면 기본 대사만 나오고 총평은 없다. `?local` 시험용 진행기도 같다.
