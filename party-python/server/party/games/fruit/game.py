"""과일자르기 (서버 판정) — 60초 동안 각자 화면에 올라오는 "같은 과일"을 베어 점수를 겨룬다.

- 시작할 때 던질 물체를 전부 정해(schedule.py) 모두에게 같은 목록을 보낸다.
- 브라우저는 칼이 지나간 선분(시각·좌표)을 보내고, 서버가 그 시각의 물체 위치로 베었는지 판정한다.
  (브라우저는 화면 반응을 위해 같은 식으로 미리 베는 모습을 보여 주지만 점수는 서버가 정한다.)
- 과일 10~20점, 3개 이상 연속으로 베면 콤보 보너스(개수 × 5).
- 폭탄을 베면 20점 감점(탈락 없음, 0점 아래로는 내려가지 않음), 콤보 끊김.
- 황금 별과일: 8초 동안 점수 2배. 프리즘 베리: 6초 동안 그 사람에게만 과일이 3배로 나온다.
- 60초 뒤 점수가 높은 순으로 순위.

브라우저 → 서버 (game.input 의 data)
    {"k": "cut", "segs": [[t0, x0, y0, t1, x1, y1], ...]}     t 는 게임 시작 뒤 초
"""

from __future__ import annotations

import bisect
import math

from ...minigame import MiniGame, rank_results
from .config import merge_config
from .schedule import build_schedule, dist_to_segment, pos_at


