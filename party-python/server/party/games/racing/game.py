"""레이싱 (서버 판정) — 모두 같은 트랙을 동시에 달려 3바퀴를 먼저 도는 순서로 순위를 정한다.

- 차는 참가자마다 한 대, 서버가 60분의 1초 단위로 움직인다(track.step_car). 브라우저는 조향·가속·드리프트 값만 보낸다.
- 차끼리는 부딪히지 않고 겹쳐 지나간다. AI 차는 없다.
- 잔디는 보이지 않는 벽이다(도로 밖으로 나갈 수 없다).
- 1등이 3바퀴를 돌면 그때부터 FINISH_GRACE(30초) 동안 나머지도 계속 달린다.
  그 안에 못 들어온 사람은 달린 거리 순으로 뒤 순위를 받는다.
- 점수는 순위별로 다르게 준다(RANK_SCORES).

브라우저 → 서버 (game.input 의 data)
    {"k": "in", "steer": -1~1, "throttle": -1~1, "drift": 0~1}     바뀔 때마다(초당 20번까지)
"""

from __future__ import annotations

import math

from ...minigame import MiniGame
from .config import LOGIC_FPS, merge_config
from .track import build_track, new_car, r2, r3, step_car


def _num(v, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return 0.0
    return max(lo, min(hi, float(v)))


class RacingGame(MiniGame):
    id = "racing"
    title = "레이싱"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R = self.cfg["RULES"]
        self.laps = int(self.R["LAPS"])
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.track = build_track(self.cfg)
        self.cars = {pid: new_car(self.cfg, self.track, i, len(self.ids)) for i, pid in enumerate(self.ids)}
        for car in self.cars.values():
            car["laps"] = 0
        self.phase = "idle"
        self.start_at = 0.0
        self.frame = 0
        self.deadline: float | None = None      # 이 경기 시각(초)이 지나면 끝
        self.finish_count = 0
        self.end_frame: int | None = None
        self.final_results: list[dict] = []
        self._final_at = 0.0
        self._last_phase = None
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        t = self.track
        return {
            "laps": self.laps, "countdown": self.R["COUNTDOWN"], "intro": self.R["INTRO_TIME"],
            "grace": self.R["FINISH_GRACE"], "scores": list(self.R["RANK_SCORES"]),
            "world": dict(self.cfg["WORLD"]),
            "track": {"x": t["x"], "y": t["y"], "half": t["half"], "limit": t["limit"]},
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.R["INTRO_TIME"] + self.R["COUNTDOWN"]
        self.phase = "intro"
        self._emit(now, force=True)

    def gt(self, now: float) -> float:
        return now - self.start_at

    def _advance(self, now: float) -> None:
        if self.phase != "race":
            return
        dt = 1 / LOGIC_FPS
        n = self.track["n"]
        target = math.floor(self.gt(now) * LOGIC_FPS + 1e-6)
        while self.frame < target and self.phase == "race":
            self.frame += 1
            t = self.frame / LOGIC_FPS
            for pid in self.ids:
                car = self.cars[pid]
                step_car(car, self.cfg, self.track, dt)
                if car["hit"] > self.cfg["CAR"]["WALL_EVENT_SPEED"]:
                    self.send_event({"type": "wall", "playerId": pid, "speed": r2(car["hit"])})
                if car["finished"]:
                    continue
                done = math.floor(car["total"] / n)
                if done > car["laps"]:
                    car["laps"] = done
                    lap_time = t - car["lapStart"]
                    car["lapStart"] = t
                    car["lapTimes"].append(r2(lap_time))
                    self.send_event({"type": "lap", "playerId": pid, "lap": done, "time": r2(lap_time)})
                    if done >= self.laps:
                        car["finished"] = True
                        car["finishTime"] = r2(t)
                        car["steer"] = car["throttle"] = car["drift"] = 0.0     # 들어온 차는 저절로 선다
                        self.finish_count += 1
                        car["place"] = self.finish_count
                        if self.deadline is None:
                            self.deadline = t + self.R["FINISH_GRACE"]
                        self.send_event({"type": "finish", "playerId": pid, "place": self.finish_count, "time": r2(t)})
            over = (self.finish_count == len(self.ids) or (self.deadline is not None and t >= self.deadline)
                    or t >= self.R["MAX_TIME"])
            if over:
                self.phase = "ending"
                self.end_frame = self.frame

    def tick(self, now: float) -> None:
        gt = self.gt(now)
        if self.phase == "intro" and gt >= -self.R["COUNTDOWN"]:
            self.phase = "countdown"
        if self.phase == "countdown" and gt >= 0:
            self.phase = "race"
        self._advance(now)
        if self.phase == "ending" and gt >= self.end_frame / LOGIC_FPS + self.R["END_DELAY"]:
            self.final_results = self.build_results()
            self.phase = "final"
            self._final_at = now
        if self.phase == "final" and now >= self._final_at + self.R["FINAL_TIME"]:
            self.phase = "done"
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        car = self.cars.get(player_id)
        if car is None or not isinstance(data, dict) or data.get("k") != "in":
            return
        self._advance(now)
        if self.phase != "race" or car["finished"]:
            return
        car["steer"] = _num(data.get("steer"), -1.0, 1.0)
        car["throttle"] = _num(data.get("throttle"), -1.0, 1.0)
        car["drift"] = _num(data.get("drift"), 0.0, 1.0)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        car = self.cars.get(player_id)
        if car is not None and not connected:
            car["steer"] = car["throttle"] = car["drift"] = 0.0

    # ------------------------------------------------------------------
    def order(self) -> list[str]:
        """지금 순위: 들어온 사람(들어온 순) → 나머지는 달린 거리 순."""
        idx = {pid: i for i, pid in enumerate(self.ids)}

        def key(pid):
            car = self.cars[pid]
            if car["finished"]:
                return (0, car["place"], 0.0, idx[pid])
            return (1, 0, -car["total"], idx[pid])

        return sorted(self.ids, key=key)

    def build_results(self) -> list[dict]:
        scores = self.R["RANK_SCORES"]
        n = self.track["n"]
        rows = []
        prev = None
        for i, pid in enumerate(self.order()):
            car = self.cars[pid]
            # 같은 순위: 둘 다 못 들어왔고 달린 거리가 같을 때만
            same = (prev is not None and not car["finished"] and not self.cars[prev["playerId"]]["finished"]
                    and r3(car["total"]) == r3(self.cars[prev["playerId"]]["total"]))
            rank = prev["rank"] if same else i + 1
            row = {
                "playerId": pid, "name": self.names[pid], "score": scores[rank - 1] if rank - 1 < len(scores) else 0,
                "rank": rank, "isWinner": rank == 1,
                "stats": {
                    "finished": car["finished"], "time": car["finishTime"],
                    "laps": min(self.laps, max(0, car["laps"])),
                    "progress": r2(max(0.0, min(float(self.laps), car["total"] / n))),
                    "bestLap": min(car["lapTimes"]) if car["lapTimes"] else None,
                },
            }
            rows.append(row)
            prev = row
        return rows

    def snapshot(self, now: float) -> dict:
        n = self.track["n"]
        order = self.order()
        place = {pid: i + 1 for i, pid in enumerate(order)}
        cars = {}
        for pid in self.ids:
            c = self.cars[pid]
            cars[pid] = [r2(c["x"]), r2(c["y"]), r3(c["a"]), r2(c["vx"]), r2(c["vy"]), 1 if c["drifting"] else 0,
                         min(self.laps, max(0, c["laps"]) + 1), r3(c["total"] / n), place[pid],
                         1 if c["finished"] else 0, c["finishTime"]]
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "frame": self.frame, "laps": self.laps,
            "deadline": self.deadline, "cars": cars, "order": order,
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    def _emit(self, now: float, force: bool = False) -> None:
        changed = self.phase != self._last_phase
        live = self.phase in ("race", "ending")
        if force or changed or live or now - self._last_state_at >= 1.0:
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = self.phase
            self._last_state_at = now
            self.send_state(self.snapshot(now))
