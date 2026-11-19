"""마법진 그리기 서버 판정 테스트: 모양 · 채점 · 진행 · 입력 검증 · 재접속 · AI(가짜 Gemini)."""

from __future__ import annotations

import base64
import json
import random
import shutil
import struct
import subprocess
import time
import zlib
from pathlib import Path

import pytest

from party.games.sigil.config import DEFAULT_CONFIG
from party.games.sigil.game import SigilGame
from party.games.sigil.png import encode_gray_png, paper_png_base64, rasterize
from party.games.sigil.shapes import SHAPES, plan_rounds, prepare_shape
from party.games.sigil.sketch import AutoDrawer, Paper, score_drawing
from party.services.caster import VERDICT_SCHEMA

SCORE = DEFAULT_CONFIG["SCORE"]
PLAN = [{"shape": 1, "twist": "none", "mult": 1}, {"shape": 3, "twist": "mirror", "mult": 1},
        {"shape": 8, "twist": "memory", "mult": 2}]
SIM_SCRIPT = Path(__file__).resolve().parents[2] / "web" / "tests" / "sigil-sim.mjs"


def make(n=3, plan=PLAN, services=None, seed=7, config=None):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    options = {"plan": plan} if plan else {}
    if config:
        options["config"] = config
    g = SigilGame(players, options, random.Random(seed).random)
    g.services = services or {}
    g.start(0.0)
    g._now = 0.0
    g._events = []
    g._states = []
    collect(g)
    return g


def collect(g):
    for to, kind, d in g.drain():
        (g._events if kind == "event" else g._states).append(d)


def run_until(g, cond, limit=300.0, step=0.05):
    while not cond(g):
        g._now += step
        assert g._now < limit, f"시간 초과 (phase={g.phase})"
        g.tick(g._now)
        collect(g)
    return g._now


def to_phase(g, phase, round_no=None):
    return run_until(g, lambda x: x.phase == phase and (round_no is None or x.round == round_no))


def trace(g, pid, every=1, offset=0):
    """pid 가 지금 모양을 그대로 따라 그린다(every 칸마다 한 점, offset 만큼 옆으로 밀어서)."""
    cells = prepare_shape(g.shape, g.size)["cells"][::every]
    pts = [v for x, y in cells for v in (min(119, x + offset), y)]
    for i in range(0, len(pts), 200):
        g.on_input(pid, {"k": "ink", "p": pts[i:i + 200], "c": 1 if i else 0}, g._now)


def events(g, kind):
    return [e for e in g._events if e["type"] == kind]


# ----------------------------------------------------------------------
# 모양 · 채점 · PNG
# ----------------------------------------------------------------------
def test_plan_follows_round_tiers_and_is_same_for_same_seed():
    a = plan_rounds(random.Random(3).random, DEFAULT_CONFIG["ROUNDS"])
    b = plan_rounds(random.Random(3).random, DEFAULT_CONFIG["ROUNDS"])
    assert a == b and len(a) == 3
    for r, rule in zip(a, DEFAULT_CONFIG["ROUNDS"]):
        assert SHAPES[r["shape"]]["tier"] == rule["tier"] and r["twist"] in rule["twists"] and r["mult"] == rule["mult"]
    assert plan_rounds(lambda: 0.999999, DEFAULT_CONFIG["ROUNDS"])[2]["twist"] == "shake"


def test_prepared_shape_has_zero_distance_on_the_line():
    assert len(SHAPES) == 9
    for s in SHAPES:
        prep = prepare_shape(s)
        assert all(0 <= x < 120 and 0 <= y < 120 and prep["dist"][y * 120 + x] == 0 for x, y in prep["cells"])
    tri = prepare_shape(SHAPES[1])
    assert tri["start"] == (60, 16) and tri["dist"][60 * 120 + 60] > 3     # 삼각형 한가운데는 선에서 멀다


