// =============================================================
// NetLink — 마법진 그리기 화면과 세션(LocalSession / RemoteSession) 사이의 연결
//
// 서버가 보낸 상태(snap)와 사건(events)을 보관하고, 내 입력(펜이 지나간 점 · 완료)을 서버로 보낸다.
// 실행 번호(run)가 다른 메시지는 버린다(지난 판의 늦은 메시지가 섞이지 않게).
// =============================================================

export class NetLink {
  constructor({ session, run }) {
    this.session = session;
    this.run = run;
    /** 서버가 보낸 가장 최근 상태 (없으면 null) */
    this.snap = null;
    const last = session.lastState;
    /** 다시 접속했을 때만 상태에 실려 오는 것(내 그림 · 공개된 그림) — 다음 상태가 덮어써도 남겨 둔다 */
    this.extra = { round: 0, ink: null, drawings: null };
    if (last && last.run === run && last.data) this._keep(last.data);
    this._events = [];
    this._off = [
      session.on('game.state', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        if (this.snap && typeof m.data.now === 'number' && m.data.now < this.snap.now) return;
        this._keep(m.data);
      }),
      session.on('game.event', (m) => {
        if (!m || m.run !== this.run || !m.data) return;
        this._events.push(m.data);
        if (this._events.length > 300) this._events.splice(0, this._events.length - 300);
      }),
    ];
  }

  _keep(data) {
    this.snap = data;
    if (data.me && data.me.ink) this.extra = { round: data.round, ink: data.me.ink, drawings: null };
    if (data.drawings) this.extra = { round: data.round, ink: null, drawings: data.drawings };
  }

  /** 서버 시계(초) */
  now() {
    return this.session.now();
  }

  /**
   * 펜이 지나간 점들 [x0, y0, x1, y1, ...] — 종이 좌표(0~119, 정수).
   * 거울 저주 · 흔들 종이는 이 좌표를 만들 때 이미 적용돼 있다(서버는 다시 바꾸지 않는다).
   * cont = true 면 바로 앞에 보낸 선에 이어 그린다.
   */
  ink(points, cont) {
    this.session.sendInput({ k: 'ink', p: points, c: cont ? 1 : 0 });
  }

  /** 다 그렸다 — 누른 시각(서버 시계)을 함께 보낸다 */
  done() {
    this.session.sendInput({ k: 'done', t: this.now() });
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
