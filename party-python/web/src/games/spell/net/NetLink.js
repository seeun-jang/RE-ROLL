// =============================================================
// NetLink — 주문 게임 화면과 세션(LocalSession / RemoteSession) 사이의 연결
//
// 서버가 보낸 상태(snap)와 사건(events)을 보관하고, 내 입력을 서버로 보낸다.
// 실행 번호(run)가 다른 메시지는 버린다(지난 판의 늦은 메시지가 섞이지 않게).
// =============================================================

export class NetLink {
  constructor({ session, run }) {
    this.session = session;
    this.run = run;
    /** 서버가 보낸 가장 최근 상태 (없으면 null) */
    this.snap = null;
    const last = session.lastState;
    if (last && last.run === run && last.data) this.snap = last.data;
    this._events = [];
    this._off = [
      session.on('game.state', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        if (this.snap && typeof m.data.now === 'number' && m.data.now < this.snap.now) return;
        this.snap = m.data;
      }),
      session.on('game.event', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        this._events.push(m.data);
        if (this._events.length > 300) this._events.splice(0, this._events.length - 300);
      }),
    ];
  }

  /** 서버 시계(초) */
  now() {
    return this.session.now();
  }

  /** 숫자키·클릭으로 시전 */
  cast(spellId) {
    this.session.sendInput({ k: 'cast', id: spellId });
  }

  /** 외친 주문 — 16비트 PCM 을 base64 로 보낸다 */
  voice(base64Pcm, rate) {
    this.session.sendInput({ k: 'voice', pcm: base64Pcm, rate });
  }

  /** 경기 번호 matchIndex 의 사건(경기 번호가 없는 사건 포함) 중 아직 화면에 반영하지 않은 것을 꺼낸다 */
  takeEvents(matchIndex) {
    const mine = [];
    const rest = [];
    for (const e of this._events) (e.match === matchIndex || e.match === undefined ? mine : rest).push(e);
    this._events = rest;
    return mine;
  }

  clearEvents() {
    this._events = [];
  }

  dispose() {
    for (const off of this._off) off();
    this._off = [];
    this._events = [];
  }
}
