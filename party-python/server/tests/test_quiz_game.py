"""음성 퀴즈: 버저 판정, 음성/타자 답변, 잠금·감점, 순위, 정답 비공개."""

from __future__ import annotations

import base64
import json
import random
import struct
from concurrent.futures import Future

import pytest

from party.games.quiz.checker import AnswerChecker
from party.games.quiz.config import DEFAULT_CONFIG
from party.games.quiz.game import QuizGame
from party.games.quiz.questions import QuestionPool, load_bank, pick_questions, problems_of, with_hints
from party.services.gemini import GeminiClient, GeminiError

QS = [
    with_hints({"id": "t1", "category": "history", "question": "한글을 만든 왕은?", "answer": "세종대왕", "aliases": ["세종"]}),
    with_hints({"id": "t2", "category": "science", "question": "식물이 빛으로 양분을 만드는 작용은?", "answer": "광합성", "aliases": []}),
]


class FakeStt:
    """말한 내용을 정해 둔 대로 돌려주는 가짜 음성 인식."""

    def __init__(self, texts=(), available=True, pending=False):
        self.texts = list(texts)
        self.available = available
        self.status = "ready" if available else "off"
        self.pending = pending
        self.calls = 0

    def submit(self, pcm, rate=16000):
        self.calls += 1
        f = Future()
        if not self.pending:
            f.set_result(self.texts.pop(0) if self.texts else "")
        return f


def loud(seconds=0.6, rate=16000, amp=8000):
    n = int(seconds * rate)
    pcm = b"".join(struct.pack("<h", amp if (i // 40) % 2 else -amp) for i in range(n))
    return base64.b64encode(pcm).decode()


def make(n=3, stt=None, questions=QS, seed=1):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    g = QuizGame(players, {"questions": list(questions)}, random.Random(seed).random)
    g.services = {"stt": stt} if stt is not None else {}
    g.start(0.0)
    g.drain()
    return g


def run_to(g, t, step=0.05, start=None):
    """t 초까지 진행하고 그동안의 사건을 돌려준다."""
    events = []
    now = g._now if hasattr(g, "_now") else 0.0
    while now < t - 1e-9:
        now = min(t, now + step)
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = t
    return events


def open_question(g):
    """첫 문제의 버저가 열린 직후 시각을 돌려준다."""
    R = g.R
    t = R["READY_TIME"] + R["INTRO_TIME"] + 0.1
    run_to(g, t)
    assert g.phase == "open"
    return t


def test_answer_checker_matches_original_rules():
    c = AnswerChecker(QS[0], DEFAULT_CONFIG)
    assert c.is_correct("세종대왕") and c.is_correct("세종") and c.is_correct("정답은 세종대왕입니다")
    assert c.is_correct("음 세종대왕이요") and c.is_correct(" 세종 대왕! ")
    assert not c.is_correct("태종") and not c.is_correct("") and not c.is_correct("세종대왕이순신장군")
    assert not c.is_meaningful("음") and not c.is_meaningful("   ") and c.is_meaningful("태종")
    two = AnswerChecker({"answer": "목성", "aliases": []}, DEFAULT_CONFIG)
    assert two.is_correct("목성") and not two.is_correct("목성토성")


def test_earliest_press_wins_even_if_it_arrives_later():
    g = make()
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 0.30}, t + 0.31)   # 늦게 눌렀지만 먼저 도착
    g.on_input("p2", {"k": "buzz", "t": t + 0.22}, t + 0.36)   # 먼저 눌렀지만 늦게 도착
    ev = run_to(g, t + 0.6)
    assert [e["player"] for e in ev if e["type"] == "buzz"] == ["p2"]
    assert g.phase == "answering" and g.buzzer == "p2"


def test_buzz_time_cannot_be_faked_far_into_the_past():
    g = make()
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    g.on_input("p2", {"k": "buzz", "t": 0.0}, t + 1.05)        # "아주 옛날에 눌렀다"고 주장
    run_to(g, t + 1.4)
    # 보정은 최대 0.35초까지만 → p2 는 t+0.70 으로 인정된다(그래도 통신 지연 범위 안이라 이긴다)
    assert g.buzzer == "p2"
    g2 = make()
    t = open_question(g2)
    g2.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g2, t + 1.2)                                          # 판정 끝난 뒤
    g2.on_input("p2", {"k": "buzz", "t": 0.0}, t + 1.3)
    run_to(g2, t + 1.5)
    assert g2.buzzer == "p1"


def test_typed_correct_answer_scores_and_reveals():
    g = make()
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 2.0}, t + 2.0)
    run_to(g, t + 2.3)
    assert g.snapshot(t + 2.3)["answer"] is None                 # 답변 중에는 정답을 보내지 않는다
    g.on_input("p2", {"k": "typed", "text": "세종대왕"}, t + 2.4)  # 버저를 못 잡은 사람의 답은 무시
    assert g.phase == "answering"
    g.on_input("p1", {"k": "typed", "text": "세종"}, t + 3.0)
    snap = g.snapshot(t + 3.0)
    assert snap["phase"] == "reveal" and snap["answer"] == "세종대왕"
    assert snap["scores"]["p1"] == {"score": 100, "correct": 1, "wrong": 0}
    assert g.stats["p1"]["correctTime"] == pytest.approx(2.1, abs=0.01)   # 문제가 열린 뒤(0.1초 전) 버저를 누른 순간까지


