"""박자 격자와 피버 구간 — 둘 다 '라운드 시작 후 경과 시간'만으로 결정된다.

서버와 브라우저가 따로 계산해도 같은 결과가 나오도록, 프레임 단위 누적이 아니라
시간에 대한 공식으로 정의한다. 브라우저 쪽 같은 구현: web/src/games/tug/net/timeline.js

박자 규칙
- 박 0 = 라운드 시작(START) 시각 0초. 음수 박(카운트다운)은 기본 템포 간격.
- 박 k 에서 k+1 까지의 간격은 '박 k-1 시각에 피버였으면 피버 템포, 아니면 기본 템포'.
  (원본 게임과 같다: 피버가 시작된 박의 다음 박부터 빨라지고, 끝난 뒤에도 한 박 더 빠르다)
"""

from __future__ import annotations

import math

# 경계값 비교용 여유(초). 8.0초 같은 경계에서 부동소수 오차로 결과가 갈리지 않게 한다.
EPS = 1e-9


class FeverSchedule:
    """피버 구간: FEVER_FIRST + k * FEVER_INTERVAL 부터 FEVER_DURATION 동안."""

    def __init__(self, config: dict):
        self.first = float(config["FEVER_FIRST"])
        interval = float(config["FEVER_INTERVAL"])
        self.interval = interval if interval > 0 else math.inf
        self.duration = float(config["FEVER_DURATION"])
        self.warning = float(config["FEVER_WARNING"])

    def state_at(self, t: float) -> dict:
        """{"active", "remaining", "warning"}"""
        if t < self.first - EPS:
            return {"active": False, "remaining": 0.0, "warning": (self.first - t) <= self.warning}
        if math.isinf(self.interval):
            k = 0
            start = self.first
        else:
            k = math.floor((t - self.first + EPS) / self.interval)
            start = self.first + k * self.interval
        if t < start + self.duration - EPS:
            return {"active": True, "remaining": start + self.duration - t, "warning": False}
        until = start + self.interval - t
        return {"active": False, "remaining": 0.0, "warning": until <= self.warning}

    def active_at(self, t: float) -> bool:
        return self.state_at(t)["active"]


class BeatTimeline:
    """라운드 박자 격자. times[k] = 박 k 의 시각(초), k >= 0."""

    def __init__(self, config: dict, fever: FeverSchedule | None = None):
        self.base = 60.0 / float(config["BPM"])
        self.fast = 60.0 / float(config["FEVER_BPM"])
        self.fever = fever or FeverSchedule(config)
        self.times: list[float] = [0.0]

    def interval_after(self, k: int) -> float:
        """박 k → k+1 간격."""
        if k < 1:
            return self.base
        return self.fast if self.fever.active_at(self.time_of(k - 1)) else self.base

    def _extend_to_index(self, k: int) -> None:
        while len(self.times) <= k:
            last = len(self.times) - 1
            self.times.append(self.times[last] + self.interval_after(last))

    def time_of(self, k: int) -> float:
        if k < 0:
            return k * self.base
        self._extend_to_index(k)
        return self.times[k]

    def index_at(self, t: float) -> int:
        """시각 t 이전(같음 포함)의 마지막 박 번호. 음수일 수 있다."""
        if t < 0:
            return math.floor(t / self.base)
        while self.times[-1] <= t:
            self._extend_to_index(len(self.times))
        # 뒤에서부터 찾는다(대부분 최근 박)
        k = len(self.times) - 1
        while k > 0 and self.times[k] > t:
            k -= 1
        return k

    def nearest(self, t: float) -> tuple[int, float]:
        """t 에 가장 가까운 박 → (번호, 그 박의 시각). 같은 거리면 앞의 박."""
        k = self.index_at(t)
        t0 = self.time_of(k)
        t1 = self.time_of(k + 1)
        if abs(t - t1) < abs(t - t0):
            return k + 1, t1
        return k, t0


class BeatJudge:
    """Perfect / Good / Miss / 헛힘(spam) 판정. 원본 BeatJudge.judge 와 같은 규칙."""

    HISTORY_INTERVALS = 2

    def __init__(self, config: dict, timeline: BeatTimeline):
        self.config = config
        self.timeline = timeline
        self.records: dict[str, dict] = {}

    def judge(self, player_id: str, t: float) -> dict:
        cfg = self.config
        tl = self.timeline
        beat_index, beat_time = tl.nearest(t)
        offset = t - beat_time
        # '최근 1박' 길이는 지금 시각이 속한 박 간격을 쓴다
        interval = tl.interval_after(tl.index_at(t))

        rec = self.records.setdefault(player_id, {"hit_beat": None, "presses": []})
        rec["presses"].append(t)
        keep_from = t - interval * self.HISTORY_INTERVALS
        rec["presses"] = [p for p in rec["presses"] if p >= keep_from]
        recent = sum(1 for p in rec["presses"] if p <= t and t - p < interval)

        # 1) 헛힘이 먼저: 같은 박에 이미 점수를 받았거나, 1박 안에 너무 많이 눌렀다
        if rec["hit_beat"] is not None and rec["hit_beat"] == beat_index:
            return {"grade": "spam", "offset": offset, "beatIndex": beat_index}
        if recent > cfg["SPAM_MAX_PRESSES_PER_BEAT"]:
            return {"grade": "spam", "offset": offset, "beatIndex": beat_index}
        # 2) 타이밍 창
        a = abs(offset)
        if a <= cfg["PERFECT_WINDOW"]:
            grade = "perfect"
        elif a <= cfg["GOOD_WINDOW"]:
            grade = "good"
        else:
            grade = "miss"
        if grade in ("perfect", "good"):
            rec["hit_beat"] = beat_index
        return {"grade": grade, "offset": offset, "beatIndex": beat_index}
