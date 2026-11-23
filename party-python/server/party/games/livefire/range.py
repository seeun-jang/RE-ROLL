"""사격장 규칙 — 원본 js/range.js(표적 순서 · 등급 · 표적 판정 영역)와 js/scenes/play.js(updateTargets · updateLane · fire)를 옮긴 것.

- 표적 순서는 시작할 때 한 번 정한다(make_schedule) → 모든 사로에 같은 표적이 같은 때에 올라온다.
- 사로(Lane)마다 조준점 · 흔들림 · 반동 · 탄알집을 서버가 60분의 1초 단위로 진행한다(Range.step).
  브라우저는 "누르고 있는 조준 키"와 "발사"만 보내고, 맞았는지는 여기서 판정한다(Range.fire).
- 난수는 넘겨받은 rng 만 쓴다. 시계는 읽지 않는다(프레임 수만 센다).

브라우저 쪽 시험용 진행기(web/src/games/livefire/sim/rules.js)가 같은 규칙을 JS 로 갖고 있다.
"""

from __future__ import annotations

import math

from .config import DOWN, LEFT, RIGHT, UP


def round_half_up(x: float) -> int:
    """JS 의 Math.round 와 같은 반올림(0.5 는 올림)."""
    return int(math.floor(x + 0.5))


def make_schedule(rng, cfg: dict) -> list[dict]:
    """표적 20개의 순서: [{dist(거리), x(좌우 위치), time(서 있는 프레임)}]. 첫 표적은 연습 삼아 100m."""
    dists: list[int] = []
    for dist in sorted(cfg["COUNTS"]):
        dists += [dist] * cfg["COUNTS"][dist]
    for i in range(len(dists) - 1, 0, -1):          # 섞기
        j = int(rng() * (i + 1))
        dists[i], dists[j] = dists[j], dists[i]
    if 100 in dists:
        first = dists.index(100)
        dists[0], dists[first] = dists[first], dists[0]
    total = cfg["TARGETS"]
    out = []
    for k, dist in enumerate(dists[:total]):
        d = cfg["DISTANCES"][dist]
        slots = d["slots"]
        late = k >= total / 2
        out.append({
            "dist": dist,
            "x": slots[int(rng() * len(slots)) % len(slots)],
            "time": round_half_up(d["time"] * (cfg["LATE_TIME_MUL"] if late else 1)),
        })
    return out


def grade_of(hits: int, cfg: dict) -> dict:
    """명중 수 → 등급 {min, name, color}."""
    for g in cfg["GRADES"]:
        if hits >= g["min"]:
            return g
    return cfg["GRADES"][-1]


def target_rect(tg: dict, rise: float, cfg: dict) -> tuple[float, float, float, float]:
    """표적 사각형 (x, y, w, h) — 사로 칸 좌표(가운데가 x=0). rise: 0~1 올라온 정도."""
    d = cfg["DISTANCES"][tg["dist"]]
    h = max(1, round_half_up(d["h"] * rise))
    return (tg["x"] - d["w"] / 2, d["y"] - h, d["w"], h)


class Lane:
    """사로 하나(참가자 한 명)의 상태."""

    def __init__(self, cfg: dict, sway_phase: float):
        self.ax = 0.0                       # 조준점(흔들림 · 반동을 뺀 자리)
        self.ay = float(cfg["AIM_START_Y"])
        self.kick = 0.0                     # 반동(조준점이 잠깐 튀어 오름)
        self.still = 0                      # 조준점을 가만히 둔 프레임 수
        self.sx = 0.0                       # 지금 흔들림
        self.sy = 0.0
        self.cooldown = 0
        self.mag = cfg["MAG_SIZE"]
        self.spare = math.ceil(cfg["TARGETS"] / cfg["MAG_SIZE"]) - 1
        self.reload_t = 0
        self.shots = 0
        self.hits = 0
        self.quick = 0                      # 빨리 맞힌 보너스 합계
        self.hit_k = -1                     # 마지막으로 맞힌 표적 번호
        self.fall_t = 0                     # 맞힌 표적이 넘어가는 중인 프레임
        self.phase = sway_phase             # 사람마다 다른 호흡 박자(0~10)
        self.record: list[bool] = []        # 표적마다 명중 여부
        self.streak = 0                     # 연속 명중(표적 기준)
        self.best_streak = 0
        self.miss_run = 0                   # 연속으로 빗나간 발 수
        self.held = 0                       # 누르고 있는 조준 키(비트)

    def score(self, cfg: dict) -> int:
        return self.hits * cfg["HIT_POINTS"] + self.quick

    def aim(self) -> tuple[float, float]:
        """지금 실제 조준점(흔들림 + 반동 포함)."""
        return (self.ax + self.sx, self.ay - self.kick + self.sy)

    def out_of_ammo(self) -> bool:
        return self.mag == 0 and self.spare == 0 and self.reload_t == 0


