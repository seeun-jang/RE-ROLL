"""보드게임 서버(party/board) 테스트.

가짜 연결(받은 메시지를 모으기만 함) · 씨앗을 고정한 난수 · 0 으로 줄인 연출 시간으로
실제 서버와 같은 코드를 돌린다. pytest-asyncio 없이 asyncio.run 으로 직접 돌린다.

실행(server 폴더에서):  python -m pytest -q tests/test_board_game.py
"""

from __future__ import annotations

import asyncio
import json
import math
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from party.board import data as R
from party.board import game as G
from party.board.jsutil import clean_name, clean_score, clean_timing, js_round, js_slice, same_value, to_number
from party.board.manager import BoardManager
from party.board.room import Player, Room, Timings, make_timings

ROOT = Path(__file__).resolve().parents[2]

ROOM_KEYS = {"t", "code", "phase", "step", "turn", "maxTurns", "host", "players", "prompts", "rolls",
             "mg", "mgResult", "log", "ranking"}
PLAYER_KEYS = {"id", "name", "cpu", "online", "seat", "node", "dist", "bag", "flags"}
FLAG_KEYS = {"skip", "mirror", "shield", "rest"}


# ---------------- 도구 ----------------
def fast(**kw) -> Timings:
    """연출 시간은 전부 0, 사람이 대답할 시간만 넉넉하게."""
    base = dict(
        STEP_MS=0, REVEAL_MS=0, EFFECT_MS=0, CHOOSE_MS=5000, ASK_MS=5000, TIMING_MS=5000,
        MG_INTRO_MS=0, MG_MAX_MS=60000, MG_RESULT_MS=0, CPU_THINK_MS=(0, 0),
        START_MS=0, AFTER_MOVE_MS=0, SPACE_INTRO_MS=0, SLOT_MS=0, BIGDICE_MS=0, MG_POLL_MS=0, MG_SHOW_MS=0,
        AUTO_ANSWER_MS=0, LOBBY_GRACE_MS=5000, CLOSE_MS=5000,
    )
    base.update(kw)
    return Timings(**base)


def make(seed=7, **kw) -> BoardManager:
    timings = kw.pop("timings", None) or fast()
    return BoardManager(rng_factory=lambda: random.Random(seed), timings=timings, **kw)


async def until(cond, timeout=10.0):
    """cond() 가 참이 될 때까지 다른 작업에게 차례를 넘기며 기다린다."""
    end = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < end, "시간 안에 조건이 맞지 않음"
        await asyncio.sleep(0)


class Client:
    """가짜 화면. auto=True 면 내 질문에 바로 대답하고, score 가 있으면 미니게임 점수도 보낸다."""

    def __init__(self, mgr: BoardManager, auto=False, score=None):
        self.mgr = mgr
        self.inbox: list[dict] = []
        self.auto = auto
        self.score = score
        self.id = None
        self.was_closed = False
        self._answered = set()
        self._sent = set()
        self.conn = mgr.connect(self._on_msg, close=self._on_close)

    def _on_close(self):
        self.was_closed = True

    def _on_msg(self, msg):
        self.inbox.append(msg)
        if msg["t"] == "welcome":
            self.id = msg["id"]
        if msg["t"] == "room" and self.id is not None:
            self._play(msg)

    def _play(self, snap):
        if self.auto:
            for pr in snap["prompts"]:
                if pr["pid"] == self.id and pr["id"] not in self._answered:
                    self._answered.add(pr["id"])
                    value = 7 if pr["kind"] == "timing" else pr["options"][-1]["value"]
                    self.later("answer", id=pr["id"], value=value)
        mg = snap["mg"]
        if self.score is not None and snap["step"] == "minigame" and mg and snap["turn"] not in self._sent:
            self._sent.add(snap["turn"])
            self.later("result", score=self.score)

    def later(self, t, **kw):
        asyncio.get_running_loop().create_task(self.mgr.receive(self.conn, {"t": t, **kw}))

    async def send(self, t, **kw):
        await self.mgr.receive(self.conn, {"t": t, **kw})

    def of(self, t):
        return [m for m in self.inbox if m["t"] == t]

    def last(self, t="room"):
        return self.of(t)[-1]

    def errors(self):
        return [m["text"] for m in self.of("error")]


async def enter(mgr, name, code=None, token=None, **kw) -> Client:
    """hello 를 보내고 방을 만들거나(code 없음) 들어간다."""
    c = Client(mgr, **kw)
    await c.send("hello", token=token or f"tok-{name}", name=name)
    if code is None:
        await c.send("create", name=name)
    else:
        await c.send("join", name=name, code=code)
    return c


def path_to(node_id: int) -> list[int]:
    """출발점에서 그 칸까지 가는 길 (칸 번호 목록)."""
    paths = {R.START: [R.START]}
    todo = [R.START]
    while todo:
        cur = todo.pop(0)
        for nxt in R.NODES[cur]["next"]:
            if nxt not in paths:
                paths[nxt] = paths[cur] + [nxt]
                todo.append(nxt)
    return paths[node_id]


class AutoConn:
    """Room 을 직접 만들어 시험할 때 쓰는 가짜 연결: 내 질문이 오면 바로 대답한다."""

    def __init__(self, room: Room, player: Player, pick=0):
        self.room, self.player, self.pick = room, player, pick
        self.inbox = []
        self._answered = set()

    def send(self, msg):
        self.inbox.append(msg)
        if msg["t"] != "room":
            return
        for pr in msg["prompts"]:
            if pr["pid"] == self.player.id and pr["id"] not in self._answered:
                self._answered.add(pr["id"])
                value = 7 if pr["kind"] == "timing" else pr["options"][self.pick]["value"]
                asyncio.get_running_loop().call_soon(self.room.answer, self.player, {"id": pr["id"], "value": value})


def play_room(seed=1, human=True, **kw) -> Room:
    """게임 중인 방을 손으로 만든다: 0번은 (가짜) 사람, 나머지는 CPU. 모두 윗줄 여기저기에 서 있다."""
    room = Room("1234", rng=random.Random(seed), timings=fast(**kw))
    for seat, at in enumerate([5, 3, 8, 10, 12]):
        p = Player(next(room.ids), f"P{seat}", seat, cpu=not (human and seat == 0), token=f"t{seat}")
        p.hist = list(range(at + 1))   # 윗줄은 칸 번호가 차례대로 이어져 있다
        p.flags = {"skip": 0, "mirror": False, "shield": False, "rest": False}
        room.players.append(p)
    if human:
        room.players[0].conn = AutoConn(room, room.players[0])
    room.phase = "play"
    room.turn = 1
    room.history = [[list(p.hist) for p in room.players]]
    return room