def test_wrong_answer_locks_and_costs_points_then_others_continue():
    g = make()
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    g.on_input("p1", {"k": "typed", "text": "태종"}, t + 2.0)
    assert g.phase == "wrong" and g.stats["p1"]["score"] == -50 and "p1" in g.locked
    run_to(g, t + 3.5)
    assert g.phase == "open"
    g.on_input("p1", {"k": "buzz", "t": t + 3.6}, t + 3.6)      # 잠긴 사람은 버저를 못 잡는다
    run_to(g, t + 4.0)
    assert g.phase == "open" and g.buzzer is None
    g.on_input("p2", {"k": "buzz", "t": t + 4.1}, t + 4.1)
    run_to(g, t + 4.4)
    assert g.buzzer == "p2"


def test_answer_timeout_counts_as_wrong():
    g = make()
    t = open_question(g)
    g.on_input("p3", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    ev = run_to(g, t + 1.2 + g.R["ANSWER_TIME"] + 0.3)
    wrong = [e for e in ev if e["type"] == "wrong"]
    assert wrong and wrong[0]["cause"] == "timeout" and g.stats["p3"]["score"] == -50


def test_everyone_wrong_reveals_answer_and_moves_on():
    g = make(n=2)
    t = open_question(g)
    now = t
    for pid in ("p1", "p2"):
        now += 0.5
        g.on_input(pid, {"k": "buzz", "t": now}, now)
        run_to(g, now + 0.3)
        g.on_input(pid, {"k": "typed", "text": "모름"}, now + 0.4)
        ev = run_to(g, now + 0.4 + g.R["WRONG_FEEDBACK_TIME"] + 0.2)
        now += 0.4 + g.R["WRONG_FEEDBACK_TIME"] + 0.2
    assert g.phase == "reveal" and g.last == {"type": "allWrong"}
    assert any(e["type"] == "allWrong" and e["answer"] == "세종대왕" for e in ev)
    run_to(g, now + g.R["REVEAL_TIME"] + 0.1)
    assert g.index == 1 and not g.locked                         # 다음 문제는 모두 처음부터


def test_question_timer_pauses_while_answering_and_hints_open_in_order():
    g = make()
    t = open_question(g)
    ev = run_to(g, t + 10.5)
    assert [e["level"] for e in ev if e["type"] == "hint"] == [1]
    snap = g.snapshot(t + 10.5)
    assert snap["hints"] == {"chosung": "ㅅㅈㄷㅇ"} and "세종" not in json.dumps(snap, ensure_ascii=False)
    g.on_input("p1", {"k": "buzz", "t": t + 11.0}, t + 11.0)
    run_to(g, t + 11.3)
    left = g.snapshot(t + 15.0)["timeLeft"]
    assert left == pytest.approx(g.R["QUESTION_TIME"] - 11.1, abs=0.02)   # 답하는 동안 멈춤
    g.on_input("p1", {"k": "typed", "text": "모름"}, t + 15.0)
    ev = run_to(g, t + 15.0 + g.R["WRONG_FEEDBACK_TIME"] + 9.5)
    assert [e["level"] for e in ev if e["type"] == "hint"] == [2]
    ev = run_to(g, t + 15.0 + g.R["WRONG_FEEDBACK_TIME"] + 36)
    assert any(e["type"] == "timeup" for e in ev) and g.phase in ("reveal", "intro")


def test_voice_answer_correct_and_retry_then_wrong():
    stt = FakeStt(["태정태세", "세종대왕입니다"])
    g = make(stt=stt)
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    g.on_input("p2", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 1.5)   # 남의 목소리는 무시
    assert stt.calls == 0
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 2.0)
    assert g.phase == "judging"
    ev = run_to(g, t + 2.2)
    assert [e["type"] for e in ev] == ["heard", "retry"] and ev[1]["left"] == 1 and g.phase == "answering"
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 3.0)
    ev = run_to(g, t + 3.2)
    assert [e["type"] for e in ev] == ["heard", "correct"] and g.stats["p1"]["score"] == 100

    stt = FakeStt(["태종", "정조"])
    g = make(stt=stt)
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    for at in (2.0, 3.0):
        g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + at)
        ev = run_to(g, t + at + 0.2)
    assert ev[-1]["type"] == "wrong" and ev[-1]["cause"] == "voice" and g.stats["p1"]["wrong"] == 1


