"""대기실(Hub) 테스트 — 가짜 연결과 가짜 시계로 실제 서버와 같은 코드를 돌린다."""

from __future__ import annotations

import random

from party.games import GAMES
from party.hub import Hub


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class Client:
    def __init__(self, hub, name=None, token=None):
        self.hub = hub
        self.inbox = []
        self.conn = hub.connect(self.inbox.append)
        if name is not None:
            self.send("hello", {"name": name, "token": token})

    def send(self, t, d=None):
        self.hub.receive(self.conn, {"t": t, "d": d or {}})

    def of(self, t):
        return [m["d"] for m in self.inbox if m["t"] == t]

    def last(self, t):
        return self.of(t)[-1]


def make():
    clock = Clock()
    return Hub(GAMES, clock=clock, rng_factory=lambda: random.Random(7).random), clock


def run_until_end(hub, clock, limit=400.0, on_tick=None):
    end = clock.t + limit
    while hub.phase == "playing" and clock.t < end:
        clock.t += 1 / 30
        if on_tick:
            on_tick()
        hub.tick()


def test_join_gives_distinct_ids_and_first_is_host():
    hub, _ = make()
    a, b = Client(hub, "성원"), Client(hub, "성원")
    assert a.last("welcome")["you"]["id"] == "p1" and b.last("welcome")["you"]["id"] == "p2"
    assert b.last("welcome")["you"]["name"] != "성원"          # 같은 이름은 구분되게 바뀐다
    room = a.last("room")
    assert room["hostId"] == "p1" and [p["id"] for p in room["participants"]] == ["p1", "p2"]


def test_room_is_full_at_five():
    hub, _ = make()
    for i in range(5):
        Client(hub, f"n{i}")
    assert Client(hub, "late").last("error")["code"] == "room_full"


def test_only_host_can_start_and_needs_two_players():
    hub, _ = make()
    a = Client(hub, "a")
    a.send("lobby.start")
    assert a.last("error")["code"] == "bad_player_count"
    b = Client(hub, "b")
    b.send("lobby.start")
    assert b.last("error")["code"] == "not_host" and hub.phase == "lobby"
    a.send("lobby.start")
    assert hub.phase == "playing"
    for c in (a, b):
        start = c.last("game.start")
        assert start["gameId"] == "tug" and start["run"] == 1 and len(start["players"]) == 2
        assert c.of("game.state")                       # 시작 직후 첫 상태가 온다


def test_requests_before_joining_are_rejected():
    hub, _ = make()
    c = Client(hub)
    c.send("lobby.start")
    assert c.last("error")["code"] == "not_joined"


def test_input_goes_to_the_right_player_and_duplicates_or_stale_runs_are_dropped():
    hub, clock = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    a.send("lobby.start")
    match = hub.game.match
    clock.t = match.start_at + 0.5
    hub.tick()
    a.send("game.input", {"run": 1, "seq": 10, "data": {"k": "pull", "t": 0.5}})
    a.send("game.input", {"run": 1, "seq": 10, "data": {"k": "pull", "t": 0.5}})   # 같은 순번 다시
    a.send("game.input", {"run": 1, "seq": 9, "data": {"k": "pull", "t": 0.5}})    # 더 오래된 순번
    a.send("game.input", {"run": 0, "seq": 11, "data": {"k": "pull", "t": 0.5}})   # 지난 판 번호
    judges = [e["data"] for e in b.of("game.event") if e["data"]["type"] == "judge"]
    assert len(judges) == 1 and judges[0]["playerId"] == "p1" and judges[0]["grade"] == "perfect"
    scores = match.score.snapshot()
    assert scores["p1"]["perfect"] == 1 and scores["p2"]["total"] == 0


def test_full_game_ends_with_same_results_for_everyone_and_returns_to_lobby():
    hub, clock = make()
    cs = [Client(hub, n) for n in "abc"]
    cs[0].send("lobby.start")
    seq = [0]

    def press():
        m = hub.game.match if hub.game else None
        if m and m.phase == "play":
            seq[0] += 1
            cs[0].send("game.input", {"run": 1, "seq": seq[0], "data": {"k": "pull"}})
        elif m and m.phase == "summary":
            seq[0] += 1
            cs[1].send("game.input", {"run": 1, "seq": seq[0], "data": {"k": "confirm"}})

    run_until_end(hub, clock, on_tick=press)
    assert hub.phase == "lobby"
    ends = [c.last("game.end") for c in cs]
    assert ends[0] == ends[1] == ends[2] and not ends[0]["aborted"]
    assert [r["rank"] for r in ends[0]["results"]][0] == 1 and len(ends[0]["results"]) == 3
    assert cs[2].last("room")["phase"] == "lobby"
    # 다음 판은 실행 번호가 올라간다
    cs[0].send("lobby.start")
    assert cs[1].last("game.start")["run"] == 2


def test_reconnect_with_token_resumes_the_same_player_mid_game():
    hub, clock = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    token = b.last("welcome")["token"]
    a.send("lobby.start")
    hub.disconnect(b.conn)
    assert [p["connected"] for p in a.last("room")["participants"]] == [True, False]
    clock.t += 3
    hub.tick()
    b2 = Client(hub, "b", token=token)
    assert b2.last("welcome")["you"]["id"] == "p2"
    assert b2.last("game.start")["resumed"] is True and b2.of("game.state")
    # 토큰 없는 새 사람은 게임 중에 들어올 수 없다
    assert Client(hub, "c").last("error")["code"] == "game_in_progress"


def test_leaving_in_lobby_removes_player_and_host_moves_on():
    hub, _ = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    hub.disconnect(a.conn)
    room = b.last("room")
    assert room["hostId"] == "p2" and len(room["participants"]) == 1


def test_everyone_leaving_mid_game_clears_the_room():
    hub, _ = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    a.send("lobby.start")
    hub.disconnect(a.conn)
    hub.disconnect(b.conn)
    assert hub.phase == "lobby" and hub.game is None and not hub.participants


def test_host_can_abort():
    hub, _ = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    a.send("lobby.start")
    b.send("game.abort")
    assert hub.phase == "playing"
    a.send("game.abort")
    assert hub.phase == "lobby" and b.last("game.end")["aborted"] is True


def test_ping_returns_server_time_and_bad_messages_do_not_crash():
    hub, clock = make()
    c = Client(hub, "a")
    c.send("ping", {"c": 1.5})
    assert c.last("pong") == {"c": 1.5, "s": clock.t}
    hub.receive(c.conn, "nonsense")
    hub.receive(c.conn, {"t": 5})
    hub.receive(c.conn, {"t": "game.input", "d": "x"})
    c.send("whatever")
    assert c.last("error")["code"] == "unknown_type"


def test_characters_default_to_distinct_and_can_be_changed_but_not_shared():
    hub, _ = make()
    a, b = Client(hub, "a"), Client(hub, "b")
    chars = {p["id"]: p["character"] for p in a.last("room")["participants"]}
    assert chars == {"p1": "shiba", "p2": "tiger"}
    b.send("lobby.character", {"character": "shiba"})
    assert b.last("error")["code"] == "character_taken"
    b.send("lobby.character", {"character": "dragon"})
    assert b.last("error")["code"] == "unknown_character"
    b.send("lobby.character", {"character": "cat"})
    assert {p["id"]: p["character"] for p in a.last("room")["participants"]} == {"p1": "shiba", "p2": "cat"}
    a.send("lobby.start")
    assert [p["character"] for p in b.last("game.start")["players"]] == ["shiba", "cat"]
    a.send("lobby.character", {"character": "bear"})
    assert a.last("error")["code"] == "game_in_progress"
