// =============================================================
// NetLink — 홈런 더비 화면과 세션(LocalSession / RemoteSession) 사이의 연결
//
// 서버가 보낸 상태(snap)와 사건(events)을 보관하고, 내 스윙을 서버로 보낸다.
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
        if (this._events.length > 200) this._events.splice(0, this._events.length - 200);
      }),
    ];
  }

  /** 서버 시계(초) */
  now() {
    return this.session.now();
  }

  /** 스윙: t = 누른 시각(서버 시계), x = 그때의 배트 위치(px, 가운데 0) */
  swing(t, x) {
    this.session.sendInput({ k: 'swing', t, x });
  }

  /** 아직 화면에 반영하지 않은 사건을 꺼낸다 */
  takeEvents() {
    const out = this._events;
    this._events = [];
    return out;
  }

  dispose() {
    for (const off of this._off) off();
    this._off = [];
    this._events = [];
  }
}
