(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 시합 규칙 — 3판 2선승제
  //  - 경기 시간 3분 (판정·중단 중에는 시계가 멈춤)
  //  - 먼저 두 판을 따면 승리
  //  - 시간 종료 시 한 판이라도 앞선 쪽 승리, 동점이면 연장전(먼저 한 판 = 승리)
  //  - 장외 반칙 2회 = 상대에게 한 판 (반칙 횟수는 다시 0부터)
  //  - 연장전이 ENCHO_SEC 를 넘으면 심판 3명의 판정(판정승) — 게임용 마무리 규칙
  // ─────────────────────────────────────────────────────────────
  const LABELS = { men: '머', kote: '손', do: '허', hansoku: '반' };

  class MatchRules {
    constructor(o) {
      const C = PK.CONFIG.MATCH;
      this.timeLimit = Math.round((o && o.timeSec || C.TIME_SEC) * 60);
      this.timeLeft = this.timeLimit;
      this.toWin = (o && o.toWin) || C.POINTS_TO_WIN;
      this.points = { red: [], white: [] };
      this.hansoku = { red: 0, white: 0 };
      this.encho = false;
      this.enchoT = 0;
      this.winner = null;
      this.decidedBy = null;
    }

    static other(side) { return side === 'red' ? 'white' : 'red'; }
    static label(kind) { return LABELS[kind] || '?'; }

    // 1틱 진행. 정규 시간이 막 끝났으면 true
    tick() {
      if (this.encho) { this.enchoT++; return false; }
      if (this.timeLeft > 0) {
        this.timeLeft--;
        return this.timeLeft === 0;
      }
      return false;
    }

    award(side, kind) {
      this.points[side].push(kind);
      if (this.encho || this.points[side].length >= this.toWin) {
        this.winner = side;
        this.decidedBy = this.encho ? 'encho' : 'points';
      }
      return { winner: this.winner };
    }

    addHansoku(side) {
      this.hansoku[side]++;
      if (this.hansoku[side] >= PK.CONFIG.MATCH.HANSOKU_LIMIT) {
        this.hansoku[side] = 0;
        const to = MatchRules.other(side);
        const r = this.award(to, 'hansoku');
        return { converted: true, to: to, winner: r.winner };
      }
      return { converted: false, count: this.hansoku[side] };
    }

    // 시간 종료 판정
    decideOnTime() {
      const r = this.points.red.length, w = this.points.white.length;
      if (r > w) { this.winner = 'red'; this.decidedBy = 'time'; }
      else if (w > r) { this.winner = 'white'; this.decidedBy = 'time'; }
      return this.winner;
    }

    // 연장전 시간 초과 → 판정으로 가야 하는가
    get enchoOver() {
      return this.encho && this.enchoT >= PK.CONFIG.MATCH.ENCHO_SEC * 60;
    }

    // 판정승 기록
    decideByHantei(side) {
      this.winner = side;
      this.decidedBy = 'hantei';
      return side;
    }

    startEncho() {
      this.encho = true;
      this.enchoT = 0;
    }

    // 1:1 이면 마지막 판 ("승부!")
    get isShobu() {
      return !this.encho && this.points.red.length === this.toWin - 1 && this.points.white.length === this.toWin - 1;
    }

    get totalPoints() { return this.points.red.length + this.points.white.length; }

    timeText() {
      const t = this.encho ? this.enchoT : this.timeLeft;
      const sec = this.encho ? Math.floor(t / 60) : Math.ceil(t / 60);
      const m = Math.floor(sec / 60), s = sec % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
  }

  PK.MatchRules = MatchRules;
})(window.PK = window.PK || {});
