// =============================================================
// 미니게임 목록 (브라우저 쪽). 새 게임은 여기에 한 항목을 추가한다.
//
//   load()     화면 모듈: { mount(container, ctx) → { destroy() } }
//   loadSim()  LocalSession 전용 시험용 진행기: { Sim, createBots }
//
// id 는 서버(server/party/games/__init__.py)의 게임 id 와 같아야 한다.
// =============================================================

/** 두 번째 묶음 게임의 조작 설명(대기실에 보이는 한 줄) */
const HOW_TO = {
  claw: '←/→(A/D): 집게 옮기기 · Space(↑/↓): 집게 내리기 (8초가 지나면 저절로 내려감) · M: 소리 끄기/켜기',
  fight: '←→ 이동(상대 쪽으로 톡톡 = 대시) · Space 펀치(톡 = 잽, 꾹 눌렀다 떼기 = 강펀치) · ↓ 가드(맞기 직전에 누르면 슥 피하고 카운터) · M: 소리 끄기/켜기',
  hanomano: 'Z: 내 차례에 카드 뒤집기 · Space: 같은 과일이 딱 5개면 종! (틀리면 1장씩 주고 3초 금지) · M: 소리 끄기/켜기',
  bowling: '←→ 위치 · Space 로 방향 → 힘 차례로 멈추기 · 굴러가는 동안 ←→ 스핀 (금색 잭팟 핀 +3점, 10초 안에 던지기) · M: 소리 끄기/켜기',
  groove: '← ↑ → (또는 A S D): 칩이 판정선에 닿는 순간 누르기, 꼬리 달린 칩은 끝까지 꾹 · [ ]: 소리 싱크 조절 · M: 소리 끄기/켜기',
  homerun: '← → 로 노란 배트 막대를 공이 올 줄에 맞추고, 공이 홈 플레이트에 올 때 Space 로 스윙 (볼은 골라내기 · 금색 공은 2배) · M: 소리 끄기/켜기',
  livefire: '방향키(또는 WASD): 조준 — 가만히 두면 흔들림이 줄어듦 · Space: 발사 (표적 20개 · 탄알 20발) · M: 소리 끄기/켜기',
  sigil: '마우스 왼쪽 버튼을 누른 채 마법진을 따라 그리기 (터치 가능) · 다 그리면 Space/Enter/오른쪽 클릭/완료 버튼 · M: 소리 끄기/켜기',
  pingpong: '← 후진 · → 전진(탁구대 쪽) · Space 치기 — 톡: 드라이브, 꾹 눌렀다 떼기: 스매시, 전진+톡: 드롭, 후진+톡: 로브 · M: 소리 끄기/켜기',
  sneaky: 'X(또는 Space) 꾹: 작은 춤 · Z(또는 ←/→) 꾹: 큰 춤 — 교수님이 돌아보기 전에 손 떼기 · M: 소리 끄기/켜기',
};