def sway_of(frame: int, phase: float, amp: float) -> tuple[float, float]:
    """호흡 흔들림 — 프레임 수와 사람별 박자만으로 정해진다(브라우저도 같은 식으로 미리 그린다)."""
    f = frame + phase * 60
    sx = math.sin(f * 0.047 + phase) * amp + math.sin(f * 0.13) * 0.4 * amp
    sy = math.sin(f * 0.035 + phase * 2) * amp * 1.1
    return sx, sy


class Range:
    """사격장 전체: 표적 진행(모두 같음) + 사로들.

    phase: brief(통제관 준비 방송) → fire(사격) → cease(사격 끝 방송) → over
    t_phase(표적): gap(다음 표적 기다림) → rise(올라옴) → up(서 있음) → fall(내려감)
    """

    def __init__(self, cfg: dict, ids: list[str], schedule: list[dict], sway_phases: dict[str, float]):
        self.cfg = cfg
        self.ids = list(ids)
        self.schedule = schedule
        self.total = len(schedule)
        self.lanes = {pid: Lane(cfg, sway_phases.get(pid, 0.0)) for pid in self.ids}
        self.away: set[str] = set()         # 연결이 끊긴 참가자(표적을 일찍 내릴지 볼 때 빼고 센다)
        self.phase = "brief"
        self.frame = 0                      # 시작부터 센 프레임
        self.t = 0                          # 지금 단계에서 지난 프레임
        self.k = 0                          # 지금 표적 번호
        self.t_phase = "gap"
        self.t_t = 0
        self.events: list[dict] = []        # 일어난 일(게임이 꺼내 간다)

    # ----- 표적 -----
    @property
    def target(self) -> dict | None:
        return self.schedule[self.k] if self.phase == "fire" and self.k < self.total else None

    def rise_for(self, lane: Lane) -> float:
        """이 사로에서 지금 표적이 얼마나 올라와 있나(0~1). 맞힌 사로는 먼저 넘어간다."""
        if self.phase != "fire":
            return 0.0
        r = self.cfg["RISE_TIME"]
        if lane.hit_k == self.k:
            return max(0.0, 1 - lane.fall_t / r)
        if self.t_phase == "rise":
            return self.t_t / r
        if self.t_phase == "up":
            return 1.0
        if self.t_phase == "fall":
            return 1 - self.t_t / r
        return 0.0

    def _update_targets(self) -> None:
        """표적 올라옴 → 서 있음 → 내려감 → 다음 표적 (원본 updateTargets)."""
        cfg = self.cfg
        tg = self.schedule[self.k]
        self.t_t += 1
        if self.t_phase == "gap" and self.t_t >= cfg["TARGET_GAP"]:
            self.t_phase, self.t_t = "rise", 0
            self.events.append({"type": "popup", "k": self.k, "dist": tg["dist"]})
            if self.k == self.total // 2:
                self.events.append({"type": "half"})
                self.events.append({"type": "tower", "text": cfg["HALF_LINE"]})
        elif self.t_phase == "rise" and self.t_t >= cfg["RISE_TIME"]:
            self.t_phase, self.t_t = "up", 0
        elif self.t_phase == "up":
            # 모든 사로가 맞혔거나 탄이 없으면 조금 일찍 내린다(끊긴 사람은 빼고 센다)
            here = [self.lanes[pid] for pid in self.ids if pid not in self.away]
            all_done = bool(here) and all(l.hit_k == self.k or l.out_of_ammo() for l in here)
            if self.t_t >= tg["time"] or (all_done and self.t_t > cfg["EARLY_DROP"]):
                self.t_phase, self.t_t = "fall", 0
        elif self.t_phase == "fall" and self.t_t >= cfg["RISE_TIME"]:
            hitters = []
            for pid in self.ids:
                lane = self.lanes[pid]
                hit = lane.hit_k == self.k
                lane.record.append(hit)
                if hit:
                    hitters.append(pid)
                else:
                    lane.streak = 0         # 못 맞히고 표적이 내려가면 연속이 끊긴다
            self.events.append({"type": "down", "k": self.k, "dist": tg["dist"], "hitters": hitters})
            self.k += 1
            self.t_phase, self.t_t = "gap", 0
            if self.k >= self.total:
                self.phase, self.t = "cease", 0
                self.events.append({"type": "cease"})

    # ----- 사로 -----
    def _update_lane(self, lane: Lane) -> None:
        """사로 한 프레임 (원본 updateLane)."""
        cfg = self.cfg
        if lane.cooldown > 0:
            lane.cooldown -= 1
        if self.phase == "fire" and lane.hit_k == self.k:
            lane.fall_t += 1
        if lane.reload_t > 0:               # 탄알집 교체
            lane.reload_t -= 1
            if lane.reload_t == 0:
                lane.mag = cfg["MAG_SIZE"]
                lane.spare -= 1
        # 방향키로 조준 (놓으면 그 자리에 멈춤)
        dx = (1 if lane.held & RIGHT else 0) - (1 if lane.held & LEFT else 0)
        dy = (1 if lane.held & DOWN else 0) - (1 if lane.held & UP else 0)
        lane.ax = max(-cfg["AIM_RANGE"], min(cfg["AIM_RANGE"], lane.ax + dx * cfg["AIM_SPEED_X"]))
        lane.ay = max(cfg["AIM_TOP_Y"], min(cfg["AIM_BOTTOM_Y"], lane.ay + dy * cfg["AIM_SPEED_Y"]))
        lane.still = 0 if (dx or dy) else lane.still + 1
        lane.kick *= cfg["KICK_DECAY"]
        # 호흡 흔들림 (가만히 조준하고 있으면 숨이 골라져서 덜 흔들림)
        amp = cfg["SWAY"] * (cfg["STEADY_SWAY"] if lane.still > cfg["STEADY_TIME"] else 1)
        lane.sx, lane.sy = sway_of(self.frame, lane.phase, amp)

    def step(self) -> None:
        """사격장 전체를 한 프레임 진행한다."""
        if self.phase == "over":
            return
        cfg = self.cfg
        self.frame += 1
        self.t += 1
        if self.phase == "brief":
            for at, text in cfg["BRIEF"]:
                if self.t == at + 1:
                    self.events.append({"type": "tower", "text": text})
            if self.t >= cfg["BRIEF_END"]:
                self.phase, self.t = "fire", 0
                self.t_phase, self.t_t = "gap", 0
        elif self.phase == "fire":
            self._update_targets()
        elif self.phase == "cease":
            for at, text in cfg["CEASE"]:
                if self.t == at + 1:
                    self.events.append({"type": "tower", "text": text})
            if self.t >= cfg["CEASE_END"]:
                self.phase = "over"
        for pid in self.ids:
            self._update_lane(self.lanes[pid])

    def set_held(self, pid: str, held: int) -> None:
        lane = self.lanes.get(pid)
        if lane is not None:
            lane.held = held & 15

    def fire(self, pid: str) -> None:
        """격발 (원본 fire). 맞았는지는 지금 서버가 갖고 있는 조준점과 표적 사각형으로 판정한다."""
        cfg = self.cfg
        lane = self.lanes.get(pid)
        if lane is None or self.phase != "fire" or lane.cooldown > 0 or lane.reload_t > 0:
            return
        if lane.mag == 0:
            self.events.append({"type": "dry", "playerId": pid})
            return
        px, py = lane.aim()
        lane.mag -= 1
        lane.shots += 1
        lane.cooldown = cfg["FIRE_COOLDOWN"]
        lane.kick += cfg["RECOIL"]          # 반동: 튀어 올랐다가 제자리로
        tg = self.schedule[self.k]
        rise = self.rise_for(lane)
        hit = False
        if lane.hit_k != self.k and rise >= 0.5:
            x, y, w, h = target_rect(tg, rise, cfg)
            hit = x <= px <= x + w and y <= py <= y + h     # 여유 없이 딱 표적 안만
        quick = 0
        if hit:
            react = self.t_t if self.t_phase == "up" else 0
            quick = max(0, cfg["QUICK_MAX"] - react // cfg["QUICK_STEP"])
            lane.hits += 1
            lane.quick += quick
            lane.hit_k = self.k
            lane.fall_t = 0
            lane.streak += 1
            lane.best_streak = max(lane.best_streak, lane.streak)
            lane.miss_run = 0
        else:
            lane.miss_run += 1
        reload = lane.mag == 0 and lane.spare > 0
        if reload:                          # 탄알집이 비면 자동으로 교체
            lane.reload_t = cfg["RELOAD_TIME"]
        self.events.append({
            "type": "shot", "playerId": pid, "hit": hit, "k": self.k, "dist": tg["dist"],
            "x": round(px, 2), "y": round(py, 2), "pts": (cfg["HIT_POINTS"] + quick) if hit else 0,
            "quick": quick, "streak": lane.streak, "missRun": lane.miss_run, "reload": reload,
        })