def test_scoring_perfect_trace_scribble_and_empty():
    for s in SHAPES:
        paper = Paper()
        for x, y in prepare_shape(s)["cells"]:
            paper.stroke(x, y)
        assert score_drawing(paper, s, SCORE)["accuracy"] == 100, s["name"]
    assert score_drawing(Paper(), SHAPES[0], SCORE) == {"accuracy": 0, "cover": 0.0, "neat": 0.0}
    # 종이를 온통 칠하면 다 덮지만 깔끔하지 않다 → 100 × 1 × (0.4 + 0.6 × 깔끔)
    full = Paper()
    for y in range(0, 120, 2):
        full.end()
        full.stroke(0, y)
        full.stroke(119, y)
    sc = score_drawing(full, SHAPES[1], SCORE)
    assert sc["cover"] == 1.0 and sc["neat"] < 0.3 and 40 <= sc["accuracy"] < 60
    # 반만 그리면 덮기가 절반쯤
    half = Paper()
    cells = prepare_shape(SHAPES[1])["cells"]
    for x, y in cells[:len(cells) // 2]:
        half.stroke(x, y)
    assert 45 <= score_drawing(half, SHAPES[1], SCORE)["accuracy"] <= 58


def test_paper_brush_and_line_match_the_original_rules():
    p = Paper()
    p.stroke(10, 10)
    assert p.ink_count == 4 and all(p.ink[y * 120 + x] for x in (10, 11) for y in (10, 11))
    p.stroke(13, 10)                       # 가로 3칸 이동 → 2줄 x 5칸
    assert p.ink_count == 10
    p.end()
    p.stroke(119, 119)                     # 모서리: 종이 밖으로 나가는 칸은 버린다
    assert p.ink_count == 11
    bits = base64.b64decode(p.bits())
    assert len(bits) == 1800 and sum(bin(b).count("1") for b in bits) == 11


def test_autodrawer_draws_better_with_more_skill():
    def acc(skill):
        rng = random.Random(1).random
        auto, paper = AutoDrawer(SHAPES[3], skill, rng), Paper()
        while (p := auto.next()) is not None:
            if 0 <= p[0] < 119.5 and 0 <= p[1] < 119.5:
                paper.stroke(max(0, p[0]), max(0, p[1]))
        return score_drawing(paper, SHAPES[3], SCORE)["accuracy"]
    assert acc(0.95) >= 80 and acc(0.95) >= acc(0.1)


def read_png(data: bytes):
    """PNG 를 다시 풀어 (너비, 높이, 픽셀) 로 — 인코더가 올바른지 확인용."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, chunks = 8, {}
    while pos < len(data):
        (length,), name = struct.unpack(">I", data[pos:pos + 4]), data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        assert struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0] == zlib.crc32(name + body) & 0xFFFFFFFF
        chunks[name] = body
        pos += 12 + length
    w, h, depth, color = struct.unpack(">IIBB", chunks[b"IHDR"][:10])
    assert (depth, color) == (8, 0) and b"IEND" in chunks
    raw = zlib.decompress(chunks[b"IDAT"])
    rows = [raw[y * (w + 1):(y + 1) * (w + 1)] for y in range(h)]
    assert all(r[0] == 0 for r in rows)
    return w, h, b"".join(r[1:] for r in rows)


def test_png_encoder_and_rasterizer():
    w, h, px = read_png(encode_gray_png(3, 2, bytes([0, 128, 255, 255, 128, 0])))
    assert (w, h, px) == (3, 2, bytes([0, 128, 255, 255, 128, 0]))
    with pytest.raises(ValueError):
        encode_gray_png(3, 2, b"\x00")
    paper = Paper()
    paper.stroke(0, 0)
    paper.stroke(119, 119)
    small = rasterize(paper.ink, 120, 96)
    assert len(small) == 96 * 96 and small[0] == 0 and small[95 * 96 + 95] == 0 and small[95] == 255
    assert all(small[i * 96 + i] == 0 for i in range(96))          # 대각선이 끊기지 않는다
    w, h, px = read_png(base64.b64decode(paper_png_base64(paper, 96)))
    assert (w, h) == (96, 96) and px == small
    assert set(rasterize(Paper().ink, 120, 96)) == {255}


# ----------------------------------------------------------------------
# 진행
# ----------------------------------------------------------------------
@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_runs_to_common_results(n):
    g = make(n=n)
    for r in range(1, 4):
        to_phase(g, "draw", r)
        for i, pid in enumerate(g.ids):
            if i == 0:
                trace(g, pid)                      # 1번은 정확히
            elif i == 1:
                trace(g, pid, every=1, offset=12)  # 2번은 옆으로 밀려서
            # 나머지는 아무것도 안 그림(연결이 끊긴 사람과 같다)
        to_phase(g, "gallery", r)
    run_until(g, lambda x: x.finished)
    res = g.results
    assert [r["playerId"] for r in res][0] == "p1" and len(res) == n
    assert res[0]["score"] == 400 and res[0]["rank"] == 1 and res[0]["isWinner"]      # 100 + 100 + 100×2
    assert res[0]["stats"] == {"rounds": [100, 100, 200], "accuracy": [100, 100, 100], "best": 100, "spells": 3}
    assert all(set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"} for r in res)
    assert [r["score"] for r in res] == sorted((r["score"] for r in res), reverse=True)
    assert 0 < res[1]["score"] < 400
    if n > 2:
        assert res[-1]["score"] == 0 and res[-1]["rank"] == 3 and not res[-1]["isWinner"]
    assert len(events(g, "reveal")) == 3 and not events(g, "review") and not events(g, "verdict")
    assert all(e["source"] == "canned" and e["who"] == "마법사" and e["text"] for e in events(g, "say"))
    kinds = [e["kind"] for e in events(g, "say")]
    assert kinds[0] == "round_start" and "jackpot" in kinds and "success" in kinds and kinds[-1] == "final"
    assert g._now < 120                    # 한 판이 2분 안에 끝난다
    final = [s for s in g._states if s["phase"] == "final"]
    assert final and final[0]["results"] == res and final[0]["verdict"] is None


def test_says_keep_a_minimum_gap():
    g = make(n=2)
    to_phase(g, "draw", 1)
    for pid in g.ids:
        trace(g, pid)
    run_until(g, lambda x: x.finished)
    assert len(events(g, "say")) >= 5
    # 사건에 시각이 없으므로 간격은 진행기의 기록으로 확인한다
    g2 = make(n=2)
    times = []
    while not g2.finished:
        g2._now += 0.05
        g2.tick(g2._now)
        times += [g2._now for _to, kind, d in g2.drain() if kind == "event" and d["type"] == "say"]
    assert all(b - a >= 3.0 - 1e-6 for a, b in zip(times, times[1:]))


def test_time_bonus_for_finishing_early_and_speed_curse_doubles_it():
    g = make(n=3, plan=[{"shape": 1, "twist": "none", "mult": 1}, {"shape": 3, "twist": "speed", "mult": 1}])
    t0 = to_phase(g, "draw", 1)
    assert g.draw_until - g.since == pytest.approx(10.0) and g.until == pytest.approx(g.draw_until + 0.35)
    trace(g, "p1")
    g.on_input("p1", {"k": "done"}, g._now + 0.1)          # 시작 직후(20프레임 안)에는 받지 않는다
    assert not g.P["p1"]["done"]
    run_until(g, lambda x: x._now >= t0 + 2.5)
    g.on_input("p1", {"k": "done", "t": g._now - 0.2}, g._now)      # 0.35초 안의 시각은 인정
    assert g.P["p1"]["doneAt"] == pytest.approx(g._now - 0.2)
    g.on_input("p1", {"k": "ink", "p": [5, 5, 100, 100], "c": 0}, g._now)   # 완료 뒤에는 못 그린다
    g.on_input("p2", {"k": "ink", "p": [5, 5, 6, 6], "c": 0}, g._now)       # 조금만 그린 사람은 보너스가 없다
    g.on_input("p2", {"k": "done", "t": g._now - 5}, g._now)                # 너무 옛 시각은 받은 시각으로
    assert g.P["p2"]["doneAt"] == pytest.approx(g._now)
    collect(g)
    assert events(g, "done") == [{"type": "done", "playerId": "p1"}, {"type": "done", "playerId": "p2"}]
    to_phase(g, "score", 1)
    sc = events(g, "reveal")[0]["scores"]
    assert sc["p1"] == {"accuracy": 100, "cover": 1.0, "neat": 1.0, "bonus": 14, "mult": 1, "total": 114}   # 남은 7초 × 2
    assert sc["p2"]["accuracy"] < 50 and sc["p2"]["bonus"] == 0 and sc["p3"]["total"] == 0
    # 2라운드: 번개 마법 — 5초, 남은 초 × 4, 최대 16
    t1 = to_phase(g, "draw", 2)
    assert g.draw_until - g.since == pytest.approx(5.0)
    trace(g, "p1")
    run_until(g, lambda x: x._now >= t1 + 0.5)
    g.on_input("p1", {"k": "done"}, g._now)
    to_phase(g, "score", 2)
    assert events(g, "reveal")[1]["scores"]["p1"]["bonus"] == 16
    assert g.P["p1"]["total"] == 114 + 116


def test_round_ends_early_when_every_connected_player_is_done():
    g = make(n=3)
    g.on_connection("p3", False, 0.0)                      # 끊긴 사람은 기다리지 않는다
    t0 = to_phase(g, "draw", 1)
    run_until(g, lambda x: x._now >= t0 + 1.0)
    for pid in ("p1", "p2"):
        trace(g, pid)
        g.on_input(pid, {"k": "done"}, g._now)
    assert g.phase == "score" and g.since == pytest.approx(g._now)
    assert g.P["p1"]["rounds"][0]["bonus"] == 16           # 남은 9초 × 2 = 18 → 최대 16
    # 아무도 완료하지 않으면 시간(10초 + 0.35초)이 끝나야 넘어간다
    t1 = to_phase(g, "draw", 2)
    to_phase(g, "score", 2)
    assert g._now - t1 == pytest.approx(10.35, abs=0.06)


def test_bad_input_is_ignored_and_curses_are_not_reapplied_on_the_server():
    g = make(n=2)
    g.on_input("p1", {"k": "ink", "p": [1, 1, 2, 2]}, g._now)      # 그리기 단계가 아님
    to_phase(g, "draw", 2)                                 # 2라운드 = 거울 저주
    paper = g.P["p1"]["paper"]
    for bad in ({"k": "ink", "p": [1, 2, 3]}, {"k": "ink", "p": [1, "a"]}, {"k": "ink", "p": [1, 120]},
                {"k": "ink", "p": [-3, 5]}, {"k": "ink", "p": [True, 5]}, {"k": "ink", "p": "xx"},
                {"k": "ink", "p": [1, 1] * 401}, {"k": "what"}, "ink", None):
        g.on_input("p1", bad, g._now)
    g.on_input("zz", {"k": "ink", "p": [1, 1]}, g._now)
    assert paper.ink_count == 0
    # 거울 저주는 브라우저가 종이 좌표로 바꿀 때 이미 적용했다 → 서버는 받은 좌표 그대로 그린다
    g.on_input("p1", {"k": "ink", "p": [10, 20, 14, 20], "c": 0}, g._now)
    assert paper.ink[20 * 120 + 10] and paper.ink[20 * 120 + 14] and not paper.ink[20 * 120 + 109]
    # c = 1 이면 앞 선에 이어 그리고, c = 0 이면 펜을 뗀 것으로 본다
    g.on_input("p1", {"k": "ink", "p": [14, 30], "c": 1}, g._now)
    assert paper.ink[25 * 120 + 14]
    g.on_input("p1", {"k": "ink", "p": [60.4, 60.4], "c": 0}, g._now)
    assert paper.ink[60 * 120 + 60] and not paper.ink[45 * 120 + 37]
    # 한 라운드에 보낼 수 있는 점 개수 제한
    g2 = make(n=2, config={"LIMITS": {"ROUND_POINTS": 3}})
    to_phase(g2, "draw", 1)
    g2.on_input("p1", {"k": "ink", "p": [1, 1, 2, 2]}, g2._now)
    g2.on_input("p1", {"k": "ink", "p": [50, 50, 60, 60]}, g2._now)
    assert g2.P["p1"]["points"] == 2 and not g2.P["p1"]["paper"].ink[50 * 120 + 50]


def test_states_and_reconnect():
    g = make(n=2, plan=[{"shape": 1, "twist": "ghost", "mult": 1}])
    opts = g.client_options()
    assert opts["canvas"] == 120 and len(opts["shapes"]) == 9 and opts["rounds"] == [{"tier": "easy", "mult": 1}]
    json.dumps(opts)
    to_phase(g, "draw", 1)
    trace(g, "p1")
    g._states.clear()
    run_until(g, lambda x: x._now >= x.since + 2.0)
    draw_states = [s for s in g._states if s["phase"] == "draw"]
    assert 8 <= len(draw_states) <= 12                     # 그리는 동안 초당 5번
    s = draw_states[-1]
    assert s["shape"] == 1 and s["twist"] == "ghost" and s["drawUntil"] == g.draw_until
    assert s["players"]["p1"]["live"] is None and "me" not in s    # 투명 잉크: 마력은 숨긴다
    assert g.P["p1"]["live"] == 100
    back = g.state_for("p1", g._now)
    assert back["me"]["ink"] == g.P["p1"]["paper"].bits() and "me" in g.state_for("p2", g._now)
    to_phase(g, "gallery", 1)
    back = g.state_for("p2", g._now)
    assert set(back["drawings"]) == {"p1", "p2"} and back["players"]["p1"]["rounds"][0]["total"] == 100
    assert back["drawings"] == events(g, "reveal")[0]["drawings"]
    json.dumps(back)
    assert "drawings" not in g._states[-1]


# ----------------------------------------------------------------------
# AI (가짜 Gemini)
# ----------------------------------------------------------------------
class FakeGemini:
    """받은 요청(글 · 그림)을 기록하고, 요청 종류에 따라 정해 둔 답을 준다."""

    def __init__(self, reviews=None, error_on_review=False, review_delay=0.0):
        self.calls = []
        self.reviews = reviews
        self.error_on_review = error_on_review
        self.review_delay = review_delay

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append({"prompt": prompt, "schema": schema, "images": images, "system": system})
        if images:
            if self.review_delay:
                time.sleep(self.review_delay)
            if self.error_on_review:
                raise RuntimeError("429")
            return self.reviews
        if schema is VERDICT_SCHEMA:
            return {"headline": "마을이 조금\n밝아졌군요", "mvp": '"N1" 인정합니다', "cheer": "다음엔 더 잘하시길"}
        named = ("first_done", "success", "poof", "lead_change", "final")
        return {kind: [f"AI {kind}" + (" {name}" if kind in named else "")] for kind in schema["properties"]}

    @property
    def review_calls(self):
        return [c for c in self.calls if c["images"]]


def settle(g, seconds=0.3):
    """스레드에서 도는 가짜 Gemini 가 답할 시간을 준 뒤 한 번 더 진행한다."""
    time.sleep(seconds)
    g._now += 0.05
    g.tick(g._now)
    collect(g)


def test_gemini_lines_reviews_and_verdict():
    fake = FakeGemini(reviews=[
        {"looks_like": '찌그러진\n"세모"', "comment": "삼각이라 부르기엔 " + "너무 " * 30},
        {"looks_like": "빈 종이", "comment": "아무것도 없군요."},
        {"looks_like": "남는 칸", "comment": "참가자보다 많은 답"},
        "엉뚱한 값",
    ])
    g = make(n=2, services={"gemini": fake})
    time.sleep(0.2)                                        # 대사 묶음 도착
    for r in range(1, 4):
        to_phase(g, "draw", r)
        trace(g, "p1")
        to_phase(g, "score", r)
        settle(g)
    # 한 라운드에 요청 한 번, 그 안에 모든 참가자의 그림(참가자 순서)
    assert len(fake.review_calls) == 3
    call = fake.review_calls[0]
    assert len(call["images"]) == 2 and all(i["mime_type"] == "image/png" for i in call["images"])
    w, h, px = read_png(base64.b64decode(call["images"][0]["data"]))
    assert (w, h) == (96, 96) and 0 in px and 255 in px             # p1 의 그림: 검은 선이 있다
    assert set(read_png(base64.b64decode(call["images"][1]["data"]))[2]) == {255}     # p2 는 빈 종이
    assert "삼각 마법진" in call["prompt"] and "N1" in call["prompt"] and "마법사" in call["system"]
    assert call["schema"]["type"] == "ARRAY"
    # 감상평: 다듬어서(줄바꿈 · 따옴표 제거, 길이 제한) 참가자 수까지만
    revs = events(g, "review")
    assert len(revs) == 3 and revs[0]["round"] == 1 and revs[0]["source"] == "gemini"
    assert set(revs[0]["reviews"]) == {"p1", "p2"}
    assert revs[0]["reviews"]["p1"]["looksLike"] == "찌그러진 세모" and len(revs[0]["reviews"]["p1"]["comment"]) <= 26
    assert revs[0]["reviews"]["p2"] == {"looksLike": "빈 종이", "comment": "아무것도 없군요."}
    # 점수는 감상평과 무관하게 규칙 계산 그대로
    assert events(g, "reveal")[0]["scores"]["p1"]["total"] == 100
    to_phase(g, "gallery", 3)
    assert g.snapshot(g._now)["reviews"] == revs[2]["reviews"]
    # 대사는 Gemini 것, 이름이 채워진다
    says = events(g, "say")
    assert says and all(e["source"] == "gemini" for e in says)
    assert any(e["text"] == "AI success N1" for e in says)
    # 총평
    to_phase(g, "final")
    settle(g)
    assert events(g, "verdict") == [{"type": "verdict", "headline": "마을이 조금 밝아졌군요", "mvp": "N1 인정합니다",
                                     "cheer": "다음엔 더 잘하시길"}]
    assert g.state_for("p1", g._now)["verdict"]["headline"] == "마을이 조금 밝아졌군요"
    run_until(g, lambda x: x.finished)
    assert len(fake.calls) == 1 + 3 + 1                    # 대사 1 + 라운드별 감상평 3 + 총평 1
    assert g.results[0]["playerId"] == "p1"


@pytest.mark.parametrize("fake", [FakeGemini(error_on_review=True), FakeGemini(reviews={"oops": 1}),
                                  FakeGemini(reviews=[{"looks_like": "늦은 답", "comment": "x"}], review_delay=0.5)])
def test_review_failure_or_late_answer_never_blocks_the_game(fake):
    g = make(n=2, services={"gemini": fake}, plan=PLAN[:1],
             config={"FLOW": {"SCORE_TIME": 0.1, "GALLERY_TIME": 0.1}})
    to_phase(g, "draw", 1)
    trace(g, "p1")
    to_phase(g, "final")                   # 기다리지 않고(가짜 시계만으로) 최종 화면까지 간다
    time.sleep(0.7)
    run_until(g, lambda x: x.finished)
    assert not events(g, "review") and g.results[0]["score"] == 100


# ----------------------------------------------------------------------
# 화면 쪽(JS) 계산과 같은지 — 모양 · 종이 · 채점
# ----------------------------------------------------------------------
@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")
def test_shapes_paper_and_scoring_match_the_browser_code():
    rnd = random.Random(11)
    strokes = [[rnd.randrange(120) for _ in range(2 * rnd.randrange(1, 12))] for _ in range(14)]
    proc = subprocess.run(["node", str(SIM_SCRIPT), "--parity"], input=json.dumps({"strokes": strokes}),
                          capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert proc.returncode == 0, proc.stderr
    js = json.loads(proc.stdout)
    paper = Paper()
    for s in strokes:
        paper.end()
        for i in range(0, len(s), 2):
            paper.stroke(s[i], s[i + 1])
    assert js["bits"] == paper.bits() and js["inkCount"] == paper.ink_count
    assert len(js["shapes"]) == len(SHAPES)
    for s, row in zip(SHAPES, js["shapes"]):
        prep = prepare_shape(s)
        assert row["name"] == s["name"] and row["tier"] == s["tier"]
        assert row["cells"] == [v for c in prep["cells"] for v in c], s["name"]
        assert row["distSum"] == sum(prep["dist"]), s["name"]
        assert row["accuracy"] == score_drawing(paper, s, SCORE)["accuracy"], s["name"]
        full = Paper()
        for x, y in prep["cells"]:
            full.stroke(x, y)
        assert row["perfect"] == score_drawing(full, s, SCORE)["accuracy"] == 100
    assert js["config"]["SCORE"] == {k: v for k, v in SCORE.items()}
    assert js["config"]["ROUNDS"] == DEFAULT_CONFIG["ROUNDS"] and js["config"]["TWISTS"] == DEFAULT_CONFIG["TWISTS"]
    for key in ("CANVAS", "BRUSH", "DRAW_TIME", "SPEED_TIME", "MEMORY_TIME", "SHAKE"):
        assert js["config"][key] == DEFAULT_CONFIG[key], key
    assert js["config"]["FLOW"] == pytest.approx(DEFAULT_CONFIG["FLOW"])