export const GAMES = Object.freeze({
  tug: {
    id: 'tug',
    title: '픽셀 줄다리기',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: 'Space: 박자에 맞춰 당기기 · M: 소리 끄기/켜기',
    load: () => import('./tug/minigame.js'),
    loadSim: () => import('./tug/sim/TugSim.js').then((m) => ({ Sim: m.TugSim, createBots: m.createBots })),
  },
  palm: {
    id: 'palm',
    title: '손바닥 밀치기',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: 'A/D: 균형 · J: 밀기(길게 누르면 차지) · K: 손 빼기 · L: 버티기 · M: 소리 끄기/켜기',
    load: () => import('./palm/minigame.js'),
    loadSim: () => import('./palm/sim/PalmSim.js').then((m) => ({ Sim: m.PalmSim, createBots: m.createBots })),
  },
  quiz: {
    id: 'quiz',
    title: '음성 퀴즈',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '스페이스: 버저 → 마이크로 정답 말하기(또는 타자 입력 후 Enter) · M: 소리 끄기/켜기',
    load: () => import('./quiz/minigame.js'),
    loadSim: () => import('./quiz/sim/QuizSim.js').then((m) => ({ Sim: m.QuizSim, createBots: m.createBots })),
  },
  spell: {
    id: 'spell',
    title: '주문을 외쳐라',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '주문 이름을 외치기 (파이어볼 · 아쿠아 샷 · 썬더 · 윈드 커터 · 아이스 실드 · 힐) 또는 숫자키 1~6 · M: 소리 끄기/켜기',
    load: () => import('./spell/minigame.js'),
    loadSim: () => import('./spell/sim/SpellSim.js').then((m) => ({ Sim: m.SpellSim, createBots: m.createBots })),
  },
  mugunghwa: {
    id: 'mugunghwa',
    title: '무궁화 꽃이 피었습니다',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '도망자: 스페이스를 누르고 있으면 전진 · 술래: 마이크에 "무궁화 꽃이 피었습니다" 외치기 · M: 소리 끄기/켜기',
    load: () => import('./mugunghwa/minigame.js'),
    loadSim: () => import('./mugunghwa/sim/MugunghwaSim.js').then((m) => ({ Sim: m.MugunghwaSim, createBots: m.createBots })),
  },
  mimic: {
    id: 'mimic',
    title: '소리 따라하기',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '제시 소리를 듣고, 내 차례에 마이크로 똑같이 따라 하기 (다른 사람 차례에는 조용히) · M: 소리 끄기/켜기',
    load: () => import('./mimic/minigame.js'),
    loadSim: () => import('./mimic/sim/MimicSim.js').then((m) => ({ Sim: m.MimicSim, createBots: m.createBots })),
  },
  fruit: {
    id: 'fruit',
    title: '과일자르기',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '마우스를 누른 채 긋기 또는 카메라 앞에서 검지 휘두르기로 과일 베기 (폭탄은 -20점) · M: 소리 끄기/켜기',
    load: () => import('./fruit/minigame.js'),
    loadSim: () => import('./fruit/sim/FruitSim.js').then((m) => ({ Sim: m.FruitSim, createBots: m.createBots })),
  },
  garden: {
    id: 'garden',
    title: '가든 디펜스',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: 'W/S·↑/↓ 레인 이동, Space(꾹) 사격 — 또는 손을 총 모양(ㄱ자)으로 만들어 높이로 조준, 검지를 구부려 발사 · M: 소리 끄기/켜기',
    load: () => import('./garden/minigame.js'),
    loadSim: () => import('./garden/sim/GardenSim.js').then((m) => ({ Sim: m.GardenSim, createBots: m.createBots })),
  },
  kendo: {
    id: 'kendo',
    title: '검도',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '←→ 이동 · Shift 기합(꾹) · Z 머리 · X 손목 · C 허리 · Space 막기(타이밍이 맞으면 받아치기) · M: 소리 끄기/켜기',
    load: () => import('./kendo/minigame.js'),
    loadSim: () => import('./kendo/sim/KendoSim.js').then((m) => ({ Sim: m.KendoSim, createBots: m.createBots })),
  },
  racing: {
    id: 'racing',
    title: '레이싱',
    minPlayers: 2,
    maxPlayers: 5,
    howTo: '두 손을 핸들처럼 들고 기울여 방향, 카메라 쪽으로 밀면 가속 (카메라를 쓸 수 없을 때만 ↑↓←→·Space) · M: 소리 끄기/켜기',
    load: () => import('./racing/minigame.js'),
    loadSim: () => import('./racing/sim/RacingSim.js').then((m) => ({ Sim: m.RacingSim, createBots: m.createBots })),
  },
  // ----- 두 번째 묶음(미니게임 10개). 화면은 <id>/minigame.js, 시험용 진행기는 <id>/sim/Sim.js -----
  claw: more('claw', '잭팟 인형뽑기'),
  fight: more('fight', '매직 파이트 나이트'),
  hanomano: more('hanomano', '하노마노'),
  bowling: more('bowling', '잭팟 볼링'),
  groove: more('groove', '잭팟 그루브'),
  homerun: more('homerun', '잭팟 홈런 더비'),
  livefire: more('livefire', '실거리 사격'),
  sigil: more('sigil', '마법진 그리기'),
  pingpong: more('pingpong', '잭팟 탁구왕'),
  sneaky: more('sneaky', '교수님 몰래 댄스!'),
});

/**
 * 두 번째 묶음 게임의 등록 항목. 화면은 <id>/minigame.js, 시험용 진행기는 <id>/sim/Sim.js.
 * import.meta.glob 은 "지금 있는 파일만" 묶어 준다 — 아직 만들지 않은 게임이 있어도 빌드가 깨지지 않는다.
 */
function more(id, title) {
  const screens = typeof import.meta.glob === 'function' ? import.meta.glob('./*/minigame.js') : {};
  const sims = typeof import.meta.glob === 'function' ? import.meta.glob('./*/sim/Sim.js') : {};
  const pick = (table, path) => (table[path] ? table[path]() : import(/* @vite-ignore */ path));
  return {
    id, title, minPlayers: 2, maxPlayers: 5,
    howTo: HOW_TO[id] || '',
    load: () => pick(screens, `./${id}/minigame.js`),
    loadSim: () => pick(sims, `./${id}/sim/Sim.js`).then((m) => ({ Sim: m.Sim, createBots: m.createBots })),
  };
}