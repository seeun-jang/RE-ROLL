"""교수님 (원본 js/teacher.js 를 Python 으로 옮긴 것) + AI 수업 계획.

교수님의 한 바퀴:
    write(칠판에 쓰기) → tell(낌새: 분필 멈춤 · 흠흠) → turn(돌아봄) → look(반 보기) → back(다시 칠판) → write
    fake   : 낌새만 주고 다시 쓴다
    sudden : 낌새 없이 갑자기(대신 천천히) 돌아본다

AI 수업 계획(Gemini)은 "단계" 목록이다. 한 단계 = 쓰기 한 번 + 그 뒤에 할 행동:
    {"write": 쓰는 시간, "move": "tell" | "fake" | "sudden", "tell": 낌새 시간, "look": 보는 시간}   (프레임)
쓰기를 시작할 때마다 계획에서 한 단계를 꺼내 쓰고, 계획이 없거나 그 단계가 잘못됐으면
원본과 똑같이 난수로 정한다(규칙 기반).
"""

from __future__ import annotations

import math
from typing import Callable

from .config import LOGIC_FPS

MOVES = ("tell", "fake", "sudden")


def lerp(a: float, b: float, k: float) -> float:
    return a + (b - a) * k


def js_round(x: float) -> int:
    """JavaScript 의 Math.round (0.5 는 올림)."""
    return math.floor(x + 0.5)


class Teacher:
    def __init__(self, rng: Callable[[], float], cfg: dict):
        """rng: 0 이상 1 미만 난수 함수, cfg: 설정의 TEACHER 부분."""
        self.rng = rng
        self.cfg = cfg
        self.state = "write"
        self.t = 0
        self.dur = cfg["FIRST_WRITE"]     # 첫 쓰기는 넉넉하게 (항상 규칙 기반)
        self.sudden = False
        self.fake = False
        self.x = 160.0                    # 칠판 앞 위치
        self.goal_x = 160
        self.watch_t = 0                  # 반을 보기 시작한 뒤 지난 프레임(유예 판정용)
        self.events: list[dict] = []
        # AI 수업 계획
        self.plan: list[dict | None] = []
        self.plan_i = 0
        self.step: dict | None = None     # 지금 쓰기에 쓰는 계획 단계 (None = 규칙 기반)
        self.steps_used = 0

    # ----- AI 수업 계획 -----
    def set_plan(self, steps: list[dict | None], k: float = 0.0) -> None:
        """검증을 통과한 계획을 받는다. 늦게 도착했으면 수업 진행도 k 만큼 건너뛴 곳부터 쓴다."""
        self.plan = list(steps)
        self.plan_i = min(len(self.plan), int(max(0.0, min(1.0, k)) * len(self.plan)))

    def _next_step(self) -> dict | None:
        """다음 계획 단계. 계획이 없거나 다 썼거나 그 단계가 잘못됐으면 None."""
        if self.plan_i >= len(self.plan):
            return None
        step = self.plan[self.plan_i]
        self.plan_i += 1
        if step is not None:
            self.steps_used += 1
        return step

    # ----- 원본 로직 -----
    def range(self, pair: list, k: float) -> int:
        """k: 수업 진행도 0~1 (갈수록 어려워진다)."""
        lo = lerp(pair[0][0], pair[1][0], k)
        hi = lerp(pair[0][1], pair[1][1], k)
        return js_round(lo + self.rng() * (hi - lo))

    def set(self, state: str, dur: int) -> None:
        self.state = state
        self.t = 0
        self.dur = dur
        self.events.append({"type": state})

    def _begin_write(self, k: float) -> None:
        self.step = self._next_step()
        self.set("write", self.step["write"] if self.step else self.range(self.cfg["WRITE"], k))

    def update(self, k: float) -> None:
        """한 프레임(1/60초) 진행."""
        T = self.cfg
        self.t += 1
        if self.x != self.goal_x:
            self.x += math.copysign(0.5, self.goal_x - self.x)
        if self.state == "write":
            if self.t >= self.dur:
                step = self.step
                if step is not None:                      # AI 수업 계획대로
                    self.sudden = step["move"] == "sudden"
                    self.fake = step["move"] == "fake"
                    tell = step["tell"]
                elif self.rng() < lerp(T["SUDDEN"][0], T["SUDDEN"][1], k):   # 원본: 난수로
                    self.sudden, self.fake, tell = True, False, 0
                else:
                    self.sudden = False
                    self.fake = self.rng() < lerp(T["FAKE"][0], T["FAKE"][1], k)
                    tell = self.range(T["TELL"], k)
                if self.sudden:
                    self.set("turn", T["SUDDEN_TURN"])
                else:
                    self.set("tell", tell)
        elif self.state == "tell":
            if self.t >= self.dur:
                if self.fake:
                    self._begin_write(k)
                    self.events.append({"type": "fake"})
                else:
                    self.set("turn", T["TURN"])
        elif self.state == "turn":
            if self.t >= self.dur:
                self.set("look", self.step["look"] if self.step else self.range(T["LOOK"], k))
        elif self.state == "look":
            if self.t >= self.dur:
                self.set("back", T["BACK"])
        elif self.state == "back":
            if self.t >= self.dur:
                self._begin_write(k)
                # 가끔 칠판의 다른 곳으로 옮겨 가며 쓴다
                if self.rng() < 0.4:
                    self.goal_x = js_round(110 + self.rng() * 100)
        self.watch_t = self.watch_t + 1 if self.watching else 0

    @property
    def watching(self) -> bool:
        """지금 반을 보고 있나 (이때 춤추면 걸린다)."""
        if self.state == "look":
            return True
        if self.state == "turn":
            return self.t / self.dur >= self.cfg["SEE_FROM"]
        return False

    @property
    def planned(self) -> bool:
        """지금 행동이 AI 수업 계획에서 나온 것인가."""
        return self.step is not None


