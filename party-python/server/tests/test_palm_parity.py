"""손바닥 밀치기: 서버 판정(Python)과 원본 JS 로직(PalmSim)이 같은 입력에 같은 결과를 내는지 비교한다.

PalmSim 은 원본 게임의 Fighter/Combat/Match 코드를 그대로 쓰므로,
이 테스트가 통과하면 Python 으로 옮긴 판정이 원본과 같게 동작한다는 뜻이다. Node.js 가 없으면 건너뛴다.
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.palm.game import PalmGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "palm-replay.mjs"
# 경기를 짧게 해서 여러 판을 빨리 돌린다
FAST = {"MATCH": {"TIME_LIMIT": 12, "WOBBLE_START": 4}, "FLOW": {"INTRO_TIME": 0.5, "END_HOLD": 1.0, "RESULT_TIME": 0.5, "FINAL_TIME": 0.5}}


def build_script(n_players: int, seed: int) -> dict:
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    now = 500.0
    ops: list = [["start", now]]
    dt = 1.0 / 30.0
    state = {p["id"]: {"lean": 0, "push": False, "hold": False, "until": 0} for p in players}
    for i in range(1, int(140 / dt)):
        t = now + i * dt
        for p in players:
            st = state[p["id"]]
            changed = False
            feint = False
            if i >= st["until"] and (st["push"] or st["hold"]):
                st["push"] = st["hold"] = False
                changed = True
            roll = r.random()
            if roll < 0.035:
                st["push"], st["until"], changed = True, i + r.choice([1, 2, 12, 30, 60]), True
            elif roll < 0.05:
                st["hold"], st["until"], changed = True, i + r.choice([6, 20, 80]), True
            elif roll < 0.065:
                feint = True
            elif roll < 0.10:
                st["lean"], changed = r.choice([-1, 0, 1]), True
            if changed or feint:
                data = {"k": "in", "lean": st["lean"], "push": st["push"], "hold": st["hold"]}
                if feint:
                    data["feint"] = True
                ops.append(["input", p["id"], data, t])
        ops.append(["tick", t])
    return {"players": players, "config": FAST, "rng": [r.random() for _ in range(32)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = PalmGame(script["players"], {"config": script["config"]}, rng)
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


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")
@pytest.mark.parametrize("n_players,seed", [(2, 11), (3, 12), (4, 13), (5, 14), (5, 77)])
def test_python_and_original_js_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    proc = subprocess.run(
        ["node", str(REPLAY)], input=json.dumps(script), capture_output=True, text=True, cwd=str(WEB_DIR), timeout=180,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    js = json.loads(proc.stdout)

    assert py["finished"] and js["finished"]
    kinds = {e["type"] for e in py["events"]}
    # 여러 종류의 상황이 실제로 일어났는지 (비교가 의미 있도록)
    assert {"hit", "matchEnd", "feint", "holdStart"} <= kinds
    assert_close([e for e in py["events"]], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
