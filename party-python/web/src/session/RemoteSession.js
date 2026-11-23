// =============================================================
// RemoteSession — 실제 Python 서버와 WebSocket 으로 통신하는 세션
//
// LocalSession 과 같은 메서드·같은 이벤트를 쓴다 (docs/COMMON_SPEC.md 3장).
// 주소는 지금 접속한 주소를 기준으로 만든다 → localhost, 터널 주소 어디서 열어도 동작한다.
// =============================================================
import { Emitter } from './Emitter.js';

const TOKEN_KEY = 'party.token';       // 재접속용 토큰 (탭마다 따로: sessionStorage)
const PING_FAST_MS = 400;              // 접속 직후 시계 맞추기 간격
const PING_SLOW_MS = 4000;             // 그 뒤 간격
const PING_FAST_COUNT = 6;
const RECONNECT_MS = 1500;
const CONNECT_TIMEOUT_MS = 8000;

const localSeconds = () => performance.now() / 1000;

function loadToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
}
function saveToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* 저장 실패는 무시 */ }
}

export class RemoteSession extends Emitter {
  /**
   * @param {{ url?: string, hello?: object }} options
   *   hello = 입장할 때 함께 보낼 값(보드게임이 띄운 미니게임: { tag, character })
   */
  constructor({ url, hello } = {}) {
    super();
    this.kind = 'remote';
    this._hello = hello || {};
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.me = null;
    this.room = null;
    this.run = 0;
    this.connected = false;
    /** 가장 최근 game.state 메시지 { run, data } — 게임 화면이 뜨기 전에 온 상태를 놓치지 않게 보관 */
    this.lastState = null;
    this._ws = null;
    this._name = '';
    this._token = loadToken();
    this._seq = Date.now();          // 입력 순번: 새로고침 뒤에도 계속 커지도록 시각에서 시작
    this._offset = 0;                // 서버 시계 - 내 시계 (초)
    this._bestRtt = Infinity;
    this._pingCount = 0;
    this._pingTimer = 0;
    this._retryTimer = 0;
    this._closed = false;
    this._pending = null;            // connect() 의 { resolve, reject, timer }
  }

  /** 서버 시계(초) */
  now() {
    return localSeconds() + this._offset;
  }

  /** 이름으로 입장. 성공하면 { id, name } */
  connect(name) {
    this._name = String(name || '');
    this._closed = false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._failPending(new Error('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.'));
      }, CONNECT_TIMEOUT_MS);
      this._pending = { resolve, reject, timer };
      this._open();
    });
  }

  _failPending(err) {
    const p = this._pending;
    if (!p) return;
    this._pending = null;
    clearTimeout(p.timer);
    this._closed = true;
    if (this._ws) { try { this._ws.close(); } catch (e) { /* 무시 */ } }
    p.reject(err);
  }

  _open() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this._failPending(new Error('서버 주소가 올바르지 않습니다.'));
      return;
    }
    this._ws = ws;
    ws.onopen = () => {
      this._send('hello', { ...this._hello, name: this._name, token: this._token });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg && typeof msg.t === 'string') this._handle(msg.t, msg.d || {});
    };
    ws.onclose = () => {
      if (this._ws !== ws) return;
      this._ws = null;
      clearTimeout(this._pingTimer);
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('status', { connected: false });
      if (this._pending) {
        this._failPending(new Error('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.'));
        return;
      }
      // 입장한 뒤 끊겼으면 같은 참가자로 다시 접속을 시도한다
      if (!this._closed && this.me) {
        this._retryTimer = setTimeout(() => this._open(), RECONNECT_MS);
      }
    };
    ws.onerror = () => { /* onclose 가 이어서 온다 */ };
  }

  _send(t, d) {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t, d: d || {} }));
    return true;
  }

  _handle(t, d) {
    switch (t) {
      case 'welcome': {
        this.me = d.you;
        this._token = d.token;
        saveToken(d.token);
        this._offset = d.serverTime - localSeconds(); // 첫 추정값. 곧 ping 으로 더 정확히 맞춘다
        this._bestRtt = Infinity;
        this._pingCount = 0;
        this.connected = true;
        this._ping();
        const p = this._pending;
        if (p) {
          this._pending = null;
          clearTimeout(p.timer);
          p.resolve(this.me);
        }
        this.emit('status', { connected: true });
        break;
      }
      case 'pong': {
        // 왕복 시간이 가장 짧았던 측정값으로 시계 차이를 정한다
        const t1 = localSeconds();
        const t0 = Number(d.c);
        if (!Number.isFinite(t0) || !Number.isFinite(d.s)) break;
        const rtt = t1 - t0;
        if (rtt >= 0 && rtt <= this._bestRtt + 0.005) {
          this._bestRtt = Math.min(this._bestRtt, rtt);
          this._offset = d.s - (t0 + t1) / 2;
        }
        break;
      }
      case 'room':
        this.room = d;
        this.emit('room', d);
        break;
      case 'game.start':
        this.run = d.run;
        this.emit('game.start', d);
        break;
      case 'game.state':
        this.lastState = d;
        this.emit(t, d);
        break;
      case 'game.event':
      case 'game.end':
        this.emit(t, d);
        break;
      case 'error':
        if (this._pending) {
          this._failPending(new Error(d.message || '입장할 수 없습니다.'));
        } else {
          if (d.code === 'replaced') this._closed = true; // 다른 창이 이어받았으면 다시 접속하지 않는다
          this.emit('error', d);
        }
        break;
      default:
        break;
    }
  }

  _ping() {
    clearTimeout(this._pingTimer);
    if (!this._send('ping', { c: localSeconds() })) return;
    this._pingCount++;
    const delay = this._pingCount < PING_FAST_COUNT ? PING_FAST_MS : PING_SLOW_MS;
    this._pingTimer = setTimeout(() => this._ping(), delay);
  }

  selectGame(gameId) {
    this._send('lobby.select', { gameId });
  }

  /** 대기실에서 캐릭터(동물) 고르기 */
  selectCharacter(character) {
    this._send('lobby.character', { character });
  }

  startGame() {
    this._send('lobby.start', {});
  }

  abortGame() {
    this._send('game.abort', {});
  }

  /** 미니게임 입력. 실행 번호와 순번을 붙여 보낸다(지난 판·중복 입력을 서버가 걸러낸다) */
  sendInput(data) {
    this._seq += 1;
    this._send('game.input', { run: this.run, seq: this._seq, data });
  }

  close() {
    this._closed = true;
    clearTimeout(this._pingTimer);
    clearTimeout(this._retryTimer);
    if (this._ws) { try { this._ws.close(); } catch (e) { /* 무시 */ } }
    this._ws = null;
    this.connected = false;
    this.clear();
  }
}
