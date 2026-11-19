"""주문 게임: 주문 판정(글자 → 주문), 결투 규칙, 음성 입력, 순위."""

from __future__ import annotations

import random

import pytest

from party.games.spell.config import merge_config
from party.games.spell.duel import Duel
from party.games.spell.game import SpellGame
from party.games.spell.match import SpellMatcher
from test_quiz_game import FakeStt, loud

FAST = {"FLOW": {"INTRO_TIME": 0.2, "END_HOLD": 0.5, "RESULT_TIME": 0.2, "FINAL_TIME": 0.2}, "BATTLE": {"COUNTDOWN": 0.3}}


def duel(**over):
    events = []
    d = Duel(merge_config(over or None), "p1", "p2", events.append)
    d.start()
    return d, events


def steps(d, n):
    for _ in range(n):
        d.step()


@pytest.mark.parametrize("text,spell", [
    ("파이어볼", "fireball"), ("파이어 벌!!", "fireball"), ("화이어 볼", "fireball"),
    ("아쿠아샷", "aqua_shot"), ("아쿠아 샤트", "aqua_shot"),
    ("썬더", "thunder"), ("선더!", "thunder"), ("윈드 커터", "wind_cutter"), ("윈드카터", "wind_cutter"),
    ("아이스쉴드", "ice_shield"), ("아이스 실드.", "ice_shield"), ("힐", "heal"), ("힐!", "heal"),
    ("킬", None), ("안녕하세요", None), ("", None), ("감사합니다", None), ("정답은 힐입니다", None),
])
def test_matcher_accepts_near_misses_but_not_other_words(text, spell):
    assert SpellMatcher().match(text)["spell"] == spell


def test_projectile_hits_and_costs_mana_and_cooldown():
    d, ev = duel()
    assert d.cast("a", "fireball")["ok"]
    assert d.a.mana == 90 and d.cast("a", "fireball") == {"ok": False, "reason": "cooldown"}
    steps(d, 90)
    assert d.b.hp == 90 and [e["type"] for e in ev] == ["cast", "castFail", "hit"]
    d.a.mana = 5
    assert d.cast("a", "fireball")["reason"] == "mana"
    assert d.cast("a", "nope")["reason"] == "unknown"


def test_element_advantage_wins_the_clash_and_keeps_70_percent():
    d, ev = duel()
    d.cast("a", "fireball")      # 불
    d.cast("b", "wind_cutter")   # 바람 — 불이 이긴다
    steps(d, 120)
    clash = next(e for e in ev if e["type"] == "clash")
    assert clash["winner"] == "a" and clash["advantage"]
    assert d.a.hp == 100 and d.b.hp == 93          # 10 × 0.7 = 7
    assert d.a.stats["counters"] == 1


def test_same_strength_projectiles_cancel_out():
    d, ev = duel()
    d.cast("a", "fireball")
    d.cast("b", "fireball")
    steps(d, 120)
    assert next(e for e in ev if e["type"] == "clash")["both"] and d.a.hp == d.b.hp == 100


def test_shield_blocks_projectiles_and_thunder_and_fire_melts_it_faster():
    d, ev = duel()
    d.cast("b", "ice_shield")
    d.cast("a", "thunder")
    steps(d, 30)
    assert d.b.hp == 100 and d.b.shield["hp"] == 16          # 30 - 14
    d.cast("a", "wind_cutter")                               # 콤보 2 → 8 × 1.1 = 8.8
    steps(d, 60)
    assert d.b.hp == 100 and d.b.shield["hp"] == pytest.approx(7.2)
    assert [e["type"] for e in ev].count("blocked") == 2 and d.b.stats["blocks"] == 2

    d, ev = duel()
    d.cast("b", "ice_shield")
    d.cast("a", "fireball")                                  # 불은 방패를 1.5배로 깎는다: 30 - 15
    steps(d, 80)
    assert d.b.shield["hp"] == 15 and d.b.hp == 100

    d, ev = duel()
    d.cast("b", "ice_shield")
    d.b.shield["hp"] = 3.0
    d.cast("a", "aqua_shot")                                 # 10 중 3 은 방패가 막고, 넘친 7 이 들어간다
    steps(d, 90)
    assert d.b.shield is None and d.b.hp == 93
    assert next(e for e in ev if e["type"] == "blocked")["broken"] is True


def test_heal_and_combo_bonus():
    d, _ = duel()
    d.a.hp = 50
    d.cast("a", "heal")
    assert d.a.hp == 68
    d2, ev = duel()
    d2.cast("a", "wind_cutter")      # 콤보 1
    d2.cast("a", "fireball")         # 콤보 2 (+10%)
    d2.cast("a", "aqua_shot")        # 콤보 3 (+20%)
    assert [e["combo"] for e in ev if e["type"] == "cast"] == [1, 2, 3]
    steps(d2, 120)
    assert d2.b.hp == 100 - 8 - 11 - 12


