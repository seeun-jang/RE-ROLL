# 하노마노 (HANOMANO) — RE:ROLL 미니게임

> 같은 과일이 딱 5개! 제일 먼저 종을 쳐라!
> 마법사 성 카지노 테이블의 5인 반응속도 카드게임.

## 실행 방법
1. VS Code로 이 폴더를 엽니다.
2. `index.html`을 Chrome이나 Edge로 엽니다(더블클릭해도 됩니다).
3. 첫 키를 누르는 순간부터 소리가 납니다.

## 규칙
- 시작하기 전에 **하는 법 화면**이 나옵니다 (아무 키나 누르면 시작, 15초 뒤 자동 시작).
- 카드는 **체리 · 레몬 · 라임 · 포도** 52장(과일마다 1개짜리 4장, 2개 3장, 3개 3장, 4개 2장, 5개 1장). 처음에 모두에게 똑같이 나눠 줍니다.
- 차례가 되면 내 카드를 한 장 뒤집어 내 앞에 놓습니다. 3초 동안 안 뒤집으면 자동으로 뒤집히고, 끝으로 갈수록 1.5초까지 빨라집니다.
- 펼쳐진 카드(각자 맨 위 한 장) 중 **같은 과일이 정확히 5개**가 되면 종을 칩니다.
  - **맞으면**: 펼쳐진 카드를 전부 가져가고, 다음 차례는 내가 됩니다.
  - 종을 치면 그 순간의 카드를 잠깐 보여 주며 왜 맞았는지/틀렸는지 알려 줍니다 (예: '라임 2+3 = 5개!', '포도 4개뿐!').
  - **틀리면**: 다른 사람에게 1장씩 주고, **3초 동안 종을 못 칩니다**(손 얼얼).
- 같은 순간에 쳐도 키를 먼저 누른 사람이 이깁니다.
- **모두 끝까지 참여**: 카드가 0장이어도 탈락하지 않습니다. 종을 맞히면 다시 살아납니다.
- **제한 시간 2분 30초**. 끝나면 카드가 많은 순서로 순위를 정합니다(같으면 종을 많이 맞힌 순, 그다음은 덜 틀린 순). 한 명이 카드를 다 가지면 바로 끝납니다.
- 메인 게임 순위 점수: 1위 10 / 2위 7 / 3위 5 / 4위 3 / 5위 1

## 조작 (키 3개, 자리마다 항상 표시 — 가운데 금색 키가 종)
| 플레이어 | 뒤집기 · **종** · 뒤집기 |
|---|---|
| P1 럼블 | Q · **W** · E |
| P2 나르 | R · **T** · Y |
| P3 꽥스 | U · **I** · O |
| P4 볼리베어 | Z · **X** · C |
| P5 에코 | ← · **↑** · → |
| 개인 화면 | ←/→ · **Space** |

- P / Esc: 일시정지, M: 소리 끄기/켜기

## 개인 화면
- 나 혼자 CPU 4명과 겨룹니다. CPU는 0.4~0.8초 만에 반응하고, 가끔 헷갈려서 틀리게 칩니다.
- 점수(다른 사람과 비교용): 카드 1장 10점 + 종 맞힘 20점 - 틀림 10점

## 메인 게임 연동
- URL 실행: `index.html?mode=together&players=5&autostart=1&embed=1`
- 개인 화면: `index.html?mode=personal&char=3&autostart=1` (char 1~5 = 럼블·나르·꽥스·볼리베어·에코)
- 결과 받기 (셋 중 아무거나):
  - `window.addEventListener('re-minigame:finish', e => e.detail)`
  - iframe이면 부모 창에서 `message` 이벤트를 받습니다(`type: 'RE_MINIGAME_RESULT'`).
  - `window.RE_MINIGAME_LAST_RESULT`
- `ranking: [{ playerId, slot, name, cpu, cards, correct, wrong, score, rank, rankPoints }]`
- `&autoplay=1`: 모두 CPU (시연·테스트용)

## 파일 구조
```
hanomano/
├─ index.html · css/style.css · assets/(fonts, characters) · examples/host-example.html
└─ js/
   ├─ config.js      카드 구성, 시간, 벌칙, CPU 반응 속도 등 모든 수치
   ├─ cards.js       덱 만들기, 과일·카드·종 그림, '5개' 판정과 설명
   ├─ bot.js         CPU 플레이어
   ├─ hud.js         캐릭터 이름표 카드 (얼굴 아이콘)
   ├─ minigame-api.js 메인 게임 연동
   ├─ 공용 엔진: palette · characters · sprites · font · ui · input(누른 순서 기록) · audio · particles · transition · game · main
   └─ scenes/ title.js · play.js(게임 규칙 + 테이블 화면) · result.js
```
