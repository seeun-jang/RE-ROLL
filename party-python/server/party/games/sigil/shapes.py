"""마법진 모양 — 원본 js/shapes.js 를 옮긴 것.

- 모양은 60x60 기준 좌표로 적고, 실제 종이(120x120)에는 2배로 그린다.
- 첫 점이 출발점.
- prepare_shape: 모양을 1px 간격의 점(path)과 거리 지도(dist: 각 칸이 모양 선에서 몇 칸 떨어졌나)로 바꾼다.
- plan_rounds: 라운드마다 난이도 묶음에서 모양 하나, 저주 후보에서 저주 하나를 뽑는다.
"""

from __future__ import annotations

import math
from typing import Callable


def js_round(v: float) -> int:
    """JavaScript 의 Math.round 와 같은 반올림(.5 는 위로). Python 의 round 는 짝수 쪽으로 가므로 쓰지 않는다."""
    return math.floor(v + 0.5)


def arc_pts(cx: float, cy: float, rx: float, ry: float, a0: float, a1: float, n: int) -> list[list[float]]:
    """타원 호 위의 점 n+1 개."""
    pts = []
    for i in range(n + 1):
        a = a0 + ((a1 - a0) * i) / n
        pts.append([cx + math.cos(a) * rx, cy + math.sin(a) * ry])
    return pts


def _swirl() -> list[list[float]]:
    """소용돌이: 바깥에서 안으로 2바퀴 조금 넘게."""
    pts = []
    for i in range(91):
        k = i / 90
        a = -math.pi / 2 + k * math.pi * 4.5
        r = 24 - k * 20
        pts.append([30 + math.cos(a) * r, 30 + math.sin(a) * r])
    return pts


PI = math.pi

#: color: 이름 글씨 색 / gc: 양피지 위 안내선 색 (화면 팔레트 글자) / tier: easy · mid · hard
SHAPES: list[dict] = [
    {"name": "달빛 고리", "short": "고리", "color": "h", "gc": "g", "tier": "easy",
     "pts": arc_pts(30, 30, 20, 20, -PI / 2, PI * 1.5, 48)},
    {"name": "삼각 마법진", "short": "삼각", "color": "e", "gc": "d", "tier": "easy",
     "pts": [[30, 8], [52, 48], [8, 48], [30, 8]]},
    {"name": "다이아 마법진", "short": "다이아", "color": "q", "gc": "3", "tier": "easy",
     "pts": [[30, 6], [52, 30], [30, 54], [8, 30], [30, 6]]},
    # 별 (다섯 꼭짓점 한 붓 그리기)
    {"name": "잭팟 별", "short": "별", "color": "9", "gc": "8", "tier": "mid",
     "pts": [[30, 6], [44, 52], [6, 22], [54, 22], [16, 52], [30, 6]]},
    {"name": "번개 볼트", "short": "번개", "color": "8", "gc": "r", "tier": "mid",
     "pts": [[38, 4], [16, 32], [29, 32], [22, 56], [46, 24], [33, 24], [44, 4], [38, 4]]},
    {"name": "마법 왕관", "short": "왕관", "color": "t", "gc": "u", "tier": "mid",
     "pts": [[8, 48], [8, 14], [19, 32], [30, 8], [41, 32], [52, 14], [52, 48], [8, 48]]},
    # 하트: 위 가운데 → 오른쪽 볼록 → 아래 끝 → 왼쪽 볼록 → 위 가운데
    {"name": "사랑의 하트", "short": "하트", "color": "p", "gc": "4", "tier": "hard",
     "pts": arc_pts(41, 20, 11, 10, PI, PI * 2.2, 14) + [[30, 52]] + arc_pts(19, 20, 11, 10, PI * 0.8, PI * 2, 14)},
    {"name": "소용돌이", "short": "소용돌이", "color": "h", "gc": "f", "tier": "hard", "pts": _swirl()},
    # 물고기: 코 → 등 → 꼬리 → 배 → 코
    {"name": "황금 물고기", "short": "물고기", "color": "8", "gc": "l", "tier": "hard",
     "pts": arc_pts(26, 30, 18, 13, PI, PI * 2, 20) + [[54, 18], [54, 42]] + arc_pts(26, 30, 18, 13, 0, PI, 20)},
]


def plan_rounds(rng: Callable[[], float], rounds: list[dict], shapes: list[dict] | None = None) -> list[dict]:
    """라운드 계획 [{shape(SHAPES 번호), twist, mult}]. 난수는 넘겨받은 rng 만 쓴다."""
    shapes = SHAPES if shapes is None else shapes
    plan = []
    for r in rounds:
        pool = [i for i, s in enumerate(shapes) if s["tier"] == r["tier"]] or list(range(len(shapes)))
        shape = pool[min(len(pool) - 1, math.floor(rng() * len(pool)))]
        twists = r["twists"]
        twist = twists[min(len(twists) - 1, math.floor(rng() * len(twists)))]
        plan.append({"shape": shape, "twist": twist, "mult": r["mult"]})
    return plan


def sample_path(pts: list[list[float]]) -> list[tuple[float, float]]:
    """꺾은선을 1px 간격의 점들로 (채점용)."""
    out: list[tuple[float, float]] = []
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0)))
        for k in range(n):
            out.append((x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n))
    out.append((pts[-1][0], pts[-1][1]))
    return out


_PREPARED: dict[tuple[int, int], dict] = {}


def prepare_shape(shape: dict, size: int = 120) -> dict:
    """모양 정보 미리 계산 → {"path": [(x, y)], "cells": [(ix, iy)], "dist": bytearray, "start": (x, y)}.

    dist[y * size + x] = 그 칸이 모양 선에서 몇 칸 떨어졌나(8방향, 20 넘으면 더 세지 않음).
    """
    key = (id(shape), size)
    if key in _PREPARED:
        return _PREPARED[key]
    S = size
    K = S / 60
    pts = [[x * K, y * K] for x, y in shape["pts"]]
    path = sample_path(pts)
    cells = [(js_round(x), js_round(y)) for x, y in path]
    dist = bytearray([255]) * (S * S)
    queue: list[int] = []
    for ix, iy in cells:
        if ix < 0 or iy < 0 or ix >= S or iy >= S:
            continue
        if dist[iy * S + ix] != 0:
            dist[iy * S + ix] = 0
            queue.append(iy * S + ix)
    # 넓이 우선으로 거리 퍼뜨리기 (8방향)
    qi = 0
    while qi < len(queue):
        i = queue[qi]
        qi += 1
        x, y, d = i % S, i // S, dist[i]
        if d >= 20:
            continue
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= S or ny >= S:
                    continue
                j = ny * S + nx
                if dist[j] > d + 1:
                    dist[j] = d + 1
                    queue.append(j)
    out = {"path": path, "cells": cells, "dist": dist, "start": (pts[0][0], pts[0][1])}
    _PREPARED[key] = out
    return out