# ----------------------------------------------------------------------
# AI 수업 계획: 요청문 · 응답 모양 · 검증
# ----------------------------------------------------------------------
def plan_bounds(cfg: dict) -> dict[str, tuple[int, int]]:
    """계획의 숫자가 지켜야 할 범위(프레임) — 원본 교수님이 쓰는 범위 그대로."""
    T = cfg["TEACHER"]

    def span(pair: list) -> tuple[int, int]:
        return min(pair[0][0], pair[1][0]), max(pair[0][1], pair[1][1])

    return {"write": span(T["WRITE"]), "tell": span(T["TELL"]), "look": span(T["LOOK"])}


def plan_request(cfg: dict, n_players: int) -> tuple[str, str, dict]:
    """Gemini 에게 보낼 (시스템 프롬프트, 요청문, 응답 스키마). 시간은 초 단위로 주고받는다."""
    P = cfg["PLAN"]
    sec = {k: (round(lo / LOGIC_FPS, 2), round(hi / LOGIC_FPS, 2)) for k, (lo, hi) in plan_bounds(cfg).items()}
    system = (
        "너는 미니게임 '교수님 몰래 댄스!' 의 교수님이야. 학생들은 교수님이 칠판에 쓰는 동안 몰래 춤추고, "
        "교수님이 돌아봤을 때 춤추고 있으면 걸린다.\n"
        "이번 수업(60초)에서 교수님이 어떻게 움직일지 '단계' 목록으로 계획해.\n"
        "한 단계 = 칠판 쓰기 한 번 + 그 뒤의 행동(move):\n"
        "- tell: 낌새(흠흠)를 준 뒤 돌아본다.\n"
        "- fake: 낌새만 주고 돌아보지 않는다.\n"
        "- sudden: 낌새 없이 갑자기 돌아본다.\n"
        "규칙:\n"
        f"- 단계는 {P['MIN_STEPS']}~{P['MAX_STEPS']}개.\n"
        f"- write(쓰는 시간, 초)는 {sec['write'][0]}~{sec['write'][1]}, "
        f"tell(낌새 시간, 초)은 {sec['tell'][0]}~{sec['tell'][1]}, "
        f"look(반을 보는 시간, 초)은 {sec['look'][0]}~{sec['look'][1]} 사이.\n"
        f"- sudden 은 {P['MAX_SUDDEN']}번 이하, fake 는 {P['MAX_FAKE']}번 이하.\n"
        "- 처음 몇 단계는 쉽게(길게 쓰고 tell), 뒤로 갈수록 짧게 쓰고 fake · sudden 을 섞어 교활하게.\n"
        "- 같은 패턴을 반복하지 말고 학생들이 방심할 만한 리듬을 만든다."
    )
    prompt = f"학생 수: {n_players}명. 이번 수업의 계획을 만들어 줘."
    number = lambda key: {"type": "NUMBER", "minimum": sec[key][0], "maximum": sec[key][1]}  # noqa: E731
    schema = {
        "type": "OBJECT",
        "properties": {
            "steps": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "write": number("write"),
                        "move": {"type": "STRING", "enum": list(MOVES)},
                        "tell": number("tell"),
                        "look": number("look"),
                    },
                    "required": ["write", "move", "tell", "look"],
                },
            },
        },
        "required": ["steps"],
    }
    return system, prompt, schema


def _frames(value, lo: int, hi: int) -> int | None:
    """초 단위 숫자 → 프레임(범위 밖이면 범위 끝으로 자른다). 숫자가 아니면 None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return max(lo, min(hi, js_round(value * LOGIC_FPS)))


def clean_plan(data, cfg: dict) -> list[dict | None] | None:
    """AI 가 준 계획을 검증한다.

    - 모양이 틀리면 None (계획 전체를 버리고 규칙 기반으로)
    - 숫자는 원본 범위로 자르고, move 를 모르거나 숫자가 아닌 단계는 None (그 단계만 규칙 기반으로)
    - sudden · fake 가 너무 많으면 넘치는 것은 tell 로 바꾼다
    """
    steps = data.get("steps") if isinstance(data, dict) else data
    if not isinstance(steps, list):
        return None
    P = cfg["PLAN"]
    bounds = plan_bounds(cfg)
    left = {"sudden": P["MAX_SUDDEN"], "fake": P["MAX_FAKE"]}
    out: list[dict | None] = []
    for raw in steps[: P["MAX_STEPS"]]:
        step = None
        if isinstance(raw, dict) and raw.get("move") in MOVES:
            nums = {key: _frames(raw.get(key), *bounds[key]) for key in ("write", "tell", "look")}
            if None not in nums.values():
                move = raw["move"]
                if move in left:
                    if left[move] <= 0:
                        move = "tell"
                    else:
                        left[move] -= 1
                step = {"move": move, **nums}
        out.append(step)
    return out if any(s is not None for s in out) else None
