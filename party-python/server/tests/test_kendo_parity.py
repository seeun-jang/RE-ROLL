"""검도: 서버 판정(Python)과 시험용 진행기(JS KendoSim, 원본 선수·판정 코드 사용)가 같은 입력에 같은 결과를 내는지,
그리고 서버의 수치가 원본 설정과 같은지 비교한다. Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.kendo.config import DEFAULT_CONFIG
from party.games.kendo.game import KendoGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "kendo-replay.mjs"
FAST = {"MATCH": {"TIME_SEC": 25}, "FLOW": {"PRACTICE_TIME": 0.5, "INTRO_TIME": 0.5, "END_HOLD": 0.3, "RESULT_TIME": 0.5, "FINAL_TIME": 0.5}}

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def node(args, stdin=None):
    proc = subprocess.run(["node", str(REPLAY), *args], input=stdin, capture_output=True, text=True,
                          cwd=str(WEB_DIR), timeout=300)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def assert_subset(py, js, path="config"):
    """서버 설정의 모든 값이 원본 설정에 같은 값으로 있는지."""
    if isinstance(py, dict):
        assert isinstance(js, dict), path
        for k, v in py.items():
            assert k in js, f"{path}.{k} 가 원본에 없음"
            assert_subset(v, js[k], f"{path}.{k}")
    elif isinstance(py, list):
        assert isinstance(js, list) and len(py) == len(js), path
        for i, (a, b) in enumerate(zip(py, js)):
            assert_subset(a, b, f"{path}[{i}]")
    else:
        assert_close(py, js, path)


def test_server_numbers_match_the_original_config():
    js = node(["--config"])
    for key, value in DEFAULT_CONFIG.items():
        if key in ("MATCH", "FLOW"):
            assert_close(js["party"][key], value, key)      # 파티용 값
        else:
            assert_subset(value, js["original"][key], key)   # 원본 값


def build_script(n_players: int, seed: int) -> dict:
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    now = 300.0
    ops: list = [["start", now]]
    dt = 1.0 / 30.0
    held = {p["id"]: 0 for p in players}
    for i in range(1, int(260 / dt)):
        t = now + i * dt
        for p in players:
            if r.random() < 0.2:
                h = held[p["id"]]
                # 서로 다가가거나 물러나고, 기합을 모으고, 가끔 막는다
                h = (h & ~3) | r.choice([0, 1, 2, 2, 1, 0])
                h = (h & ~4) | (4 if r.random() < 0.7 else 0)
                h = (h & ~8) | (8 if r.random() < 0.12 else 0)
                held[p["id"]] = h
                press = []
                if r.random() < 0.3:
                    press.append(r.choice(["men", "kote", "do"]))
                if r.random() < 0.08:
                    press.append("block")
                if r.random() < 0.15:
                    press.append("kiai")
                ops.append(["input", p["id"], {"k": "in", "held": h, "press": press}, round(t - r.uniform(0, 0.03), 4)])
        ops.append(["tick", t])
    return {"players": players, "config": FAST, "rng": [r.random() for _ in range(997)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = KendoGame(script["players"], {"config": script["config"]}, rng)
    trace, events = [], []
    for op in script["ops"]:
        if op[0] == "start":
            game.start(op[1])
        elif op[0] == "tick":
            game.tick(op[1])
        else:
            game.on_input(op[1], op[2], op[3])
        for _to, kind, data in game.drain():
            (events if kind == "event" else trace).append(data)
    return {"trace": trace, "events": events, "finished": game.finished, "results": game.results}


@pytest.mark.parametrize("n_players,seed", [(2, 51), (3, 52), (4, 53), (5, 54), (5, 99)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    js = node([], json.dumps(script))
    assert py["finished"] and js["finished"]
    assert len(py["events"]) > 50
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")


def test_scripts_cover_the_interesting_cases():
    kinds = set()
    for n, seed in [(2, 51), (3, 52), (4, 53), (5, 54), (5, 99)]:
        py = run_python(build_script(n, seed))
        for e in py["events"]:
            kinds.add((e["type"], e.get("kind"), e.get("ippon")))
    assert {("strike", "whiff", None), ("strike", "contact", None), ("strike", "blocked", None), ("strike", "deflected", None),
            ("judge", None, False), ("hajime", None, None), ("end", None, None), ("stun", None, None)} <= kinds
    print(sorted(k for k in kinds if k[0] not in ("kiai", "step")))
