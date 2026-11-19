// =============================================================
// LocalSession — 서버 없이 화면과 입력을 확인하는 시험용 세션
//
// - 참가자는 '나' + 시험용 봇이다. 실제 사람·실제 서버·실제 AI 가 아니다.
// - 게임 진행은 각 게임의 시험용 진행기(registry 의 loadSim)가 맡는다.
// - RemoteSession 과 같은 메서드·같은 이벤트를 쓰고, 결과도 비동기로 전달한다.
//   그래서 화면 코드는 세션이 어느 쪽인지 몰라도 된다.
// =============================================================
import { Emitter } from './Emitter.js';
import { GAMES } from '../games/registry.js';
import { ANIMAL_ORDER } from '../shared/animals.js';

const MAX_PLAYERS = 5;
const now = () => performance.now() / 1000;
/** 결과를 다음 순간에 전달(서버 응답처럼 비동기로) */
const later = (fn) => Promise.resolve().then(fn);

export class LocalSession extends Emitter {
  /** @param {{ players?: number }} options players = 나를 포함한 전체 인원 (2~5) */
  constructor({ players = 3 } = {}) {
    super();
    this.kind = 'local';
    this.total = Math.max(2, Math.min(MAX_PLAYERS, Number(players) || 3));
    this.me = null;
    this.room = null;
    this.run = 0;
    this.connected = false;
    /** 가장 최근 game.state 메시지 { run, data } */
    this.lastState = null;
    this._participants = [];
    this._gameId = Object.keys(GAMES)[0] || null;
    this._phase = 'lobby';
    this._sim = null;
    this._bots = null;
    this._timer = 0;
    this._closed = false;
  }

  now() {
    return now();
  }

  async connect(name) {
    const myName = String(name || '').trim().slice(0, 8) || '플레이어';
    this._participants = [{ id: 'p1', name: myName, bot: false, character: ANIMAL_ORDER[0] }];
    for (let i = 2; i <= this.total; i++) {
      this._participants.push({ id: `p${i}`, name: `봇${i - 1}`, bot: true, character: ANIMAL_ORDER[i - 1] });
    }
    this.me = { id: 'p1', name: myName };
    this.connected = true;
    later(() => {
      this.emit('status', { connected: true });
      this._emitRoom();
    });
    return this.me;
  }

  _emitRoom() {
    if (this._closed) return;
    this.room = {
      local: true,
      phase: this._phase,
      gameId: this._gameId,
      run: this.run,
      hostId: 'p1',
      maxPlayers: MAX_PLAYERS,
      characters: [...ANIMAL_ORDER],
      participants: this._participants.map((p) => ({
        id: p.id, name: p.name, connected: true, isHost: p.id === 'p1', bot: p.bot, character: p.character,
      })),
      games: Object.values(GAMES).map((g) => ({
        id: g.id, title: g.title, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
      })),
    };
    this.emit('room', this.room);
  }

  selectGame(gameId) {
    if (this._phase !== 'lobby' || !GAMES[gameId]) return;
    this._gameId = gameId;
    later(() => this._emitRoom());
  }

  /** 캐릭터 고르기. 봇이 쓰던 캐릭터를 고르면 봇과 맞바꾼다(시험용이라 봇은 양보한다) */
  selectCharacter(character) {
    if (this._phase !== 'lobby' || !ANIMAL_ORDER.includes(character)) return;
    const me = this._participants[0];
    const owner = this._participants.find((p) => p.character === character && p !== me);
    if (owner) owner.character = me.character;
    me.character = character;
    later(() => this._emitRoom());
  }

  async startGame() {
    const def = GAMES[this._gameId];
    if (this._phase !== 'lobby' || !def) return;
    const n = this._participants.length;
    if (n < def.minPlayers || n > def.maxPlayers) {
      later(() => this.emit('error', {
        code: 'bad_player_count', message: `이 게임은 ${def.minPlayers}~${def.maxPlayers}명이 필요합니다(지금 ${n}명).`,
      }));
      return;
    }
    this._phase = 'playing';
    const { Sim, createBots } = await def.loadSim();
    if (this._closed) return;
    this.run += 1;
    const run = this.run;
    const players = this._participants.map((p, index) => ({ id: p.id, name: p.name, index, character: p.character }));
    const sim = new Sim(players, {}, Math.random);
    this._sim = sim;
    this._bots = createBots ? createBots(this._participants.filter((p) => p.bot).map((p) => p.id), Math.random) : null;
    const t0 = now();
    sim.start(t0);
    this._emitRoom();
    this.emit('game.start', {
      run, gameId: def.id, players, options: sim.clientOptions(), serverTime: t0, resumed: false, local: true,
    });
    this._flush(run);
    const hz = Sim.tickHz || 30;
    this._timer = setInterval(() => this._tick(run), 1000 / hz);
  }

  _tick(run) {
    const sim = this._sim;
    if (!sim || run !== this.run) return;
    const t = now();
    if (this._bots) {
      for (const input of this._bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    }
    sim.tick(t);
    this._flush(run);
    if (sim.finished) this._end(run, false);
  }

  _flush(run) {
    const sim = this._sim;
    if (!sim) return;
    for (const [to, kind, data] of sim.drain()) {
      if (to !== null && to !== this.me.id) continue;
      if (kind === 'state') this.lastState = { run, data };
      this.emit(`game.${kind}`, { run, data });
    }
  }

  _end(run, aborted) {
    const sim = this._sim;
    clearInterval(this._timer);
    this._timer = 0;
    this._sim = null;
    this._bots = null;
    this._phase = 'lobby';
    this.emit('game.end', {
      run, gameId: this._gameId, results: aborted || !sim ? [] : sim.results, aborted, local: true,
    });
    this._emitRoom();
  }

  abortGame() {
    if (this._phase === 'playing' && this._sim) later(() => this._end(this.run, true));
  }

  sendInput(data) {
    const run = this.run;
    later(() => {
      const sim = this._sim;
      if (!sim || run !== this.run || this._closed) return;
      sim.onInput(this.me.id, data, now());
      this._flush(run);
      if (sim.finished) this._end(run, false);
    });
  }

  close() {
    this._closed = true;
    clearInterval(this._timer);
    this._sim = null;
    this.connected = false;
    this.clear();
  }
}
