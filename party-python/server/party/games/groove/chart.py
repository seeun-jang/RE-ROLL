"""채보 자동 생성: 곡 멜로디 → 3레인 노트 (원본 js/chart.js 를 그대로 옮김).

- 음이 올라가면 오른쪽, 내려가면 왼쪽 레인
- 긴 음은 롱노트(꾹 누르기), 코러스 첫 박은 동시치기(2개)
- 같은 곡 · 같은 난이도면 항상 같은 채보 → 서버와 브라우저가 따로 만들어도 같다(테스트가 비교한다)
"""

from __future__ import annotations

from .songs import expand_song

CHART_RULES = {
    # grid: 이 칸 수의 배수 자리에 있는 음만 쓴다 / holdMin: 이 칸 수 이상이면 롱노트
    # doubleEvery: 코러스에서 이 칸마다 동시치기(0 = 없음) / breakTaps: 브레이크 롱노트 중 탭 추가
    "easy": {"grid": 4, "holdMin": 6, "doubleEvery": 0, "breakTaps": False},
    "normal": {"grid": 2, "holdMin": 4, "doubleEvery": 16, "breakTaps": False},
    "hard": {"grid": 1, "holdMin": 3, "doubleEvery": 4, "breakTaps": True},
}


def build_chart(song: dict, difficulty: str = "normal") -> list[dict]:
    """노트 목록 [{id, time, lane, endTime(롱노트 끝 시각 또는 None), step}] — 시각 순."""
    ex = expand_song(song)
    R = CHART_RULES.get(difficulty) or CHART_RULES["normal"]
    notes: list[dict] = []
    st = ex["stepSec"]
    lane = 1
    prev_midi = None
    hold_until = [0, 0, 0]      # 레인별로 롱노트가 끝나는 칸

    def free(l: int, step: int) -> bool:
        return hold_until[l] <= step

    def add(step: int, l: int, dur: int) -> None:
        is_hold = dur >= R["holdMin"]
        # 끝을 반 칸 일찍 끊어서 다음 노트와 붙지 않게
        end_step = step + dur - 0.5 if is_hold else None
        notes.append({"time": step * st, "lane": l, "endTime": end_step * st if is_hold else None, "step": step})
        hold_until[l] = step + dur if is_hold else step + 1

    for m in ex["melody"]:
        bar = ex["bars"][m["bar"]]
        in_bar = m["step"] % 16
        if in_bar % R["grid"] != 0:
            continue
        # 멜로디 모양으로 레인 결정
        if prev_midi is not None:
            d = m["midi"] - prev_midi
            move = 0 if d == 0 else (2 if abs(d) >= 5 else 1) * (1 if d > 0 else -1)
            nxt = max(0, min(2, lane + move))
            if move != 0 and nxt == lane:
                nxt = 1          # 끝에 붙어 있으면 가운데로 튕김
            lane = nxt
        prev_midi = m["midi"]
        l = lane
        if not free(l, m["step"]):
            l = next((x for x in (0, 1, 2) if free(x, m["step"])), l)
        add(m["step"], l, m["dur"])

        # 코러스 동시치기
        if bar["fever"] and R["doubleEvery"] and in_bar % R["doubleEvery"] == 0:
            other = 2 if l == 0 else 0 if l == 2 else (0 if m["bar"] % 2 else 2)
            if free(other, m["step"]):
                add(m["step"], other, 1)

    # 어려움: 브레이크 롱노트 중간에 킥 박자 탭
    if R["breakTaps"]:
        for bar in ex["bars"]:
            if bar["section"] != "break":
                continue
            for s in (4, 12):
                step = bar["index"] * 16 + s
                t = step * st
                held = next((n for n in notes if n["endTime"] is not None and n["time"] <= t <= n["endTime"]), None)
                cand = next(
                    (x for x in (2, 0, 1)
                     if (held is None or x != held["lane"])
                     and not any(n["lane"] == x and abs(n["time"] - t) < st * 1.5 for n in notes)),
                    None,
                )
                if cand is not None:
                    notes.append({"time": t, "lane": cand, "endTime": None, "step": step})

    notes.sort(key=lambda n: (n["time"], n["lane"]))
    for i, n in enumerate(notes):
        n["id"] = i
    return notes


def chart_judge_count(notes: list[dict]) -> int:
    """판정 개수 (롱노트는 머리 + 꼬리 = 2개)"""
    return sum(2 if n["endTime"] is not None else 1 for n in notes)