def test_silence_garbage_and_stuck_recognition_do_not_use_up_a_try():
    stt = FakeStt(["음"])
    g = make(stt=stt)
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    g.on_input("p1", {"k": "voice", "pcm": loud(amp=10), "rate": 16000}, t + 1.5)       # 너무 작은 소리
    g.on_input("p1", {"k": "voice", "pcm": "###", "rate": 16000}, t + 1.6)             # 깨진 데이터
    g.on_input("p1", {"k": "voice", "pcm": loud(seconds=30), "rate": 16000}, t + 1.7)  # 너무 긴 소리
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": "x"}, t + 1.8)
    assert stt.calls == 0 and g.phase == "answering"
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 2.0)            # "음" 만 들림
    ev = run_to(g, t + 2.2)
    assert ev[-1]["type"] == "unheard" and g.voice_tries == 0 and g.phase == "answering"

    stt = FakeStt(pending=True)                                                         # 인식이 끝나지 않는 경우
    g = make(stt=stt)
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 2.0)
    ev = run_to(g, t + 2.0 + g.R["JUDGE_TIMEOUT"] + 0.2)
    assert ev[-1]["type"] == "sttFail" and g.phase == "answering" and g.voice_tries == 0


def test_voice_off_reports_to_clients():
    g = make(stt=FakeStt(available=False))
    assert g.client_options()["voice"] is False
    t = open_question(g)
    g.on_input("p1", {"k": "buzz", "t": t + 1.0}, t + 1.0)
    run_to(g, t + 1.3)
    g.on_input("p1", {"k": "voice", "pcm": loud(), "rate": 16000}, t + 2.0)
    assert g.phase == "answering" and ("p1", "event", {"type": "voiceOff"}) in g.drain()


def test_full_game_finishes_and_ranks_by_score_then_correct_then_time():
    g = make(n=3)
    t = open_question(g)
    g.on_input("p2", {"k": "buzz", "t": t + 3.0}, t + 3.0)
    run_to(g, t + 3.3)
    g.on_input("p2", {"k": "typed", "text": "세종대왕"}, t + 4.0)
    run_to(g, 400.0, step=0.1)
    assert g.finished
    assert [r["playerId"] for r in g.results] == ["p2", "p1", "p3"]
    assert [r["rank"] for r in g.results] == [1, 2, 2] and g.results[0]["isWinner"]

    g = make(n=3)
    g.stats["p1"].update(score=100, correct=2, wrong=2, correctTime=9.0)
    g.stats["p2"].update(score=100, correct=1, wrong=0, correctTime=3.0)
    g.stats["p3"].update(score=100, correct=2, wrong=2, correctTime=5.0)
    assert [r["playerId"] for r in g.build_results()] == ["p3", "p1", "p2"]


def test_bank_is_valid_and_picks_are_balanced_and_unique():
    bank = load_bank()
    ids = {c["id"] for c in bank["categories"]}
    assert all(not problems_of(q, ids) for q in bank["questions"])
    qs, source = pick_questions(10, random.Random(3).random, None)
    assert source == "bank" and len({q["answer"] for q in qs}) == 10
    assert len({q["category"] for q in qs}) == len(ids)


def test_gemini_questions_are_validated_and_used_first():
    class FakeGemini:
        def generate_json(self, prompt, schema=None, temperature=1.0):
            return [
                {"category": "science", "question": "물의 화학식에 들어 있는 기체 원소 두 가지 중 가벼운 것은?", "answer": "수소", "aliases": []},
                {"category": "science", "question": "수소가 정답인 문제?", "answer": "수소", "aliases": []},        # 문제에 정답 포함 + 중복
                {"category": "nope", "question": "분야가 틀린 문제?", "answer": "정답", "aliases": []},
                {"category": "history", "question": "영어 정답?", "answer": "ABC", "aliases": []},
                {"category": "history", "question": "고려를 세운 사람은?", "answer": "왕건", "aliases": ["태조왕건"]},
                "엉뚱한 값",
            ]

    pool = QuestionPool(FakeGemini())
    pool._refill()
    assert pool.size() == 2
    qs, source = pick_questions(4, random.Random(1).random, pool)
    assert source == "mixed" and [q["source"] for q in qs[:2]] == ["gemini", "gemini"]
    assert qs[0]["hints"]["chosung"] == "ㅅㅅ" and len({q["answer"] for q in qs}) == 4
    pool.accept([{"category": "science", "question": "다시 나온 문제?", "answer": "수소", "aliases": []}])
    assert pool.size() == 0                                      # 이미 낸 정답은 다시 쌓지 않는다


def test_gemini_client_tries_next_model_and_parses_json():
    calls = []

    class Res:
        def __init__(self, body):
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def opener(req, timeout=0):
        calls.append(req.full_url)
        assert req.headers["X-goog-api-key"] == "KEY"
        if "model-a" in req.full_url:
            raise OSError("없는 모델")
        text = json.dumps([{"ok": 1}])
        return Res(json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]}).encode())

    c = GeminiClient("KEY", ["model-a", "model-b"], opener=opener)
    assert c.generate_json("hi") == [{"ok": 1}] and c.last_model == "model-b" and len(calls) == 2
    assert c.generate_json("hi") == [{"ok": 1}] and len(calls) == 3      # 성공한 모델을 먼저 쓴다
    bad = GeminiClient("KEY", ["model-a"], opener=opener)
    with pytest.raises(GeminiError):
        bad.generate_json("hi")
