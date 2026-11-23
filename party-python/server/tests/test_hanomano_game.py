"""하노마노 서버 판정 테스트: 나눠주기, 뒤집기, 종 판정(지연 보정), 벌칙, 끝, 순위, AI 해설."""

from __future__ import annotations

import random
import time

from party.games.hanomano.cards import bell_reason, deal, fruit_totals, make_deck
from party.games.hanomano.config import DEFAULT_CONFIG
from party.games.hanomano.game import HanomanoGame

R = DEFAULT_CONFIG["RULES"]
T0 = DEFAULT_CONFIG["FLOW"]["INTRO_TIME"] + DEFAULT_CONFIG["FLOW"]["DEAL_TIME"]   # play 가 시작되는 시각


class FakeGemini:
    """정해 둔 답을 돌려주는 가짜 Gemini (tests/test_caster.py 와 같은 방식)."""

    def __init__(self, data):
        self.data, self.calls = data, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append(prompt)
        return self.data(schema) if callable(self.data) else self.data


def make(n=3, seed=1, services=None):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    g = HanomanoGame(players, {}, random.Random(seed).random)
    g.services = services or {}
    g.start(0.0)
    g.drain()
    g._now = 0.0
    return g


def run_to(g, t, step=1 / 30):
    """t 초까지 진행하고 그동안의 사건을 돌려준다."""
    events = []
    now = g._now
    while now < t - 1e-9:
        now = min(t, now + step)
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = t
    return events


def events_of(g):
    return [d for _to, kind, d in g.drain() if kind == "event"]


def to_play(g):
    run_to(g, T0 + 0.01)
    assert g.phase == "play"
    return T0 + 0.01


def setup(g, decks, piles=None, turn=0):
    """자리별 덱과 펼친 카드를 직접 정한다."""
    for i, s in enumerate(g.seats):
        s["deck"] = [list(c) for c in decks[i]]
        s["pile"] = [list(c) for c in (piles[i] if piles else [])]
    g.turn = turn
    g.turn_since = g._now
    g.history = [(g._now, g.tops())]


# ----------------------------------------------------------------------
# 카드
# ----------------------------------------------------------------------
def test_deck_and_equal_deal():
    deck = make_deck(R, random.Random(3).random)
    assert len(deck) == 52
    for f in range(4):
        assert sorted(c[1] for c in deck if c[0] == f) == [1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5]
    for n, each, spare in ((2, 26, 0), (3, 17, 1), (4, 13, 0), (5, 10, 2)):
        hands, rest = deal(deck, n)
        assert [len(h) for h in hands] == [each] * n and len(rest) == spare
        g = make(n)
        assert all(len(s["deck"]) == each for s in g.seats) and len(g.spare) == spare
        assert g.client_options()["each"] == each


def test_bell_reason_texts():
    assert fruit_totals([[0, 2], [0, 3], None]) == [5, 0, 0, 0]
    assert bell_reason([[2, 2], [2, 3], [0, 1]], R) == {"ok": True, "text": "라임 2+3 = 5개!", "fruit": 2, "near": False}
    why = bell_reason([[3, 4], [0, 1]], R)
    assert (why["ok"], why["text"], why["fruit"], why["near"]) == (False, "포도 4개뿐! (5개 아님)", 3, True)
    why = bell_reason([[1, 3], [1, 3]], R)
    assert (why["text"], why["near"]) == ("레몬 6개! (5개 아님)", False)
    assert bell_reason([None, None], R)["text"] == "과일이 없어요!"
    # 5개짜리 카드가 있어도 같은 과일이 더 있으면 5개가 아니다
    assert bell_reason([[0, 5], [0, 1]], R)["ok"] is False


# ----------------------------------------------------------------------
# 뒤집기
# ----------------------------------------------------------------------
def test_flip_only_on_my_turn_and_turn_moves_on():
    g = make(3)
    now = to_play(g)
    first = g.turn
    other = g.seats[(first + 1) % 3]["id"]
    g.on_input(other, {"k": "flip"}, now)               # 차례가 아닌 사람
    assert all(not s["pile"] for s in g.seats)
    g.on_input(g.seats[first]["id"], {"k": "flip"}, now)
    ev = events_of(g)
    flip = next(e for e in ev if e["type"] == "flip")
    assert flip["playerId"] == g.seats[first]["id"] and flip["auto"] is False and flip["next"] == other
    assert len(g.seats[first]["pile"]) == 1 and g.turn == (first + 1) % 3


def test_auto_flip_after_turn_time_and_faster_near_the_end():
    g = make(2)
    to_play(g)
    ev = run_to(g, T0 + 2.9)
    assert not [e for e in ev if e["type"] == "flip"]
    ev = run_to(g, T0 + 3.1)
    assert [e["auto"] for e in ev if e["type"] == "flip"] == [True]
    assert abs(g.turn_time(g.end_at - 150) - 3.0) < 1e-9
    assert abs(g.turn_time(g.end_at - 75) - 2.25) < 1e-9
    assert abs(g.turn_time(g.end_at) - 1.5) < 1e-9


