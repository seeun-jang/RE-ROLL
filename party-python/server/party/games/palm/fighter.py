"""선수 한 명의 균형 물리와 행동 상태 — 원본 Fighter.js / BalanceSystem.js 를 옮긴 것.

상태 흐름
    idle ─밀기─▶ windup ─(뗌)─▶ push ─▶ recover ─▶ idle           (툭 밀기)
                       └(유지)▶ charge ─(뗌)─▶ release ─▶ push      (차지 밀기)
    idle ─손빼기─▶ feint(판정 창) ─▶ feintRecover(무방비) ─▶ idle
    idle ─버티기─▶ holdStart ─▶ hold(스태미나 소모) ─(뗌)─▶ holdRecover ─▶ idle
    (어디서든) 큰 충격 ─▶ stagger ─▶ idle,   |균형| ≥ 100 ─▶ fall

입력은 {"lean", "pushDown", "feintPressed", "holdDown"} 하나로 통일한다.
"""

from __future__ import annotations

import math
from typing import Callable

from .config import LOGIC_FPS

EMPTY_INPUT = {"lean": 0, "pushDown": False, "feintPressed": False, "holdDown": False}


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


def create_rng(seed: int = 1) -> Callable[[], float]:
    """시드 고정 난수(mulberry32) — 브라우저 쪽 util.js 의 createRng 와 같은 수열."""
    state = {"s": seed & 0xFFFFFFFF}

    def imul(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def rng() -> float:
        state["s"] = (state["s"] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state["s"]
        t = imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


class BalanceBody:
    """균형 위치 b(-100~100)와 속도 v. +는 앞(상대 쪽)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.reset()

    def reset(self) -> None:
        self.b = 0.0
        self.v = 0.0

    def apply_impulse(self, amount: float) -> None:
        self.v += amount

    def step(self, dt: float, force: float) -> None:
        B = self.cfg["BALANCE"]
        # 중앙 근처에서는 약하게 되돌아오지만, 많이 기울수록 넘어지려는 힘이 커진다
        restore = self.b * ((B["TIP"] * abs(self.b)) / B["LIMIT"] - B["RECOVER"])
        self.v += (force + restore) * dt
        self.v *= math.pow(B["DAMPING"], dt)
        self.v = clamp(self.v, -B["MAX_SPEED"], B["MAX_SPEED"])
        self.b += self.v * dt

    @property
    def stability(self) -> float:
        limit = self.cfg["BALANCE"]["LIMIT"]
        return clamp(limit - abs(self.b), 0, limit)

    @property
    def fallen(self) -> bool:
        return abs(self.b) >= self.cfg["BALANCE"]["LIMIT"]


class SwayField:
    """받침대 흔들림: 주기가 다른 사인파 2개 + 부드러운 무작위 성분."""

    def __init__(self, cfg: dict, seed: int):
        self.cfg = cfg
        self.rng = create_rng(seed)
        self.p1 = self.rng() * math.pi * 2
        self.p2 = self.rng() * math.pi * 2
        self.w1 = 0.006 + self.rng() * 0.004
        self.w2 = 0.025 + self.rng() * 0.012
        self.noise = 0.0

    def force(self, t: float, dt: float = 1.0) -> float:
        B = self.cfg["BALANCE"]
        self.noise += ((self.rng() * 2 - 1) - self.noise) * 0.05 * dt
        amp = B["SWAY_BASE"] + B["SWAY_GROWTH"] * self.growth(t)
        return amp * (math.sin(t * self.w1 + self.p1) * 0.65 + math.sin(t * self.w2 + self.p2) * 0.35) + self.noise * B["SWAY_NOISE"]

    def growth(self, t: float) -> float:
        M = self.cfg["MATCH"]
        sec = t / LOGIC_FPS
        return clamp((sec - M["WOBBLE_START"]) / max(1, M["TIME_LIMIT"] - M["WOBBLE_START"]), 0, 1)


class Fighter:
    def __init__(self, cfg: dict, key: str, player_id: str, name: str):
        self.cfg = cfg
        self.key = key              # 경기 안에서의 자리 "a" | "b"
        self.player_id = player_id
        self.name = name
        self.body = BalanceBody(cfg)
        self.reset()

    def reset(self) -> None:
        A = self.cfg["ACTION"]
        self.body.reset()
        self.state = "idle"
        self.state_frame = 0.0
        self.state_len = 0.0
        self.charge = 0.0
        self.charge_frames = 0.0
        self.overhold = 0.0
        self.power = 1.0
        self.charged = False
        self.push_resolved = False
        self.feint_consumed = False
        self.stamina = float(A["HOLD_STAMINA"])
        self.stagger_timer = 0.0
        self.push_latch = False
        self.hold_latch = False
        self.input = EMPTY_INPUT
        self.lean_input = 0
        self.fallen = False
        self.frozen = False
        self.fall_overshoot = 0.0
        self.feint_streak = 0
        self.feint_streak_timer = 0.0
        self.feint_window = A["FEINT_WINDOW"]
        self.fall_dir = 0
        self.fall_t = 0.0
        self.splashed = False
        self.won = False
        self.flash = 0.0
        self.squash = 0.0
        self.stats = {
            "pushes": 0, "pushesLanded": 0, "chargePushes": 0, "feints": 0, "feintsSucceeded": 0,
            "cleanFeints": 0, "holds": 0, "holdsSucceeded": 0, "whiffs": 0, "clashes": 0, "staggers": 0,
        }

    # ----- 조회 -----
    @property
    def in_feint_window(self) -> bool:
        return self.state == "feint" and not self.feint_consumed

    @property
    def forward_lean(self) -> float:
        return clamp(self.body.b / self.cfg["BALANCE"]["LIMIT"], 0, 1)

    def set_state(self, state: str, length: float = 0) -> None:
        self.state = state
        self.state_frame = 0.0
        self.state_len = length

    def record_feint_success(self) -> None:
        self.stats["feintsSucceeded"] += 1
        if self.feint_streak <= 1:
            self.stats["cleanFeints"] += 1

    # ----- 한 프레임 진행 -----
    def update(self, dt: float, inp: dict | None, sway: float, emit: Callable[[dict], None]) -> None:
        A = self.cfg["ACTION"]
        B = self.cfg["BALANCE"]
        I = self.cfg["IMPACT"]
        self.input = inp or EMPTY_INPUT
        if self.flash > 0:
            self.flash = max(0.0, self.flash - dt)
        if self.squash > 0:
            self.squash = max(0.0, self.squash - dt)

        if self.fallen:
            self.fall_t += dt
            if not self.splashed and self.fall_t >= 34:
                self.splashed = True
                emit({"type": "splash", "who": self.key})
            return
        if self.won:
            self.lean_input = 0
            self.body.b *= math.pow(0.95, dt)   # 이긴 쪽은 천천히 중앙으로
            self.body.v = 0.0
            return
        if self.frozen:
            self.lean_input = 0
            self.body.v = 0.0
            return
        if self.feint_streak_timer > 0:
            self.feint_streak_timer -= dt
            if self.feint_streak_timer <= 0:
                self.feint_streak = 0

        # 버튼을 떼야 다음 행동을 시작할 수 있다
        if not self.input["pushDown"]:
            self.push_latch = False
        if not self.input["holdDown"]:
            self.hold_latch = False

        self.state_frame += dt
        st = self.state
        if st == "idle":
            self._try_start_action(emit)
        elif st == "windup":
            if self.state_frame >= A["PUSH_WINDUP"]:
                if self.input["pushDown"]:
                    self.set_state("charge")
                    self.charge_frames = 0.0
                    self.overhold = 0.0
                    emit({"type": "chargeStart", "who": self.key})
                else:
                    self.begin_push(emit, False)
        elif st == "charge":
            self.charge_frames += dt
            self.charge = clamp(self.charge_frames / A["CHARGE_MAX"], 0, 1)
            if self.charge >= 1:
                self.overhold += dt
            if not self.input["pushDown"] or self.overhold >= A["CHARGE_OVERHOLD"]:
                self.set_state("release")
                emit({"type": "chargeEnd", "who": self.key})
        elif st == "release":
            if self.state_frame >= A["CHARGE_RELEASE"]:
                self.begin_push(emit, True)
        elif st == "push":
            active = A["CHARGE_ACTIVE"] if self.charged else A["PUSH_ACTIVE"]
            if self.state_frame >= active:
                self.push_resolved = True
                self.set_state("recover", A["CHARGE_RECOVER"] if self.charged else A["PUSH_RECOVER"])
        elif st in ("recover", "holdRecover", "feintRecover"):
            if self.state_frame >= self.state_len:
                self.set_state("idle")
        elif st == "feint":
            if self.state_frame >= self.feint_window:
                if not self.feint_consumed:
                    # 아무도 걸려들지 않음 → 살짝 앞으로 쏠리고 무방비 (연달아 할수록 더 크게)
                    self.body.apply_impulse(I["FEINT_EMPTY"] * (1 + 0.6 * (self.feint_streak - 1)))
                    emit({"type": "feintEmpty", "who": self.key})
                    self.set_state("feintRecover", A["FEINT_RECOVER"])
                else:
                    self.set_state("recover", 6)
        elif st == "holdStart":
            self.stamina -= dt
            if self.state_frame >= A["HOLD_STARTUP"]:
                self.set_state("hold")
        elif st == "hold":
            self.stamina -= dt
            if self.stamina <= 0:
                self.stamina = 0.0
                self.body.apply_impulse(I["STAMINA_EMPTY_LURCH"])
                emit({"type": "holdTired", "who": self.key})
                self.set_state("holdRecover", A["HOLD_RECOVER"] * 2)
                self.hold_latch = True
            elif not self.input["holdDown"]:
                self.set_state("holdRecover", A["HOLD_RECOVER"])
        elif st == "stagger":
            self.stagger_timer -= dt
            if self.stagger_timer <= 0:
                self.set_state("idle")
        else:
            self.set_state("idle")

        if self.state not in ("hold", "holdStart"):
            self.stamina = min(A["HOLD_STAMINA"], self.stamina + A["HOLD_REGEN"] * dt)
        if self.state not in ("charge", "release", "push"):
            self.charge = 0.0

        # ----- 균형 물리 -----
        lean_mult = 1.0
        if self.state == "stagger":
            lean_mult = B["STAGGER_LEAN_MULT"]
        elif self.state in ("hold", "holdStart"):
            lean_mult = B["HOLD_LEAN_MULT"]
        self.lean_input = self.input.get("lean") or 0
        force = self.lean_input * B["LEAN_FORCE"] * lean_mult
        if self.state in ("hold", "holdStart"):
            sway *= B["HOLD_SWAY_MULT"]
        force += sway
        if self.state == "charge":
            force += B["CHARGE_DRIFT"]
        self.body.step(dt, force)
        if self.body.fallen:
            self.start_fall(emit)

    def _try_start_action(self, emit: Callable[[dict], None]) -> None:
        """idle 에서 새 행동 시작. 동시에 눌렀으면 손빼기 > 버티기 > 밀기."""
        A = self.cfg["ACTION"]
        inp = self.input
        if inp["feintPressed"]:
            self.set_state("feint")
            self.feint_consumed = False
            self.feint_window = max(
                A["FEINT_MIN_WINDOW"], js_round(A["FEINT_WINDOW"] * math.pow(A["FEINT_STREAK_DECAY"], self.feint_streak))
            )
            self.feint_streak += 1
            self.feint_streak_timer = A["FEINT_STREAK_RESET"] + self.feint_window + A["FEINT_RECOVER"]
            self.stats["feints"] += 1
            emit({"type": "feint", "who": self.key})
            return
        if inp["holdDown"] and not self.hold_latch and self.stamina >= A["HOLD_MIN_STAMINA"]:
            self.hold_latch = True
            self.set_state("holdStart")
            self.stats["holds"] += 1
            emit({"type": "holdStart", "who": self.key})
            return
        if inp["pushDown"] and not self.push_latch:
            self.push_latch = True
            self.set_state("windup")
            self.charge = 0.0
            self.charged = False
            self.stats["pushes"] += 1
            emit({"type": "windup", "who": self.key})

    def begin_push(self, emit: Callable[[dict], None], charged: bool) -> None:
        I = self.cfg["IMPACT"]
        self.charged = charged
        charge_mult = 1 + (I["CHARGE_MULT_MAX"] - 1) * self.charge if charged else 1
        self.power = charge_mult * (1 + I["FORWARD_LEAN_POWER"] * self.forward_lean)
        if charged:
            self.stats["chargePushes"] += 1
        self.push_resolved = False
        self.set_state("push")
        emit({"type": "pushActive", "who": self.key, "charged": charged})

    def interrupt(self, length: float = 8) -> None:
        self.charge = 0.0
        self.charged = False
        self.set_state("recover", length)

    def take_impulse(self, amount: float, emit: Callable[[dict], None]) -> None:
        self.body.apply_impulse(amount)
        if abs(amount) >= self.cfg["BALANCE"]["STAGGER_THRESHOLD"] and not self.fallen:
            self.charge = 0.0
            self.charged = False
            self.set_state("stagger")
            self.stagger_timer = self.cfg["BALANCE"]["STAGGER_FRAMES"]
            self.stats["staggers"] += 1
            emit({"type": "stagger", "who": self.key})

    def end_action(self) -> None:
        if self.fallen:
            return
        self.charge = 0.0
        self.charged = False
        self.set_state("idle")

    def start_fall(self, emit: Callable[[dict], None]) -> None:
        if self.fallen:
            return
        limit = self.cfg["BALANCE"]["LIMIT"]
        self.fallen = True
        self.fall_overshoot = abs(self.body.b) + abs(self.body.v) * 0.5
        self.fall_dir = 1 if self.body.b > 0 else -1
        self.fall_t = 0.0
        self.body.b = clamp(self.body.b, -limit, limit)
        self.body.v = 0.0
        self.set_state("fall")
        emit({"type": "fall", "who": self.key, "dir": self.fall_dir})

    def snapshot(self) -> dict:
        """화면에 보낼 상태."""
        return {
            "id": self.player_id, "b": self.body.b, "v": self.body.v, "state": self.state,
            "stateFrame": self.state_frame, "charge": self.charge, "charged": self.charged,
            "stamina": self.stamina, "fallen": self.fallen, "fallDir": self.fall_dir, "fallT": self.fall_t,
            "won": self.won, "frozen": self.frozen, "flash": self.flash, "squash": self.squash,
            "lean": self.lean_input, "cleanFeints": self.stats["cleanFeints"],
        }