class FruitGame(MiniGame):
    id = "fruit"
    title = "과일자르기"
    min_players = 2
    max_players = 5
    tick_hz = 20

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R, self.SC, self.N, self.IT = self.cfg["RULES"], self.cfg["SCORE"], self.cfg["NET"], self.cfg["ITEMS"]
        self.duration = float(self.R["DURATION"])
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.points = {f["id"]: f["points"] for f in self.cfg["FRUITS"]}
        self.objects = build_schedule(rng, self.cfg)
        self.by_id = {o["id"]: o for o in self.objects}
        # 시각 순으로 찾기 위한 목록(mode 0·1). mode 2 는 벤 사람별로 따로 만든다.
        self._timed = sorted((o for o in self.objects if o["mode"] != 2), key=lambda o: (o["t"], o["id"]))
        self._times = [o["t"] for o in self._timed]
        self._max_life = max((o["life"] for o in self.objects), default=0.0)
        self._bursts: dict[int, list[dict]] = {}
        for o in self.objects:
            if o["mode"] == 2:
                self._bursts.setdefault(o["group"], []).append(o)
        self.P = {
            pid: {
                "score": 0, "sliced": 0, "bombs": 0, "items": 0, "combo": 0, "comboExpire": 0.0, "maxCombo": 0,
                "doubleFrom": -1.0, "doubleUntil": -1.0, "triples": [], "bursts": {}, "cut": set(), "extra": [],
            }
            for pid in self.ids
        }
        self.phase = "idle"
        self.start_at = 0.0       # 과일이 나오기 시작하는 서버 시각
        self.final_results: list[dict] = []
        self._final_at = 0.0
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        keys = ("id", "kind", "def", "t", "x", "vx", "vy", "r", "life", "mode", "group")
        return {
            "duration": self.duration,
            "countdown": self.R["COUNTDOWN"],
            "intro": self.R["INTRO_TIME"],
            "endDelay": self.R["END_DELAY"],
            "objects": [[o[k] for k in keys] for o in self.objects],
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.R["INTRO_TIME"] + self.R["COUNTDOWN"]
        self.phase = "intro"
        self._emit(now, force=True)

    def gt(self, now: float) -> float:
        """게임 시각: 과일이 나오기 시작한 뒤 흐른 초."""
        return now - self.start_at

    def tick(self, now: float) -> None:
        gt = self.gt(now)
        before = self.phase
        if self.phase == "intro" and gt >= -self.R["COUNTDOWN"]:
            self.phase = "countdown"
        if self.phase == "countdown" and gt >= 0:
            self.phase = "play"
        if self.phase in ("play", "timeup"):
            for pid in self.ids:
                self._settle_combo(pid, gt - self.N["MAX_LAG"])
        if self.phase == "play" and gt >= self.duration:
            self.phase = "timeup"
        if self.phase == "timeup" and gt >= self.duration + self.R["END_DELAY"]:
            for pid in self.ids:
                self._settle_combo(pid, math.inf)
            self.final_results = self.build_results()
            self.phase = "final"
            self._final_at = now
        if self.phase == "final" and now >= self._final_at + self.R["FINAL_TIME"]:
            self.phase = "done"
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if player_id not in self.P or not isinstance(data, dict) or data.get("k") != "cut":
            return
        if self.phase not in ("play", "timeup"):
            return
        segs = data.get("segs")
        if not isinstance(segs, list):
            return
        gt = self.gt(now)
        W, H = self.cfg["VIEW"]["W"], self.cfg["VIEW"]["H"]
        min_speed = self.cfg["BLADE"]["MIN_SLICE_SPEED"]
        for seg in segs[: self.N["MAX_SEGS"]]:
            if not isinstance(seg, list) or len(seg) != 6:
                continue
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in seg):
                continue
            t0, x0, y0, t1, x1, y1 = (float(v) for v in seg)
            x0, x1 = max(-20.0, min(W + 20.0, x0)), max(-20.0, min(W + 20.0, x1))
            y0, y1 = max(-20.0, min(H + 20.0, y0)), max(-20.0, min(H + 20.0, y1))
            dx, dy = x1 - x0, y1 - y0
            speed = math.sqrt(dx * dx + dy * dy) / max(1 / 240, t1 - t0)
            if speed < min_speed:
                continue
            # 판정 시각: 브라우저가 알려 준 시각을 쓰되, 너무 오래됐거나 미래면 서버 시각 쪽으로 당긴다
            t = min(gt, max(gt - self.N["MAX_LAG"], t1))
            if t < 0 or t >= self.duration:
                continue
            self._cut(player_id, t, x0, y0, x1, y1)

    def _visible(self, pid: str, t: float) -> list[dict]:
        """t 시각에 pid 의 화면에 떠 있는(아직 베지 않은) 물체. 번호 순."""
        st = self.P[pid]
        lo = bisect.bisect_left(self._times, t - self._max_life)
        hi = bisect.bisect_right(self._times, t)
        out = []
        for o in self._timed[lo:hi]:
            if o["id"] in st["cut"] or t - o["t"] > o["life"]:
                continue
            if o["mode"] == 1 and not any(a <= o["t"] < b for a, b in st["triples"]):
                continue
            out.append((o, o["t"]))
        for o, t0 in st["extra"]:
            if o["id"] not in st["cut"] and 0 <= t - t0 <= o["life"]:
                out.append((o, t0))
        out.sort(key=lambda e: e[0]["id"])
        return out

    def _cut(self, pid: str, t: float, x0: float, y0: float, x1: float, y1: float) -> None:
        tol = self.N["HIT_TOLERANCE"]
        for o, t0 in self._visible(pid, t):
            x, y = pos_at(o, t - t0, self.cfg)
            if dist_to_segment(x, y, x0, y0, x1, y1) <= o["r"] + tol:
                self._slice(pid, o, t)

    def _slice(self, pid: str, o: dict, t: float) -> None:
        st = self.P[pid]
        st["cut"].add(o["id"])
        pts = 0
        if o["kind"] == "bomb":
            self._settle_combo(pid, t)       # 이미 끝난 콤보는 정산하고,
            st["combo"] = 0                  # 이어지던 콤보는 보너스 없이 끊긴다
            st["bombs"] += 1
            before = st["score"]
            st["score"] = max(0, st["score"] - self.SC["BOMB_PENALTY"])
            pts = st["score"] - before
        elif o["kind"] == "item":
            st["items"] += 1
            pts = self.SC["ITEM_POINTS"]
            st["score"] = min(self.SC["MAX"], st["score"] + pts)
            act = t + self.IT["ACTIVATE_DELAY"]
            if o["def"] == "double":
                st["doubleFrom"], st["doubleUntil"] = act, act + self.IT["DOUBLE_TIME"]
            else:
                st["triples"].append((act, act + self.IT["TRIPLE_TIME"]))
                st["bursts"][o["id"]] = act
                for b in self._bursts.get(o["id"], []):
                    if act + b["t"] < self.duration:
                        st["extra"].append((b, act + b["t"]))
        else:
            self._settle_combo(pid, t)
            pts = self.points[o["def"]] * self._mult(st, t)
            st["score"] = min(self.SC["MAX"], st["score"] + pts)
            st["sliced"] += 1
            st["combo"] += 1
            st["comboExpire"] = t + self.SC["COMBO_WINDOW"]
        self.send_event({"type": "slice", "id": o["id"], "kind": o["kind"], "t": t, "pts": pts, "score": st["score"]}, to=pid)

    def _mult(self, st: dict, t: float) -> int:
        return self.IT["DOUBLE_MULT"] if st["doubleFrom"] <= t < st["doubleUntil"] else 1

    def _settle_combo(self, pid: str, t: float) -> None:
        """콤보 시간이 t 이전에 끝났으면 정산한다. t=inf 는 무조건 정산."""
        st = self.P[pid]
        if st["combo"] <= 0 or t <= st["comboExpire"]:
            return
        n = st["combo"]
        st["combo"] = 0
        if n >= self.SC["COMBO_MIN"]:
            bonus = n * self.SC["COMBO_BONUS_PER_FRUIT"] * self._mult(st, st["comboExpire"])
            st["score"] = min(self.SC["MAX"], st["score"] + bonus)
            st["maxCombo"] = max(st["maxCombo"], n)
            self.send_event({"type": "combo", "n": n, "bonus": bonus, "score": st["score"]}, to=pid)

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        return rank_results([
            {
                "playerId": pid, "name": self.names[pid], "score": self.P[pid]["score"],
                "stats": {k: self.P[pid][k] for k in ("sliced", "bombs", "maxCombo", "items")},
            }
            for pid in self.ids
        ])

    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "duration": self.duration,
            "players": {pid: {k: self.P[pid][k] for k in ("score", "sliced", "bombs", "maxCombo")} for pid in self.ids},
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        """다시 접속한 사람에게: 이미 벤 물체와 아이템 효과까지 알려 준다."""
        snap = self.snapshot(now)
        st = self.P.get(player_id)
        if st:
            snap["me"] = {
                "cut": sorted(st["cut"]), "doubleFrom": st["doubleFrom"], "doubleUntil": st["doubleUntil"],
                "triples": [list(w) for w in st["triples"]], "bursts": {str(k): v for k, v in st["bursts"].items()},
            }
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.N["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            self.send_state(self.snapshot(now))
