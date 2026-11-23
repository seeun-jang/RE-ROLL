"""무궁화: 술래 뽑기, 음성으로 돌아보기, 움직임 감지, 승패와 점수."""

from __future__ import annotations

import random

import pytest

from party.games.mugunghwa.game import MugunghwaGame
from test_quiz_game import FakeStt, loud

FAST = {"FLOW": {"INTRO_TIME": 0.2, "END_HOLD": 0.3, "FINAL_TIME": 0.3}, "RULES": {"COUNTDOWN": 0.3}}
T0 = 0.5   # 플레이가 시작되는 시각


def make(n=4, stt=None, tagger="p1", config=None, seed=1):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    cfg = {**FAST, **(config or {})}
    g = MugunghwaGame(players, {"config": cfg, "tagger": tagger}, random.Random(seed).random)
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


def voice(g, at):
    g.on_input(g.tagger_id, {"k": "voice", "pcm": loud(seconds=1.2), "rate": 16000}, at)


def test_tagger_is_picked_at_random_and_everyone_else_runs():
    seen = set()
    for seed in range(30):
        players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(5)]
        g = MugunghwaGame(players, {}, random.Random(seed).random)
        seen.add(g.tagger_id)
        assert len(g.runners) == 4 and g.tagger_id not in g.runner_by_id
    assert len(seen) >= 4


def test_runner_moves_with_inertia_and_cannot_start_before_go():
    g = make()
    g.on_input("p2", {"k": "move", "on": True}, 0.1)         # 술래 발표 중 — 무시
    run_to(g, 0.25)
    assert g.runner_by_id["p2"]["held"] is False
    g.on_input("p2", {"k": "move", "on": True}, 0.3)         # 카운트다운 중에 누르고 있으면 시작과 함께 출발
    run_to(g, T0 + 1.0)
    r = g.runner_by_id["p2"]
    assert r["speed"] == pytest.approx(1.1) and 0.8 < r["dist"] < 1.0
    g.on_input("p2", {"k": "move", "on": False}, T0 + 1.0)
    run_to(g, T0 + 1.1)
    assert 0.3 < r["speed"] < 0.6                            # 바로 멈추지 못한다
    run_to(g, T0 + 1.3)
    assert r["speed"] == 0
    g.on_input("p1", {"k": "move", "on": True}, T0 + 1.3)    # 술래는 달릴 수 없다
    assert "p1" not in g.runner_by_id


def test_voice_phrase_turns_the_tagger_and_moving_runners_are_caught():
    stt = FakeStt(["무궁화 꽃이", "무궁화 꽃이 피었습니다"])
    g = make(stt=stt)
    for pid in ("p2", "p3", "p4"):
        g.on_input(pid, {"k": "move", "on": True}, 0.3)
    run_to(g, T0 + 1.0)
    voice(g, T0 + 1.0)                                       # 끝까지 말하지 않음 → 돌아보지 않는다
    ev = run_to(g, T0 + 1.1)
    assert [e["type"] for e in ev] == ["heard"] and ev[0]["ok"] is False and g.t_phase == "back"
    g.on_input("p2", {"k": "move", "on": False}, T0 + 1.2)   # p2 는 미리 멈춘다
    voice(g, T0 + 1.5)
    ev = run_to(g, T0 + 1.6)
    assert [e["type"] for e in ev] == ["heard", "turn"] and ev[0]["ok"] is True
    g.on_input("p3", {"k": "move", "on": False}, T0 + 1.65)  # p3 는 보자마자 뗀다 → 유예 안에 멈춤
    ev = run_to(g, T0 + 2.3)                                 # p4 는 계속 달린다
    caught = [e for e in ev if e["type"] == "caught"]
    assert len(caught) == 1 and caught[0]["ids"] == ["p4"]
    assert g.runner_by_id["p4"]["alive"] is False and g.runner_by_id["p3"]["alive"] and g.runner_by_id["p2"]["alive"]
    g.on_input("p3", {"k": "move", "on": True}, T0 + 2.4)    # 술래가 보고 있을 때 움직이기 시작해도 탈락
    ev = run_to(g, T0 + 2.6)
    assert [e["ids"] for e in ev if e["type"] == "caught"] == [["p3"]]
    assert g.caught_total == 2


def test_tagger_turns_back_when_chanting_again_or_after_max_look():
    stt = FakeStt(["무궁화 꽃이 피었습니다"] * 3)
    g = make(stt=stt)
    run_to(g, T0 + 0.5)
    voice(g, T0 + 0.5)
    run_to(g, T0 + 0.9)
    assert g.t_phase == "watching"
    g.on_input("p1", {"k": "mic", "on": True, "lv": 0.5}, T0 + 0.9)    # 너무 일찍 다시 외쳐도 MIN_LOOK 은 지켜본다
    run_to(g, T0 + 1.5)
    assert g.t_phase == "watching"
    ev = run_to(g, T0 + 2.1)
    assert [e["type"] for e in ev] == ["turnBack"] and g.t_phase == "back"
    voice(g, T0 + 2.2)
    g.on_input("p1", {"k": "mic", "on": False}, T0 + 2.2)
    run_to(g, T0 + 2.6)
    assert g.t_phase == "watching"
    voice(g, T0 + 2.7)                                                  # 보고 있는 동안 끝난 말은 버린다
    assert stt.calls == 2
    ev = run_to(g, T0 + 2.4 + 0.15 + 4.0 + 0.4)                         # 아무 말도 안 해도 MAX_LOOK 뒤에는 뒤돈다
    assert "turnBack" in [e["type"] for e in ev] and g.t_phase == "back"


