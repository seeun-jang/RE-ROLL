"""복서 한 명 — 원본 js/fighter.js 의 규칙 부분(이동 · 대시 · 가드 · 잽/강펀치 · 피격)을 그대로 옮긴 것.

그림(글러브 위치 · 몸 기울기)은 브라우저가 맡으므로 여기에는 없다.
한 번 update() = 1/60초.
"""

from __future__ import annotations

import math


def js_round(x: float) -> int:
    """JavaScript 의 Math.round (0.5 는 올림)."""
    return math.floor(x + 0.5)


class Fighter:
    def __init__(self, cfg: dict, player_id: str, name: str, corner: str):
        self.cfg = cfg
        self.player_id = player_id
        self.name = name
        self.corner = corner                      # 'red'(왼쪽에서 시작) | 'blue'(오른쪽에서 시작)
        self.facing = 1 if corner == "red" else -1
        R = cfg["RING"]
        self.x = float(R["LEFT"] + R["START_GAP"] if corner == "red" else R["RIGHT"] - R["START_GAP"])
        self.vx = 0.0
        self.hp = cfg["FIGHTER"]["HP"]
        self.state = "idle"                       # idle | walk | guard | charge | punch | stun | ko | win
        self.t = 0                                # 지금 상태가 된 뒤 지난 프레임
        self.punch: dict | None = None            # {"kind", "t", "hit"}
        self.charge_t = 0
        self.stun = 0
        self.flash = 0
        self.squash = 0
        self.block_shake = 0
        self.slip_t = 0
        self.counter_t = 0                        # 0 보다 크면 카운터 찬스(다음 펀치 피해 2배)
        self.guard_start = -99                    # 가드를 시작한 프레임(슥 판정용)
        self.last_fwd_tap = -99
        self.prev_fwd = False
        self.prev_skill = False
        self.hits = 0
        self.damage_dealt = 0

    # ctrl: {"left", "right", "skill"(펀치 키를 누르고 있는지), "down"(가드 키)}
    def update(self, bout, ctrl: dict, opp: "Fighter") -> None:
        F = self.cfg["FIGHTER"]
        self.t += 1
        if self.flash > 0:
            self.flash -= 1
        if self.block_shake > 0:
            self.block_shake -= 1
        if self.slip_t > 0:
            self.slip_t -= 1
        if self.counter_t > 0:
            self.counter_t -= 1
        if self.squash != 0:
            self.squash -= 1 if self.squash > 0 else -1

        # 항상 상대를 바라본다
        if self.state != "ko":
            self.facing = 1 if opp.x >= self.x else -1
        fwd_key = ctrl["right"] if self.facing == 1 else ctrl["left"]
        back_key = ctrl["left"] if self.facing == 1 else ctrl["right"]

        # 대시: 앞키 두 번 톡톡
        fwd_tap = fwd_key and not self.prev_fwd
        self.prev_fwd = fwd_key

        if self.state in ("ko", "win") or bout.frozen:
            self.vx *= F["FRICTION"]
            self.move()
            self.prev_skill = ctrl["skill"]
            return

        if self.state == "stun":
            self.stun -= 1
            if self.stun <= 0:
                self.set_state("idle")
        elif self.state == "punch":
            self.update_punch(bout, opp)
        elif self.state == "charge":
            # 강펀치를 모으는 중: 조금 느리게 앞뒤로 움직일 수 있다
            self.charge_t += 1
            if fwd_key and not back_key:
                self.vx += (self.facing * F["MAX_SPEED"] * F["CHARGE_MOVE"] - self.vx) * F["ACCEL"]
            elif back_key and not fwd_key:
                self.vx += (-self.facing * F["GUARD_SPEED"] * F["CHARGE_MOVE"] - self.vx) * F["ACCEL"]
            else:
                self.vx *= F["FRICTION"]
            if not ctrl["skill"]:
                self.start_punch("power" if self.charge_t >= F["CHARGE_TIME"] else "jab", bout)
        else:
            # 이동 / 가드
            if fwd_tap and not back_key and bout.frame - self.last_fwd_tap <= F["DASH_WINDOW"]:
                self.vx = self.facing * F["DASH_SPEED"]
                self.squash = -2
                bout.emit({"type": "dash", "side": self.corner})
                self.last_fwd_tap = -99
            elif fwd_tap:
                self.last_fwd_tap = bout.frame

            if ctrl["down"]:
                # 가드: 제자리에서 막는다
                if self.state != "guard":
                    self.guard_start = bout.frame
                self.set_state("guard", True)
                self.vx *= F["FRICTION"]
            elif back_key:
                self.set_state("walk", True)
                self.vx += (-self.facing * F["GUARD_SPEED"] - self.vx) * F["ACCEL"]
            elif fwd_key:
                self.set_state("walk", True)
                self.vx += (self.facing * F["MAX_SPEED"] - self.vx) * F["ACCEL"]
            else:
                self.set_state("idle", True)
                self.vx *= F["FRICTION"]
            # 펀치 키를 누르기 시작 → 모으기
            if ctrl["skill"] and not self.prev_skill:
                self.set_state("charge")
                self.charge_t = 0
        self.prev_skill = ctrl["skill"]
        self.move()

    def set_state(self, s: str, keep_t: bool = False) -> None:
        if self.state == s and keep_t:
            return
        self.state = s
        self.t = 0

    def move(self) -> None:
        R = self.cfg["RING"]
        self.x += self.vx
        if abs(self.vx) < 0.02:
            self.vx = 0.0
        # 로프에 닿으면 살짝 튕긴다
        if self.x < R["LEFT"]:
            self.x = float(R["LEFT"])
            self.vx = abs(self.vx) * 0.4
        if self.x > R["RIGHT"]:
            self.x = float(R["RIGHT"])
            self.vx = -abs(self.vx) * 0.4

    def start_punch(self, kind: str, bout) -> None:
        self.set_state("punch")
        self.punch = {"kind": kind, "t": 0, "hit": False}
        self.vx += self.facing * (1.6 if kind == "power" else 0.6)   # 체중을 실어 앞으로
        bout.emit({"type": "punch", "side": self.corner, "kind": kind})

    def update_punch(self, bout, opp: "Fighter") -> None:
        P = self.cfg["PUNCH"][self.punch["kind"]]
        self.punch["t"] += 1
        t = self.punch["t"]
        self.vx *= 0.85
        # 판정 구간
        if not self.punch["hit"] and P["startup"] < t <= P["startup"] + P["active"]:
            if abs(opp.x - self.x) <= P["range"] and opp.state != "ko":
                self.punch["hit"] = True
                bout.resolve_hit(self, opp, self.punch["kind"])
        if t >= P["startup"] + P["active"] + P["recovery"]:
            self.set_state("idle")

    def take_hit(self, attacker: "Fighter", kind: str, bout) -> dict:
        """맞았을 때. 돌려주는 값: {"dmg", "blocked", "slip", "counter", "broken"}"""
        P = self.cfg["PUNCH"][kind]
        G = self.cfg["GUARD"]
        C = self.cfg["COUNTER"]
        guarding = self.state == "guard" and self.facing == -attacker.facing
        dmg = P["damage"]
        counter = attacker.counter_t > 0
        if counter:
            dmg *= C["COUNTER_MUL"]
            attacker.counter_t = 0
        push = P["push"]
        blocked = False
        broken = False
        if guarding and bout.frame - self.guard_start <= C["SLIP_WINDOW"]:
            # 슥! 몸을 빼서 완전히 피한다 → 카운터 찬스, 헛친 상대는 비틀
            self.slip_t = 14
            self.counter_t = C["COUNTER_TIME"]
            attacker.set_state("stun")
            attacker.stun = C["ATTACKER_STAGGER"]
            self.vx = attacker.facing * 1.4
            return {"dmg": 0, "blocked": True, "slip": True, "counter": False, "broken": False}
        if guarding:
            blocked = True
            self.block_shake = 8
            dmg = max(1, js_round(dmg * G["DAMAGE_MUL"]))
            push *= G["PUSH_MUL"]
            if kind == "power" and G["BREAK_POWER"]:
                # 강펀치는 가드를 깨고 비틀거리게 한다
                self.set_state("stun")
                self.stun = G["BREAK_STUN"]
                broken = True
        else:
            self.set_state("stun")
            self.stun = P["stun"]
            self.flash = 8
            self.squash = 3
        self.hp = max(0, self.hp - dmg)
        self.vx = attacker.facing * push
        attacker.hits += 1
        attacker.damage_dealt += dmg
        return {"dmg": dmg, "blocked": blocked, "slip": False, "counter": counter and not blocked, "broken": broken}

    def snapshot(self) -> dict:
        """화면이 그리는 데 필요한 값."""
        p = self.punch
        return {
            "x": round(self.x, 2), "vx": round(self.vx, 3), "hp": self.hp, "facing": self.facing,
            "state": self.state, "t": self.t,
            "punch": [p["kind"], p["t"]] if p is not None and self.state == "punch" else None,
            "chargeT": self.charge_t, "flash": self.flash, "squash": self.squash,
            "blockShake": self.block_shake, "slipT": self.slip_t, "counterT": self.counter_t,
            "hits": self.hits, "damage": self.damage_dealt,
        }
