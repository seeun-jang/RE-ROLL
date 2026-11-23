"""줄 물리, 팀 배정, 점수판, 힘 계산 — 원본 JS(systems/*.js)를 그대로 옮긴 것.

화면 연출(줄 튕김 등)은 브라우저 몫이라 여기에는 없다.
"""

from __future__ import annotations

import math
from itertools import combinations
from typing import Callable

# 승리 선 너머로 줄이 더 갈 수 있는 여유(px)
POS_OVERSHOOT = 16


# ---------------------------------------------------------------------------
# 줄
# ---------------------------------------------------------------------------
class Rope:
    """pos: px, 0 = 중앙. 음수 = 왼쪽(빨강) 팀 쪽으로 끌려옴."""

    def __init__(self, config: dict):
        self.config = config
        self.win_distance = float(config["WIN_DISTANCE"])
        self.reset()

    def reset(self) -> None:
        self.pos = 0.0
        self.vel = 0.0
        self.left_force = 0.0
        self.right_force = 0.0

    def add_force(self, side: str, amount: float) -> None:
        if not math.isfinite(amount):
            return
        if side == "left":
            self.left_force += amount
        elif side == "right":
            self.right_force += amount

    def update(self, dt: float) -> None:
        cfg = self.config
        decay = math.exp(-cfg["FORCE_DECAY"] * dt)
        self.left_force *= decay
        self.right_force *= decay
        raw = (self.right_force - self.left_force) * cfg["ROPE_SPEED"]
        mx = cfg["ROPE_MAX_SPEED"]
        self.vel = mx if raw > mx else (-mx if raw < -mx else raw)
        limit = self.win_distance + POS_OVERSHOOT
        self.pos += self.vel * dt
        if self.pos > limit:
            self.pos = limit
        if self.pos < -limit:
            self.pos = -limit

    def winner(self) -> str | None:
        if self.pos <= -self.win_distance:
            return "left"
        if self.pos >= self.win_distance:
            return "right"
        return None

    def leader(self) -> str | None:
        """시간 종료 때 우세한 팀. DRAW_EPSILON 안이면 무승부(None)."""
        eps = self.config["DRAW_EPSILON"]
        if self.pos < -eps:
            return "left"
        if self.pos > eps:
            return "right"
        return None


# ---------------------------------------------------------------------------
# 힘
# ---------------------------------------------------------------------------
def compute_power(grade: str, config: dict, team_multiplier: float = 1.0, fever: bool = False) -> float:
    """판정 등급 → 줄에 더할 힘. 피버 배율은 박자에 맞춘 입력(Perfect/Good)에만."""
    base = config["POWER"].get(grade, 0)
    fever_mult = config["FEVER_POWER_MULT"] if fever and grade in ("perfect", "good") else 1
    return base * team_multiplier * fever_mult


def team_multipliers(n_left: int, n_right: int, config: dict) -> dict:
    """인원이 적은 팀의 힘 보정 배율 {"left": x, "right": y}."""
    setting = config.get("SMALL_TEAM_MULT", "ratio")

    def mult(small: int, big: int) -> float:
        if small <= 0 or small >= big:
            return 1.0
        if setting == "ratio":
            return big / small
        return float(setting)

    return {"left": mult(n_left, n_right), "right": mult(n_right, n_left)}


# ---------------------------------------------------------------------------
# 팀 배정
# ---------------------------------------------------------------------------
def _pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _split_key(group_a: list[str], group_b: list[str]) -> str:
    a = "|".join(sorted(group_a))
    b = "|".join(sorted(group_b))
    return f"{a}#{b}" if a < b else f"{b}#{a}"


class TeamAssigner:
    """라운드마다 팀을 나눈다. 같은 사람끼리 계속 같은 팀이 되지 않게 비용을 매긴다.

    인원 n 명을 floor(n/2) : 나머지로 나눈다 (2명 1:1, 3명 1:2, 4명 2:2, 5명 2:3).
    rng: 0 이상 1 미만 난수를 돌려주는 함수.
    """

    def __init__(self, player_ids: list[str], rng: Callable[[], float]):
        self.player_ids = list(player_ids)
        self.rng = rng
        self.reset()

    def reset(self) -> None:
        self.history: list[dict] = []
        self.pair_counts: dict[tuple[str, str], int] = {}
        self.small_counts: dict[str, int] = {}
        self.last_key: str | None = None

    def _pair_cost(self, group: list[str]) -> int:
        cost = 0
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                c = self.pair_counts.get(_pair_key(group[i], group[j]), 0)
                cost += c + c * c
        return cost

    def _small_cost(self, small_ids: list[str]) -> int:
        cost = 0
        for pid in small_ids:
            s = self.small_counts.get(pid, 0)
            cost += s + s * s
        return cost

    def next(self) -> dict:
        ids = self.player_ids
        n = len(ids)
        small = n // 2

        candidates = []
        seen = set()
        for combo in combinations(range(n), small):
            in_small = set(combo)
            small_ids = [ids[i] for i in combo]
            big_ids = [pid for i, pid in enumerate(ids) if i not in in_small]
            key = _split_key(small_ids, big_ids)
            if key in seen:
                continue
            seen.add(key)
            is_small = len(small_ids) < len(big_ids)
            cost = self._pair_cost(small_ids) + self._pair_cost(big_ids) + (self._small_cost(small_ids) if is_small else 0)
            candidates.append({"small": small_ids, "big": big_ids, "key": key, "cost": cost})

        filtered = [c for c in candidates if c["key"] != self.last_key]
        pool = filtered or candidates
        min_cost = min(c["cost"] for c in pool)
        best = [c for c in pool if c["cost"] == min_cost]
        pick = best[min(len(best) - 1, math.floor(self.rng() * len(best)))]

        small_left = self.rng() < 0.5
        split = (
            {"left": list(pick["small"]), "right": list(pick["big"])}
            if small_left
            else {"left": list(pick["big"]), "right": list(pick["small"])}
        )

        for group in (pick["small"], pick["big"]):
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    k = _pair_key(group[i], group[j])
                    self.pair_counts[k] = self.pair_counts.get(k, 0) + 1
        if len(pick["small"]) < len(pick["big"]):
            for pid in pick["small"]:
                self.small_counts[pid] = self.small_counts.get(pid, 0) + 1
        self.last_key = pick["key"]
        self.history.append({"left": list(split["left"]), "right": list(split["right"])})
        return split