def test_key_chant_fallback_needs_a_long_enough_hold():
    g = make()
    assert g.client_options()["voice"] is False
    run_to(g, T0 + 0.5)
    g.on_input("p1", {"k": "chant", "on": True}, T0 + 0.5)
    run_to(g, T0 + 1.0)
    g.on_input("p1", {"k": "chant", "on": False}, T0 + 1.0)             # 0.5초 — 너무 짧다
    assert g.t_phase == "back"
    g.on_input("p1", {"k": "chant", "on": True}, T0 + 1.1)
    run_to(g, T0 + 2.8)
    g.on_input("p1", {"k": "chant", "on": False}, T0 + 2.8)             # 1.7초 — 인정
    assert g.t_phase == "turning"
    g.on_input("p2", {"k": "chant", "on": True}, T0 + 2.9)              # 도망자의 외치기는 무시
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, T0 + 2.9)
    assert ("p1", "event", {"type": "voiceOff"}) in g.drain()


def test_first_runner_to_finish_wins_for_runners_and_scores_are_ordered():
    g = make(config={"RULES": {"COUNTDOWN": 0.3, "METERS": 3}})
    g.on_input("p2", {"k": "move", "on": True}, 0.3)
    g.on_input("p3", {"k": "move", "on": True}, 0.3)
    run_to(g, T0 + 1.5)
    g.on_input("p3", {"k": "move", "on": False}, T0 + 1.5)
    ev = run_to(g, T0 + 4.0)
    assert [e["id"] for e in ev if e["type"] == "finish"] == ["p2"]
    assert g.result == {"winner": "runners", "reason": "finish", "finishers": ["p2"]}
    run_to(g, T0 + 6.0)
    assert g.finished
    res = {r["playerId"]: r for r in g.results}
    assert res["p2"]["score"] == 1000 and res["p2"]["rank"] == 1 and res["p2"]["isWinner"]
    assert 600 < res["p3"]["score"] < 900 and res["p4"]["score"] == 600      # 도착 못 한 도망자도 술래보다 높다
    assert res["p1"]["score"] == 0 and res["p1"]["stats"]["role"] == "tagger"
    assert res["p3"]["score"] > res["p4"]["score"] > res["p1"]["score"]


def test_tagger_wins_on_time_up_or_when_everyone_is_caught():
    g = make(n=3, config={"RULES": {"COUNTDOWN": 0.3, "TIME_LIMIT": 2}})
    g.on_input("p2", {"k": "move", "on": True}, 0.3)
    ev = run_to(g, T0 + 3.0)
    assert any(e["type"] == "end" and e["result"]["reason"] == "timeUp" for e in ev)
    run_to(g, T0 + 4.0)
    res = {r["playerId"]: r for r in g.results}
    assert res["p1"]["score"] == 1000 and res["p1"]["isWinner"]
    assert 0 < res["p2"]["score"] < 500 and res["p3"]["score"] == 0

    stt = FakeStt(["무궁화 꽃이 피었습니다"])
    g = make(n=3, stt=stt)
    for pid in ("p2", "p3"):
        g.on_input(pid, {"k": "move", "on": True}, 0.3)
    run_to(g, T0 + 1.0)
    voice(g, T0 + 1.0)
    ev = run_to(g, T0 + 2.0)
    assert any(e["type"] == "end" and e["result"] == {"winner": "tagger", "reason": "allCaught", "finishers": []} for e in ev)
    run_to(g, T0 + 3.0)
    res = {r["playerId"]: r for r in g.results}
    assert res["p1"]["score"] == 1000 and res["p1"]["stats"]["caught"] == 2
    assert res["p2"]["stats"]["eliminated"] and res["p2"]["score"] < 500


def test_bad_input_is_ignored():
    g = make(stt=FakeStt(["무궁화 꽃이 피었습니다"]))
    run_to(g, T0 + 0.5)
    for data in ("x", {"k": "voice", "pcm": "@@", "rate": 16000}, {"k": "voice", "pcm": loud(), "rate": True},
                 {"k": "voice", "pcm": loud(seconds=30), "rate": 16000}, {"k": "mic", "on": True, "lv": "크게"}, {"k": "?"}):
        g.on_input("p1", data, T0 + 0.5)
    g.on_input("nobody", {"k": "move", "on": True}, T0 + 0.5)
    assert g.services["stt"].calls == 0 and g.t_phase == "back"