def test_disconnected_player_flips_quickly():
    g = make(2)
    now = to_play(g)
    g.on_connection(g.seats[g.turn]["id"], False, now)
    ev = run_to(g, now + DEFAULT_CONFIG["NET"]["AWAY_TURN_TIME"] + 0.1)
    assert [e["auto"] for e in ev if e["type"] == "flip"] == [True]


# ----------------------------------------------------------------------
# 종
# ----------------------------------------------------------------------
def test_correct_bell_takes_all_open_cards():
    g = make(3)
    now = to_play(g) + 3.5                               # 시작 대사와 간격을 두고
    run_to(g, now)
    setup(g, [[[1, 1]] * 5, [[1, 1]] * 5, [[1, 1]] * 5], [[[0, 2]], [[3, 1], [0, 3]], [[2, 4]]], turn=0)
    g.on_input("p3", {"k": "bell", "t": now}, now)
    ev = run_to(g, now + 0.2)
    ring = next(e for e in ev if e["type"] == "ring")
    assert ring["playerId"] == "p3" and ring["ok"] and ring["text"] == "체리 2+3 = 5개!" and ring["got"] == 4
    assert ring["piles"] == {"p1": 1, "p2": 2, "p3": 1}
    assert [len(s["deck"]) for s in g.seats] == [5, 5, 9] and all(not s["pile"] for s in g.seats)
    assert g.phase == "collect" and g.seats[2]["correct"] == 1 and g.seats[g.turn]["id"] == "p3"
    assert any(e["type"] == "say" and e["source"] == "canned" and e["who"] == "마법사" for e in ev)
    # 연출 중에는 종이 안 먹는다
    g.on_input("p1", {"k": "bell", "t": now + 0.3}, now + 0.3)
    run_to(g, now + 0.2 + R["COLLECT_PAUSE"])
    assert g.phase == "play" and g.seats[0]["wrong"] == 0


def test_wrong_bell_gives_cards_and_locks():
    g = make(3)
    now = to_play(g)
    setup(g, [[[1, 1]] * 5, [[1, 1]] * 5, [[1, 1]] * 5], [[[0, 2]], [[0, 2]], []], turn=0)
    g.on_input("p1", {"k": "bell", "t": now}, now)
    ev = run_to(g, now + 0.2)
    ring = next(e for e in ev if e["type"] == "ring")
    assert not ring["ok"] and ring["gave"] == 2 and ring["to"] == ["p2", "p3"] and ring["near"] is True
    assert ring["text"] == "체리 4개뿐! (5개 아님)"
    assert [len(s["deck"]) for s in g.seats] == [3, 6, 6]
    assert g.phase == "wrong" and g.seats[0]["wrong"] == 1
    lock = g.seats[0]["lock"]
    assert abs(lock - (ring["t"] + 0.12 + R["WRONG_LOCK"])) < 0.05
    # 잠긴 동안에는 종을 못 친다
    run_to(g, now + 1.5)
    g.on_input("p1", {"k": "bell", "t": now + 1.5}, now + 1.5)
    run_to(g, now + 1.8)
    assert g.seats[0]["wrong"] == 1
    # 카드가 없는 사람이 틀리면 줄 카드가 없다(잠기기만 한다)
    g2 = make(2)
    now = to_play(g2)
    setup(g2, [[], [[1, 1]] * 5], [[[0, 1]], []], turn=1)
    g2.on_input("p1", {"k": "bell"}, now)
    ring = next(e for e in run_to(g2, now + 0.2) if e["type"] == "ring")
    assert ring["gave"] == 0 and g2.seats[0]["lock"] > now


def test_earliest_press_wins_even_if_it_arrives_later():
    g = make(3)
    now = to_play(g)
    setup(g, [[[1, 1]] * 5] * 3, [[[0, 2]], [[0, 3]], []], turn=0)
    g.on_input("p1", {"k": "bell", "t": now + 0.30}, now + 0.32)
    g.on_input("p2", {"k": "bell", "t": now + 0.25}, now + 0.40)      # 더 먼저 눌렀지만 늦게 도착
    ev = run_to(g, now + 0.6)
    rings = [e for e in ev if e["type"] == "ring"]
    assert len(rings) == 1 and rings[0]["playerId"] == "p2" and rings[0]["ok"]
    assert g.seats[0]["wrong"] == 0                                     # 진 사람은 벌칙이 없다


