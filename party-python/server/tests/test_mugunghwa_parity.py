"""무궁화: 서버 판정(Python)과 시험용 진행기(JS MugunghwaSim)가 같은 입력에 같은 결과를 내는지 비교한다.
Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.mugunghwa.game import MugunghwaGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "mugunghwa-replay.mjs"
FAST = {"FLOW": {"INTRO_TIME": 0.5, "END_HOLD": 1.0, "FINAL_TIME": 0.5}, "RULES": {"COUNTDOWN": 0.5, "TIME_LIMIT": 25, "METERS": 9}}

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def build_script(n_players: int, seed: int) -> dict:
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    tagger = None if seed % 2 else "p2"          # 절반은 서버가 뽑게, 절반은 지정
    now = 50.0
    ops: list = [["start", now]]
    dt = 1.0 / 30.0
    held = {p["id"]: False for p in players}
    for i in range(1, int(40 / dt)):
        t = now + i * dt
        for p in players:
            pid = p["id"]
            roll = r.random()
            if roll < 0.06:                      # 전진 키 / 외치기 키를 누르거나 뗀다 (누가 술래인지 모르고 둘 다 보낸다)
                held[pid] = not held[pid]
                ops.append(["input", pid, {"k": "move", "on": held[pid]}, t])
                ops.append(["input", pid, {"k": "chant", "on": held[pid]}, t])
            elif roll < 0.08:
                ops.append(["input", pid, {"k": "mic", "on": r.random() < 0.5, "lv": round(r.random(), 2)}, t])
        ops.append(["tick", t])
    return {"players": players, "tagger": tagger, "config": FAST, "rng": [r.random() for _ in range(16)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = MugunghwaGame(script["players"], {"config": script["config"], "tagger": script["tagger"]}, rng)
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


@pytest.mark.parametrize("n_players,seed", [(2, 31), (3, 32), (4, 33), (5, 34), (5, 35), (4, 36)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    proc = subprocess.run(["node", str(REPLAY)], input=json.dumps(script), capture_output=True, text=True,
                          cwd=str(WEB_DIR), timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    js = json.loads(proc.stdout)
    assert py["finished"] and js["finished"]
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")


def test_scripts_cover_the_interesting_cases():
    kinds, winners = set(), set()
    for n, seed in [(2, 31), (3, 32), (4, 33), (5, 34), (5, 35), (4, 36)]:
        out = run_python(build_script(n, seed))
        kinds |= {e["type"] for e in out["events"]}
        winners |= {e["result"]["winner"] for e in out["events"] if e["type"] == "end"}
    assert {"chant", "turn", "turnBack", "caught", "end"} <= kinds      # 비교가 의미 있도록
    assert winners == {"runners", "tagger"} or "tagger" in winners
