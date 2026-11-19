// =============================================================
// NetLink — 줄다리기 화면과 세션(LocalSession / RemoteSession) 사이의 연결
//
// - 서버가 보낸 상태(snap)와 판정 결과(judge)를 보관하고, 내 입력을 서버로 보낸다.
// - 화면 쪽 코드는 세션 종류를 모른다. 이 객체만 본다.
// - 실행 번호(run)가 다른 메시지는 버린다(지난 판의 늦은 메시지가 섞이지 않게).
// =============================================================

export class NetLink {
  /**
   * @param {{ session: object, run: number }} ctx 공통 규격의 mount(container, ctx) 가 받는 값
   */
  constructor({ session, run }) {
    this.session = session;
    this.run = run;
    /** 서버가 보낸 가장 최근 상태 (없으면 null) */
    this.snap = null;
    // 화면이 뜨기 전에 이미 도착한 상태가 있으면 그것부터 쓴다
    const last = session.lastState;
    if (last && last.run === run && last.data) this.snap = last.data;
    this._judges = [];
    this._lastResult = null;
    this._off = [
      session.on('game.state', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        // 순서가 뒤바뀌어 도착한 오래된 상태는 버린다
        if (this.snap && typeof m.data.now === 'number' && m.data.now < this.snap.now) return;
        this.snap = m.data;
        if (m.data.result) this._lastResult = m.data.result;
      }),
      session.on('game.event', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        if (m.data.type === 'judge') this._judges.push(m.data);
      }),
    ];
  }

  /** 서버 시계(초) */
  now() {
    return this.session.now();
  }

  /** 줄 당기기. t = 라운드 시작 후 경과 시간(초)으로 나타낸 '누른 시각' */
  sendPull(t) {
    this.session.sendInput({ k: 'pull', t });
  }

  /** 점수 기록 화면의 '결과 확인' */
  sendConfirm() {
    this.session.sendInput({ k: 'confirm' });
  }

  /** 아직 화면에 반영하지 않은 판정 결과들을 꺼낸다 */
  takeJudges() {
    const out = this._judges;
    this._judges = [];
    return out;
  }

  /** 서버가 계산한 직전 라운드 결과 (RoundResultScene 이 쓰는 형식) */
  roundResult() {
    const r = (this.snap && this.snap.result) || this._lastResult;
    if (!r) return { winnerSide: null, bonus: {}, roundScores: {}, round: this.snap ? this.snap.round : 1 };
    return { ...r };
  }

  /** Game.setupRound 가 쓰는 팀 배정기 대역: 서버가 정한 팀을 그대로 돌려준다 */
  teamAssigner() {
    return {
      next: () => {
        const t = (this.snap && this.snap.teams) || { left: [], right: [] };
        return { left: [...t.left], right: [...t.right] };
      },
      reset() {},
    };
  }

  /** 서버가 정한 힘 보정 배율을 팀 객체에 적용 */
  applyTeamMultipliers(teams) {
    const mult = this.snap && this.snap.teams && this.snap.teams.mult;
    if (!mult) return;
    if (Number.isFinite(mult.left)) teams.left.multiplier = mult.left;
    if (Number.isFinite(mult.right)) teams.right.multiplier = mult.right;
  }

  dispose() {
    for (const off of this._off) off();
    this._off = [];
    this._judges = [];
  }
}