def test_press_time_is_clamped_to_035s():
    g = make(2)
    now = to_play(g)
    run_to(g, now + 1.0)
    setup(g, [[[1, 1]] * 5] * 2, [[[0, 2]], [[0, 3]]], turn=0)
    g.on_input("p1", {"k": "bell", "t": now - 50}, now + 1.0)           # 터무니없이 이른 시각
    g.on_input("p2", {"k": "bell", "t": now + 0.6}, now + 1.05)         # 0.45초 전이라고 주장 → 0.35초까지만
    ring = next(e for e in run_to(g, now + 1.3) if e["type"] == "ring")
    assert ring["playerId"] == "p1" and abs(ring["t"] - (now + 0.65)) < 1e-6


def test_bell_is_judged_on_cards_at_press_time():
    g = make(2)
    now = to_play(g)
    setup(g, [[[1, 4]] * 5, [[1, 1]] * 5], [[[0, 2]], [[0, 3]]], turn=0)
    # p2 가 5개를 보고 눌렀는데, 신호가 가는 사이에 p1 이 카드를 뒤집어 5개가 깨졌다
    g.on_input("p1", {"k": "flip"}, now + 0.20)
    g.on_input("p2", {"k": "bell", "t": now + 0.10}, now + 0.25)
    ring = next(e for e in run_to(g, now + 0.5) if e["type"] == "ring")
    assert ring["ok"] and ring["tops"] == [[0, 2], [0, 3]] and ring["got"] == 3
    # 반대로, 뒤집힌 뒤에 눌렀으면 틀린 것이다
    g = make(2)
    now = to_play(g)
    setup(g, [[[1, 4]] * 5, [[1, 1]] * 5], [[[0, 2]], [[0, 3]]], turn=0)
    g.on_input("p1", {"k": "flip"}, now + 0.20)
    g.on_input("p2", {"k": "bell", "t": now + 0.22}, now + 0.25)
    ring = next(e for e in run_to(g, now + 0.5) if e["type"] == "ring")
    assert not ring["ok"]


# ----------------------------------------------------------------------
# 다시 모으기 · 끝
# ----------------------------------------------------------------------
def test_reshuffle_when_nobody_can_flip():
    g = make(2)
    now = to_play(g)
    setup(g, [[[0, 1]], []], [[], [[1, 1], [1, 2]]], turn=0)
    g.on_input("p1", {"k": "flip"}, now)
    ev = events_of(g)
    assert [e["type"] for e in ev if e["type"] in ("flip", "reshuffle")] == ["flip", "reshuffle"]
    assert [len(s["deck"]) for s in g.seats] == [1, 2] and all(not s["pile"] for s in g.seats)
    # 5개가 보이는 채로 멈추면 잠깐 기다렸다가 다시 모은다
    g = make(2)
    now = to_play(g)
    setup(g, [[[0, 2]], []], [[], [[1, 1], [0, 3]]], turn=0)
    g.on_input("p1", {"k": "flip"}, now)
    assert not [e for e in events_of(g) if e["type"] == "reshuffle"] and g.stall_since is not None
    ev = run_to(g, now + DEFAULT_CONFIG["NET"]["STALL_TIME"] + 0.1)
    assert [e for e in ev if e["type"] == "reshuffle"]


def test_sweep_ends_the_game():
    g = make(2)
    now = to_play(g)
    setup(g, [[[1, 1]] * 3, []], [[[0, 2]], [[0, 3]]], turn=0)
    g.on_input("p1", {"k": "bell", "t": now}, now)
    ev = run_to(g, now + 0.2 + R["COLLECT_PAUSE"] + 0.1)
    end = next(e for e in ev if e["type"] == "end")
    assert end == {"type": "end", "reason": "sweep", "playerId": "p1", "text": "N1 싹쓸이!"}
    assert g.phase == "end"
    ev = run_to(g, g._now + 2.5 + 8.2)
    assert any(e["type"] == "final" for e in ev) and g.finished
    assert [(r["playerId"], r["score"], r["rank"], r["isWinner"]) for r in g.results] == [("p1", 5, 1, True), ("p2", 0, 2, False)]


def test_ranking_tie_breaks():
    g = make(4)
    for s, (cards, correct, wrong) in zip(g.seats, ((10, 1, 2), (10, 3, 0), (10, 1, 2), (12, 0, 5))):
        s["deck"] = [[0, 1]] * cards
        s["correct"], s["wrong"] = correct, wrong
    rows = g.build_results()
    assert [(r["playerId"], r["rank"]) for r in rows] == [("p4", 1), ("p2", 2), ("p1", 3), ("p3", 3)]
    assert rows[0]["stats"] == {"cards": 12, "correct": 0, "wrong": 5, "got": 0}


