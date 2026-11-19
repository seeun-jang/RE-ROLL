# 잭팟 그루브 (`groove`)

3레인 리듬 게임. 모두가 **각자 자기 화면에서 같은 곡 · 같은 채보**를 동시에 연주하고 점수로 순위를 가린다.
본보기로 삼은 기존 게임: `fruit`(모두에게 같은 내용, 시각으로 판정) · `tug`(박자 판정, 서버 시계, 0.35초 지연 보정).

조작 한 줄(howTo): **← ↑ → (또는 A S D): 칩이 판정선에 닿는 순간 누르기, 꼬리 달린 칩은 끝까지 꾹 · [ ]: 소리 싱크 조절 · M: 소리 끄기/켜기**

## 규칙 (원본 그대로인 것)

- 판정: PERFECT ±45ms(100%) · GREAT ±90ms(70%) · GOOD ±135ms(35%) · 그 밖/놓침 MISS(0%, 콤보 끊김). 빈 곳을 눌러도 벌점은 없다.
- 롱노트: 머리 판정 + 끝까지 누르면 꼬리 PERFECT(끝나기 0.12초 전부터는 떼도 성공), 일찍 떼면 꼬리 MISS.
- 점수: 1,000,000점 만점 = 판정 점수 900,000 + 최대 콤보 보너스 100,000. 등급 S 950,000 / A 880,000 / B 750,000 / C 600,000 / D.
- 순위: 점수 → 최대 콤보 → PERFECT 수. 셋 다 같을 때만 공동 순위.
- 곡 3개(잭팟 그루브 128BPM 약 71초 · 달빛 칩스 96BPM 약 65초 · 네온 러시 150BPM 약 61초), 채보는 멜로디에서 자동 생성(같은 곡 · 난이도면 언제나 같다).
- 30콤보부터 피버(연출만), 구간 알림(잭팟 타임 · 롱노트 · 피날레), FULL COMBO / ALL PERFECT 도장.

## 원본과 달라진 점

- 한 화면에 5명이 나란히 치던 '함께 하기' 대신, 원본 '개인 화면' 배치(큰 레인 1개)로 각자 자기 PC 에서 친다. 키도 개인 화면 키(← ↑ → / A S D)로 통일. 게임패드는 뺐다.
- **곡은 서버가 판마다 무작위로 고른다**(`self.rng` 로 3곡 중 하나). **난이도는 "보통"** 고정 *(임시 값 — 서버 options 의 `song` · `difficulty` 로 지정할 수 있다)*. 노트 속도는 기본(3) 고정. 타이틀 화면 · 일시정지 · 다시 하기는 없다.
- **곡 시계 = 서버 시계.** 서버가 곡 0초가 되는 서버 시각(`startAt`)을 알리고, 브라우저는 그 시각에 맞춰 소리를 예약하고 노트를 그린다(원본은 각자의 오디오 시계). 그래서 모두가 같은 순간에 같은 박을 듣는다.
- **판정은 서버가 한다.** 브라우저는 키를 누른/뗀 순간의 곡 시간과 레인만 보낸다. 서버는 보낸 시각을 (지금 − 0.35초) ~ 지금 사이로 맞춘 뒤 원본 판정을 적용한다. 놓친 노트(MISS) 처리는 늦게 오는 입력을 기다리느라 0.35초 늦다.
  화면은 같은 계산(`performer.js`)으로 판정 글자 · 콤보를 바로 보여 주고(예측), **점수와 순위는 서버 값**만 쓴다.
- **싱크 보정**(원본 타이틀의 '싱크', 10ms 단위 ±200ms, 브라우저에 저장)은 `[` `]` 키로 언제든 조절한다. 원본은 노트 쪽을 밀었지만 여기서는 노트 · 판정이 서버 시계에 고정이라 **소리 쪽을 당기거나 민다**(소리가 늦게 들리면 +).
- 시작: 곡 소개 5초 *(임시 값)* → 카운트인 한 마디(3·2·1·GO) → 연주 → FINISH! 약 2.8초 → 최종 순위 10초 *(임시 값)*. 한 판 약 85~95초.
- 왼쪽 위에 모두의 점수 · 콤보 순위판, 맨 아래에 해설 자막, 최종 순위 화면에 AI 총평을 더했다.
- 점수 계산을 정수로 바꿨다(판정 비율 ×100). 결과는 원본 공식과 같다.

## 주고받는 메시지

- 시작 옵션(`options`): `song`(groove/moon/neon), `title`, `difficulty`, `approach`(노트가 떨어지는 시간), `lead`(카운트인 길이), `intro`, `duration`, `notes`(노트 수 — 화면이 만든 채보와 다르면 경고), `total`(판정 개수), `maxLag`, `outro`, `final`
- 입력: `{"k":"key","lane":0|1|2,"down":true|false,"t":곡 시간(초)}` — 곡 시간 = 서버 시계 − `startAt`
- 상태(연주 중 초당 10번, 그 밖에는 장면이 바뀔 때와 1초마다): `phase`(intro/play/outro/final/done), `now`, `startAt`, `song`, `difficulty`,
  `players{id:{score,combo,maxCombo,perfect,great,good,miss,judged,grade}}`, `leader`, `results`(outro 부터), `verdict`, `say`
  - 다시 접속한 사람에게는 `me{ptr[3],hold[3],perfect,great,good,miss,combo,maxCombo,judged}` 가 함께 간다(채보가 어디까지 판정됐는지).
- 사건(모두에게): `say{text,source,who,kind}`, `verdict{headline,mvp,cheer}`, `combo{playerId,n}`(50콤보마다), `break{playerId,combo}`(30콤보 이상이 끊김), `lead{playerId}`(1등 바뀜), `finish{playerId,grade,fullCombo,allPerfect}`
- `stats`: `grade`, `maxCombo`, `perfect`, `great`, `good`, `miss`, `fullCombo`, `allPerfect`, `song`, `difficulty`

## AI 가 쓰인 곳

- **해설 대사**(LineBook, 말하는 인물 = 꽥대장): 시작할 때 한 번 대사 묶음을 받아 두고, 상황 10가지에 한 줄씩 자막으로 보여 준다(최소 3초 간격, AI 가 쓴 줄에는 "AI" 표시).
  상황: 곡 시작 · 잭팟 타임(코러스) · 50콤보 · 100콤보 · 풀콤보 페이스(곡 절반까지 무실수) · 콤보 끊김 · 1등 역전 · 막바지(10초 전) · S 등급으로 끝 · 그냥 끝.
- **총평**(ask_verdict): 곡이 끝나 결과가 정해지는 순간 한 번 부탁하고, 최종 순위 화면에 "AI 총평"으로 보여 준다(안 오면 안 보여 준다).
- Gemini 가 꺼져 있으면 기본 대사만 쓴다. 시험용 진행기(`?local`)에는 AI 가 없다.

## 파일

- 서버 `server/party/games/groove/`: `game.py`(진행 · 해설) · `performer.py`(판정 · 점수) · `chart.py`(채보 생성) · `songs.py`(멜로디) · `config.py`
- 화면 `web/src/games/groove/`: `net/GrooveScreen.js`(장면) · 원본을 옮긴 `highway.js` `dancer.js` `stage.js` `audio.js` `sprites.js` `ui.js` 등 · `sim/Sim.js`(시험용 진행기)
- 테스트: `server/tests/test_groove_game.py`(채보 · 규칙 값 · 같은 입력의 점수를 Node 쪽과 비교) · `web/tests/groove-sim.mjs`
