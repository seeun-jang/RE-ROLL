// =============================================================
// NetLink — 잭팟 그루브 화면과 세션(LocalSession / RemoteSession) 사이의 연결
//
// 서버가 보낸 상태(snap)와 사건(events)을 보관하고, 내 키 입력을 서버로 보낸다.
// 실행 번호(run)가 다른 메시지는 버린다(지난 판의 늦은 메시지가 섞이지 않게).
// =============================================================

export class NetLink {
  constructor({ session, run }) {
    this.session = session;
    this.run = run;
    /** 서버가 보낸 가장 최근 상태 (없으면 null) */
    this.snap = null;
    /** 다시 접속했을 때 서버가 알려 준 내 진행 상황 (없으면 null) */
    this.meDump = null;
    this._events = [];
    const take = (data) => {
      if (this.snap && typeof data.now === 'number' && data.now < this.snap.now) return;
      this.snap = data;
      if (data.me) this.meDump = data.me;
    };
    const last = session.lastState;
    if (last && last.run === run && last.data) take(last.data);
    this._off = [
      session.on('game.state', (m) => {
        if (m && m.run === this.run && m.data) take(m.data);
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

  /** 키를 누르거나(down=true) 뗀 순간. t = 곡 시간(서버 시계 − 곡 시작 시각) */
  key(lane, down, t) {
    this.session.sendInput({ k: 'key', lane, down, t });
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
