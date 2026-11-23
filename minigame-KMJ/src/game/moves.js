// 노트를 칠 때마다 영웅이 쓰는 공격 기술 7가지.
// 가벼운 기술 4번 → 5타째 큰 기술, 콤비네이션처럼 이어져요. 같은 기술이 연속으로 나오지 않아요.
//
//   lunge   상대 쪽으로 돌진하는 거리 (음수면 뒤로 물러서며 던짐)
//   time    동작 전체 시간 (초)
//   impact  동작 시작 후 공격이 들어가는 순간 (초)
//   power   타격 세기 배율 (피, 밀려남, 화면 흔들림)
//   hitY    맞는 높이 (발 기준, 음수 = 위)

export const MOVES = {
  thrust: { lunge: 125, time: 0.22, impact: 0.08, power: 1.0, hitY: -125 }, // 창 찌르기
  punch: { lunge: 105, time: 0.18, impact: 0.06, power: 0.8, hitY: -165 }, // 주먹질
  bash: { lunge: 145, time: 0.24, impact: 0.09, power: 1.1, hitY: -130, knock: 1.7 }, // 방패로 치기
  butt: { lunge: 115, time: 0.22, impact: 0.08, power: 0.9, hitY: -175 }, // 창대로 올려치기
  javelin: { lunge: -24, time: 0.36, impact: 0.24, power: 1.4, hitY: -135, throwAt: 0.12 }, // 투창
  smash: { lunge: 140, time: 0.34, impact: 0.17, power: 1.5, hitY: -150, jump: 70 }, // 뛰어올라 내려찍기
  spin: { lunge: 130, time: 0.32, impact: 0.14, power: 1.3, hitY: -125 }, // 회전 베기
};

const LIGHT = ['thrust', 'punch', 'bash', 'butt'];
const HEAVY = ['javelin', 'smash', 'spin'];

export const isHeavy = (move) => HEAVY.includes(move);

// p.combo 는 이번 타격까지 센 콤보 수
export function nextMove(p) {
  const pool = p.combo % 5 === 0 ? HEAVY : LIGHT;
  let move;
  do {
    move = pool[Math.floor(Math.random() * pool.length)];
  } while (move === p.lastMove);
  p.lastMove = move;
  return move;
}
