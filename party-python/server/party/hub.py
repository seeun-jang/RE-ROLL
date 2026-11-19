"""대기실(방) — 참가자 관리, 게임 선택·시작, 진행 중인 미니게임 돌리기.

- 방은 하나이고 상태는 서버 메모리에만 있다. 서버를 끄면 사라진다.
- 통신 방식(WebSocket)과 분리되어 있다: 연결마다 '보내기 함수'만 받는다.
  그래서 실제 서버(main.py)와 테스트가 같은 코드를 쓴다.
- 메시지 형식은 docs/COMMON_SPEC.md 참고. 모든 메시지는 {"t": 종류, "d": 내용}.

이 대기실은 미니게임을 따로 시험하기 위한 것이다. 나중에 전체 판(보드)이 생기면
'게임 선택·시작' 부분만 판의 진행 로직으로 바뀌고, 미니게임 쪽 규격은 그대로다.
"""

from __future__ import annotations

import random
import secrets
import time
from typing import Callable

from .minigame import MiniGame

MAX_PLAYERS = 5
NAME_MAX = 8
DEFAULT_NAME = "플레이어"
# 고를 수 있는 캐릭터(동물) id. 화면 쪽 web/src/shared/animals.js 의 ANIMAL_ORDER 와 같아야 한다.
CHARACTERS = ["shiba", "tiger", "duck", "bear", "cat"]


class Participant:
    def __init__(self, pid: str, name: str, order: int, character: str):
        self.id = pid
        self.name = name
        self.character = character  # 대기실에서 고른 캐릭터(동물) id
        self.token = secrets.token_hex(12)
        self.order = order          # 들어온 순서(방장 결정용)
        self.conn: Connection | None = None

    @property
    def connected(self) -> bool:
        return self.conn is not None


class Connection:
    def __init__(self, send: Callable[[dict], None]):
        self._send = send
        self.participant: Participant | None = None
        self.closed = False

    def send(self, kind: str, data: dict | None = None) -> None:
        if self.closed:
            return
        try:
            self._send({"t": kind, "d": data or {}})
        except Exception:  # 한 연결의 전송 실패가 다른 참가자에게 번지지 않게
            self.closed = True


