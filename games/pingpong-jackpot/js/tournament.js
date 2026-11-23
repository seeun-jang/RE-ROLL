// =====================================================
// 토너먼트 대진 (2~5명) + 개인 화면용 CPU 3연전
// 5명: 예선(4번 vs 5번 시드) → 4강 2경기 → 3·4위전 → 결승
//      → 1~5위가 모두 경기 결과로 정해짐
// =====================================================
class Participant {
  constructor(index) {
    this.index = index;
    this.def = CHARACTERS[index];
    this.name = this.def.name;
    this.color = C(this.def.color);
    this.wins = 0;
    this.scored = 0;   // 딴 점수 합계
    this.conceded = 0; // 내준 점수 합계
    this.score = 0;
    this.placement = null;
  }

  get spr() {
    return SPR.players[this.index];
  }
}

class Tournament {
  // order: 대진 정하기 화면에서 고른 자리 순서 (캐릭터 번호 배열). 없으면 무작위
  constructor(players, order = null) {
    let s;
    if (order && order.length === players.length) s = order.map((i) => players.find((p) => p.index === i));
    else s = shuffleArray([...players]);
    this.seeds = s;
    this.matches = this.build(s);
    this.cursor = 0;
  }

  // ref: { p } 선수 고정 / { w: id } 그 경기 승자 / { l: id } 그 경기 패자
  build(s) {
    const n = s.length;
    const M = (id, label, a, b) => ({ id, label, a, b, winner: null, loser: null, how: '' });
    if (n === 2) return [M('F', '결승', { p: s[0] }, { p: s[1] })];
    if (n === 3) return [M('Q', '예선', { p: s[1] }, { p: s[2] }), M('F', '결승', { p: s[0] }, { w: 'Q' })];
    if (n === 4) {
      return [
        M('S1', '4강 1', { p: s[0] }, { p: s[3] }),
        M('S2', '4강 2', { p: s[1] }, { p: s[2] }),
        M('B', '3·4위전', { l: 'S1' }, { l: 'S2' }),
        M('F', '결승', { w: 'S1' }, { w: 'S2' }),
      ];
    }
    return [
      M('Q', '예선', { p: s[3] }, { p: s[4] }),
      M('S1', '4강 1', { p: s[0] }, { w: 'Q' }),
      M('S2', '4강 2', { p: s[1] }, { p: s[2] }),
      M('B', '3·4위전', { l: 'S1' }, { l: 'S2' }),
      M('F', '결승', { w: 'S1' }, { w: 'S2' }),
    ];
  }

  find(id) {
    return this.matches.find((m) => m.id === id);
  }

  // 아직 정해지지 않았으면 null
  resolve(ref) {
    if (ref.p) return ref.p;
    const m = this.find(ref.w || ref.l);
    if (!m || !m.winner) return null;
    return ref.w ? m.winner : m.loser;
  }

  get current() {
    return this.matches[this.cursor] || null;
  }

  get finished() {
    return this.cursor >= this.matches.length;
  }

  // how: '5:3' 처럼 경기 점수 (대진표에 표시)
  record(winner, loser, how) {
    const m = this.current;
    m.winner = winner;
    m.loser = loser;
    m.how = how;
    this.cursor++;
    if (this.finished) this.assignPlacements();
  }

  // 최종 순위
  assignPlacements() {
    const F = this.find('F');
    F.winner.placement = 1;
    F.loser.placement = 2;
    const B = this.find('B');
    if (B) {
      B.winner.placement = 3;
      B.loser.placement = 4;
    }
    const Q = this.find('Q');
    if (Q) Q.loser.placement = this.seeds.length; // 3명이면 3위, 5명이면 5위
    for (const p of this.seeds) p.score = CONFIG.PLACE_SCORE[p.placement - 1] + p.scored * 5;
  }
}

// 개인 화면: 나 vs CPU 3명 (점점 강해짐). 지면 그 자리에서 끝
class Gauntlet {
  constructor(me) {
    this.me = me;
    const others = CHARACTERS.map((_, i) => i).filter((i) => i !== me.index);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    this.matches = CONFIG.GAUNTLET.LEVELS.map((lv, i) => ({
      id: 'G' + (i + 1),
      label: `${i + 1}번째 상대`,
      a: { p: me },
      b: { p: new Participant(others[i]) },
      level: lv,
      winner: null,
      loser: null,
      how: '',
    }));
    this.cursor = 0;
    this.lost = false;
  }

  resolve(ref) {
    return ref.p;
  }

  get current() {
    return this.lost ? null : this.matches[this.cursor] || null;
  }

  get finished() {
    return this.lost || this.cursor >= this.matches.length;
  }

  // myPoints: 이 경기에서 내가 딴 점수, straight: 상대를 1점 이하로 막은 완승
  record(winner, loser, how, myPoints, straight) {
    const G = CONFIG.GAUNTLET;
    const m = this.current;
    m.winner = winner;
    m.loser = loser;
    m.how = how;
    this.cursor++;
    this.me.score += myPoints * G.POINT;
    if (winner === this.me) this.me.score += G.WIN + (straight ? G.STRAIGHT : 0);
    else this.lost = true;
  }
}

function shuffleArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
