"""서버 판정(Python)과 시험용 진행기(JS TugSim)가 같은 입력에 같은 결과를 내는지 비교한다.

Node.js 가 없으면 건너뛴다.
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.tug.config import merge_config
from party.games.tug.game import TugGame

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "tug-replay.mjs"


def build_script(n_players: int, seed: int, config: dict | None = None) -> dict:
    """봇들이 박자 근처에서 누르는 한 경기 분량의 조작 목록."""
    r = random.Random(seed)
    cfg = merge_config(config)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    rng_values = [r.random() for _ in range(64)]
    base = 60.0 / cfg["BPM"]
    count_len = max(1, math.floor(cfg["COUNTDOWN"] / base + 0.5)) * base
    # 장면 시간을 알아야 입력 시각을 만들 수 있으므로, 넉넉한 길이로 tick 과 입력을 섞는다
    now = 1000.0
    ops: list = [["start", now]]
    dt = 1.0 / 30.0
    total = cfg["ROUNDS"] * (cfg["ASSIGN_TIME"] + count_len + cfg["ROUND_TIME"] + cfg["END_HOLD"] + cfg["ROUND_RESULT_TIME"])
    total += cfg["SUMMARY_TIME"] + cfg["FINAL_TIME"] + 2.0
    steps = int(total / dt)
    for i in range(1, steps + 1):
        t = now + i * dt
        for p in players:
            # 대략 0.5초에 한 번, 시각을 조금 흔들어 누른다(가끔 연타, 가끔 엉뚱한 시각)
            if r.random() < dt / 0.5:
                kind = r.random()
                if kind < 0.75:
                    ops.append(["input", p["id"], {"k": "pull", "t": None}, t])       # 시각 없음 → 서버 시각
                elif kind < 0.95:
                    ops.append(["input", p["id"], {"k": "pull", "t": "REL", "lag": round(r.random() * 0.2, 4)}, t])
                else:
                    ops.append(["input", p["id"], {"k": "pull", "t": 12345.6}, t])    # 말이 안 되는 시각
        ops.append(["tick", t])
    return {"players": players, "config": config or {}, "rng": rng_values, "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = TugGame(script["players"], {"config": script["config"]}, rng)
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


def resolve_relative_times(script: dict) -> None:
    """'REL' 로 표시한 입력 시각을 '그 순간의 라운드 시각 - lag' 으로 바꾼다(양쪽에 같은 값을 주기 위해)."""
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    probe = TugGame(script["players"], {"config": script["config"]}, rng)
    for op in script["ops"]:
        if op[0] == "start":
            probe.start(op[1])
        elif op[0] == "tick":
            probe.tick(op[1])
        else:
            data = op[2]
            if data.get("t") == "REL":
                probe.match.advance(op[3])
                data["t"] = (op[3] - probe.match.start_at) - data.pop("lag")
            probe.on_input(op[1], data, op[3])
        probe.drain()


def assert_close(a, b, path="root"):
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None, f"{path}: {a!r} != {b!r}"
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9), f"{path}: {a!r} != {b!r}"
    elif isinstance(a, dict):
        assert isinstance(b, dict) and set(a) == set(b), f"{path}: 키가 다름 {sorted(a)} / {sorted(b) if isinstance(b, dict) else b}"
        for k in a:
            assert_close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{path}: 길이 {len(a)} != {len(b) if isinstance(b, list) else b}"
        for i, (x, y) in enumerate(zip(a, b)):
            assert_close(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")
@pytest.mark.parametrize("n_players,seed", [(2, 1), (3, 2), (4, 3), (5, 4), (5, 99)])
def test_python_and_js_agree(n_players, seed):
    script = build_script(n_players, seed)
    resolve_relative_times(script)
    py = run_python(script)
    proc = subprocess.run(
        ["node", str(REPLAY)], input=json.dumps(script), capture_output=True, text=True, cwd=str(WEB_DIR), timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    js = json.loads(proc.stdout)

    assert py["finished"] and js["finished"]
    assert len(py["events"]) > 20
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