def test_time_up_with_no_input_and_state_hides_decks():
    g = make(3)
    ev = run_to(g, T0 + 60)
    snap = g.state_for("p2", g._now)
    assert snap["phase"] in ("play", "collect", "wrong") and 89 < snap["timeLeft"] < 91
    assert all(isinstance(p["deck"], int) and len(p["show"]) <= 4 for p in snap["players"])
    assert sum(p["deck"] + p["pile"] for p in snap["players"]) == 51
    ev += run_to(g, T0 + 150 + 0.1)
    assert any(e["type"] == "end" and e["reason"] == "time" for e in ev)
    assert any(e["type"] == "say" and e["kind"] == "lastMinute" for e in ev)
    says = [e for e in ev if e["type"] == "say"]
    assert all(e["source"] == "canned" and e["text"] for e in says)
    run_to(g, T0 + 150 + 2.5 + 8 + 0.2)
    assert g.finished and len(g.results) == 3


def play_full(n, seed):
    """모두가 '5개면 0.3초 뒤 종, 가끔 헛종' 으로 한 판을 끝까지 한다."""
    g = make(n, seed)
    rnd = random.Random(seed + 100)
    now, step = 0.0, 1 / 30
    seen = {"ring": 0, "flip": 0}
    plan = {}
    while not g.finished and now < 400:
        now += step
        if g.phase == "play":
            sig = str(g.tops())
            for s in g.seats:
                p = plan.get(s["id"])
                if p is None or p[0] != sig:
                    ok = bell_reason(g.tops(), R)["ok"]
                    want = ok or rnd.random() < 0.03
                    p = plan[s["id"]] = [sig, now + 0.3 + rnd.random() * 0.4 if want else None]
                if p[1] is not None and now >= p[1]:
                    p[1] = None
                    g.on_input(s["id"], {"k": "bell", "t": now - 0.05}, now)
            cur = g.seats[g.turn]
            if cur["deck"] and now - g.turn_since > 0.6 and rnd.random() < 0.2:
                g.on_input(cur["id"], {"k": "flip"}, now)
        g.tick(now)
        for _to, kind, d in g.drain():
            if kind == "event" and d["type"] in seen:
                seen[d["type"]] += 1
        assert sum(g.cards_of(s) for s in g.seats) == n * (52 // n)      # 카드는 사라지지 않는다
    return g, seen


def test_full_games_with_2_3_5_players():
    for n in (2, 3, 5):
        g, seen = play_full(n, seed=n)
        assert g.finished and seen["flip"] > 10 and seen["ring"] > 0
        rows = g.results
        assert len(rows) == n and [r["rank"] for r in rows] == sorted(r["rank"] for r in rows)
        assert rows[0]["rank"] == 1 and rows[0]["isWinner"]
        for r in rows:
            assert set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
            assert r["score"] == r["stats"]["cards"] and set(r["stats"]) == {"cards", "correct", "wrong", "got"}
        assert [r["score"] for r in rows] == sorted((r["score"] for r in rows), reverse=True)


# ----------------------------------------------------------------------
# AI
# ----------------------------------------------------------------------
def test_gemini_lines_and_verdict():
    def answer(schema):
        if "headline" in schema["properties"]:
            return {"headline": "눈보다 빠른 손", "mvp": "N1 님, 대단하십니다", "cheer": "N2 님, 다음엔 꼭"}
        return {kind: [f"{{name}} {kind} 한마디"] for kind in schema["properties"]}

    fake = FakeGemini(answer)
    g = make(2, services={"gemini": fake})
    for _ in range(200):
        if g.book.ready:
            break
        time.sleep(0.01)
    now = to_play(g)
    run_to(g, now + 3.5)                                     # 해설 간격이 지나도록
    setup(g, [[[1, 1]] * 9, [[1, 1]] * 9], [[[0, 2]], [[0, 3]]], turn=0)
    g.on_input("p1", {"k": "bell", "t": g._now}, g._now)
    ev = run_to(g, g._now + 0.2)
    say = next(e for e in ev if e["type"] == "say")
    assert say["source"] == "gemini" and say["text"] == "N1 correct 한마디" and say["kind"] == "correct"
    # 싹쓸이로 끝 → 총평
    run_to(g, g._now + R["COLLECT_PAUSE"] + 0.1)
    setup(g, [[[1, 1]] * 3, []], [[[0, 2]], [[0, 3]]], turn=0)
    g.on_input("p1", {"k": "bell", "t": g._now}, g._now)
    ev = run_to(g, g._now + 0.2 + R["COLLECT_PAUSE"] + 0.1)
    assert g.phase == "end"
    for _ in range(200):
        if g._verdict_job is None or g._verdict_job.done():
            break
        time.sleep(0.01)
    ev = run_to(g, g._now + 1.0)
    verdict = next(e for e in ev if e["type"] == "verdict")
    assert verdict["headline"] == "눈보다 빠른 손" and g.state_for("p2", g._now)["verdict"]["mvp"]
    assert len(fake.calls) == 2
