// =============================================================
// NetLink — 무궁화 게임 화면과 세션(LocalSession / RemoteSession) 사이의 연결
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

  /** 도망자: 전진 키를 누름/뗌 */
  move(on) {
    this.session.sendInput({ k: 'move', on });
  }

  /** 술래: 말하는 중인지와 소리 크기(화면 표시·뒤돌기용) */
  mic(on, level) {
    this.session.sendInput({ k: 'mic', on, lv: Math.round(level * 100) / 100 });
  }

  /** 술래: 외친 말 한 토막 — 16비트 PCM 을 base64 로 보낸다 */
  voice(base64Pcm, rate) {
    this.session.sendInput({ k: 'voice', pcm: base64Pcm, rate });
  }

  /** 술래: 마이크 대신 키로 외치기(누르고 있다 떼면 돌아본다) */
  chant(on) {
    this.session.sendInput({ k: 'chant', on });
  }

  /** 아직 화면에 반영하지 않은 사건을 꺼낸다 */
  takeEvents() {
    const out = this._events;
    this._events = [];
    return out;
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
