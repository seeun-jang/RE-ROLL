"""마법사 1:1 결투 한 판 (순수 규칙. 화면·통신과 분리)

원본 src/game/Battle.js 의 규칙을 사람 대 사람으로 옮겼다.
- 양쪽 모두 원본의 '플레이어'와 같은 조건이다(체력 100, 마나 100, 주문 6개, 쿨다운, 콤보).
- 원본의 적 전용 요소(공격 예고, 화염 방벽, 분노 단계, 속성 친화)는 없다.
- 투사체끼리 만나면 상성(불 → 바람 → 번개 → 물 → 불)으로 상쇄된다.
- 얼음 방패는 투사체와 낙뢰(썬더)를 모두 막는다.

자리 이름: 'a' = 왼쪽(오른쪽을 본다), 'b' = 오른쪽(왼쪽을 본다).
1/60초 단위로 step() 을 부른다. 일어난 일은 emit 으로 알린다(화면 효과·소리용).
"""

from __future__ import annotations

import math
from typing import Callable

from .config import LOGIC_FPS, SPELL_BY_ID, beats

DT = 1.0 / LOGIC_FPS


def jround(x: float) -> int:
    """JS 의 Math.round 와 같은 반올림(.5 는 올림)."""
    return math.floor(x + 0.5)


class Mage:
    def __init__(self, key: str, pid: str, cfg: dict):
        L, P = cfg["LAYOUT"], cfg["PLAYER"]
        self.key = key
        self.id = pid
        self.x = L["LEFT_X"] if key == "a" else L["RIGHT_X"]
        self.y = L["GROUND_Y"]
        self.facing = 1 if key == "a" else -1
        self.max_hp = P["MAX_HP"]
        self.hp = float(P["MAX_HP"])
        self.max_mana = P["MAX_MANA"]
        self.mana = float(P["MAX_MANA"])
        self.mana_regen = P["MANA_REGEN"]
        self.shield: dict | None = None        # {hp, max, time, duration}
        self.cooldowns: dict[str, float] = {}
        self.combo = {"count": 0, "last": None, "timer": 0.0}
        self.max_combo = 0
        self.stats = {"casts": 0, "fails": 0, "damageDealt": 0, "damageTaken": 0, "counters": 0, "blocks": 0}

    @property
    def cast_x(self) -> float:
        return self.x + self.facing * 9

    @property
    def cast_y(self) -> float:
        return self.y - 20

    @property
    def center_y(self) -> float:
        return self.y - 15

    def update(self, dt: float, combo_window: float) -> None:
        if self.hp > 0:
            self.mana = min(self.max_mana, max(0.0, self.mana + self.mana_regen * dt))
        if self.shield is not None:
            self.shield["time"] -= dt
            if self.shield["time"] <= 0 or self.shield["hp"] <= 0:
                self.shield = None
        for sid in self.cooldowns:
            if self.cooldowns[sid] > 0:
                self.cooldowns[sid] = max(0.0, self.cooldowns[sid] - dt)
        c = self.combo
        if c["timer"] > 0:
            c["timer"] -= dt
            if c["timer"] <= 0:
                c["count"] = 0
                c["last"] = None

    def snapshot(self) -> dict:
        s = self.shield
        return {
            "id": self.id, "hp": self.hp, "mana": self.mana,
            "shield": {"hp": s["hp"], "max": s["max"], "time": s["time"]} if s else None,
            "cd": {sid: v for sid, v in self.cooldowns.items() if v > 0},
            "combo": self.combo["count"], "comboTimer": max(0.0, self.combo["timer"]),
        }


