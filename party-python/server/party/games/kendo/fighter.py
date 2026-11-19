"""검도 선수 — 원본 js/game/fighter.js 를 옮긴 것(수련용 '부위 열어주기'와 AI 전용 동작은 뺐다).

컨트롤러가 매 틱 "의도(intent)" 를 만들고, Fighter 는 그 의도로 이동·기합·타격·막기·경직 상태를 갱신한다.
    intent = {move: -1|0|1 (월드 방향), attack: 'men'|'kote'|'do'|None, attackPressed,
              block, blockPressed, kiai, kiaiPressed}
상태: idle(겨눔) / move(발놀림) / strike(타격) / block(막기) / stagger(무너짐) / stun(기세 0 경직)
      sonkyo(준거) / frozen(정지)
"""

from __future__ import annotations

import math


def sign(v: float) -> int:
    return 1 if v > 0 else -1 if v < 0 else 0


class Fighter:
    def __init__(self, cfg: dict, name: str, side: str, facing: int, player_id: str | None = None):
        self.cfg = cfg
        self.name = name
        self.side = side                # 'red'(홍) | 'white'(백)
        self.facing = facing            # 1 = 오른쪽, -1 = 왼쪽
        self.player_id = player_id
        self.reach = 0
        self.speed_mul = 1
        self.strike_speed_mul = 1
        self.reset(0.0)

    def reset(self, x: float) -> None:
        self.x = x
        self.vx = 0.0
        self.state = "idle"
        self.state_t = 0
        self.state_dur = 0
        self.momentum = self.cfg["MOMENTUM"]["MAX"]
        self.kiai = 0.0
        self.kiai_holding = False
        self.last_kiai_press = -9999
        self.strike: dict | None = None
        self.block_t = 0
        self.counter_t = 0
        self.parry_cd_t = 0
        self.block_hit = False
        self.block_no_parry = False
        self.move_rel = 0
        self.flinch_t = 0
        self.squash_t = 0
        self.step_t = 0
        self.step_frame = 0

    def set_state(self, s: str, dur: int = 0) -> None:
        self.state = s
        self.state_t = 0
        self.state_dur = dur

    @property
    def can_act(self) -> bool:
        return self.state in ("idle", "move")

    def strike_phase(self) -> str | None:
        s = self.strike
        if not s:
            return None
        if s["t"] < s["startup"]:
            return "windup"
        if s["t"] == s["startup"]:
            return "active"
        return "recover"

    def snapshot(self) -> dict:
        """판정용 상태 요약."""
        s = self.strike
        return {
            "state": self.state, "moveRel": self.move_rel, "strikeType": s["type"] if s else None,
            "phase": self.strike_phase(), "recoverBad": s["bad"] if s else False,
        }

    def add_momentum(self, v: float) -> None:
        self.momentum = max(0, min(self.cfg["MOMENTUM"]["MAX"], self.momentum + v))

    def stagger(self, ticks: int) -> None:
        """받아치기 당함 → 무너짐."""
        self.strike = None
        self.vx = -self.facing * 0.9
        self.set_state("stagger", ticks)

    def stun(self) -> None:
        """기세 0 → 경직."""
        self.strike = None
        self.vx = 0.0
        self.set_state("stun", self.cfg["MOMENTUM"]["STUN_TICKS"])

    def on_parry(self) -> None:
        self.counter_t = self.cfg["PARRY"]["COUNTER_TICKS"]
        self.add_momentum(self.cfg["MOMENTUM"]["PARRY_GAIN"])

    def flinch(self) -> None:
        self.flinch_t = 8

    def freeze(self, state: str = "frozen") -> None:
        self.strike = None
        self.vx = 0.0
        self.set_state(state)

    # ── 매 틱 갱신 ──
    def update(self, intent: dict, w) -> None:
        C = self.cfg
        K, M = C["KIAI"], C["MOMENTUM"]
        self.state_t += 1
        if self.flinch_t > 0:
            self.flinch_t -= 1
        if self.squash_t > 0:
            self.squash_t -= 1
        if self.counter_t > 0:
            self.counter_t -= 1
        if self.parry_cd_t > 0:
            self.parry_cd_t -= 1

        disabled = self.state in ("stun", "stagger", "frozen", "sonkyo")

        # 기합 게이지: 누르는 동안 차오르고, 놓으면 서서히 줄어든다
        if not disabled and intent.get("kiaiPressed"):
            self.last_kiai_press = w.frame
            w.on_kiai(self)
        if not disabled and intent.get("kiai"):
            self.kiai = min(K["MAX"], self.kiai + K["CHARGE"])
            self.kiai_holding = True
        else:
            self.kiai = max(0, self.kiai - K["DECAY"])
            self.kiai_holding = False

        st = self.state
        if st in ("idle", "move"):
            if intent.get("attack"):
                self.start_strike(intent["attack"], w)
            elif intent.get("block"):
                self.start_block()
            else:
                self.apply_move(intent.get("move"), C["MOVE"]["KIAI_MUL"] if intent.get("kiai") else 1)
                self.state = "move" if abs(self.vx) > 0.15 else "idle"
        elif st == "block":
            self.block_t += 1
            if intent.get("attack"):          # 막은 직후 바로 반격할 수 있다
                self.end_block()
                self.start_strike(intent["attack"], w)
            elif not intent.get("block"):
                self.end_block()
                self.set_state("idle")
            else:
                self.apply_move(intent.get("move"), C["MOVE"]["BLOCK_MUL"])
                self.add_momentum(-M["BLOCK_DRAIN"])
        elif st == "strike":
            self.update_strike(w)
        elif st == "stagger":
            self.vx *= 0.82
            if self.state_t >= self.state_dur:
                self.set_state("idle")
        elif st == "stun":
            self.vx *= 0.8
            if self.state_t >= self.state_dur:
                self.set_state("idle")
                self.momentum = M["STUN_RECOVER"]
        elif st in ("frozen", "sonkyo"):
            self.vx = 0.0

        # 이동 방향 (상대 쪽으로 = +1, 뒤로 = −1)
        self.move_rel = sign(self.vx) * self.facing if abs(self.vx) > 0.2 else 0

        # 기세: 겨눔·압박하면 회복, 물러나면 감소
        if self.state == "idle":
            self.add_momentum(M["REGEN"])
        elif self.state == "move":
            self.add_momentum(M["SEME_GAIN"] if self.move_rel > 0 else -M["RETREAT_DRAIN"] if self.move_rel < 0 else 0)

        self.x += self.vx

        # 발놀림 애니메이션
        if self.state == "move":
            self.step_t += 1
            if self.step_t >= C["ANIM_TICKS"] + 1:
                self.step_t = 0
                self.step_frame = (self.step_frame + (1 if self.move_rel >= 0 else 3)) % 4
                if self.step_frame == 0:
                    w.on_step(self)
        else:
            self.step_t = 0
            self.step_frame = 0

    def start_block(self) -> None:
        self.set_state("block")
        self.block_t = 0
        self.block_hit = False
        self.block_no_parry = self.parry_cd_t > 0
        self.vx *= 0.5

    def end_block(self) -> None:
        """막기 끝. 받아치기 시간 안에 아무것도 닿지 않았으면 "헛막기" → 잠깐 받아치기 불가 + 기세 감소."""
        P = self.cfg["PARRY"]
        if not self.block_hit and self.block_t <= P["WINDOW"] + 2:
            self.parry_cd_t = P["MISS_COOLDOWN"]
            self.add_momentum(-P["MISS_MOMENTUM"])

    @property
    def parry_active(self) -> bool:
        return self.state == "block" and not self.block_no_parry and self.block_t <= self.cfg["PARRY"]["WINDOW"]

    def apply_move(self, direction, mul: float) -> None:
        """밀어걷기: 가속·감속이 있는 미끄러지는 움직임."""
        MV = self.cfg["MOVE"]
        if direction:
            target = direction * MV["MAX"] * self.speed_mul * mul
            dv = target - self.vx
            self.vx += max(-MV["ACCEL"], min(MV["ACCEL"], dv))
        else:
            self.vx *= MV["FRICTION"]
            if abs(self.vx) < 0.03:
                self.vx = 0.0

    def start_strike(self, stype: str, w) -> None:
        """타격 시작: 기합 게이지가 충분하면 소모하고 "유효 기합" 으로 표시."""
        C = self.cfg
        S = C["STRIKES"][stype]
        startup = S["startup"] / self.strike_speed_mul
        lunge = S["lunge"]
        counter = False
        if self.counter_t > 0:               # 받아치기 직후의 반격은 빠르다
            startup *= C["PARRY"]["COUNTER_SPEED"]
            lunge *= C["PARRY"]["COUNTER_LUNGE"]
            counter = True
            self.counter_t = 0
        startup = max(4, math.floor(startup + 0.5))
        kiai_gauge = math.floor(self.kiai + 0.5)
        kiai_ok = self.kiai >= C["KIAI"]["REQUIRED"]
        if kiai_ok:
            self.kiai -= C["KIAI"]["COST"]
        self.strike = {
            "type": stype, "t": 0, "startup": startup, "recover": S["recover"], "lungeStep": lunge / startup,
            "extra": 0, "bad": False, "result": None, "counter": counter, "kiaiOk": kiai_ok, "kiaiGauge": kiai_gauge,
            "moveRelAtStart": self.move_rel, "momentumAtStart": self.momentum,
        }
        self.set_state("strike")
        self.vx = 0.0

    def update_strike(self, w) -> None:
        C = self.cfg
        s = self.strike
        S = C["STRIKES"][s["type"]]
        s["t"] += 1
        if s["t"] < s["startup"]:
            self.x += self.facing * s["lungeStep"]       # 들어올리며 앞으로 디딤
        elif s["t"] == s["startup"]:
            self.x += self.facing * s["lungeStep"]       # 발구름 + 접촉 판정
            self.squash_t = 4
            res = w.on_strike_active(self)
            if self.state != "strike":                   # 받아치기 당해 무너짐 등
                return
            s["result"] = res["kind"]
            if res["kind"] == "whiff":
                s["bad"], s["extra"] = True, S["whiffExtra"]
            elif res["kind"] == "blocked":
                s["bad"], s["extra"] = True, C["BLOCKED_EXTRA"]
            elif res["kind"] == "deflected":
                s["bad"], s["extra"] = True, C["DEFLECT_EXTRA"]
        else:
            if s["result"] == "contact" and s["t"] < s["startup"] + 10:
                self.x += self.facing * 0.45             # 머리·허리는 친 뒤 조금 더 밀고 나간다
            if s["t"] >= s["startup"] + s["recover"] + s["extra"]:
                self.strike = None
                self.set_state("idle")

    # ── 화면용 상태 ──
    def view(self) -> dict:
        s = self.strike
        r2 = lambda v: math.floor(v * 100 + 0.5) / 100
        return {
            "x": r2(self.x), "state": self.state, "stateT": self.state_t, "momentum": r2(self.momentum),
            "kiai": r2(self.kiai), "kiaiHolding": self.kiai_holding,
            "strike": [s["type"], s["t"], s["startup"], s["recover"], s["extra"], s["bad"], s["result"]] if s else None,
            "blockT": self.block_t, "counterT": self.counter_t, "flinchT": self.flinch_t, "squashT": self.squash_t,
            "stepFrame": self.step_frame,
        }
