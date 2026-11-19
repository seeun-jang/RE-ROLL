"""종이 + 붓 + 채점 — 원본 js/sketch.js 를 옮긴 것.

- Paper: 120x120 종이. 브라우저가 보낸 점(종이 좌표)을 이어 그려 잉크 칸을 기억한다.
- score_drawing: 모양을 얼마나 덮었나(덮기) × 선을 얼마나 안 벗어났나(깔끔).
- AutoDrawer: 모양을 따라가며 손떨림을 넣는 자동 그리기(테스트 · 시연용).
"""

from __future__ import annotations

import base64
import math
from typing import Callable

from .shapes import js_round, prepare_shape


class Paper:
    """잉크가 묻은 칸을 기억하는 종이. ink[y * size + x] = 0 | 1"""

    def __init__(self, size: int = 120, brush: int = 2):
        self.size = size
        self.brush = brush
        self.ink = bytearray(size * size)
        self.ink_count = 0
        self.last: tuple[float, float] | None = None

    def dot(self, x: int, y: int) -> None:
        """붓 한 칸 찍기 (brush x brush 네모)."""
        S = self.size
        for dy in range(self.brush):
            for dx in range(self.brush):
                X, Y = x + dx, y + dy
                if X < 0 or Y < 0 or X >= S or Y >= S:
                    continue
                i = Y * S + X
                if not self.ink[i]:
                    self.ink[i] = 1
                    self.ink_count += 1

    def line(self, x0: float, y0: float, x1: float, y1: float) -> None:
        """(x0,y0)→(x1,y1) 선 (정수 좌표, 브레젠험)."""
        x0, y0, x1, y1 = js_round(x0), js_round(y0), js_round(x1), js_round(y1)
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.dot(x0, y0)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def stroke(self, x: float, y: float) -> None:
        """붓 이어 그리기. 펜을 떼면 end()."""
        if self.last is not None:
            self.line(self.last[0], self.last[1], x, y)
        else:
            self.dot(js_round(x), js_round(y))
        self.last = (x, y)

    def end(self) -> None:
        self.last = None

    def bits(self) -> str:
        """잉크 칸을 1칸 = 1비트로 묶어 base64 로 (갤러리에서 모두에게 보여 줄 그림). 왼쪽 위부터, 높은 비트가 먼저."""
        S = self.size
        out = bytearray((S * S + 7) // 8)
        for i, v in enumerate(self.ink):
            if v:
                out[i >> 3] |= 0x80 >> (i & 7)
        return base64.b64encode(bytes(out)).decode("ascii")


def score_drawing(paper: Paper, shape: dict, score_cfg: dict) -> dict:
    """채점 → {"accuracy": 0~100, "cover": 0~1, "neat": 0~1}"""
    S = paper.size
    prep = prepare_shape(shape, S)
    cells, dist, ink = prep["cells"], prep["dist"], paper.ink
    if not paper.ink_count:
        return {"accuracy": 0, "cover": 0.0, "neat": 0.0}
    # 덮기: 모양 선의 점마다 근처(COVER_RADIUS 칸)에 잉크가 있나
    R = score_cfg["COVER_RADIUS"]
    covered = 0
    for x, y in cells:
        hit = False
        for Y in range(max(0, y - R), min(S, y + R + 1)):
            row = Y * S
            lo, hi = max(0, x - R), min(S, x + R + 1)
            if lo < hi and ink.find(1, row + lo, row + hi) >= 0:
                hit = True
                break
        if hit:
            covered += 1
    # 깔끔: 잉크 칸 중 모양 선 가까이(NEAT_RADIUS 칸)에 있는 비율
    N = score_cfg["NEAT_RADIUS"]
    near = sum(1 for i in range(S * S) if ink[i] and dist[i] <= N)
    cover = covered / len(cells)
    neat = near / paper.ink_count
    return {"accuracy": js_round(100 * cover * (0.4 + 0.6 * neat)), "cover": cover, "neat": neat}


class AutoDrawer:
    """자동으로 그리는 손(테스트 · 시연용): 모양을 따라가며 손떨림. skill 0~1 (높을수록 정확)."""

    def __init__(self, shape: dict, skill: float, rng: Callable[[], float], size: int = 120):
        self.path = prepare_shape(shape, size)["path"]
        self.skill = skill
        self.rng = rng
        self.i = 0.0
        self.wob = 0.0

    def next(self) -> tuple[float, float] | None:
        """이번 프레임의 펜 위치 (None 이면 다 그림)."""
        if self.i >= len(self.path):
            return None
        self.i += 2.2 + self.skill
        p = self.path[min(len(self.path) - 1, math.floor(self.i))]
        self.wob += (self.rng() - 0.5) * (1 - self.skill) * 5
        self.wob *= 0.93
        return (p[0] + self.wob + (self.rng() - 0.5) * (1 - self.skill) * 3, p[1] + self.wob)