# ---------------------------------------------------------------------------
# 점수판
# ---------------------------------------------------------------------------
def _empty_stats() -> dict:
    return {
        "total": 0, "round": 0, "combo": 0, "maxCombo": 0,
        "perfect": 0, "good": 0, "miss": 0, "spam": 0,
        "roundWins": 0, "power": 0.0, "roundScores": [],
    }


def _apply_points(s: dict, points: int) -> int:
    """누적·라운드 점수가 0 아래로 내려가지 않게 같은 변화량을 적용한다."""
    delta = max(points, -s["round"], -s["total"])
    s["total"] += delta
    s["round"] += delta
    return delta


def _js_round(x: float) -> int:
    """JS Math.round 와 같은 반올림(0.5 는 위로)."""
    return math.floor(x + 0.5)


class ScoreBoard:
    def __init__(self, player_ids: list[str], config: dict):
        self.player_ids = list(player_ids)
        self.config = config
        self.reset()

    def reset(self) -> None:
        self.stats: dict[str, dict] = {pid: _empty_stats() for pid in self.player_ids}
        self.history: list[dict] = []
        self.current_round = 0

    def start_round(self, round_no: int) -> None:
        self.current_round = round_no
        for s in self.stats.values():
            s["round"] = 0
            s["combo"] = 0

    def record(self, player_id: str, grade: str, fever: bool = False) -> dict:
        sc = self.config["SCORE"]
        s = self.stats[player_id]
        if grade in ("perfect", "good"):
            s["combo"] += 1
            s["maxCombo"] = max(s["maxCombo"], s["combo"])
            base = sc[grade] * (self.config["FEVER_SCORE_MULT"] if fever else 1)
            points = base + min(s["combo"], sc["comboCap"]) * sc["comboStep"]
            s[grade] += 1
        elif grade == "spam":
            s["combo"] = 0
            points = sc.get("spam", 0)
            s["spam"] += 1
        else:
            s["combo"] = 0
            points = sc.get("miss", 0)
            s["miss"] += 1
        points = _js_round(points)
        _apply_points(s, points)
        return {"points": points, "combo": s["combo"]}

    def add_power(self, player_id: str, amount: float) -> None:
        if math.isfinite(amount):
            self.stats[player_id]["power"] += amount

    def end_round(self, round_no: int, winner_side: str | None, left_ids: list[str], right_ids: list[str]) -> dict:
        sc = self.config["SCORE"]
        bonus = {pid: 0 for pid in self.player_ids}
        if winner_side in ("left", "right"):
            for pid in left_ids if winner_side == "left" else right_ids:
                bonus[pid] = sc["roundWin"]
                self.stats[pid]["roundWins"] += 1
        else:
            winner_side = None
            for pid in self.player_ids:
                bonus[pid] = sc["roundDraw"]

        idx = max(0, round_no - 1)
        round_scores = {}
        for pid in self.player_ids:
            s = self.stats[pid]
            _apply_points(s, bonus[pid])
            while len(s["roundScores"]) < idx:
                s["roundScores"].append(0)
            if len(s["roundScores"]) == idx:
                s["roundScores"].append(s["round"])
            else:
                s["roundScores"][idx] = s["round"]
            round_scores[pid] = s["round"]

        entry = {
            "round": round_no, "winnerSide": winner_side,
            "left": list(left_ids), "right": list(right_ids),
            "roundScores": dict(round_scores), "bonus": dict(bonus),
        }
        self.history.append(entry)
        return entry

    def snapshot(self) -> dict:
        return {pid: {**s, "roundScores": list(s["roundScores"])} for pid, s in self.stats.items()}

    def results(self, players: list[dict]) -> list[dict]:
        """공통 결과 형식 [{playerId, name, score, rank, isWinner, stats}] — 점수 내림차순."""
        rows = []
        for order, p in enumerate(players):
            s = self.stats[p["id"]]
            rows.append({
                "playerId": p["id"], "name": p["name"], "score": s["total"], "rank": 0, "isWinner": False,
                "_order": order,
                "stats": {
                    "perfect": s["perfect"], "good": s["good"], "miss": s["miss"], "spam": s["spam"],
                    "maxCombo": s["maxCombo"], "roundWins": s["roundWins"], "power": s["power"],
                    "roundScores": list(s["roundScores"]),
                },
            })
        rows.sort(key=lambda r: (-r["score"], r["_order"]))
        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and r["score"] == rows[i - 1]["score"] else i + 1
        top = rows[0]["score"] if rows else 0
        for r in rows:
            r["isWinner"] = r["score"] == top
            del r["_order"]
        return rows
