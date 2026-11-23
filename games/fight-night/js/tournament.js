// =====================================================
// 토너먼트 대진 (2~5명) + 개인 화면용 CPU 3연전
// 5명: 예선(4번 vs 5번 시드) → 준결승 2경기 → 3·4위전 → 결승
//      → 1~5위가 모두 경기 결과로 정해짐
// =====================================================
class Participant {
  constructor(index) {
    this.index = index;
    this.def = CHARACTERS[index];
    this.name = this.def.name;
    this.color = C(this.def.color);
    this.wins = 0;
    this.kos = 0;
    this.damage = 0;
    this.score = 0;
    this.placement = null;
  }

  get spr() {
    return SPR.players[this.index];
  }
}

class Tournament {
  constructor(players) {
    this.seeds = [...players];
    this.shuffle();
    this.cursor = 0;
  }

  // 무작위 대진
  shuffle() {
    const s = this.seeds;
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    this.matches = this.build(s);
  }

  // 대진표 칸 두 개 바꾸기 (대진 정하기 화면)
  swap(pa, pb) {
    const s = this.seeds;
    const i = s.indexOf(pa);
    const j = s.indexOf(pb);
    if (i < 0 || j < 0 || i === j) return;
    [s[i], s[j]] = [s[j], s[i]];
    this.matches = this.build(s);
  }

  // ---- 대진표 나무 모양 (아래 = 선수 · 위로 갈수록 결승) ----
  //  leaves: 아래 줄 선수 칸 (왼→오른) / nodes: 경기 마디 (level 1~)
  tree() {
    const F = this.find('F');
    const leaves = [];
    const nodes = [];
    const walk = (ref) => {
      if (ref.p) {
        const leaf = { kind: 'leaf', p: ref.p, level: 0, idx: leaves.length };
        leaves.push(leaf);
        return leaf;
      }
      return walkMatch(this.find(ref.w));
    };
    const walkMatch = (m) => {
      const a = walk(m.a);
      const b = walk(m.b);
      const node = { kind: 'match', m, kids: [a, b], level: Math.max(a.level, b.level) + 1 };
      nodes.push(node);
      return node;
    };
    const root = walkMatch(F);
    return { root, leaves, nodes, depth: root.level };
  }

  // ref: { p } 선수 고정 / { w: id } 그 경기 승자 / { l: id } 그 경기 패자
  build(s) {
    const n = s.length;
    const M = (id, label, a, b) => ({ id, label, a, b, winner: null, loser: null, ko: false });
    if (n === 2) return [M('F', '결승', { p: s[0] }, { p: s[1] })];
    if (n === 3) return [M('Q', '예선', { p: s[1] }, { p: s[2] }), M('F', '결승', { p: s[0] }, { w: 'Q' })];
    if (n === 4) {
      return [
        M('S1', '준결승 1', { p: s[0] }, { p: s[3] }),
        M('S2', '준결승 2', { p: s[1] }, { p: s[2] }),
        M('B', '3·4위전', { l: 'S1' }, { l: 'S2' }),
        M('F', '결승', { w: 'S1' }, { w: 'S2' }),
      ];
    }
    return [
      M('Q', '예선', { p: s[3] }, { p: s[4] }),
      M('S1', '준결승 1', { p: s[0] }, { w: 'Q' }),
      M('S2', '준결승 2', { p: s[1] }, { p: s[2] }),
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

  record(winner, loser, ko) {
    const m = this.current;
    m.winner = winner;
    m.loser = loser;
    m.ko = ko;
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
    for (const p of this.seeds) p.score = CONFIG.PLACE_SCORE[p.placement - 1] + p.kos * 20 + p.damage;
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
      ko: false,
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

  record(winner, loser, ko, hpLeft) {
    const G = CONFIG.GAUNTLET;
    const m = this.current;
    m.winner = winner;
    m.loser = loser;
    m.ko = ko;
    this.cursor++;
    if (winner === this.me) this.me.score += G.WIN + (ko ? G.KO_BONUS : 0) + hpLeft * G.HP_BONUS;
    else this.lost = true;
  }
}