def test_ko_and_timeout_results():
    d, ev = duel()
    d.b.hp = 5
    d.cast("a", "thunder")
    steps(d, 30)
    assert d.over and d.result["winner"] == "a" and d.result["reason"] == "ko" and d.result["hp"] == {"a": 100, "b": 0}
    assert d.cast("b", "heal")["reason"] == "notready"

    d, _ = duel(BATTLE={"TIME_LIMIT": 1})
    d.a.hp = 40
    steps(d, 70)
    assert d.result["winner"] == "b" and d.result["reason"] == "timeout"
    d, _ = duel(BATTLE={"TIME_LIMIT": 1})
    steps(d, 70)
    assert d.result["winner"] == "draw"


def make_game(n=2, stt=None, seed=1):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    g = SpellGame(players, {"config": FAST}, random.Random(seed).random)
    g.services = {"stt": stt} if stt is not None else {}
    g.start(0.0)
    g.drain()
    return g


def run_to(g, t, step=1 / 30):
    events = []
    now = getattr(g, "_now", 0.0)
    while now < t - 1e-9:
        now = min(t, now + step)
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = t
    return events


def test_voice_is_recognised_matched_and_cast():
    stt = FakeStt(["파이어 벌!", "오늘 날씨 좋다", "썬더"])
    g = make_game(stt=stt)
    assert g.client_options()["voice"] is True
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, 0.1)      # 결투 시작 전 — 무시
    assert stt.calls == 0
    run_to(g, 0.6)
    assert g.phase == "fight"
    a_id = g.duels[0].a.id
    g.on_input(a_id, {"k": "voice", "pcm": loud(), "rate": 16000}, 0.7)
    g.on_input(a_id, {"k": "voice", "pcm": loud(), "rate": 16000}, 0.71)     # 인식 중에 겹친 말은 버린다
    assert stt.calls == 1
    ev = run_to(g, 0.8)
    assert [e["type"] for e in ev] == ["heard", "cast"]
    assert ev[0]["spell"] == "fireball" and ev[1]["source"] == "voice" and ev[1]["who"] == "a"
    g.on_input(a_id, {"k": "voice", "pcm": loud(), "rate": 16000}, 0.9)
    ev = run_to(g, 1.0)
    assert [e["type"] for e in ev] == ["heard"] and ev[0]["spell"] is None    # 주문이 아닌 말
    g.on_input(a_id, {"k": "voice", "pcm": loud(amp=5), "rate": 16000}, 1.1)  # 너무 작은 소리
    g.on_input(a_id, {"k": "voice", "pcm": "@@", "rate": 16000}, 1.1)        # 깨진 데이터
    g.on_input(a_id, {"k": "voice", "pcm": loud(seconds=20), "rate": 16000}, 1.1)
    g.on_input("nobody", {"k": "voice", "pcm": loud(), "rate": 16000}, 1.1)
    assert stt.calls == 2


def test_without_stt_keys_still_work_and_voice_reports_off():
    g = make_game()
    assert g.client_options()["voice"] is False
    run_to(g, 0.6)
    a_id = g.duels[0].a.id
    g.on_input(a_id, {"k": "voice", "pcm": loud(), "rate": 16000}, 0.7)
    assert (a_id, "event", {"type": "voiceOff"}) in g.drain()
    g.on_input(a_id, {"k": "cast", "id": "wind_cutter"}, 0.8)
    g.on_input(a_id, {"k": "cast", "id": "없는주문"}, 0.8)
    g.on_input(a_id, {"k": "cast", "id": ["x"]}, 0.8)
    ev = run_to(g, 0.9)
    assert [e["type"] for e in ev] == ["cast"]


def test_three_players_round_robin_and_ranking_by_wins_then_hp():
    g = make_game(n=3, seed=4)
    r = random.Random(7)
    t = 0.0
    strong = "p2"
    while not g.finished and t < 400:
        t += 1 / 30
        if r.random() < 0.2:
            g.on_input(strong, {"k": "cast", "id": r.choice(["fireball", "wind_cutter", "thunder", "aqua_shot"])}, t)
        g.tick(t)
        g.drain()
    assert g.finished
    res = {x["playerId"]: x for x in g.results}
    assert res[strong]["rank"] == 1 and res[strong]["stats"]["wins"] == 2 and res[strong]["isWinner"]
    assert all(x["stats"]["matches"] == 2 for x in g.results)
    assert sum(x["stats"]["wins"] + x["stats"]["losses"] + x["stats"]["draws"] for x in g.results) == 6
    g.standings["p1"].update(wins=1, score=10)
    g.standings["p2"].update(wins=1, score=90)
    g.standings["p3"].update(wins=2, score=1)
    assert [x["playerId"] for x in g._build_results()] == ["p3", "p2", "p1"]
