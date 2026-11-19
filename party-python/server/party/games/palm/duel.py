"""한 경기(1:1) — 상성 판정과 승패. 원본 Combat.js / Match.js 를 옮긴 것.

상성
    밀기  vs 대기/후딜            → 상대가 뒤로 밀림 (준비·차지 중이면 카운터, 손빼기 후딜이면 추가 피해)
    밀기  vs 버티기 자세 잡는 중  → 버티기 실패 (피해 증가)
    밀기  vs 버티기               → 받아냄. 미는 쪽이 튕겨남 (차지 밀기는 일부 뚫음)
    밀기  vs 손빼기(판정 창)      → 헛손질. 미는 쪽이 앞으로 크게 쏠림
    밀기  vs 밀기(동시)           → 맞부딪혀 둘 다 뒤로 (센 쪽이 덜 밀림)
    손빼기 vs 버티기              → 버티던 쪽이 앞으로 고꾸라짐

승패: 발이 떨어지면(|균형| ≥ 100) 패배. 시간이 끝나면 |균형|이 작은 쪽이 이긴다.
원본에서는 화면이 정하던 '맞은 순간 멈춤(히트스톱)'도 판정에 영향을 주므로 여기서 관리한다.
"""

from __future__ import annotations

import math

from .config import LOGIC_FPS
from .fighter import EMPTY_INPUT, Fighter, SwayField

CLASH_WINDOW = 2   # 두 밀기가 이 프레임 안에 나가면 동시 밀기로 본다


