"""가든 디펜스 (서버 판정) — 120초 동안 각자 자기 정원에서 "같은 좀비 떼"를 총으로 막아 점수를 겨룬다.

- 시작할 때 좀비가 나올 시각·레인·종류를 전부 정한다(world.build_spawns) → 모두에게 같다.
- 참가자마다 정원(World)을 하나씩 서버가 60분의 1초 단위로 진행한다. 브라우저는 "있는 레인 / 쏘는 중" 만 보낸다.
- 사격만 남겼다: 포탑·무기 해금·아이템·코인·하트(라이프)는 없다. 무기는 권총(탄약 무한).
- 좀비를 잡으면 점수(연속 처치 콤보로 최대 4배), 좀비가 집에 닿으면 감점(탈락 없음).
- 웨이브 6개가 정해진 시각에 시작하고, 뒤로 갈수록 많고 빠르다. 마지막 웨이브에는 보스가 나온다.
- 120초 뒤 점수가 높은 순으로 순위.

브라우저 → 서버 (game.input 의 data)
    {"k": "in", "lane": 0~4, "fire": true/false}     바뀔 때마다 보낸다
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from .config import merge_config
from .world import World, build_boss_dirs, build_spawns


class GardenGame(MiniGame):
    id = "garden"
    title = "가든 디펜스"
    min_players = 2
    max_players = 5
    tick_hz = 20

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R, self.N = self.cfg["RULES"], self.cfg["NET"]
        self.duration = float(self.R["DURATION"])
        self.fps = self.cfg["BASE"]["LOGIC_FPS"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.spawns = build_spawns(rng, self.cfg)
        self.boss_dirs = build_boss_dirs(rng)
        self.worlds = {pid: World(self.cfg, self.spawns, self.boss_dirs) for pid in self.ids}
        self.phase = "idle"
        self.start_at = 0.0
        self.final_results: list[dict] = []
        self._final_at = 0.0
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        return {
            "duration": self.duration, "countdown": self.R["COUNTDOWN"], "intro": self.R["INTRO_TIME"],
            "waves": [{"name": w["name"], "start": w["start"], "boss": w["boss"]} for w in self.cfg["WAVES"]],
            "total": len(self.spawns), "penalty": self.cfg["SCORE"]["BREACH_PENALTY"],
            "fireRate": self.cfg["GUN"]["FIRE_RATE"], "bulletSpeed": self.cfg["GUN"]["BULLET_SPEED"],
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.R["INTRO_TIME"] + self.R["COUNTDOWN"]
        self.phase = "intro"
        self._emit(now, force=True)

    def gt(self, now: float) -> float:
        return now - self.start_at

    def _advance(self, now: float) -> None:
        """모든 정원을 지금 시각까지 진행한다."""
        if self.phase not in ("play", "timeup"):
            return
        target = min(int(self.duration * self.fps), math.floor(self.gt(now) * self.fps + 1e-6))
        for pid in self.ids:
            w = self.worlds[pid]
            while w.frame < target:
                w.step()
            for e in w.events:
                self.send_event(e, to=pid)
            w.events = []

    def tick(self, now: float) -> None:
        gt = self.gt(now)
        before = self.phase
        if self.phase == "intro" and gt >= -self.R["COUNTDOWN"]:
            self.phase = "countdown"
        if self.phase == "countdown" and gt >= 0:
            self.phase = "play"
        self._advance(now)
        if self.phase == "play" and gt >= self.duration:
            self.phase = "timeup"
        if self.phase == "timeup" and gt >= self.duration + self.R["END_DELAY"]:
            self.final_results = self.build_results()
            self.phase = "final"
            self._final_at = now
        if self.phase == "final" and now >= self._final_at + self.R["FINAL_TIME"]:
            self.phase = "done"
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        w = self.worlds.get(player_id)
        if w is None or not isinstance(data, dict) or data.get("k") != "in":
            return
        self._advance(now)      # 입력이 들어온 시각까지 진행한 뒤 반영한다
        w.set_input(data.get("lane"), data.get("fire") is True)

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        return rank_results([
            {"playerId": pid, "name": self.names[pid], "score": self.worlds[pid].score, "stats": self.worlds[pid].stats()}
            for pid in self.ids
        ])

    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "duration": self.duration,
            "players": {pid: {"score": w.score, "kills": w.kills, "breaches": w.breaches} for pid, w in self.worlds.items()},
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        snap = self.snapshot(now)
        w = self.worlds.get(player_id)
        if w is not None:
            snap["me"] = w.view()
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.N["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            common = self.snapshot(now)
            for pid in self.ids:
                self.send_state({**common, "me": self.worlds[pid].view()}, to=pid)