# ---------------- 데이터 · 계산 도구 ----------------
def test_board_data_json_is_up_to_date(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node 가 설치되어 있지 않아 board_data.json 을 다시 만들어 볼 수 없음")
    out = tmp_path / "board_data.json"
    script = ROOT / "server" / "tools" / "export_board_data.mjs"
    subprocess.run([node, str(script), str(out)], check=True, capture_output=True)
    fresh = json.loads(out.read_text(encoding="utf-8"))
    saved = json.loads(R.DATA_FILE.read_text(encoding="utf-8"))
    assert fresh == saved, "rules.js / board.js 가 바뀜 → node server/tools/export_board_data.mjs 를 다시 실행"


def test_board_data_basics():
    assert len(R.NODES) == 71 and R.START == 0 and R.GOAL == 70
    assert R.DIST[R.GOAL] == 0 and R.DIST[R.START] == max(R.DIST)
    assert [n["id"] for n in R.NODES] == list(range(71))
    forks = [n for n in R.NODES if len(n["next"]) > 1]
    assert len(forks) == 2 and all(n["type"] == "fork" for n in forks)
    assert R.MAX_PLAYERS == 5 and R.BAG_MAX == 4 and R.TURN_CHOICES == [6, 10, 15] and R.DEFAULT_TURNS == 10
    assert R.dice_of("normal") == ["d8", "safe", "turtle", "double"]
    assert len(R.dice_of("fun")) == 10 and len(R.dice_of("trash")) == 8
    assert R.MINIGAMES[0] == {"id": "jackpot-bowling", "name": "잭팟 볼링"} and len(R.MINIGAMES) == 10
    assert all(n["type"] in R.SPACES for n in R.NODES)


def test_js_helpers():
    assert [js_round(x) for x in (0.5, 1.5, 2.5, -0.5, -2.5, 2.4)] == [1, 2, 3, 0, -2, 2]   # 파이썬 round(2.5) 는 2
    assert to_number("12") == 12 and to_number(" 3.5 ") == 3.5 and to_number("") == 0 and to_number(True) == 1
    assert math.isnan(to_number("abc")) and math.isnan(to_number({})) and math.isnan(to_number("1_0"))
    assert [clean_timing(v) for v in (0, 1, 5.5, 10, 11, -3, "7", "x", None, float("inf"))] == [1, 1, 6, 10, 10, 1, 7, 1, 1, 10]
    assert [clean_score(v) for v in (12.5, -4, "30", "x", None, float("inf"), float("nan"))] == [13, 0, 30, 0, 0, 0, 0]
    assert same_value(1, 1.0) and not same_value(True, 1) and not same_value("1", 1) and same_value("odd", "odd")
    assert clean_name("  가나다라마바사아자차  ") == "가나다라마바사아" and clean_name(None) == "" and clean_name(123) == "123"
    assert js_slice("😀" * 5, 8) == "😀" * 4   # 이모지는 자바스크립트에서 2칸


def test_timings_speed(monkeypatch):
    t = make_timings(4)
    assert t.STEP_MS == 57.5 and t.CHOOSE_MS == 5000 and t.CPU_THINK_MS == (125, 325)
    assert t.START_MS == 1500 and t.CLOSE_MS == 15000   # 원본에서 숫자로 적혀 있던 값은 그대로
    monkeypatch.setenv("PARTY_SPEED", "2")
    assert make_timings().REVEAL_MS == 1300
    monkeypatch.setenv("PARTY_SPEED", "0.1")   # 1 보다 작으면 1
    assert make_timings().REVEAL_MS == 2600
    monkeypatch.setenv("PARTY_SPEED", "abc")
    assert make_timings().REVEAL_MS == 2600 and make_timings().MG_MAX_MS == 360000


# ---------------- 방 만들기 · 들어가기 · 나가기 ----------------
def test_create_join_and_errors():
    async def main():
        mgr = make()
        nobody = Client(mgr)
        await nobody.send("create", name="철수")   # hello 전에는 아무것도 안 됨
        assert nobody.inbox == [] and mgr.rooms == {}

        a = Client(mgr)
        await a.send("hello", token="ta", name="")
        assert a.last("welcome") == {"t": "welcome", "id": None}
        await a.send("create")
        assert a.errors() == ["이름을 먼저 정해 주세요"]
        await a.send("create", name="  철수  ")
        snap = a.last()
        code = snap["code"]
        assert len(code) == 4 and code.isdigit() and 1000 <= int(code) <= 9999
        assert snap["phase"] == "lobby" and snap["step"] is None and snap["maxTurns"] == 10 and snap["turn"] == 0
        assert snap["host"] == a.id and [p["name"] for p in snap["players"]] == ["철수"]
        assert snap["players"][0] == {"id": a.id, "name": "철수", "cpu": False, "online": True, "seat": 0,
                                      "node": 0, "dist": R.DIST[0], "bag": [], "flags": {}}
        await a.send("create", name="철수")   # 이미 방에 있으면 무시
        assert len(mgr.rooms) == 1

        b = Client(mgr)
        await b.send("hello", token="tb", name="영희")
        await b.send("join", code="0000")
        await b.send("join")
        assert b.errors() == ["그런 방이 없어요", "그런 방이 없어요"]
        await b.send("join", code=f" {code} ")   # 이름은 hello 때 것을 씀
        assert b.id is not None and b.id != a.id
        assert [(p["name"], p["seat"]) for p in a.last()["players"]] == [("철수", 0), ("영희", 1)]
        assert mgr.status() == [{"code": code, "phase": "lobby", "turn": 0, "players": ["철수", "영희"]}]

        others = [await enter(mgr, f"사람{i}", code) for i in range(3)]
        assert len(a.last()["players"]) == 5
        late = await enter(mgr, "늦은이", code)
        assert late.errors() == ["방이 꽉 찼어요 (5명)"] and late.id is None

        # 이름 바꾸기 (8글자까지), 빈 이름은 무시
        await b.send("name", name="아주아주아주긴이름입니다")
        await b.send("name", name="   ")
        assert a.last()["players"][1]["name"] == "아주아주아주긴이"

        # 나가기: 바로 빠지고, 나간 사람은 left 를 받음. 빈 자리는 다음 사람이 채움
        await others[0].send("leave")
        assert others[0].last("left") == {"t": "left"}
        assert [p["seat"] for p in a.last()["players"]] == [0, 1, 3, 4]
        again = await enter(mgr, "다시", code)
        assert next(p for p in a.last()["players"] if p["name"] == "다시")["seat"] == 2

        # 시작한 방에는 못 들어감
        await a.send("start")
        assert a.last()["phase"] == "play"
        await late.send("join", name="늦은이", code=code)
        assert late.errors()[-1] == "이미 게임이 시작된 방이에요"

    asyncio.run(main())


def test_host_only_messages():
    async def main():
        mgr = make()
        a = await enter(mgr, "방장")
        code = a.last()["code"]
        b = await enter(mgr, "손님", code)
        await b.send("turns", n=6)
        await b.send("start")
        assert a.last()["maxTurns"] == 10 and a.last()["phase"] == "lobby"
        await a.send("turns", n=7)       # 고를 수 없는 턴 수
        await a.send("turns", n="x")
        assert a.last()["maxTurns"] == 10
        await a.send("turns", n="15")    # 원본은 +msg.n 이라 글자 숫자도 받음
        assert a.last()["maxTurns"] == 15
        await a.send("turns", n=6)
        assert a.last()["maxTurns"] == 6
        await a.send("lobby")            # 끝난 뒤에만 됨
        assert a.last()["phase"] == "lobby"
        await a.send("start")
        await a.send("start")            # 두 번 눌러도 한 번만 시작
        snap = a.last()
        assert snap["phase"] == "play" and len(snap["players"]) == 5
        assert [p["name"] for p in snap["players"]] == ["방장", "손님", "CPU 3", "CPU 4", "CPU 5"]
        assert all(p["online"] for p in snap["players"]) and [p["cpu"] for p in snap["players"]] == [False, False, True, True, True]
        await a.send("turns", n=10)      # 게임 중에는 못 바꿈
        assert a.last()["maxTurns"] == 6

    asyncio.run(main())


def test_reconnect_with_token():
    async def main():
        mgr = make()
        a = await enter(mgr, "철수", token="same")
        code = a.last()["code"]
        b = await enter(mgr, "영희", code)
        # 연결이 끊김 → 대기실에서는 잠깐 자리를 남겨 둠 (연결 끊김 표시), 방장은 다음 사람
        mgr.disconnect(a.conn)
        snap = b.last()
        assert [p["online"] for p in snap["players"]] == [False, True] and snap["host"] == b.id
        # 같은 token 으로 다시 접속 → 같은 번호 · 같은 자리, 방장도 돌아옴
        a2 = Client(mgr)
        await a2.send("hello", token="same", name="다른이름")
        assert a2.last("welcome") == {"t": "welcome", "id": a.id}
        snap = a2.last()
        assert snap["players"][0] == {**snap["players"][0], "name": "철수", "online": True, "seat": 0}
        assert snap["host"] == a.id
        # 다른 탭에서 같은 token 으로 또 들어오면 옛 연결은 서버가 끊는다
        a3 = Client(mgr)
        await a3.send("hello", token="same", name="철수")
        assert a2.was_closed and not a3.was_closed
        before = len(a2.inbox)
        await a2.send("name", name="가짜")    # 끊긴 연결이 보낸 것은 무시
        mgr.disconnect(a2.conn)               # 옛 연결이 끊겨도 자리는 그대로
        assert len(a2.inbox) == before
        assert b.last()["players"][0]["online"] is True and b.last()["players"][0]["name"] == "철수"
        # 모르는 token
        c = Client(mgr)
        await c.send("hello", token="nobody", name="x")
        assert c.last("welcome")["id"] is None

    asyncio.run(main())


def test_lobby_disconnect_removal_and_host_migration():
    async def main():
        mgr = make(timings=fast(LOBBY_GRACE_MS=20))
        a = await enter(mgr, "방장")
        code = a.last()["code"]
        b = await enter(mgr, "둘째", code)
        c = await enter(mgr, "셋째", code)
        assert c.last()["host"] == a.id
        mgr.disconnect(a.conn)
        assert c.last()["host"] == b.id and len(c.last()["players"]) == 3   # 아직 자리는 남아 있음
        await until(lambda: len(c.last()["players"]) == 2)                    # 잠시 뒤 빠짐
        assert [p["name"] for p in c.last()["players"]] == ["둘째", "셋째"]
        await b.send("leave")                                                 # 방장이 나가면 다음 사람
        assert c.last()["host"] == c.id and [p["name"] for p in c.last()["players"]] == ["셋째"]
        await c.send("turns", n=15)
        assert c.last()["maxTurns"] == 15
        # 나간 사람은 같은 token 으로도 못 돌아옴
        b2 = Client(mgr)
        await b2.send("hello", token="tok-둘째", name="둘째")
        assert b2.last("welcome")["id"] is None

    asyncio.run(main())


def test_room_closes_when_empty_and_reconnect_cancels():
    async def main():
        mgr = make(timings=fast(CLOSE_MS=30, LOBBY_GRACE_MS=10000))
        a = await enter(mgr, "철수", token="t1")
        room = next(iter(mgr.rooms.values()))
        mgr.disconnect(a.conn)
        assert room.close_timer is not None
        a2 = Client(mgr)
        await a2.send("hello", token="t1", name="철수")   # 돌아오면 닫기 취소
        await asyncio.sleep(0.08)
        assert not room.dead and mgr.rooms
        # 게임 중에 모두 나가면 방이 닫히고 게임 작업도 멈춘다
        await a2.send("start")
        await a2.send("leave")
        assert a2.last("left")
        await until(lambda: room.dead)
        assert mgr.rooms == {} and mgr.status() == []
        await until(lambda: room.task.done())

    asyncio.run(main())


# ---------------- 한 판 ----------------
def check_snapshot(snap: dict) -> None:
    """화면(board/main.js)이 읽는 키가 정확히 그 모양인지."""
    assert set(snap) == ROOM_KEYS
    for p in snap["players"]:
        assert set(p) == PLAYER_KEYS
        assert isinstance(p["bag"], list) and all(d in R.DICE for d in p["bag"]) and len(p["bag"]) <= R.BAG_MAX
        if snap["phase"] != "lobby":
            assert set(p["flags"]) == FLAG_KEYS
        assert p["dist"] == R.DIST[p["node"]]
    for pr in snap["prompts"]:
        assert {"id", "pid", "kind", "title", "options", "deadline"} <= set(pr) <= {"id", "pid", "kind", "title", "options", "deadline", "meta"}
        assert pr["kind"] in ("dice", "branch", "parity", "target", "timing", "reward")
        assert isinstance(pr["deadline"], (int, float)) and pr["deadline"] > 1e12   # 1970년부터의 밀리초
        if pr["kind"] == "branch":
            assert pr["meta"]["left"] >= 1 and [o["label"] for o in pr["options"]] == ["위 길", "아래 길"]
            assert all(set(o) == {"value", "label", "desc"} for o in pr["options"])
        if pr["kind"] == "target":
            assert all(set(o) == {"value", "label", "icon", "seat"} for o in pr["options"])
        if pr["kind"] in ("dice", "reward"):
            assert all(set(o) == {"value", "label", "icon", "desc"} for o in pr["options"])
        if pr["kind"] == "timing":
            assert pr["options"] == []
    for pid, roll in snap["rolls"].items():
        assert isinstance(pid, str)
        if roll["skip"]:
            assert set(roll) == {"dice", "text", "skip"} and roll["dice"] is None
        else:
            assert set(roll) == {"dice", "face", "move", "text", "skip"} and roll["dice"] in R.DICE
    if snap["mg"] is not None:
        assert {"id", "name", "seed", "startAt", "done"} <= set(snap["mg"])
        assert "results" not in snap["mg"] and "skip" not in snap["mg"]
    if snap["mgResult"] is not None:
        assert set(snap["mgResult"]) == {"name", "rows"}
        assert all(set(row) == {"id", "name", "score", "rank", "reward"} for row in snap["mgResult"]["rows"])
        assert [row["rank"] for row in snap["mgResult"]["rows"]] == [1, 2, 3, 4, 5]
    if snap["ranking"] is not None:
        assert all(set(row) == {"id", "name", "cpu", "seat", "dist", "over", "rank"} for row in snap["ranking"])
    assert len(snap["log"]) <= 8
    json.dumps(snap, allow_nan=False)


def test_full_game_default_minigame():
    async def main():
        mgr = make(seed=3)
        a = await enter(mgr, "철수", auto=True, score=77)
        await a.send("turns", n=6)
        await a.send("start")
        await until(lambda: a.last()["phase"] == "end", timeout=30)
        snaps = a.of("room")
        for snap in snaps:
            check_snapshot(snap)
            assert snap["mg"] is None or set(snap["mg"]) == {"id", "name", "seed", "startAt", "done"}
        steps = {s["step"] for s in snaps}
        assert {"choose", "reveal", "move", "space"} <= steps
        end = snaps[-1]
        assert end["step"] is None and [r["rank"] for r in end["ranking"]] == [1, 2, 3, 4, 5]
        assert [r["dist"] for r in end["ranking"]] == sorted(r["dist"] for r in end["ranking"])
        assert 1 <= end["turn"] <= 6
        if end["ranking"][0]["dist"] != 0:   # 아무도 결승에 못 갔으면 마지막 턴까지 한 것
            assert end["turn"] == 6
        # 미니게임: 내가 점수를 보내면 done 에 내 번호가 들어가고, 순위표에 내 점수가 나온다
        mg_snaps = [s for s in snaps if s["step"] == "minigame"]
        assert mg_snaps and any(a.id in s["mg"]["done"] for s in mg_snaps)
        assert all(s["mg"]["id"] in {g["id"] for g in R.MINIGAMES} and 1 <= s["mg"]["seed"] <= 99999 for s in mg_snaps)
        results = [s["mgResult"] for s in snaps if s["step"] == "mgResult"]
        assert all(next(r for r in res["rows"] if r["id"] == a.id)["score"] == 77 for res in results)
        final = [s["mgResult"] for s in snaps if s["step"] == "mgResult" and s["mg"] is not None][-1]
        assert [len(r["reward"]) >= 1 for r in final["rows"][:3]] == [True, True, True] and final["rows"][4]["reward"] == []
        # 같은 미니게임이 연달아 나오지 않는다
        order = []
        for s in mg_snaps:
            if not order or order[-1][0] != s["turn"]:
                order.append((s["turn"], s["mg"]["id"]))
        assert all(x[1] != y[1] for x, y in zip(order, order[1:]))
        # 알림
        fx = a.of("fx")
        assert fx[0] == {"t": "fx", "kind": "announce", "text": "게임 시작! 결승에 먼저 도착하면 우승", "icon": "🏁", "pid": None, "big": True}
        assert fx[-1]["text"].endswith("우승!") and fx[-1]["icon"] == "🏆"
        assert any(f["text"] == "1턴" for f in fx) and any("미니게임 끝! (77점)" in f["text"] for f in fx)
        for m in a.inbox:
            json.dumps(m, allow_nan=False)
        assert mgr.status()[0]["phase"] == "end"

        # 끝난 뒤: 방장이 아닌 사람은 대기실로 못 돌림 → 방장이 누르면 사람만 남고 처음 상태로
        await a.send("lobby")
        snap = a.last()
        assert snap["phase"] == "lobby" and snap["step"] is None and snap["ranking"] is None
        assert snap["mg"] is None and snap["mgResult"] is None and snap["rolls"] == {}
        assert [(p["name"], p["node"], p["bag"], p["flags"]) for p in snap["players"]] == [("철수", 0, [], {})]
        await a.send("start")            # 다시 시작할 수 있다
        assert a.last()["phase"] == "play" and a.last()["turn"] == 0 and len(a.last()["players"]) == 5

    asyncio.run(main())


@pytest.mark.parametrize("seed", range(8))
def test_many_games_finish_without_errors(seed, capsys):
    """씨앗과 사람 수를 바꿔 가며 끝까지 돌려 본다. 진행 중 오류가 나면 서버는 게임을 그냥 끝내므로 출력으로 확인한다."""
    async def main():
        mgr = make(seed=seed)
        a = await enter(mgr, "방장", auto=True, score=seed * 7)
        code = a.last()["code"]
        for i in range(seed % 5):
            await enter(mgr, f"사람{i}", code, auto=True, score=10 * i)
        await a.send("turns", n=15)
        await a.send("start")
        await until(lambda: a.last()["phase"] == "end", timeout=30)
        for snap in a.of("room"):
            check_snapshot(snap)
        assert len(a.last()["ranking"]) == 5

    asyncio.run(main())
    out = capsys.readouterr()
    assert "진행 오류" not in out.out and "Traceback" not in out.err


def test_lobby_after_end_is_host_only_and_drops_offline():
    async def main():
        mgr = make(seed=5)
        a = await enter(mgr, "방장", auto=True, score=10)
        code = a.last()["code"]
        b = await enter(mgr, "손님", code, auto=True, score=20)
        c = await enter(mgr, "떠날이", code, auto=True, score=30)
        await a.send("turns", n=6)
        await a.send("start")
        await until(lambda: a.last()["turn"] >= 1)
        mgr.disconnect(c.conn)           # 게임 중에 끊김 → 자리는 남고 CPU 처럼 자동 진행
        snap = a.last()
        assert len(snap["players"]) == 5 and snap["players"][2]["online"] is False and snap["players"][2]["cpu"] is False
        await until(lambda: a.last()["phase"] == "end", timeout=30)
        await b.send("lobby")
        assert a.last()["phase"] == "end"
        await a.send("lobby")
        assert a.last()["phase"] == "lobby" and [p["name"] for p in a.last()["players"]] == ["방장", "손님"]

    asyncio.run(main())


def test_reconnect_during_game_gets_snapshot():
    async def main():
        mgr = make(seed=2)
        a = await enter(mgr, "철수", token="t1")   # 대답을 안 하는 사람
        await a.send("start")
        room = next(iter(mgr.rooms.values()))
        p = room.players[0]
        await until(lambda: a.last()["turn"] >= 1)
        mgr.disconnect(a.conn)
        assert not p.online and room.close_timer is not None
        a2 = Client(mgr, auto=True, score=5)
        await a2.send("hello", token="t1", name="철수")
        assert a2.id == p.id and p.online and room.host == p.id
        assert a2.last()["phase"] == "play" and a2.last()["players"][0]["online"] is True

    asyncio.run(main())


def test_goal_ends_game():
    async def main():
        mgr = make(seed=1)
        a = await enter(mgr, "철수", auto=True, score=1)
        await a.send("start")
        room = next(iter(mgr.rooms.values()))
        me = room.players[0]
        me.hist = path_to(R.GOAL)[:-1]   # 결승 바로 앞 칸 (기본 주사위는 1 이상 → 무조건 도착)
        await until(lambda: a.last()["phase"] == "end")
        end = a.last()
        assert end["turn"] == 1 and end["ranking"][0]["id"] == a.id and end["ranking"][0]["dist"] == 0
        assert end["ranking"][0]["over"] >= 0 and all(r["over"] == -1 for r in end["ranking"][1:])
        assert not any(s["step"] in ("space", "minigame") for s in a.of("room"))   # 도착하면 바로 끝
        assert a.of("fx")[-1]["text"] == "철수 우승!"

    asyncio.run(main())


def test_finish_ranking_order():
    async def main():
        room = play_room(human=False)
        goal = path_to(R.GOAL)
        a, b, c, d, e = room.players
        a.hist, a.goal_over = list(goal), 1
        b.hist, b.goal_over = list(goal), 4      # 걸음이 더 많이 남은 채로 들어온 사람이 먼저
        c.hist = goal[:-3]
        G.finish_game(room)
        assert [r["id"] for r in room.ranking[:3]] == [b.id, a.id, c.id]
        assert room.phase == "end" and room.step is None and room.prompts == {}

    asyncio.run(main())


# ---------------- 미니게임 ----------------
def test_skip_game_by_host():
    async def main():
        mgr = make(seed=4)
        a = await enter(mgr, "방장", auto=True)            # 점수를 안 보냄
        code = a.last()["code"]
        b = await enter(mgr, "손님", code, auto=True, score=40)
        await a.send("start")
        await until(lambda: a.last()["step"] == "minigame" and b.id in a.last()["mg"]["done"])
        for _ in range(50):
            await asyncio.sleep(0)
        assert a.last()["step"] == "minigame"              # 방장을 기다리는 중
        await b.send("skipGame")                           # 방장이 아니면 무시
        for _ in range(50):
            await asyncio.sleep(0)
        assert a.last()["step"] == "minigame"
        await a.send("result", score="abc")                # 숫자가 아니면 0점
        await a.send("result", score=99)                   # 두 번째는 무시
        await until(lambda: a.last()["step"] == "mgResult")
        rows = {r["id"]: r for r in a.last()["mgResult"]["rows"]}
        assert rows[a.id]["score"] == 0 and rows[b.id]["score"] == 40

        # 다음 턴: 이번엔 방장이 건너뛰기
        await until(lambda: a.last()["step"] == "minigame" and a.last()["turn"] == 2 and b.id in a.last()["mg"]["done"])
        await a.send("skipGame")
        await until(lambda: a.last()["step"] == "mgResult" and a.last()["turn"] == 2)
        rows = {r["id"]: r for r in a.last()["mgResult"]["rows"]}
        assert rows[a.id]["score"] == 0 and rows[b.id]["score"] == 40
        cpu_scores = [r["score"] for r in rows.values() if r["id"] not in (a.id, b.id)]
        assert all(20 <= s <= 46 for s in cpu_scores)      # 사람 평균 40 의 0.5~1.15배

    asyncio.run(main())


def test_minigame_time_limit_with_fake_clock():
    async def main():
        now = [1_800_000_000_000]
        mgr = make(seed=4, clock=lambda: now[0], timings=fast(MG_INTRO_MS=3500, MG_MAX_MS=360000))
        a = await enter(mgr, "철수", auto=True)             # 점수를 안 보냄
        await a.send("start")
        await until(lambda: a.last()["step"] == "minigame")
        assert a.last()["mg"]["startAt"] == now[0] + 3500
        now[0] += 3500 + 360000 - 1
        for _ in range(50):
            await asyncio.sleep(0)
        assert a.last()["step"] == "minigame"
        now[0] += 1                                          # 6분이 지나면 그냥 진행
        await until(lambda: a.last()["step"] == "mgResult")
        rows = a.last()["mgResult"]["rows"]
        assert next(r for r in rows if r["id"] == a.id)["score"] == 0
        assert all(25 <= r["score"] <= 58 for r in rows if r["id"] != a.id)   # 사람 점수가 없으면 평균 50 으로 봄

    asyncio.run(main())


def test_injected_runner_ranks_and_extra_mg_keys(capsys):
    async def main():
        seen = []

        async def runner(room, mg):
            humans = room.humans()
            seen.append([(p.id, p.name, p.seat, p.token, p.online) for p in humans])
            assert room.mg is mg and len(room.code) == 4
            mg["url"] = f"/mini/{room.code}/{mg['id']}"     # 화면에 보여줄 값을 추가
            room.broadcast()
            await asyncio.sleep(0)
            # 순위가 점수와 반대여도 순위가 우선. CPU 들은 결과에 없음
            return {humans[0].id: {"score": 10, "rank": 1}, humans[1].id: {"score": 90, "rank": 2}}

        games = [{"id": "g1", "name": "하나"}, {"id": "g2", "name": "둘"}]
        mgr = make(seed=6, minigame_runner=runner, minigames=games)
        a = await enter(mgr, "철수", auto=True)
        code = a.last()["code"]
        b = await enter(mgr, "영희", code, auto=True)
        await a.send("turns", n=6)
        await a.send("start")
        await until(lambda: a.last()["phase"] == "end" or a.last()["turn"] >= 3, timeout=30)

        snaps = a.of("room")
        for snap in snaps:
            check_snapshot(snap)
        assert seen and seen[0] == [(a.id, "철수", 0, "tok-철수", True), (b.id, "영희", 1, "tok-영희", True)]
        with_url = [s for s in snaps if s["mg"] and "url" in s["mg"]]
        assert with_url and with_url[0]["mg"]["url"] == f"/mini/{code}/{with_url[0]['mg']['id']}"
        assert all(s["mg"]["id"] in ("g1", "g2") for s in snaps if s["mg"])
        results = [s["mgResult"] for s in snaps if s["step"] == "mgResult"]
        assert results
        for res in results:
            rows = {r["id"]: r for r in res["rows"]}
            assert len(rows) == 5 and res["name"] in ("하나", "둘")
            assert rows[a.id]["score"] == 10 and rows[b.id]["score"] == 90
            assert rows[a.id]["rank"] < rows[b.id]["rank"]              # 러너가 준 순위대로
            cpus = [r for r in res["rows"] if r["id"] not in (a.id, b.id)]
            assert len(cpus) == 3 and all(25 <= r["score"] <= 58 for r in cpus)   # 평균 50 근처로 채움
            # CPU 끼리, 그리고 CPU 와 사람 자리 사이는 점수 순서 그대로
            assert [r["score"] for r in cpus] == sorted((r["score"] for r in cpus), reverse=True)
            assert sorted(r["rank"] for r in res["rows"]) == [1, 2, 3, 4, 5]
        # 러너가 결과를 준 사람은 done 에 들어간다
        assert any(s["mg"] and s["mg"]["done"] == sorted([a.id, b.id]) for s in snaps)

    asyncio.run(main())
    assert "진행 오류" not in capsys.readouterr().out


def test_runner_scores_without_rank_and_fallback():
    async def main():
        calls = []

        async def runner(room, mg):
            calls.append(mg["id"])
            if len(calls) == 1:
                return {room.humans()[0].id: {"score": 33.5}}   # 순위 없음 → 점수로, 점수는 반올림(34)
            if len(calls) == 2:
                return None                                      # 이번 턴은 원래 방식으로
            raise RuntimeError("러너 고장")                      # 오류가 나도 원래 방식으로

        mgr = make(seed=8, minigame_runner=runner, minigames=[{"id": "only", "name": "하나뿐"}])
        a = await enter(mgr, "철수", auto=True, score=500)
        await a.send("turns", n=6)
        await a.send("start")
        await until(lambda: a.last()["phase"] == "end" or a.last()["turn"] >= 4, timeout=30)
        by_turn = {}
        for s in a.of("room"):
            if s["step"] == "mgResult":
                by_turn[s["turn"]] = next(r for r in s["mgResult"]["rows"] if r["id"] == a.id)
        assert {1, 2, 3} <= set(by_turn), "이 씨앗에서는 3턴 안에 게임이 끝나지 않아야 함"
        # 1턴: 러너 점수 34 (화면이 보낸 500 이 먼저 들어왔어도 러너 결과가 덮어씀)
        assert by_turn[1]["score"] == 34
        # 2턴(None) · 3턴(오류): 원래 방식 → 화면이 보낸 점수
        assert by_turn[2]["score"] == 500 and by_turn[3]["score"] == 500
        assert calls and set(calls) == {"only"}   # 게임이 하나뿐이면 같은 게임을 계속

    asyncio.run(main())


# ---------------- 질문 ----------------
def test_prompt_answers_invalid_and_valid():
    async def main():
        room = play_room()
        me, other = room.players[0], room.players[1]
        me.conn = conn = type("Conn", (), {"inbox": [], "send": lambda self, m: self.inbox.append(m)})()
        opts = [{"value": 0, "label": "영"}, {"value": 1, "label": "일"}, {"value": "odd", "label": "홀"}]
        fut = room.ask(me, "dice", "골라요", opts, cpu_pick=lambda: 1)
        pr = conn.inbox[-1]["prompts"][0]
        assert pr["pid"] == me.id and pr["options"] == opts and "meta" not in pr
        assert abs(pr["deadline"] - (time.time() * 1000 + 5000)) < 2000
        pid = pr["id"]
        for bad in ({"id": pid, "value": 5}, {"id": pid, "value": "1"}, {"id": pid, "value": True}, {"id": pid},
                    {"id": pid + 99, "value": 1}, {"id": "x", "value": 1}, {"value": 1}, {"id": None, "value": 0}):
            room.answer(me, bad)
        room.answer(other, {"id": pid, "value": 1})        # 남의 질문
        assert not fut.done() and pid in room.prompts
        room.answer(me, {"id": str(pid), "value": 1.0})    # 원본처럼 글자 번호 · 1.0 도 받음
        value = await fut
        assert value == 1 and isinstance(value, int) and room.prompts == {}
        assert conn.inbox[-1]["prompts"] == []
        room.answer(me, {"id": pid, "value": 0})           # 이미 끝난 질문 → 무시

        fut = room.ask(me, "parity", "홀? 짝?", opts)
        room.answer(me, {"id": conn.inbox[-1]["prompts"][0]["id"], "value": "odd"})
        assert await fut == "odd"

        # 타이밍: 1~10 으로 맞춰짐
        for raw, want in ((4, 4), (99, 10), (-1, 1), ("abc", 1), (6.5, 7), (None, 1)):
            fut = room.ask(me, "timing", "멈춰!", [], cpu_pick=lambda: 3)
            room.answer(me, {"id": conn.inbox[-1]["prompts"][0]["id"], "value": raw})
            assert await fut == want

        # meta 는 있을 때만
        fut = room.ask(me, "branch", "길", opts, meta={"left": 2})
        assert conn.inbox[-1]["prompts"][0]["meta"] == {"left": 2}
        room.answer(me, {"id": conn.inbox[-1]["prompts"][0]["id"], "value": 0})
        assert await fut == 0

    asyncio.run(main())


def test_prompt_deadline_fallback_and_auto_answers():
    async def main():
        room = play_room(ASK_MS=30, CPU_THINK_MS=(5000, 5000), AUTO_ANSWER_MS=10)
        me, cpu = room.players[0], room.players[1]
        me.conn = type("Conn", (), {"send": lambda self, m: None})()
        opts = [{"value": "a", "label": "A"}, {"value": "b", "label": "B"}]

        # 사람이 시간 안에 대답을 안 하면: cpu_pick 값, 없으면 첫 번째
        t0 = time.monotonic()
        assert await room.ask(me, "target", "?", opts) == "a"
        assert time.monotonic() - t0 >= 0.02
        assert await room.ask(me, "target", "?", opts, cpu_pick=lambda: "b") == "b"
        assert await room.ask(me, "target", "?", opts, timeout=10) == "a"

        # CPU 는 생각하는 시간(CPU_THINK_MS) 뒤에 자동으로
        room.T.CPU_THINK_MS = (0, 0)
        room.T.ASK_MS = 5000
        t0 = time.monotonic()
        assert await room.ask(cpu, "target", "?", opts, cpu_pick=lambda: "b") == "b"
        assert time.monotonic() - t0 < 1

        # 대답을 기다리는 중에 끊기면 잠시 뒤 자동으로 (게임 중)
        fut = room.ask(me, "target", "?", opts, cpu_pick=lambda: "b")
        room.leave(me)
        assert not me.online and not fut.done()
        assert await asyncio.wait_for(fut, 1) == "b"
        # 끊긴 사람에게 묻는 질문은 CPU 처럼 바로
        assert await asyncio.wait_for(room.ask(me, "target", "?", opts), 1) == "a"
        room.close()

    asyncio.run(main())


# ---------------- 주사위 ----------------
def test_bag_limit_and_take():
    async def main():
        room = play_room(human=False)
        p = room.players[0]
        for dice_id in ("d8", "safe", "turtle", "double", "sticky", "poop"):
            room.give_dice(p, dice_id)
        assert [d["id"] for d in p.bag] == ["turtle", "double", "sticky", "poop"]   # 오래된 것부터 버림
        assert [d["uses"] for d in p.bag] == [1, 1, 2, 1]                           # 끈끈이는 2번
        assert room.log[-1] == f"{p.name} 💩 똥 주사위 획득!"
        taken = room.take_random_dice(p)
        assert taken["id"] in R.DICE and len(p.bag) == 3
        assert room.take_random_dice(room.players[1]) is None

    asyncio.run(main())


def test_forced_trash_die_and_sticky_twice():
    async def main():
        room = play_room()
        me = room.players[0]
        me.bag = [{"id": "d8", "uses": 1}, {"id": "sticky", "uses": 2}]
        await G.phase_roll(room)
        # 고르는 질문 없이 끈끈이를 굴렸다
        assert not any(pr["kind"] == "dice" for m in me.conn.inbox if m["t"] == "room" for pr in m["prompts"])
        assert room.rolls[me.id]["dice"] == "sticky"
        assert me.bag == [{"id": "d8", "uses": 1}, {"id": "sticky", "uses": 1}]
        await G.phase_roll(room)
        assert room.rolls[me.id]["dice"] == "sticky" and me.bag == [{"id": "d8", "uses": 1}]
        # 쓰레기가 없으면 고를 수 있다 (가짜 연결은 첫 번째 = 기본 주사위를 고름)
        await G.phase_roll(room)
        dice_prompts = [pr for m in me.conn.inbox if m["t"] == "room" for pr in m["prompts"] if pr["kind"] == "dice"]
        assert [o["value"] for o in dice_prompts[-1]["options"]] == [-1, 0]
        assert room.rolls[me.id]["dice"] == "basic" and me.bag == [{"id": "d8", "uses": 1}]

    asyncio.run(main())


@pytest.mark.parametrize("dice_id", list(R.DICE))
def test_every_die_runs(dice_id):
    async def main(seed):
        room = play_room(seed=seed)
        me = room.players[0]
        me.conn.pick = -1                       # 마지막 보기 = 가방의 그 주사위
        if dice_id != "basic":
            me.bag = [{"id": dice_id, "uses": 1}]
        before = {p.id: p.node for p in room.players}
        await G.phase_roll(room)
        roll = room.rolls[me.id]
        assert roll["dice"] == dice_id and roll["skip"] is False and isinstance(roll["text"], str)
        assert set(roll) == {"dice", "face", "move", "text", "skip"}
        assert isinstance(roll["move"], int)
        assert me.bag == [] and room.step == "move" and room.prompts == {}
        assert set(room.rolls) == {p.id for p in room.players}
        json.dumps(room.snapshot(), allow_nan=False)
        return roll, before, {p.id: p.node for p in room.players}, me

    for seed in range(12):   # 확률로 갈리는 주사위(바나나 · 졸음 · 룰렛 …)도 여러 번 돌려 본다
        roll, before, after, me = asyncio.run(main(seed))
        if dice_id in ("sniper", "helper", "poop") or roll["move"] == 0:
            continue
        if dice_id not in ("magnet", "roulette"):
            assert after[me.id] != before[me.id] or roll["move"] < 0


def test_roll_one_details():
    async def main():
        room = play_room(human=False)
        me, o1, o2, o3, o4 = room.players   # 칸: 5, 3, 8, 10, 12 (12 가 1등)

        def roll(dice, **extra):
            r = {"p": me, "dice": dice, **extra}
            G.roll_one(room, r, all_rolls)
            if r.get("later"):
                r["later"]()
            return r

        all_rolls = [{"p": o4, "dice": "basic", "move": 4, "face": 4}]
        assert roll("timing", timing=9)["move"] == 9
        r = roll("parity", parity="odd")
        assert r["move"] == (r["face"] * 2 if r["face"] % 2 == 1 else 0)
        r = roll("magnet")
        assert r["teleport"] is o2 and r["move"] == 0 and r["face"] == "🧲" and r["text"] == "🧲 P2에게 철컥!"
        r = roll("envy")
        assert r["move"] == (me.dist - o4.dist) // 2 == 3 and r["text"] == "😤 P4이(가) 부러워서 3칸"
        assert roll("copy")["move"] == 4 and roll("copy")["text"] == "📋 P4 따라 4칸"
        all_rolls[0]["skip"] = True
        assert roll("copy")["move"] == 3               # 1등이 쉬는 중이면 3
        r = roll("sniper", target=o4.id)
        assert r["move"] == 0 and r["other"] == (o4, -r["face"])
        r = roll("helper")
        assert r["move"] == 0 and r["other"] == (o1, r["face"])   # 꼴찌(3번 칸)가 감
        r = roll("slow")
        assert r["move"] == r["face"] // 2
        r = roll("reverse")
        assert r["move"] < 0 and r["text"] == f"🔙 {-r['move']}칸 뒤로"
        assert roll("shield")["move"] >= 1 and me.flags["shield"] is True
        r = roll("double")
        assert 2 <= r["move"] <= 12
        # 내가 1등이면: 자석은 1칸, 질투는 최소 1칸
        me.hist = list(range(14))
        assert roll("magnet")["move"] == 1 and roll("envy")["move"] == 1

    asyncio.run(main())


def test_mirror_skip_shield_and_sniper_in_phase_roll():
    async def main():
        room = play_room()
        me, o1 = room.players[0], room.players[1]
        me.flags["mirror"] = True
        o1.flags["skip"] = 1
        await G.phase_roll(room)
        r = room.rolls[me.id]
        assert r["move"] < 0 and r["text"].endswith("→ 🪞 거울! 뒤로") and me.flags["mirror"] is False
        assert me.node == 5 + r["move"]
        assert room.rolls[o1.id] == {"dice": None, "text": "😵 쉬는 중", "skip": True}
        assert o1.flags["skip"] == 0 and o1.node == 3 and o1.landed is False

        # 저격: 고른 사람(가짜 연결은 첫 번째 = P1)을 뒤로. 방패가 있으면 막음
        room = play_room(seed=3)
        me, o1 = room.players[0], room.players[1]
        me.conn.pick = -1
        me.bag = [{"id": "sniper", "uses": 1}]
        targets = []
        orig_roll_one = G.roll_one

        def spy(room_, r, all_rolls):
            orig_roll_one(room_, r, all_rolls)
            if r["dice"] == "sniper":
                targets.append(r["other"])
        G.roll_one = spy
        try:
            await G.phase_roll(room)
        finally:
            G.roll_one = orig_roll_one
        who, steps = targets[0]
        assert who is room.players[-1] and steps < 0 and me.node == 5 and me.landed is False

    asyncio.run(main())


# ---------------- 칸 ----------------
TILE_TYPES = [t for t in R.SPACES if t not in ("start", "goal", "plain", "fork")]


@pytest.mark.parametrize("kind", TILE_TYPES)
def test_every_tile_runs(kind):
    node_id = next(n["id"] for n in R.NODES if n["type"] == kind)

    async def main(seed):
        room = play_room(seed=seed)
        me = room.players[0]
        for p in room.players:
            p.bag = [{"id": "d8", "uses": 1}, {"id": "poop", "uses": 1}]
        room.history = [[list(p.hist) for p in room.players] for _ in range(4)]
        me.hist = path_to(node_id)
        me.landed = True
        await G.phase_spaces(room)
        assert room.step == "space" and room.prompts == {}
        assert any(R.SPACES[kind]["name"] in line for line in room.log)
        for p in room.players:
            assert len(p.bag) <= R.BAG_MAX and p.hist and p.hist[0] == R.START
        json.dumps(room.snapshot(), allow_nan=False)
        return room, me

    for seed in range(12):   # 확률로 갈리는 칸(슬롯 · 캡슐 · 로켓 · 회오리)도 여러 번
        room, me = asyncio.run(main(seed))
    if kind == "trap":
        assert me.node == path_to(node_id)[-4]
    if kind == "slide":
        assert len(me.hist) == len(path_to(node_id)) + 6
    if kind == "rest":
        assert me.flags["rest"] is True
    if kind == "mirror":
        assert me.flags["mirror"] is True
    if kind == "taxi":
        assert me.node == room.players[1].node           # 가짜 연결은 첫 번째 사람을 고름
    if kind == "point":
        assert room.players[1].flags["skip"] == 1
    if kind == "thief":
        assert len(me.bag) == 3 and len(room.players[1].bag) == 1
    if kind == "jackpot":
        assert len(me.bag) == 4 and all(len(p.bag) == 1 for p in room.players[1:])
    if kind == "gift":
        assert len(me.bag) == 1 and sum(len(p.bag) for p in room.players) == 10
    if kind == "timemachine":
        assert [p.node for p in room.players] == [5, 3, 8, 10, 12]
    if kind == "drill":
        assert [p.node for p in room.players[1:]] == [1, 6, 8, 10]


def test_tile_special_cases():
    async def main():
        # 함정 · 단체 기합은 방패로 막는다
        room = play_room(human=False)
        me, o1 = room.players[0], room.players[1]
        me.flags["shield"] = True
        await G.apply_space(room, me, "trap")
        assert me.node == 5 and "방패로 함정을 막음" in room.log[-1]
        o1.flags["shield"] = True
        await G.apply_space(room, me, "drill")
        assert o1.node == 3 and room.players[2].node == 6

        # 혁명: 1등과 꼴등이 자리를 바꾼다
        room = play_room(human=False)
        await G.apply_space(room, room.players[0], "revolt")
        assert room.players[1].node == 12 and room.players[4].node == 3
        assert room.log[-1] == "👑 혁명! P4 ↔ P1"

        # 블랙홀: 앞뒤 5칸 안에 있는 사람(출발점 제외)을 내 칸으로
        room = play_room(human=False)
        room.players[1].hist = [R.START]
        await G.apply_space(room, room.players[0], "hole")
        assert [p.node for p in room.players] == [5, 0, 5, 5, 12]

        # 지진: 위치가 섞여도 위치들의 모음은 그대로
        room = play_room(human=False)
        await G.apply_space(room, room.players[0], "quake")
        assert sorted(p.node for p in room.players) == [3, 5, 8, 10, 12]

        # 줄 것 · 훔칠 것이 없을 때
        room = play_room(human=False)
        await G.apply_space(room, room.players[0], "gift")
        await G.apply_space(room, room.players[0], "thief")
        await G.apply_space(room, room.players[0], "jackpot")
        assert room.log[-3:] == ["줄 주사위가 없음…", "훔칠 주사위가 없음…", "💰 잭팟… 근데 아무도 주사위가 없음"]

        # 슬롯: 여러 번 돌려도 🍒🍒🍒 · 🔔🔔🔔 은 안 나온다
        room = play_room(human=False)
        for _ in range(60):
            await G.apply_space(room, room.players[0], "slot")
        shown = [line for line in room.log if line.startswith("🎰 ")]
        assert len(shown) == 60 and "🎰 🍒 🍒 🍒" not in shown and "🎰 🔔 🔔 🔔" not in shown

    asyncio.run(main())


def test_move_branch_goal_and_back():
    async def main():
        room = play_room()
        me = room.players[0]
        fork = next(n for n in R.NODES if len(n["next"]) > 1)
        # 갈림길 바로 앞에서 3칸: 갈림길에 서면 길을 묻는다 (가짜 연결은 첫 번째 = 위 길)
        me.hist = path_to(fork["id"])[:-1]
        assert await G.move(room, me, 3, landing=True) == 3
        assert me.hist[-2] == fork["next"][0] and me.landed is True
        asked = [pr for m in me.conn.inbox if m["t"] == "room" for pr in m["prompts"] if pr["kind"] == "branch"]
        assert asked[0]["meta"] == {"left": 2} and [o["value"] for o in asked[0]["options"]] == fork["next"]
        assert [o["desc"] for o in asked[0]["options"]] == ["짧지만 위험", "길지만 안전"]
        # 뒤로: 왔던 길로, 출발점에서 멈춤
        assert await G.move(room, me, -2) == 2 and me.node == fork["id"]
        me.hist = [0, 1]
        me.landed = False
        assert await G.move(room, me, -5, landing=True) == 1 and me.node == 0 and me.landed is True
        assert await G.move(room, me, -5, landing=True) == 0
        # 결승: 넘치는 걸음은 버리고 남은 걸음 수를 적어 둔다
        me.hist = path_to(R.GOAL)[:-2]
        assert await G.move(room, me, 6) == 2 and me.node == R.GOAL and me.goal_over == 4
        assert await G.move(room, me, 3) == 0

    asyncio.run(main())
