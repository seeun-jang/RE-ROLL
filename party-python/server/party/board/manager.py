"""보드게임 방 관리자 — 모든 방을 갖고 있고, 화면이 보낸 메시지를 처리한다.

원본 party.js 의 onPartyConnection(메시지 처리) · partyStatus 부분을 옮긴 것이다.

    manager = BoardManager()
    conn = manager.connect(send)          # send(msg: dict) 는 그 사람에게 보내는 함수
    await manager.receive(conn, msg)      # 화면이 보낸 메시지 하나
    manager.disconnect(conn)              # 연결이 끊김

화면 → 서버 메시지 (모두 {"t": 종류, ...} 모양)
    hello{token,name} · create{name} · join{name,code} · leave · name{name} · turns{n} · start
    lobby · answer{id,value} · result{score} · skipGame
"""

from __future__ import annotations

import itertools
import random
from typing import Awaitable, Callable

from . import data as R
from .game import start_game
from .jsutil import clean_name, clean_score, js_slice, js_text, to_number
from .room import Player, Room, Timings, make_timings, now_ms


class Connection:
    """접속 하나 (브라우저 탭 하나). 원본에서 onPartyConnection 안의 변수 me · room · player 에 해당."""

    def __init__(self, send: Callable[[dict], None], close: Callable[[], None] | None = None):
        self._send = send
        self._close = close
        self.closed = False
        self.me: dict | None = None        # {"token", "name"} — hello 를 받으면 생김
        self.room: Room | None = None
        self.player: Player | None = None

    def send(self, msg: dict) -> None:
        if not self.closed:
            self._send(msg)

    def close(self) -> None:
        """서버 쪽에서 끊기 (같은 사람이 다른 탭으로 다시 들어왔을 때 옛 연결)."""
        self.closed = True
        if self._close:
            self._close()


