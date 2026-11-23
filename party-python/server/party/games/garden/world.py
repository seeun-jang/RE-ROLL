"""가든 디펜스: 좀비 일정(모두 같음)과 한 사람의 정원(World).

- build_spawns: 한 판에 나올 좀비를 시작할 때 전부 정한다 → 모든 참가자가 같은 좀비 떼를 받는다.
- World: 한 사람의 정원. 60분의 1초 단위로 진행하며, 입력은 "있는 레인"과 "쏘는 중인지" 둘뿐이다.
  브라우저 쪽 시험용 진행기(web/src/games/garden/sim/rules.js)와 같은 계산을 한다(테스트가 비교한다).
"""

from __future__ import annotations

import math


def r1(v: float) -> float:
    return math.floor(v * 10 + 0.5) / 10


def r2(v: float) -> float:
    return math.floor(v * 100 + 0.5) / 100


def build_spawns(rng, cfg: dict) -> list[dict]:
    """웨이브 일정 → 시간순 좀비 목록 [{t, lane, type, speedMul, hpMul}]."""
    lanes = cfg["LAYOUT"]["LANES"]
    out: list[dict] = []
    for wave in cfg["WAVES"]:
        entries: list[str] = []
        for etype, count in wave["spawns"]:
            for _ in range(int(count)):
                entries.append(etype)
        for i in range(len(entries) - 1, 0, -1):
            j = min(i, math.floor(rng() * (i + 1)))
            entries[i], entries[j] = entries[j], entries[i]
        n = len(entries)
        prev_lane = -1
        rows = []
        for i in range(n):
            slot = wave["duration"] / n
            t = (i + 0.5) * slot + (-0.45 + 0.9 * rng()) * slot
            lane = min(lanes - 1, math.floor(rng() * lanes))
            if lane == prev_lane:
                if rng() < 0.6:      # 같은 레인 연속 완화
                    lane = (lane + 1 + min(lanes - 2, math.floor(rng() * (lanes - 1)))) % lanes
            prev_lane = lane
            rows.append({"t": max(0.3, t), "lane": lane, "type": entries[i]})
        if wave["boss"]:
            rows.append({"t": cfg["BOSS_SPAWN_DELAY"], "lane": lanes // 2, "type": "boss"})
        for row in rows:
            out.append({"t": r2(wave["start"] + row["t"]), "lane": row["lane"], "type": row["type"],
                        "speedMul": wave["speedMul"], "hpMul": wave["hpMul"]})
    order = sorted(range(len(out)), key=lambda i: (out[i]["t"], i))
    return [out[i] for i in order if out[i]["t"] < cfg["RULES"]["DURATION"]]


def build_boss_dirs(rng, count: int = 16) -> list[int]:
    """보스가 옆 레인으로 옮길 방향(+1/-1) 목록 — 모두에게 같다."""
    return [1 if rng() < 0.5 else -1 for _ in range(count)]


class World:
    def __init__(self, cfg: dict, spawns: list[dict], boss_dirs: list[int]):
        self.cfg = cfg
        self.L, self.G, self.E = cfg["LAYOUT"], cfg["GUN"], cfg["ENEMIES"]
        self.fps = cfg["BASE"]["LOGIC_FPS"]
        self.dt = 1 / self.fps
        self.spawns = spawns
        self.boss_dirs = boss_dirs
        self.lane = self.L["LANES"] // 2
        self.fire = False
        self.cooldown = 0.0
        self.frame = 0
        self.enemies: list[dict] = []
        self.bullets: list[dict] = []
        self.next_id = 1
        self.next_bullet = 1
        self.spawn_i = 0
        self.boss_dir_i = 0
        self.score = 0
        self.combo = 0
        self.combo_timer = 0.0
        self.best_combo = 0
        self.kills = 0
        self.breaches = 0
        self.shots = 0
        self.hits = 0
        self.helmets = 0
        self.boss_killed = False
        self.events: list[dict] = []

    # ------------------------------------------------------------------
    @property
    def time(self) -> float:
        return self.frame / self.fps

    @property
    def multiplier(self) -> float:
        c = self.cfg["COMBO"]
        return min(c["MAX_MUL"], 1 + (self.combo // c["STEP"]) * c["MUL_PER_STEP"])

    def set_input(self, lane, fire) -> None:
        if isinstance(lane, int) and not isinstance(lane, bool):
            self.lane = max(0, min(self.L["LANES"] - 1, lane))
        self.fire = bool(fire)

    def wave_mods(self, t: float) -> tuple[float, float]:
        mods = (1.0, 1.0)
        for w in self.cfg["WAVES"]:
            if w["start"] <= t:
                mods = (w["speedMul"], w["hpMul"])
        return mods

    def spawn(self, etype: str, lane: int, x: float, speed_mul: float, hp_mul: float, from_boss: bool = False) -> dict:
        base = self.E[etype]
        e = {
            "id": self.next_id, "type": etype, "lane": lane, "x": x,
            "maxHp": math.ceil(base["hp"] * hp_mul), "hp": math.ceil(base["hp"] * hp_mul),
            "maxHelmet": math.ceil(base["helmetHp"] * hp_mul) if etype == "helmet" else 0,
            "helmetHp": math.ceil(base["helmetHp"] * hp_mul) if etype == "helmet" else 0,
            "speed": base["speed"] * speed_mul, "speedMul": speed_mul, "score": base["score"],
            "hitL": base["hitL"], "hitR": base["hitR"], "state": "walk", "eatTimer": 0.0,
            "summonTimer": base.get("summonInterval", 0.0), "laneTimer": base.get("laneSwitchInterval", 0.0),
            "dead": False, "fromBoss": from_boss,
        }
        self.next_id += 1
        self.enemies.append(e)
        return e

    # ------------------------------------------------------------------
    def step(self) -> None:
        """1/60초 진행."""
        self.frame += 1
        dt = self.dt
        t = self.frame / self.fps
        if self.combo > 0:
            self.combo_timer -= dt
            if self.combo_timer <= 0:
                self.combo = 0
                self.combo_timer = 0.0
        # 사격
        if self.cooldown > 0:
            self.cooldown -= dt
        if self.fire and self.cooldown <= 0:
            self.cooldown = 1 / self.G["FIRE_RATE"]
            x = self.L["PLAYER_X"] + self.L["MUZZLE_DX"]
            self.bullets.append({"id": self.next_bullet, "lane": self.lane, "x": float(x), "prev": float(x), "dead": False})
            self.next_bullet += 1
            self.shots += 1
        # 좀비 (보스가 소환한 좀비도 같은 프레임에 움직인다)
        i = 0
        while i < len(self.enemies):
            self._update_enemy(self.enemies[i], dt, t)
            i += 1
        # 총알
        for b in self.bullets:
            b["prev"] = b["x"]
            b["x"] += self.G["BULLET_SPEED"] * dt
            if b["x"] > self.cfg["BASE"]["WIDTH"] + 8:
                b["dead"] = True
            else:
                self._collide(b)
        if any(e["dead"] for e in self.enemies):
            self.enemies = [e for e in self.enemies if not e["dead"]]
        if any(b["dead"] for b in self.bullets):
            self.bullets = [b for b in self.bullets if not b["dead"]]
        # 일정대로 좀비 등장
        while self.spawn_i < len(self.spawns) and self.spawns[self.spawn_i]["t"] <= t:
            s = self.spawns[self.spawn_i]
            self.spawn_i += 1
            self.spawn(s["type"], s["lane"], float(self.L["SPAWN_X"]), s["speedMul"], s["hpMul"])

    def _update_enemy(self, e: dict, dt: float, t: float) -> None:
        if e["dead"]:
            return
        if e["type"] == "boss":
            self._update_boss(e, dt, t)
        if e["state"] == "walk":
            e["x"] -= e["speed"] * dt
            if e["x"] + e["hitL"] <= self.L["EXIT_X"]:
                if e["type"] == "boss":      # 보스는 문 앞에 서서 계속 집을 뜯는다
                    e["x"] = float(self.L["EXIT_X"] - e["hitL"])
                    e["state"] = "eat"
                    e["eatTimer"] = 0.0
                else:
                    e["dead"] = True
                    self._breach(e)
        elif e["state"] == "eat":
            e["eatTimer"] -= dt
            if e["eatTimer"] <= 0:
                e["eatTimer"] = self.cfg["SCORE"]["BOSS_BITE_EVERY"]
                self._breach(e)

    def _update_boss(self, e: dict, dt: float, t: float) -> None:
        base = self.E["boss"]
        lanes = self.L["LANES"]
        e["summonTimer"] -= dt
        if e["summonTimer"] <= 0:
            e["summonTimer"] = base["summonInterval"]
            speed_mul, hp_mul = self.wave_mods(t)
            for i in range(base["summonCount"]):
                d = 1 if i % 2 == 0 else -1
                lane = e["lane"] + d
                if lane < 0 or lane >= lanes:
                    lane = e["lane"] - d
                lane = max(0, min(lanes - 1, lane))
                self.spawn("normal", lane, min(e["x"] + 10, float(self.L["SPAWN_X"])), speed_mul, hp_mul, True)
            self.events.append({"type": "summon", "lane": e["lane"], "x": r1(e["x"])})
        e["laneTimer"] -= dt
        if e["laneTimer"] <= 0 and e["state"] == "walk":
            e["laneTimer"] = base["laneSwitchInterval"]
            d = self.boss_dirs[self.boss_dir_i % len(self.boss_dirs)]
            self.boss_dir_i += 1
            if e["lane"] + d < 1 or e["lane"] + d > lanes - 2:     # 보스는 맨 위·맨 아래 레인에 가지 않는다
                d = -d
            e["lane"] += d

    def _collide(self, b: dict) -> None:
        right = b["x"] + self.G["BULLET_W"]
        for e in self.enemies:
            if e["dead"] or e["lane"] != b["lane"]:
                continue
            if e["x"] + e["hitL"] <= right and e["x"] + e["hitR"] >= b["prev"]:
                self.hits += 1
                self._damage(e, self.G["DAMAGE"])
                b["dead"] = True
                break

    def _damage(self, e: dict, dmg: float) -> None:
        if e["type"] != "boss":
            e["x"] = min(e["x"] + self.cfg["FX"]["KNOCKBACK"], float(self.L["SPAWN_X"]))
        if e["helmetHp"] > 0:
            e["helmetHp"] -= dmg
            if e["helmetHp"] > 0:
                return
            # 철모가 깨지면 일반 좀비 속도가 된다. 남은 피해는 몸으로 넘어간다
            dmg = -e["helmetHp"]
            e["helmetHp"] = 0
            e["speed"] = self.E["normal"]["speed"] * e["speedMul"]
            self.score += self.cfg["SCORE"]["HELMET_BREAK"]
            self.helmets += 1
            self.events.append({"type": "helmet", "id": e["id"], "lane": e["lane"], "x": r1(e["x"])})
            if dmg <= 0:
                return
        e["hp"] -= dmg
        if e["hp"] <= 0:
            e["hp"] = 0
            e["dead"] = True
            self._kill(e)

    def _kill(self, e: dict) -> None:
        self.kills += 1
        self.combo += 1
        self.combo_timer = self.cfg["COMBO"]["WINDOW"]
        if self.combo > self.best_combo:
            self.best_combo = self.combo
        mul = self.multiplier
        pts = math.floor(e["score"] * mul + 0.5)
        self.score += pts
        if e["type"] == "boss":
            self.boss_killed = True
        self.events.append({"type": "kill", "id": e["id"], "etype": e["type"], "lane": e["lane"], "x": r1(e["x"]),
                            "pts": pts, "mul": mul, "combo": self.combo})

    def _breach(self, e: dict) -> None:
        """좀비가 집에 닿았다: 감점 + 콤보 끊김."""
        before = self.score
        self.score = max(0, self.score - self.cfg["SCORE"]["BREACH_PENALTY"])
        self.breaches += 1
        self.combo = 0
        self.combo_timer = 0.0
        self.events.append({"type": "breach", "lane": e["lane"], "boss": e["type"] == "boss", "lost": before - self.score})

    # ------------------------------------------------------------------
    def view(self) -> dict:
        """화면에 보낼 내 정원 상태."""
        types = self.cfg["ENEMY_TYPES"]
        return {
            "frame": self.frame, "lane": self.lane, "score": self.score, "combo": self.combo,
            "comboLeft": r2(self.combo_timer), "mul": self.multiplier, "kills": self.kills, "breaches": self.breaches,
            "enemies": [[e["id"], types.index(e["type"]), e["lane"], r1(e["x"]), e["hp"], e["maxHp"], e["helmetHp"],
                         e["maxHelmet"], 1 if e["state"] == "eat" else 0, r2(e["speed"])] for e in self.enemies],
            "bullets": [[b["id"], b["lane"], r1(b["x"])] for b in self.bullets],
        }

    def stats(self) -> dict:
        return {"kills": self.kills, "breaches": self.breaches, "bestCombo": self.best_combo,
                "accuracy": math.floor(100 * self.hits / self.shots + 0.5) if self.shots else 0,
                "bossKilled": self.boss_killed}