class Hub:
    def __init__(
        self,
        games: dict[str, type[MiniGame]],
        clock: Callable[[], float] = time.monotonic,
        rng_factory: Callable[[], Callable[[], float]] | None = None,
        services: dict | None = None,
    ):
        self.games = games
        #: 게임들이 함께 쓰는 서비스(음성 인식, Gemini 등). 게임을 만들 때 넘겨준다.
        self.services = dict(services or {})
        for cls in games.values():
            try:
                cls.prepare(self.services)
            except Exception as exc:  # 준비 실패가 서버 시작을 막지 않게
                print(f"[party] {cls.id} 준비 중 오류: {exc!r}")
        self.clock = clock
        self.rng_factory = rng_factory or (lambda: random.Random().random)
        self.participants: dict[str, Participant] = {}
        self._order = 0
        self.phase = "lobby"            # lobby | playing
        self.game_id: str | None = next(iter(games), None)
        self.run = 0                    # 미니게임 실행 번호(실행마다 1 증가)
        self.game: MiniGame | None = None
        self.game_players: list[dict] = []
        self._last_seq: dict[str, int] = {}

    # ------------------------------------------------------------------
    # 연결
    # ------------------------------------------------------------------
    def connect(self, send: Callable[[dict], None]) -> Connection:
        return Connection(send)

    def disconnect(self, conn: Connection) -> None:
        conn.closed = True
        p = conn.participant
        conn.participant = None
        if p is None or p.conn is not conn:
            return
        p.conn = None
        now = self.clock()
        if self.phase == "lobby":
            del self.participants[p.id]
        else:
            if self.game and self._in_game(p.id):
                self.game.on_connection(p.id, False, now)
            if not any(x.connected for x in self.participants.values()):
                # 아무도 남지 않으면 게임을 접고 방을 비운다
                self._reset_room()
                return
        self._broadcast_room()

    # ------------------------------------------------------------------
    # 수신
    # ------------------------------------------------------------------
    def receive(self, conn: Connection, msg) -> None:
        if not isinstance(msg, dict):
            return
        kind = msg.get("t")
        data = msg.get("d")
        if not isinstance(kind, str):
            return
        if not isinstance(data, dict):
            data = {}
        if kind == "ping":
            conn.send("pong", {"c": data.get("c"), "s": self.clock()})
            return
        if kind == "hello":
            self._hello(conn, data)
            return
        p = conn.participant
        if p is None:
            self._error(conn, "not_joined", "먼저 이름을 입력해 입장하세요.", kind)
            return
        if kind == "lobby.select":
            self._select(conn, p, data)
        elif kind == "lobby.character":
            self._character(conn, p, data)
        elif kind == "lobby.start":
            self._start(conn, p)
        elif kind == "game.input":
            self._input(p, data)
        elif kind == "game.abort":
            self._abort(conn, p)
        else:
            self._error(conn, "unknown_type", f"알 수 없는 요청입니다: {kind}", kind)

    def _error(self, conn: Connection, code: str, message: str, re: str | None = None) -> None:
        conn.send("error", {"code": code, "message": message, "re": re})

    # ------------------------------------------------------------------
    # 입장
    # ------------------------------------------------------------------
    def _hello(self, conn: Connection, data: dict) -> None:
        if conn.participant is not None:
            self._error(conn, "already_joined", "이미 입장했습니다.", "hello")
            return
        now = self.clock()
        token = data.get("token")
        p = None
        if isinstance(token, str) and token:
            p = next((x for x in self.participants.values() if x.token == token), None)
        if p is not None:
            # 같은 참가자의 재접속: 이전 연결은 끊긴 것으로 본다
            old = p.conn
            if old is not None and old is not conn:
                old.participant = None
                old.send("error", {"code": "replaced", "message": "다른 창에서 다시 접속했습니다.", "re": None})
                old.closed = True
        else:
            if self.phase != "lobby":
                self._error(conn, "game_in_progress", "게임이 진행 중입니다. 끝난 뒤 다시 입장하세요.", "hello")
                return
            if len(self.participants) >= MAX_PLAYERS:
                self._error(conn, "room_full", f"방이 가득 찼습니다(최대 {MAX_PLAYERS}명).", "hello")
                return
            pid = next(f"p{i}" for i in range(1, MAX_PLAYERS + 1) if f"p{i}" not in self.participants)
            self._order += 1
            taken = {x.character for x in self.participants.values()}
            character = next(c for c in CHARACTERS if c not in taken)  # 남은 캐릭터 중 첫 번째
            p = Participant(pid, self._unique_name(data.get("name")), self._order, character)
            self.participants[pid] = p
        p.conn = conn
        conn.participant = p
        conn.send("welcome", {"you": {"id": p.id, "name": p.name}, "token": p.token, "serverTime": now})
        self._broadcast_room()
        # 게임 중 재접속이면 현재 게임 정보를 바로 다시 보낸다
        if self.phase == "playing" and self.game and self._in_game(p.id):
            self.game.on_connection(p.id, True, now)
            conn.send("game.start", self._start_payload(now, resumed=True))
            state = self.game.state_for(p.id, now)
            if state is not None:
                conn.send("game.state", {"run": self.run, "data": state})

    def _unique_name(self, raw) -> str:
        name = raw.strip() if isinstance(raw, str) else ""
        name = name[:NAME_MAX] or DEFAULT_NAME
        used = {x.name for x in self.participants.values()}
        if name not in used:
            return name
        n = 2
        while f"{name[: NAME_MAX - 1]}{n}" in used:
            n += 1
        return f"{name[: NAME_MAX - 1]}{n}"

    # ------------------------------------------------------------------
    # 대기실
    # ------------------------------------------------------------------
    def _host(self) -> Participant | None:
        live = [x for x in self.participants.values() if x.connected]
        return min(live, key=lambda x: x.order) if live else None

    def _is_host(self, p: Participant) -> bool:
        host = self._host()
        return host is not None and host.id == p.id

    def _select(self, conn: Connection, p: Participant, data: dict) -> None:
        if self.phase != "lobby":
            return self._error(conn, "game_in_progress", "게임 중에는 바꿀 수 없습니다.", "lobby.select")
        if not self._is_host(p):
            return self._error(conn, "not_host", "방장만 게임을 고를 수 있습니다.", "lobby.select")
        game_id = data.get("gameId")
        if game_id not in self.games:
            return self._error(conn, "unknown_game", "없는 게임입니다.", "lobby.select")
        self.game_id = game_id
        self._broadcast_room()

    def _character(self, conn: Connection, p: Participant, data: dict) -> None:
        """캐릭터 고르기. 한 캐릭터는 한 사람만 쓸 수 있다."""
        if self.phase != "lobby":
            return self._error(conn, "game_in_progress", "게임 중에는 바꿀 수 없습니다.", "lobby.character")
        character = data.get("character")
        if character not in CHARACTERS:
            return self._error(conn, "unknown_character", "없는 캐릭터입니다.", "lobby.character")
        owner = next((x for x in self.participants.values() if x.character == character and x.id != p.id), None)
        if owner is not None:
            return self._error(conn, "character_taken", f"{owner.name} 님이 이미 고른 캐릭터입니다.", "lobby.character")
        p.character = character
        self._broadcast_room()

    def _start(self, conn: Connection, p: Participant) -> None:
        if self.phase != "lobby":
            return self._error(conn, "game_in_progress", "이미 게임이 진행 중입니다.", "lobby.start")
        if not self._is_host(p):
            return self._error(conn, "not_host", "방장만 시작할 수 있습니다.", "lobby.start")
        cls = self.games.get(self.game_id or "")
        if cls is None:
            return self._error(conn, "unknown_game", "게임을 먼저 고르세요.", "lobby.start")
        members = sorted((x for x in self.participants.values() if x.connected), key=lambda x: x.order)
        if not (cls.min_players <= len(members) <= cls.max_players):
            return self._error(
                conn, "bad_player_count",
                f"이 게임은 {cls.min_players}~{cls.max_players}명이 필요합니다(지금 {len(members)}명).", "lobby.start",
            )
        now = self.clock()
        self.run += 1
        self.game_players = [
            {"id": x.id, "name": x.name, "index": i, "character": x.character} for i, x in enumerate(members)
        ]
        self._last_seq = {}
        self.game = cls(self.game_players, {}, self.rng_factory())
        self.game.services = self.services
        self.phase = "playing"
        self.game.start(now)
        self._broadcast_room()
        payload = self._start_payload(now)
        for x in members:
            x.conn.send("game.start", payload)
        self._flush()

    def _start_payload(self, now: float, resumed: bool = False) -> dict:
        return {
            "run": self.run, "gameId": self.game_id, "players": self.game_players,
            "options": self.game.client_options() if self.game else {},
            "serverTime": now, "resumed": resumed,
        }

    def _abort(self, conn: Connection, p: Participant) -> None:
        if self.phase != "playing":
            return
        if not self._is_host(p):
            return self._error(conn, "not_host", "방장만 게임을 중단할 수 있습니다.", "game.abort")
        self._end_game(aborted=True)

    # ------------------------------------------------------------------
    # 게임 진행
    # ------------------------------------------------------------------
    def _in_game(self, pid: str) -> bool:
        return any(x["id"] == pid for x in self.game_players)

    def _input(self, p: Participant, data: dict) -> None:
        # 지난 실행의 입력, 게임에 없는 사람의 입력, 중복 입력은 조용히 버린다
        if self.phase != "playing" or self.game is None:
            return
        if data.get("run") != self.run or not self._in_game(p.id):
            return
        seq = data.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool) or seq <= self._last_seq.get(p.id, 0):
            return
        self._last_seq[p.id] = seq
        payload = data.get("data")
        if not isinstance(payload, dict):
            return
        self.game.on_input(p.id, payload, self.clock())
        self._flush()
        if self.game.finished:
            self._end_game()

    def tick(self) -> None:
        """주기 호출: 진행 중인 게임을 한 번 진행한다."""
        if self.phase != "playing" or self.game is None:
            return
        self.game.tick(self.clock())
        self._flush()
        if self.game.finished:
            self._end_game()

    @property
    def tick_interval(self) -> float:
        hz = self.game.tick_hz if (self.phase == "playing" and self.game) else 10
        return 1.0 / max(1, hz)

    def _flush(self) -> None:
        if self.game is None:
            return
        for to, kind, data in self.game.drain():
            msg = {"run": self.run, "data": data}
            for player in self.game_players:
                if to is not None and to != player["id"]:
                    continue
                p = self.participants.get(player["id"])
                if p is not None and p.conn is not None:
                    p.conn.send(f"game.{kind}", msg)

    def _end_game(self, aborted: bool = False) -> None:
        game = self.game
        results = [] if (aborted or game is None) else game.results
        payload = {"run": self.run, "gameId": self.game_id, "results": results, "aborted": aborted}
        for player in self.game_players:
            p = self.participants.get(player["id"])
            if p is not None and p.conn is not None:
                p.conn.send("game.end", payload)
        self.game = None
        self.game_players = []
        self.phase = "lobby"
        # 게임 도중 나간 사람은 대기실에서 정리한다
        for pid in [pid for pid, x in self.participants.items() if not x.connected]:
            del self.participants[pid]
        self._broadcast_room()

    def _reset_room(self) -> None:
        self.game = None
        self.game_players = []
        self.phase = "lobby"
        self.participants.clear()

    # ------------------------------------------------------------------
    # 방 상태 알림
    # ------------------------------------------------------------------
    def room_payload(self) -> dict:
        host = self._host()
        return {
            "phase": self.phase,
            "gameId": self.game_id,
            "run": self.run,
            "hostId": host.id if host else None,
            "maxPlayers": MAX_PLAYERS,
            "characters": list(CHARACTERS),
            "participants": [
                {
                    "id": x.id, "name": x.name, "connected": x.connected,
                    "isHost": bool(host and host.id == x.id), "character": x.character,
                }
                for x in sorted(self.participants.values(), key=lambda x: x.order)
            ],
            "games": [
                {"id": gid, "title": cls.title, "minPlayers": cls.min_players, "maxPlayers": cls.max_players}
                for gid, cls in self.games.items()
            ],
        }

    def _broadcast_room(self) -> None:
        payload = self.room_payload()
        for x in self.participants.values():
            if x.conn is not None:
                x.conn.send("room", payload)