class Duel:
    def __init__(self, cfg: dict, a: dict, b: dict, seed: int):
        """a, b: {"id", "name"}. a 가 왼쪽, b 가 오른쪽 자리."""
        self.cfg = cfg
        self.a = Fighter(cfg, "a", a["id"], a["name"])
        self.b = Fighter(cfg, "b", b["id"], b["name"])
        # 두 자리의 흔들림 패턴은 서로 다르지만, 같은 라운드의 모든 경기는 같은 패턴을 쓴다
        self.sway_a = SwayField(cfg, seed)
        self.sway_b = SwayField(cfg, seed + 7919)
        self.frame = 0.0
        self.hitstop = 0.0
        self.running = False
        self.over = False
        self.result: dict | None = None
        self.events: list[dict] = []
        self._buf = {"a": {"feint": False, "push": False}, "b": {"feint": False, "push": False}}

    # ----- 조회 -----
    @property
    def time_limit_frames(self) -> float:
        return self.cfg["MATCH"]["TIME_LIMIT"] * LOGIC_FPS

    @property
    def time_left(self) -> float:
        return max(0.0, (self.time_limit_frames - self.frame) / LOGIC_FPS)

    def fighter_of(self, player_id: str) -> Fighter | None:
        if self.a.player_id == player_id:
            return self.a
        if self.b.player_id == player_id:
            return self.b
        return None

    def emit(self, event: dict) -> None:
        self.events.append(event)
        # 맞은 순간 멈춤
        J = self.cfg["JUICE"]
        kind = event["type"]
        stop = 0
        if kind == "hit":
            stop = J["HITSTOP_CHARGE"] if event["charged"] else J["HITSTOP_PUSH"]
        elif kind == "clash":
            stop = J["HITSTOP_CLASH"]
        elif kind in ("whiff", "feintHold"):
            stop = J["HITSTOP_WHIFF"]
        elif kind == "blocked":
            stop = J["HITSTOP_HOLD"]
        if stop > self.hitstop:
            self._pending_hitstop = max(getattr(self, "_pending_hitstop", 0), stop)

    def start(self) -> None:
        self.running = True

    def pop_events(self) -> list[dict]:
        out, self.events = self.events, []
        return out

    # ----- 한 프레임 -----
    def step(self, in_a: dict | None, in_b: dict | None) -> None:
        if self.hitstop > 0:
            # 멈춘 동안 들어온 순간 입력은 버리지 않고 모아 둔다
            self.hitstop = max(0.0, self.hitstop - 1)
            self._buffer("a", in_a)
            self._buffer("b", in_b)
            return
        in_a = self._flush("a", in_a)
        in_b = self._flush("b", in_b)
        active = self.running and not self.over
        ia = in_a if active and in_a else EMPTY_INPUT
        ib = in_b if active and in_b else EMPTY_INPUT
        self._pending_hitstop = 0

        self.a.update(1, ia, self.sway_a.force(self.frame, 1) if active else 0.0, self.emit)
        self.b.update(1, ib, self.sway_b.force(self.frame, 1) if active else 0.0, self.emit)
        if active:
            self._resolve_combat()
            self.frame += 1
            self._check_end()
        if self._pending_hitstop:
            self.hitstop = max(self.hitstop, self._pending_hitstop)

    def _buffer(self, key: str, inp: dict | None) -> None:
        if not inp:
            return
        if inp.get("feintPressed"):
            self._buf[key]["feint"] = True
        if inp.get("pushDown"):
            self._buf[key]["push"] = True

    def _flush(self, key: str, inp: dict | None) -> dict | None:
        buf = self._buf[key]
        if not buf["feint"] and not buf["push"]:
            return inp
        base = inp or EMPTY_INPUT
        out = {**base, "feintPressed": base["feintPressed"] or buf["feint"], "pushDown": base["pushDown"] or buf["push"]}
        buf["feint"] = False
        buf["push"] = False
        return out

    # ----- 상성 판정 -----
    def _resolve_combat(self) -> None:
        a, b = self.a, self.b
        if a.fallen or b.fallen or a.won or b.won:
            return
        if self._try_clash(a, b) or self._try_clash(b, a):
            return
        self._resolve_push(a, b)
        if a.fallen or b.fallen:
            return
        self._resolve_push(b, a)
        if a.fallen or b.fallen:
            return
        self._feint_vs_hold(a, b)
        self._feint_vs_hold(b, a)

    @staticmethod
    def _push_just_active(f: Fighter) -> bool:
        return f.state == "push" and not f.push_resolved

    def _push_imminent(self, f: Fighter) -> bool:
        A = self.cfg["ACTION"]
        if f.state == "release":
            return A["CHARGE_RELEASE"] - f.state_frame <= CLASH_WINDOW
        if f.state == "windup" and not f.input["pushDown"]:
            return A["PUSH_WINDUP"] - f.state_frame <= CLASH_WINDOW
        return False

    def _try_clash(self, a: Fighter, b: Fighter) -> bool:
        if not self._push_just_active(a):
            return False
        both_now = self._push_just_active(b)
        b_soon = self._push_imminent(b)
        if not both_now and not b_soon:
            return False
        if b_soon:
            b.begin_push(self.emit, b.state == "release")
        a.push_resolved = True
        b.push_resolved = True
        clash = self.cfg["IMPACT"]["CLASH"]
        total = a.power + b.power
        a.take_impulse(-clash * (2 * b.power / total) * max(1, b.power * 0.8), self.emit)
        b.take_impulse(-clash * (2 * a.power / total) * max(1, a.power * 0.8), self.emit)
        a.stats["clashes"] += 1
        b.stats["clashes"] += 1
        self.emit({"type": "clash", "a": a.key, "b": b.key, "power": max(a.power, b.power)})
        return True

    def _resolve_push(self, att: Fighter, de: Fighter) -> None:
        if not self._push_just_active(att):
            return
        att.push_resolved = True
        I = self.cfg["IMPACT"]
        p = att.power

        if de.in_feint_window:
            # 손빼기 판정 창 안 → 헛손질
            de.feint_consumed = True
            de.record_feint_success()
            att.stats["whiffs"] += 1
            whiff = I["WHIFF"] * p * (1 + I["WHIFF_LEAN_MULT"] * att.forward_lean)
            att.squash = 10
            att.take_impulse(whiff, self.emit)
            self.emit({"type": "whiff", "attacker": att.key, "feinter": de.key, "power": p, "charged": att.charged})
            de.set_state("recover", 6)
            return

        if de.state == "hold":
            # 버티기 성공 (차지 밀기는 일부 뚫는다)
            de.stats["holdsSucceeded"] += 1
            ratio = I["HOLD_ABSORB"] + (I["HOLD_BREAK_MULT"] * att.charge if att.charged else 0)
            de.body.apply_impulse(-I["PUSH"] * p * ratio)
            de.stamina = max(0.0, de.stamina - 15)
            de.flash = 3
            att.take_impulse(-I["HOLD_REBOUND"] * math.sqrt(p), self.emit)
            self.emit({"type": "blocked", "attacker": att.key, "holder": de.key, "power": p, "charged": att.charged})
            return

        mult = 1.0
        kind = "normal"
        if de.state == "holdStart":
            mult, kind = I["HOLD_FAIL_MULT"], "holdFail"
        elif de.state in ("windup", "charge", "release"):
            mult, kind = I["COUNTER_MULT"], "counter"
        elif de.state == "feintRecover":
            mult, kind = I["EXPOSED_MULT"], "exposed"
        elif de.state == "stagger":
            mult, kind = I["STAGGER_MULT"], "stagger"
        if kind in ("counter", "holdFail"):
            de.interrupt(10)

        att.stats["pushesLanded"] += 1
        att.body.apply_impulse(-I["PUSH_RECOIL"] * p)
        de.flash = 3
        de.take_impulse(-I["PUSH"] * p * mult, self.emit)
        self.emit({
            "type": "hit", "attacker": att.key, "defender": de.key, "power": p * mult,
            "charged": att.charged, "kind": kind,
        })

    def _feint_vs_hold(self, feinter: Fighter, holder: Fighter) -> None:
        if not feinter.in_feint_window or holder.state != "hold":
            return
        feinter.feint_consumed = True
        feinter.record_feint_success()
        holder.squash = 8
        holder.set_state("idle")
        holder.take_impulse(self.cfg["IMPACT"]["FEINT_VS_HOLD"], self.emit)
        feinter.set_state("recover", 6)
        self.emit({"type": "feintHold", "feinter": feinter.key, "holder": holder.key})

    # ----- 승패 -----
    def _check_end(self) -> None:
        a, b = self.a, self.b
        if a.fallen or b.fallen:
            if a.fallen and b.fallen:
                # 같은 프레임에 둘 다 넘어지면 한계를 더 많이 넘은 쪽이 진다(거의 같으면 무승부)
                diff = a.fall_overshoot - b.fall_overshoot
                if abs(diff) < 0.05:
                    self._finish("draw", "ko")
                else:
                    self._finish("b" if diff > 0 else "a", "ko")
                return
            winner = b if a.fallen else a
            winner.won = True
            winner.end_action()
            self._finish(winner.key, "ko")
            return
        if self.frame >= self.time_limit_frames:
            da, db = abs(a.body.b), abs(b.body.b)
            winner = "draw"
            if da + 0.5 < db:
                winner = "a"
            elif db + 0.5 < da:
                winner = "b"
            for f in (a, b):
                f.end_action()
                f.frozen = True
            if winner == "a":
                a.won = True
            if winner == "b":
                b.won = True
            self.emit({"type": "timeUp", "winner": winner})
            self._finish(winner, "time")

    def _finish(self, winner: str, reason: str) -> None:
        self.over = True
        self.running = False
        self.result = {
            "winner": winner, "reason": reason, "timeLeft": self.time_left,
            "stability": {
                "a": 0 if self.a.fallen else self.a.body.stability,
                "b": 0 if self.b.fallen else self.b.body.stability,
            },
        }
        self.emit({"type": "matchEnd", "result": self.result})

    def forfeit(self, key: str) -> None:
        """한쪽이 나가서 경기를 더 할 수 없을 때: 남은 쪽의 승리로 끝낸다."""
        if self.over:
            return
        winner = self.b if key == "a" else self.a
        winner.won = True
        winner.end_action()
        self._finish(winner.key, "forfeit")

    # ----- 점수 -----
    def score_of(self, key: str) -> dict:
        """원본 Score.js 의 공식. 이긴 쪽·진 쪽 모두 같은 공식으로 계산한다."""
        S = self.cfg["SCORE"]
        f = self.a if key == "a" else self.b
        res = self.result or {"winner": "draw", "reason": "time", "timeLeft": 0, "stability": {"a": 0, "b": 0}}
        won = res["winner"] == key
        stability = math.floor(res["stability"][key] + 0.5)
        time_left = math.floor(res["timeLeft"])
        feints = min(f.stats["cleanFeints"], S["FEINT_MAX_COUNT"])
        time_counts = won and (not S["TIME_ONLY_ON_KO"] or res["reason"] == "ko")
        breakdown = [
            {"key": "win", "label": "승리 보너스", "count": 1 if won else 0, "points": S["WIN_BONUS"] if won else 0},
            {"key": "balance", "label": "남은 균형", "count": stability, "points": stability * S["BALANCE_POINT"]},
            {"key": "feint", "label": "페인트 성공", "count": feints, "points": feints * S["FEINT_POINT"]},
            {"key": "hold", "label": "버티기 성공", "count": f.stats["holdsSucceeded"],
             "points": f.stats["holdsSucceeded"] * S["HOLD_POINT"]},
            {"key": "push", "label": "밀기 명중", "count": f.stats["pushesLanded"],
             "points": f.stats["pushesLanded"] * S["PUSH_POINT"]},
            {"key": "time", "label": "남은 시간", "count": time_left if time_counts else 0,
             "points": time_left * S["TIME_POINT"] if time_counts else 0},
        ]
        return {"total": sum(x["points"] for x in breakdown), "won": won, "breakdown": breakdown}

    def snapshot(self) -> dict:
        return {
            "frame": self.frame, "hitstop": self.hitstop, "running": self.running, "over": self.over,
            "result": self.result, "timeLeft": self.time_left,
            "wobble": self.sway_a.growth(self.frame),
            "a": self.a.snapshot(), "b": self.b.snapshot(),
        }
