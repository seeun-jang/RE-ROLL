"""연주자(플레이어 1명): 판정 · 콤보 · 점수 — 원본 js/performer.js 를 Python 으로 옮긴 것.

- 키를 누른 "시각"(곡 시간)으로 판정한다.
- 롱노트: 머리 판정 + 끝까지 누르고 있으면 꼬리 PERFECT, 일찍 떼면 꼬리 MISS.
- 같은 계산이 web/src/games/groove/performer.js 에 있다(브라우저 예측 · 시험용 진행기).
"""

from __future__ import annotations

import math

from .chart import chart_judge_count
from .config import DEFAULT_CONFIG, grade_of

KINDS = ("perfect", "great", "good", "miss")


def score_of(counts: dict, max_combo: int, total: int, cfg: dict = DEFAULT_CONFIG) -> int:
    """(900000 × 판정 비율 합 + 100000 × 최대 콤보) ÷ 판정 개수, 반올림. 정수로 계산한다."""
    W = cfg["JUDGE_WEIGHT100"]
    w100 = counts["perfect"] * W["perfect"] + counts["great"] * W["great"] + counts["good"] * W["good"]
    part = (cfg["SCORE_MAX"] - cfg["SCORE_COMBO_PART"]) // 100
    return math.floor((part * w100 + cfg["SCORE_COMBO_PART"] * max_combo) / max(1, total) + 0.5)


class Performer:
    def __init__(self, chart: list[dict], cfg: dict = DEFAULT_CONFIG):
        self.cfg = cfg
        self.J = cfg["JUDGE"]
        self.notes = [dict(n, head=None, tail=None, holding=False) for n in chart]
        self.lanes = [[n for n in self.notes if n["lane"] == l] for l in range(3)]
        self.ptr = [0, 0, 0]                 # 레인별 아직 안 친 첫 노트
        self.total = chart_judge_count(chart)
        self.counts = {k: 0 for k in KINDS}
        self.combo = 0
        self.max_combo = 0
        self.judged = 0
        self.key_down = [False, False, False]
        self.hold_note: list[dict | None] = [None, None, None]
        self.fever = False
        #: 방금 일어난 일 — 게임(game.py)이 꺼내 해설 · 사건에 쓴다: ("break", 끊긴 콤보) / ("combo", 콤보 수)
        self.happened: list[tuple[str, int]] = []

    @property
    def score(self) -> int:
        return score_of(self.counts, self.max_combo, self.total, self.cfg)

    @property
    def grade(self) -> str:
        return grade_of(self.score, self.cfg)

    @property
    def live_grade(self) -> str | None:
        """지금까지 친 것만으로 예상한 등급(연주 중 표시용)"""
        if self.judged == 0:
            return None
        return grade_of(score_of(self.counts, self.max_combo, self.judged, self.cfg), self.cfg)

    @property
    def full_combo(self) -> bool:
        return self.counts["miss"] == 0 and self.judged == self.total

    @property
    def all_perfect(self) -> bool:
        return self.counts["perfect"] == self.total

    @property
    def finished(self) -> bool:
        return self.judged >= self.total

    def record(self, kind: str) -> None:
        """판정 기록"""
        self.counts[kind] += 1
        self.judged += 1
        if kind == "miss":
            if self.combo >= 10:
                self.happened.append(("break", self.combo))
            self.combo = 0
        else:
            self.combo += 1
            if self.combo > self.max_combo:
                self.max_combo = self.combo
            self.happened.append(("combo", self.combo))
        self.fever = self.combo >= self.cfg["FEVER_COMBO"]

    def input(self, lane: int, t: float, down: bool) -> None:
        """키 누름/뗌 처리 (t = 곡 시간)"""
        if down:
            self.key_down[lane] = True
            lst = self.lanes[lane]
            n = lst[self.ptr[lane]] if self.ptr[lane] < len(lst) else None
            if n is None or abs(t - n["time"]) > self.J["good"]:
                return                       # 빈 곳을 눌렀다(벌점 없음)
            ad = abs(t - n["time"])
            kind = "perfect" if ad <= self.J["perfect"] else "great" if ad <= self.J["great"] else "good"
            n["head"] = kind
            self.ptr[lane] += 1
            self.record(kind)
            if n["endTime"] is not None:
                n["holding"] = True
                self.hold_note[lane] = n
        else:
            self.key_down[lane] = False
            n = self.hold_note[lane]
            if n is not None and n["holding"]:
                n["holding"] = False
                self.hold_note[lane] = None
                # 끝나기 전에 너무 일찍 떼면 꼬리 MISS
                n["tail"] = "perfect" if t >= n["endTime"] - self.J["holdEndGrace"] else "miss"
                self.record(n["tail"])

    def sweep(self, t: float) -> None:
        """시각 t 까지 진행: 지나간 노트는 MISS, 끝까지 누른 롱노트는 성공 (원본 update)"""
        for l in range(3):
            lst = self.lanes[l]
            while self.ptr[l] < len(lst) and t - lst[self.ptr[l]]["time"] > self.J["good"]:
                n = lst[self.ptr[l]]
                n["head"] = "miss"
                self.ptr[l] += 1
                self.record("miss")
                if n["endTime"] is not None:
                    n["tail"] = "miss"
                    self.record("miss")
            h = self.hold_note[l]
            if h is not None and h["holding"] and t >= h["endTime"]:
                h["holding"] = False
                self.hold_note[l] = None
                h["tail"] = "perfect"
                self.record("perfect")

    def summary(self) -> dict:
        return {
            "score": self.score, "grade": self.grade, "maxCombo": self.max_combo, **self.counts,
            "fullCombo": self.full_combo, "allPerfect": self.all_perfect,
        }

    def dump(self) -> dict:
        """다시 접속한 사람의 화면을 맞추는 데 필요한 진행 상황"""
        return {
            "ptr": list(self.ptr), "hold": [n["id"] if n else None for n in self.hold_note],
            **self.counts, "combo": self.combo, "maxCombo": self.max_combo, "judged": self.judged,
        }