class Duel:
    def __init__(self, cfg: dict, a_id: str, b_id: str, emit: Callable[[dict], None] | None = None):
        self.cfg = cfg
        self.a = Mage("a", a_id, cfg)
        self.b = Mage("b", b_id, cfg)
        self._emit = emit or (lambda e: None)
        self.projectiles: list[dict] = []
        self.strikes: list[dict] = []
        self._next_id = 1
        self.state = "ready"            # ready → fight → over
        self.time = 0.0
        self.time_limit = float(cfg["BATTLE"]["TIME_LIMIT"])
        self.time_left = self.time_limit
        self.hitstop = 0
        self.frame = 0
        self.result: dict | None = None

    # ------------------------------------------------------------------
    def mage(self, key: str) -> Mage:
        return self.a if key == "a" else self.b

    def other(self, key: str) -> Mage:
        return self.b if key == "a" else self.a

    def key_of(self, pid: str) -> str | None:
        return "a" if pid == self.a.id else "b" if pid == self.b.id else None

    @property
    def fighting(self) -> bool:
        return self.state == "fight"

    @property
    def over(self) -> bool:
        return self.state == "over"

    def start(self) -> None:
        if self.state == "ready":
            self.state = "fight"

    def emit(self, event: dict) -> None:
        self._emit(event)

    def _hit_stop(self, power: float) -> None:
        B = self.cfg["BATTLE"]
        self.hitstop = max(self.hitstop, jround(B["HITSTOP_BASE"] + B["HITSTOP_POWER"] * power))

    # ------------------------------------------------------------------
    # 시전
    # ------------------------------------------------------------------
    def cast(self, key: str, spell_id: str, source: str = "key") -> dict:
        """주문 시전. {"ok": bool, "reason": ...}"""
        spell = SPELL_BY_ID.get(spell_id)
        m = self.mage(key)
        if not self.fighting:
            return {"ok": False, "reason": "notready"}
        reason = None
        if spell is None:
            reason = "unknown"
        elif m.cooldowns.get(spell_id, 0) > 0:
            reason = "cooldown"
        elif m.mana < spell["mana"]:
            reason = "mana"
        if reason:
            m.stats["fails"] += 1
            self.emit({"type": "castFail", "who": key, "spell": spell_id if spell else None, "reason": reason})
            return {"ok": False, "reason": reason}

        C = self.cfg["COMBO"]
        m.mana -= spell["mana"]
        m.cooldowns[spell_id] = spell["cooldown"]
        c = m.combo
        if c["timer"] > 0 and c["last"] and c["last"] != spell["element"]:
            c["count"] += 1
        else:
            c["count"] = 1
        c["last"] = spell["element"]
        c["timer"] = C["WINDOW"]
        m.max_combo = max(m.max_combo, c["count"])
        bonus = min(C["MAX_BONUS"], (c["count"] - 1) * C["STEP_BONUS"]) if c["count"] >= 2 else 0.0
        power = self.cfg["POWER"]["FIXED"]
        tier_mult = self.cfg["POWER"]["MULT"]
        mult = tier_mult * (1 + (bonus if spell.get("damage") else 0.0))
        m.stats["casts"] += 1

        event = {"type": "cast", "who": key, "spell": spell_id, "element": spell["element"], "kind": spell["type"],
                 "combo": c["count"], "source": source}
        kind = spell["type"]
        if kind == "projectile":
            proj = {
                "id": self._next_id, "owner": key, "element": spell["element"], "spell": spell_id,
                "x": m.cast_x, "y": m.cast_y, "vx": m.facing * spell["speed"] * (0.9 + power * 0.3),
                "damage": spell["damage"] * mult, "power": power, "alive": True,
            }
            self._next_id += 1
            self.projectiles.append(proj)
            event["proj"] = proj["id"]
        elif kind == "strike":
            self.strikes.append({
                "owner": key, "target": self.other(key).key, "element": spell["element"],
                "damage": spell["damage"] * mult, "power": power, "delay": spell.get("delay", 0.15),
            })
        elif kind == "shield":
            hp = jround(spell["shield"] * tier_mult)
            m.shield = {"hp": float(hp), "max": float(hp), "time": spell["duration"], "duration": spell["duration"]}
            event["amount"] = hp
        elif kind == "heal":
            amount = jround(spell["heal"] * tier_mult)
            before = m.hp
            m.hp = min(m.max_hp, m.hp + amount)
            event["amount"] = jround(m.hp - before)
        self.emit(event)
        return {"ok": True, "combo": c["count"]}

    # ------------------------------------------------------------------
    # 진행 (1프레임)
    # ------------------------------------------------------------------
    def step(self) -> None:
        self.frame += 1
        # 히트 스톱: 몇 프레임 동안 모든 것을 멈춰 "손맛"을 준다
        if self.hitstop > 0:
            self.hitstop -= 1
            return
        self.time += DT
        window = self.cfg["COMBO"]["WINDOW"]
        self.a.update(DT, window)
        self.b.update(DT, window)
        if self.fighting and self.time_limit > 0:
            self.time_left = max(0.0, self.time_left - DT)
            if self.time_left <= 0:
                self._end_by_time()
                return
        self._update_projectiles()
        self._update_strikes()

    def _update_projectiles(self) -> None:
        plist = self.projectiles
        for pr in plist:
            if pr["alive"]:
                pr["x"] += pr["vx"] * DT
        # 1) 공중 상쇄 (왼쪽 사람의 투사체 vs 오른쪽 사람의 투사체)
        radius = 3
        for a in plist:
            if not a["alive"] or a["owner"] != "a":
                continue
            for b in plist:
                if not b["alive"] or b["owner"] != "b":
                    continue
                if abs(a["x"] - b["x"]) <= radius * 2 and abs(a["y"] - b["y"]) <= radius * 2 + 4:
                    self._clash(a, b)
                if not a["alive"]:
                    break
        # 2) 명중 / 방어
        for pr in plist:
            if not pr["alive"]:
                continue
            target = self.other(pr["owner"])
            if pr["owner"] == "a":      # 오른쪽으로 날아간다
                if target.shield is not None and pr["x"] + radius >= target.x - 12:
                    self._block(target, pr["damage"], pr["element"], pr["power"], pr["x"], pr["y"])
                    pr["alive"] = False
                elif pr["x"] + radius >= target.x - 6:
                    pr["alive"] = False
                    self._apply_hit(target, pr["damage"], pr["element"], pr["power"], pr["x"], pr["y"])
            else:                       # 왼쪽으로 날아간다
                if target.shield is not None and pr["x"] - radius <= target.x + 12:
                    self._block(target, pr["damage"], pr["element"], pr["power"], pr["x"], pr["y"])
                    pr["alive"] = False
                elif pr["x"] - radius <= target.x + 6:
                    pr["alive"] = False
                    self._apply_hit(target, pr["damage"], pr["element"], pr["power"], pr["x"], pr["y"])
            if pr["alive"] and (pr["x"] < -20 or pr["x"] > 340):
                pr["alive"] = False
        self.projectiles = [pr for pr in plist if pr["alive"]]

    def _update_strikes(self) -> None:
        for s in list(self.strikes):
            s["delay"] -= DT
            if s["delay"] > 0:
                continue
            self.strikes.remove(s)
            if self.over:
                continue
            target = self.mage(s["target"])
            self.emit({"type": "strike", "target": target.key})
            if target.shield is not None:
                self._block(target, s["damage"], s["element"], s["power"], target.x, target.center_y)
            else:
                self._apply_hit(target, s["damage"], s["element"], s["power"], target.x, target.center_y)

    # ----- 충돌 결과 -----
    def _clash(self, a: dict, b: dict) -> None:
        if self.over:
            return
        winner = loser = None
        both = False
        advantage = beats(a["element"], b["element"]) or beats(b["element"], a["element"])
        if beats(a["element"], b["element"]):
            winner, loser = a, b
        elif beats(b["element"], a["element"]):
            winner, loser = b, a
        else:
            diff = a["damage"] - b["damage"]
            if abs(diff) < 2:
                both = True
            else:
                winner, loser = (a, b) if diff > 0 else (b, a)
                winner["damage"] = abs(diff)
        if both:
            a["alive"] = False
            b["alive"] = False
        else:
            loser["alive"] = False
            if advantage:
                keep = self.cfg["BATTLE"]["CLASH_KEEP"]
                winner["damage"] *= keep
                winner["power"] *= keep
        self._hit_stop(0.2)
        if winner is not None and advantage:
            self.mage(winner["owner"]).stats["counters"] += 1
        self.emit({
            "type": "clash", "x": (a["x"] + b["x"]) / 2, "y": (a["y"] + b["y"]) / 2,
            "winner": winner["owner"] if winner else None, "both": both, "advantage": advantage,
            "ea": a["element"], "eb": b["element"],
        })

    def _block(self, target: Mage, damage: float, element: str, power: float, x: float, y: float) -> None:
        if self.over:
            return
        s = target.shield
        mult = self.cfg["ELEMENT"]["ICE_SHIELD_VS_FIRE"] if element == "fire" else 1
        s["hp"] -= damage * mult
        target.stats["blocks"] += 1
        self._hit_stop(0.15)
        broken = s["hp"] <= 0
        self.emit({"type": "blocked", "who": target.key, "element": element, "y": y, "broken": broken})
        if broken:
            overflow = -s["hp"] / mult
            target.shield = None
            if overflow >= 1:
                self._apply_hit(target, overflow, element, power * 0.5, target.x, target.center_y)

    def _apply_hit(self, target: Mage, damage: float, element: str, power: float, x: float, y: float) -> None:
        if self.over:
            return
        dmg = max(1, jround(damage))
        target.hp = max(0.0, target.hp - dmg)
        attacker = self.other(target.key)
        target.stats["damageTaken"] += dmg
        attacker.stats["damageDealt"] += dmg
        self._hit_stop(power)
        self.emit({"type": "hit", "target": target.key, "damage": dmg, "element": element, "power": power,
                   "x": x, "y": y})
        if target.hp <= 0:
            self._finish(attacker.key, "ko")

    # ----- 종료 -----
    def _end_by_time(self) -> None:
        ra, rb = self.a.hp / self.a.max_hp, self.b.hp / self.b.max_hp
        if abs(ra - rb) < 0.005:
            self._finish("draw", "timeout")
        else:
            self._finish("a" if ra > rb else "b", "timeout")

    def forfeit(self, key: str) -> None:
        """한쪽이 나갔을 때 — 남은 쪽이 이긴다."""
        if not self.over:
            self._finish(self.other(key).key, "forfeit")

    def _finish(self, winner: str, reason: str) -> None:
        if self.over:
            return
        self.state = "over"
        self.result = {
            "winner": winner, "reason": reason, "time": jround(self.time * 10) / 10,
            "timeLeft": jround(self.time_left * 10) / 10,
            "hp": {"a": jround(self.a.hp), "b": jround(self.b.hp)},
        }
        for pr in self.projectiles:
            pr["alive"] = False
        self.projectiles = []
        self.strikes = []
        self.hitstop = int(self.cfg["BATTLE"]["END_HITSTOP"])
        self.emit({"type": "end", "result": self.result})

    # ------------------------------------------------------------------
    def stats_of(self, key: str) -> dict:
        m = self.mage(key)
        return {**m.stats, "maxCombo": m.max_combo}

    def snapshot(self) -> dict:
        return {
            "frame": self.frame, "state": self.state, "time": self.time, "timeLeft": self.time_left,
            "hitstop": self.hitstop, "result": self.result,
            "a": self.a.snapshot(), "b": self.b.snapshot(),
            "proj": [{"id": p["id"], "o": p["owner"], "e": p["element"], "x": p["x"], "y": p["y"], "vx": p["vx"]}
                     for p in self.projectiles],
        }