class BoardManager:
    def __init__(
        self,
        minigame_runner: Callable[[Room, dict], Awaitable[dict | None]] | None = None,
        minigames: list[dict] | None = None,
        *,
        rng_factory: Callable[[], random.Random] | None = None,
        clock: Callable[[], float] | None = None,
        timings: Timings | None = None,
        gemini=None,
    ):
        """
        minigame_runner: 미니게임을 직접 돌릴 함수 `async def runner(room, mg) -> dict | None` (없으면 원래 방식)
        minigames:       고를 미니게임 목록 [{"id", "name"}] (없으면 rules.js 의 목록)
        rng_factory:     방마다 쓸 random.Random 을 만드는 함수 (테스트에서 씨앗 고정)
        clock:           지금 시각(1970년부터의 밀리초)을 돌려주는 함수
        timings:         연출 시간. 없으면 환경 변수 PARTY_SPEED 를 반영한 기본값
        gemini:          서버의 Gemini 서비스 (보스전 마법사 대사). 없으면 기본 대사
        """
        self.minigame_runner = minigame_runner
        self.minigames = minigames
        self.rng_factory = rng_factory or random.Random
        self.clock = clock or now_ms
        self.T = timings or make_timings()
        self.gemini = gemini
        self.rng = self.rng_factory()          # 방 번호 뽑기용
        self.rooms: dict[str, Room] = {}       # 방 번호 → 방
        self.ids = itertools.count(1)          # 참가자 번호표 (모든 방이 같이 씀 → 서버 전체에서 겹치지 않음)
        self.prompt_ids = itertools.count(1)   # 질문 번호표

    # ----- 연결 -----
    def connect(self, send: Callable[[dict], None], close: Callable[[], None] | None = None) -> Connection:
        return Connection(send, close)

    def disconnect(self, conn: Connection) -> None:
        room, player = conn.room, conn.player
        if room and player and player.conn is conn:
            room.leave(player)

    # ----- 방 -----
    def make_code(self) -> str:
        """안 쓰는 6자리 팀 코드."""
        while True:
            code = str(100000 + int(self.rng.random() * 900000))
            if code not in self.rooms:
                return code

    def new_room(self) -> Room:
        room = Room(
            self.make_code(), rng=self.rng_factory(), clock=self.clock, timings=self.T,
            ids=self.ids, prompt_ids=self.prompt_ids,
            minigames=self.minigames, minigame_runner=self.minigame_runner,
            on_close=lambda r: self.rooms.pop(r.code, None),
            gemini=self.gemini,
        )
        self.rooms[room.code] = room
        print(f"[party {room.code}] 방 만듦")
        return room

    def find_by_token(self, token: str):
        for room in self.rooms.values():
            p = next((x for x in room.players if not x.cpu and x.token == token), None)
            if p:
                return room, p
        return None

    def status(self) -> list[dict]:
        """/_party/status 에 보여줄 방 목록."""
        return [
            {"code": r.code, "phase": r.phase, "turn": r.turn, "players": [p.name for p in r.players if not p.cpu]}
            for r in self.rooms.values()
        ]

    # ----- 메시지 처리 -----
    async def receive(self, conn: Connection, msg: dict) -> None:
        """화면이 보낸 메시지 하나를 처리한다. 권한이 없거나 모르는 메시지는 조용히 무시한다.

        async 이지만 안에서 기다리는(await) 곳이 없다 → 메시지 하나가 중간에 끊기지 않고 한 번에 처리된다.
        """
        if conn.closed or not isinstance(msg, dict):
            return
        t = msg.get("t")

        if t == "hello":
            conn.me = {"token": js_slice(js_text(msg.get("token")), 64), "name": clean_name(msg.get("name"))}
            found = self.find_by_token(conn.me["token"]) if conn.me["token"] else None
            if found:
                # 새로고침 · 잠깐 끊김 → 그 자리로 다시
                conn.room, conn.player = found
                room, player = found
                if player.conn and player.conn is not conn:
                    player.conn.close()
                player.conn = conn
                room.cancel_close()   # 이름은 그대로 (같은 컴퓨터의 다른 탭이 이름 저장소를 바꿨을 수 있음)
                room.pick_host()
                conn.send({"t": "welcome", "id": player.id})
                room.broadcast()
            else:
                conn.send({"t": "welcome", "id": None})
            return
        if conn.me is None:
            return

        if t in ("create", "join"):
            if conn.room:
                return
            name = clean_name(msg.get("name")) or conn.me["name"]
            if not name:
                conn.send({"t": "error", "text": "이름을 먼저 정해 주세요"})
                return
            if t == "create":
                target = self.new_room()
            else:
                target = self.rooms.get(js_text(msg.get("code")).strip())
                if not target:
                    conn.send({"t": "error", "text": "그런 방이 없어요"})
                    return
                if target.phase != "lobby":
                    conn.send({"t": "error", "text": "이미 게임이 시작된 방이에요"})
                    return
                if len(target.players) >= R.MAX_PLAYERS:
                    conn.send({"t": "error", "text": "방이 꽉 찼어요 (5명)"})
                    return
            # 비어 있는 자리 중 가장 앞자리
            seats = {p.seat for p in target.players}
            seat = 0
            while seat in seats:
                seat += 1
            player = Player(next(self.ids), name, seat, token=conn.me["token"], conn=conn)
            target.players.append(player)
            conn.room, conn.player = target, player
            target.pick_host()
            conn.send({"t": "welcome", "id": player.id})
            target.broadcast()
            return

        room, player = conn.room, conn.player
        if not room or not player:
            return
        is_host = room.host == player.id

        if t == "leave":
            conn.room = None
            player.token = ""   # 다시 접속해도 이 자리로 돌아오지 않게
            room.leave(player, now=True)
            conn.player = None
            conn.send({"t": "left"})

        elif t == "name":
            name = clean_name(msg.get("name"))
            if name:
                player.name = name
                room.broadcast()

        elif t == "seat":   # 대기실에서 캐릭터 고르기 (자리 0~4 = 곰 · 고양이 · 오리 · 호랑이 · 시바)
            seat = to_number(msg.get("seat"))
            taken = {p.seat for p in room.players}
            if room.phase == "lobby" and seat in range(R.MAX_PLAYERS) and seat not in taken:
                player.seat = int(seat)   # 다른 사람이 이미 고른 캐릭터는 못 고른다
                room.broadcast()

        elif t == "turns":   # 방장만: 턴 수
            n = to_number(msg.get("n"))
            # 0 = 턴 제한 없음 (누군가 결승에 도착할 때까지)
            if is_host and room.phase == "lobby" and (n in R.TURN_CHOICES or n == 0):
                room.max_turns = int(n)
                room.broadcast()

        elif t == "ready":   # 대기실: 준비 완료 / 취소
            if room.phase == "lobby":
                player.ready = bool(msg.get("on", True))
                room.broadcast()

        elif t == "start":   # 방장만: 전원 준비 완료면 게임 시작 (방장은 늘 준비된 것으로 본다)
            waiting = [p for p in room.humans() if p.online and not p.ready and p.id != room.host]
            if is_host and room.phase == "lobby" and not waiting:
                start_game(room)

        elif t == "lobby":   # 방장만: 끝난 뒤 다시 대기실로
            if is_host and room.phase == "end":
                room.players = [p for p in room.players if not p.cpu and p.online]
                room.phase = "lobby"
                room.step = None
                room.ranking = None
                room.boss = room.ending = None
                room.mg = room.mg_result = None
                room.rolls = {}
                for p in room.players:
                    p.points = 0
                    p.ready = False
                    p.hist = [R.START]
                    p.bag = []
                    p.flags = {}
                room.broadcast()

        elif t == "answer":   # 질문에 대답
            room.answer(player, msg)

        elif t == "result":   # 미니게임 점수
            if room.mg and room.step == "minigame" and player.id not in room.mg["results"]:
                score = clean_score(msg.get("score"))
                room.mg["results"][player.id] = score
                room.announce(f"{player.name} 미니게임 끝! ({score}점)", icon="✅", pid=player.id)
                room.broadcast()

        elif t == "skipGame":   # 방장: 안 끝나는 사람 기다리지 않기
            if is_host and room.mg:
                room.mg["skip"] = True
