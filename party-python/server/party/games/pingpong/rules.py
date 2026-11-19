"""잭팟 탁구왕 한 경기의 규칙 — 원본 js/ball.js · js/paddler.js · js/match.js 를 Python 으로 옮긴 것.

옆에서 본 2D(x = 가로, y = 높이, 아래로 갈수록 y 가 커진다). 한 번의 step() 이 1/60초다.
그림 · 소리 · 연출은 브라우저가 맡으므로 여기에는 판정에 필요한 값만 있다.
같은 내용이 web/src/games/pingpong/sim/rules.js 에 있고, 테스트가 두 쪽의 결과를 비교한다.

    duel = Duel(cfg, {"id": "p1", "name": "가"}, {"id": "p2", "name": "나"}, rng)
    duel.step(왼쪽 입력, 오른쪽 입력)       # 입력: {"fwd", "back", "hit", "hitPressed"}
    duel.pop_events()                       # 화면 효과 · 해설용 사건
    duel.snapshot()                         # 브라우저로 보낼 상태
"""

from __future__ import annotations

import copy
import math


def js_round(x: float) -> int:
    """JavaScript 의 Math.round 와 같은 반올림(0.5 는 올림)."""
    return math.floor(x + 0.5)


def sign(x: float) -> int:
    return (x > 0) - (x < 0)


class Ball:
    """탁구공. 매 프레임 중력 → 이동 → 네트 / 탁구대 / 바닥 충돌을 검사해 '사건'을 돌려준다."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.x = 0.0
        self.y = 0.0
        self.px = 0.0
        self.py = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.state = "held"      # held(서브 전) | toss(서브 토스) | flight | dead(득점 후 굴러다님)
        self.serve_stage = 0     # 서브: 1 = 내 코트에 먼저 튀어야 함, 2 = 상대 코트로 가는 중
        self.serve_target = 0.0
        self.serve_t = 0
        self.toss_y = 0.0
        self.last_hitter = 0     # 마지막으로 친 쪽(0 왼쪽 / 1 오른쪽)
        self.bounces = 0         # 받는 쪽 코트에 튄 횟수
        self.rest = 0.9          # 탁구대에서 튀는 힘
        self.net_hit = False
        self.chance = False      # 높게 뜬 찬스볼
        self.fast = False        # 스매시
        self.shot = ""           # 마지막 샷 종류(해설용)
        self.ticks = 0           # step() 을 부른 횟수(브라우저가 사이 위치를 계산할 때 쓴다)

    def clone(self) -> "Ball":
        return copy.copy(self)

    def step(self) -> list[dict]:
        """한 프레임 진행 → 일어난 사건 [{"type": "bounce"|"net"|"floor"|"out", "side"}]"""
        T = self.cfg["TABLE"]
        floor_y = self.cfg["FLOOR_Y"]
        ev: list[dict] = []
        self.ticks += 1
        self.px = self.x
        self.py = self.y
        self.vy += self.cfg["BALL"]["GRAVITY"]
        self.x += self.vx
        self.y += self.vy
        # 네트에 걸림
        if not self.net_hit and (self.px - T["NET_X"]) * (self.x - T["NET_X"]) <= 0 and self.px != self.x:
            k = (T["NET_X"] - self.px) / (self.x - self.px)
            y_at = self.py + (self.y - self.py) * k
            if T["NET_TOP"] < y_at < T["Y"] + 2:
                self.net_hit = True
                self.x = T["NET_X"] - sign(self.vx) * 3
                self.vx = -self.vx * 0.15
                self.vy = min(self.vy, 0.5)
                ev.append({"type": "net"})
        # 탁구대에 튐
        if self.y >= T["Y"] and self.py < T["Y"] and T["LEFT"] <= self.x <= T["RIGHT"]:
            self.y = T["Y"]
            self.vy = -abs(self.vy) * self.rest
            self.vx *= self.cfg["TABLE_GRIP"]
            ev.append({"type": "bounce", "side": 0 if self.x < T["NET_X"] else 1})
        # 바닥
        if self.y >= floor_y:
            self.y = floor_y
            self.vy = -abs(self.vy) * 0.45
            self.vx *= 0.7
            if abs(self.vy) < 0.4:
                self.vy = 0.0
            ev.append({"type": "floor"})
        if self.x < -20 or self.x > self.cfg["WIDTH"] + 20:
            ev.append({"type": "out"})
        return ev

    def launch(self, land_x: float, frames: float, clear_net: bool = True) -> None:
        """land_x 에 frames 프레임 뒤 떨어지도록 속도를 정한다(네트를 넘을 때까지 더 높게 조정)."""
        T = self.cfg["TABLE"]
        g = self.cfg["BALL"]["GRAVITY"]
        for _ in range(40):
            self.vx = (land_x - self.x) / frames
            self.vy = (T["Y"] - self.y - (g * frames * (frames + 1)) / 2) / frames
            if not clear_net or self.vx == 0:
                return
            n = (T["NET_X"] - self.x) / self.vx
            if n <= 0:
                return
            y_net = self.y + self.vy * n + (g * n * (n + 1)) / 2
            if y_net < T["NET_TOP"] - 4:
                return
            frames += 3          # 네트에 걸릴 것 같으면 더 높게(천천히)


class Paddler:
    """탁구 선수. 치기 톡 = 드라이브(전진키와 함께 = 드롭, 후진키와 함께 = 로브), 꾹 → 떼기 = 스매시."""

    def __init__(self, cfg: dict, player: dict, side: int):
        self.cfg = cfg
        self.player_id = player["id"]
        self.name = player.get("name", player["id"])
        self.side = side                       # 0 왼쪽 / 1 오른쪽
        self.facing = 1 if side == 0 else -1
        self.pts = 0                           # 이 경기 점수
        self.home_x = cfg["HOME_X"] if side == 0 else cfg["WIDTH"] - cfg["HOME_X"]
        self.x = float(self.home_x)
        self.vx = 0.0
        self.state = "ready"                   # ready | charge | swing | win | lose
        self.t = 0
        self.charge_t = 0
        self.swing_t = 0
        self.shot = "drive"
        self.hit_done = False
        self.prev_skill = False
        self.prev_dx: float | None = None

    @property
    def min_x(self) -> float:
        Z = self.cfg["ZONE"]
        return Z["FAR"] if self.side == 0 else self.cfg["WIDTH"] - Z["NEAR"]

    @property
    def max_x(self) -> float:
        Z = self.cfg["ZONE"]
        return Z["NEAR"] if self.side == 0 else self.cfg["WIDTH"] - Z["FAR"]

    @property
    def paddle_x(self) -> float:
        return self.x + self.facing * 9

    def set_state(self, s: str) -> None:
        self.state = s
        self.t = 0

    def update(self, match: "Duel", ctrl: dict) -> None:
        """ctrl: {"fwd"(탁구대 쪽), "back", "hit"(누르고 있음), "hitPressed"(방금 누름)}"""
        P = self.cfg["PLAYER"]
        self.t += 1
        fwd, back = bool(ctrl.get("fwd")), bool(ctrl.get("back"))
        # 한 프레임보다 짧게 톡 친 것도 놓치지 않게(눌린 순간 = 이번 프레임은 누른 것으로)
        skill = bool(ctrl.get("hit")) or (bool(ctrl.get("hitPressed")) and not self.prev_skill)

        if self.state in ("win", "lose") or match.frozen:
            self.vx *= P["FRICTION"]
            # 쉬는 동안 제자리로 천천히
            if self.state not in ("win", "lose") and match.state == "point":
                self.x += (self.home_x - self.x) * 0.04
        else:
            # 이동(스매시를 모으는 중에는 느리게)
            speed = P["MAX_SPEED"] * 0.55 if self.state == "charge" else P["MAX_SPEED"]
            direction = (self.facing if fwd else 0) - (self.facing if back else 0)
            if direction:
                self.vx += (direction * speed - self.vx) * P["ACCEL"]
            else:
                self.vx *= P["FRICTION"]

            if self.state == "swing":
                self.swing_t += 1
                if not self.hit_done and 1 <= self.swing_t <= P["SWING"]:
                    match.try_hit(self)
                if self.swing_t >= P["SWING"] + 6:
                    self.set_state("ready")
            elif self.state == "charge":
                self.charge_t += 1
                if self.charge_t == P["CHARGE_TIME"]:
                    match.emit({"type": "smashReady", "side": self.side})
                if not skill:
                    shot = "smash" if self.charge_t >= P["CHARGE_TIME"] else "drop" if fwd else "lob" if back else "drive"
                    self.start_swing(shot, match)
            elif skill and not self.prev_skill:
                self.set_state("charge")
                self.charge_t = 0
        self.prev_skill = skill
        self.x += self.vx
        if self.x < self.min_x:
            self.x = float(self.min_x)
            self.vx = 0.0
        if self.x > self.max_x:
            self.x = float(self.max_x)
            self.vx = 0.0
        if abs(self.vx) < 0.02:
            self.vx = 0.0

    def start_swing(self, shot: str, match: "Duel") -> None:
        self.set_state("swing")
        self.shot = shot
        self.swing_t = 0
        self.hit_done = False
        self.prev_dx = None
        match.emit({"type": "swing", "side": self.side, "shot": shot})
        if match.ball.state == "held" and match.server is self:
            match.serve(self)

    def snapshot(self) -> dict:
        return {
            "x": round(self.x, 3), "vx": round(self.vx, 3), "state": self.state,
            "chargeT": self.charge_t, "swingT": self.swing_t, "shot": self.shot,
        }


NO_INPUT = {"fwd": False, "back": False, "hit": False, "hitPressed": False}


class Duel:
    """1:1 탁구 한 경기. 서브 → 랠리 → 득점 → (2점마다 서브 교대) → … → 승리

    득점 규칙
    - 받는 쪽 코트에 두 번 튀면 / 받는 쪽이 못 치고 공이 지나가면 → 친 쪽 득점
    - 네트에 걸리거나 / 상대 코트에 안 떨어지고 나가면 → 받는 쪽 득점
    """

    def __init__(self, cfg: dict, a: dict, b: dict, rng):
        self.cfg = cfg
        self.rng = rng
        self.left = Paddler(cfg, a, 0)
        self.right = Paddler(cfg, b, 1)
        self.fighters = [self.left, self.right]
        self.ball = Ball(cfg)
        self.frame = 0
        self.state = "intro"       # intro | serve | rally | point | end
        self.state_t = 0
        self.hitstop = 0
        self.slow = 0              # 스매시 슬로모션(남은 프레임, 2프레임에 1번만 진행)
        self.rally = 0             # 이번 랠리에서 주고받은 횟수
        self.best_rally = 0
        self.serve_count = 0
        self.server = self.left if rng() < 0.5 else self.right
        self.winner: Paddler | None = None
        self.loser: Paddler | None = None
        self.done = False          # "게임 셋!" 연출까지 끝남
        self._events: list[dict] = []

    # ----- 바깥에서 쓰는 것 -----
    @property
    def over(self) -> bool:
        return self.done

    @property
    def frozen(self) -> bool:
        return self.state in ("intro", "point", "end")

    def emit(self, ev: dict) -> None:
        self._events.append(ev)

    def pop_events(self) -> list[dict]:
        out, self._events = self._events, []
        return out

    def set_state(self, s: str) -> None:
        self.state = s
        self.state_t = 0

    def step(self, in_left: dict, in_right: dict) -> bool:
        """한 프레임 진행. 입력을 실제로 읽었으면 True(멈춤 · 슬로모션으로 건너뛴 프레임은 False)."""
        C = self.cfg
        if self.slow > 0:
            self.slow -= 1
            if self.slow % 2 == 1:
                return False       # 반 속도
        self.frame += 1
        self.state_t += 1
        if self.hitstop > 0:
            self.hitstop -= 1
            return False

        if self.state == "intro" and self.state_t >= C["MATCH_INTRO"]:
            self.start_serve()
        if self.state == "serve" and self.state_t >= C["AUTO_SERVE"] and self.ball.state == "held":
            self.serve(self.server)            # 자동 서브
        if self.state == "point" and self.state_t >= C["POINT_PAUSE"]:
            self.after_point()
        if self.state == "end" and self.state_t >= C["MATCH_END"]:
            self.done = True

        # 조종 입력
        for f, inp in ((self.left, in_left), (self.right, in_right)):
            f.update(self, NO_INPUT if self.frozen else inp)

        # 공
        ball = self.ball
        if ball.state == "held":
            # 서브 전: 빈손 위에 공을 올려놓고 대기(살짝 통통)
            s = self.server
            ball.px, ball.py = ball.x, ball.y
            ball.x = s.x + s.facing * 4
            ball.y = C["FLOOR_Y"] - 20 - js_round(abs(math.sin(self.frame / 14)) * 2)
        elif ball.state == "toss":
            # 토스: 공을 위로 띄웠다가 내려올 때 라켓으로 침
            ball.px, ball.py = ball.x, ball.y
            ball.vy += C["BALL"]["GRAVITY"] * 0.7
            ball.y += ball.vy
            if ball.vy > 0 and ball.y >= ball.toss_y - 8:
                self.strike_serve(self.server)
        else:
            for ev in ball.step():
                self.on_ball_event(ev)
        return True

    # ----- 서브 -----
    def start_serve(self) -> None:
        self.ball = Ball(self.cfg)
        self.ball.state = "held"
        self.rally = 0
        self.set_state("serve")
        self.emit({"type": "serve", "side": self.server.side})

    def serve(self, p: Paddler) -> None:
        """치기 키 → 공을 위로 토스(진짜 탁구처럼)."""
        ball = self.ball
        if ball.state != "held" or self.state != "serve" or p is not self.server:
            return
        ball.state = "toss"
        ball.toss_y = ball.y
        ball.vy = -2.3
        p.set_state("ready")
        self.emit({"type": "toss", "side": p.side})

    def strike_serve(self, p: Paddler) -> None:
        """토스한 공이 내려오면 라켓으로 침 → 내 코트에 한 번 튀고 → 네트를 넘어 → 상대 코트에 튀어야 함."""
        p.set_state("swing")
        p.swing_t = 0
        p.shot = "drive"
        p.hit_done = True
        self.hit_ball(p, "serve", 0.8)
        self.set_state("rally")

    # ----- 치기 -----
    def try_hit(self, p: Paddler) -> None:
        """휘두르는 중에 공이 라켓에 닿았나."""
        ball = self.ball
        P = self.cfg["PLAYER"]
        if ball.state != "flight" or ball.last_hitter == p.side or ball.bounces < 1 or ball.net_hit:
            return
        dx = abs(ball.x - p.paddle_x)
        top = self.cfg["FLOOR_Y"] - P["REACH_TOP"]
        low = self.cfg["FLOOR_Y"] - P["REACH_LOW"]
        if dx > P["REACH_X"] or ball.y < top or ball.y > low:
            p.prev_dx = None
            return
        # 라켓 끝에 닿자마자 치지 않고, 공이 라켓 한가운데에 가장 가까워지는 순간에 침
        closing = p.prev_dx is None or dx < p.prev_dx
        if closing and dx > 3 and p.swing_t < P["SWING"]:
            p.prev_dx = dx
            return
        best = dx if p.prev_dx is None else min(dx, p.prev_dx)
        # 타이밍 점수: 라켓 한가운데 + 휘두르기 시작하고 2~7프레임 사이가 최고
        center = 1 - best / P["REACH_X"]
        timing = 1 if 2 <= p.swing_t <= 7 else 0.7
        q = max(0.0, min(1.0, center * 0.75 + timing * 0.3 - 0.05))
        p.hit_done = True
        self.hit_ball(p, p.shot, q)

    def hit_ball(self, p: Paddler, kind: str, q: float) -> None:
        """공 치기: 샷 종류와 타이밍으로 상대 코트 어디에 얼마나 빨리 떨어질지 정한다."""
        C = self.cfg
        T = C["TABLE"]
        S = C["SHOTS"][kind]
        ball = self.ball
        direction = p.facing
        start = T["NET_X"] + direction * 6
        end = T["RIGHT"] - 4 if direction > 0 else T["LEFT"] + 4
        half = abs(end - start)
        depth = S["depth"][0] + self.rng() * (S["depth"][1] - S["depth"][0])
        frames = S["T"]
        clear_net = True
        popup = None                      # 머리 위 글씨: oops(앗!) | nice(나이스!) | smash(스매시!)
        ball.chance = False
        ball.fast = kind == "smash"
        if kind == "smash" and q < C["SMASH_MIN_QUALITY"]:
            # 무리한 스매시 → 네트
            depth = 0.02
            frames = 12
            clear_net = False
            ball.fast = False
            popup = "oops"
        elif kind != "serve" and q < C["CHANCE_QUALITY"] and kind != "smash":
            # 타이밍이 나쁨 → 높고 느린 찬스볼(가끔은 아웃)
            frames = js_round(frames * 1.4) + 10
            ball.chance = True
            if q < 0.1 and self.rng() < 0.5:
                depth = 1.25
        elif kind != "serve" and kind != "smash" and q < 0.55 and self.rng() < (0.55 - q) * 0.5:
            # 애매한 타이밍 → 가끔 길게 나가서 아웃
            depth = 1.2
            popup = "oops"
        elif q > 0.85 and kind != "serve":
            # 나이스 타이밍 → 더 빠르고 낮게
            frames = js_round(frames * 0.85)
            popup = "smash" if kind == "smash" else "nice"
        if kind == "smash" and q >= C["SMASH_MIN_QUALITY"]:
            popup = "smash"
        ball.state = "flight"
        ball.last_hitter = p.side
        ball.bounces = 0
        ball.net_hit = False
        ball.rest = S["bounce"]
        ball.serve_stage = 0
        ball.shot = kind
        if kind == "serve":
            # 1단계: 내 코트 가운데쯤에 먼저 튀게(2단계는 튀는 순간 상대 코트로)
            own_end = T["LEFT"] if direction > 0 else T["RIGHT"]
            own_land = own_end + direction * (0.3 + self.rng() * 0.25) * (T["NET_X"] - T["LEFT"])
            ball.serve_stage = 1
            ball.serve_target = start + direction * depth * half
            ball.serve_t = frames
            ball.launch(own_land, 22, False)
        elif not clear_net or depth > 1:
            ball.launch(start + direction * depth * half, frames, clear_net)    # 일부러 실수(네트 / 아웃)
        else:
            self.aim_safely(ball, start + direction * depth * half, frames, direction)
        self.rally += 1
        self.best_rally = max(self.best_rally, self.rally)
        smash = kind == "smash" and clear_net
        self.hitstop = C["HITSTOP_SMASH"] if smash else C["HITSTOP"]
        if smash:
            self.slow = C["SMASH_SLOW"]
        self.emit({
            "type": "hit", "side": p.side, "shot": kind, "q": round(q, 2), "smash": smash, "popup": popup,
            "chance": ball.chance, "rally": self.rally, "x": round(ball.x, 1), "y": round(ball.y, 1),
        })

    def aim_safely(self, ball: Ball, target: float, frames: float, direction: int) -> None:
        """받는 쪽 탁구대 위에서 두 번 튀어 버리면(받을 방법이 없음) 조금씩 더 깊게 보낸다."""
        T = self.cfg["TABLE"]
        end = T["RIGHT"] - 3 if direction > 0 else T["LEFT"] + 3
        for _ in range(10):
            ball.launch(target, frames)
            sim = ball.clone()
            n = 0
            bad = False
            for _f in range(200):
                ev = sim.step()
                if any(e["type"] != "bounce" for e in ev):
                    break
                if any(e["type"] == "bounce" for e in ev):
                    n += 1
                    if n == 2:
                        bad = True       # 탁구대 위에서 두 번째로 튐(받을 수 없는 공)
                        break
            if not bad:
                return
            target = min(end, target + 7) if direction > 0 else max(end, target - 7)

    # ----- 판정 -----
    def on_ball_event(self, ev: dict) -> None:
        """공이 어딘가에 닿음 → 규칙 판정."""
        ball = self.ball
        kind = ev["type"]
        if kind == "bounce":
            self.emit({"type": "bounce", "side": ev["side"]})
        elif kind == "net":
            self.emit({"type": "net"})
        elif kind == "floor" and abs(ball.vy) > 0.4:
            self.emit({"type": "floor"})
        if self.state != "rally" or ball.state != "flight":
            return
        hitter = ball.last_hitter
        receiver = 1 - hitter
        if kind == "bounce" and ball.serve_stage == 1:
            # 서브: 내 코트에 먼저 튀어야 정상 → 상대 코트로 넘어감
            if ev["side"] == hitter:
                ball.serve_stage = 2
                self.aim_safely(ball, ball.serve_target, ball.serve_t, 1 if hitter == 0 else -1)
            else:
                self.point_to(receiver, "serveFault")
            return
        if kind == "bounce":
            if ev["side"] == hitter:
                self.point_to(receiver, "serveFault" if ball.serve_stage == 2 else "ownCourt")
            else:
                ball.bounces += 1
                if ball.bounces >= 2:
                    self.point_to(hitter, "smash" if ball.fast else "unreturned")
            ball.serve_stage = 0
        elif kind == "net":
            self.point_to(receiver, "net")
        elif kind in ("floor", "out"):
            if ball.bounces >= 1:
                self.point_to(hitter, "smash" if ball.fast else "missed")
            else:
                self.point_to(receiver, "out")

    def point_to(self, side: int, reason: str) -> None:
        """득점. reason: serveFault | ownCourt | smash | unreturned | net | missed | out"""
        C = self.cfg
        p = self.fighters[side]
        o = self.fighters[1 - side]
        p.pts += 1
        self.ball.state = "dead"
        self.serve_count += 1
        self.emit({
            "type": "point", "side": side, "reason": reason, "pts": [self.left.pts, self.right.pts],
            "rally": self.rally, "shot": self.ball.shot, "hitter": self.ball.last_hitter,
        })
        # 승부가 났나? (3점 선승, 2:2부터는 2점 차, 6점이면 무조건)
        if (p.pts >= C["GAME_POINTS"] and p.pts - o.pts >= 2) or p.pts >= C["DEUCE_CAP"]:
            self.finish(p, o)
            return
        # 원본에 없는 안전장치: 경기가 너무 길어지면 이 득점에서 앞선 쪽이 이긴다
        if self.frame >= C["FLOW"]["MATCH_LIMIT"] * 60 and p.pts != o.pts:
            if p.pts > o.pts:
                self.finish(p, o)
            else:
                self.finish(o, p)
            return
        self.set_state("point")

    def after_point(self) -> None:
        # 2점마다 서브 교대(듀스에서는 1점마다)
        G = self.cfg["GAME_POINTS"]
        deuce = self.left.pts >= G - 1 and self.right.pts >= G - 1
        if deuce or self.serve_count % self.cfg["SERVE_EVERY"] == 0:
            self.server = self.right if self.server is self.left else self.left
        self.start_serve()

    def finish(self, w: Paddler, l: Paddler) -> None:
        self.winner = w
        self.loser = l
        w.set_state("win")
        l.set_state("lose")
        self.set_state("end")
        self.emit({"type": "end", "winner": w.side, "pts": [self.left.pts, self.right.pts]})

    @property
    def is_deuce(self) -> bool:
        G = self.cfg["GAME_POINTS"]
        return self.left.pts >= G - 1 and self.right.pts >= G - 1 and self.left.pts == self.right.pts

    @property
    def match_point_side(self) -> int | None:
        """한 점만 더 따면 이기는 쪽(없으면 None)."""
        C = self.cfg
        for p in self.fighters:
            o = self.right if p is self.left else self.left
            if (p.pts + 1 >= C["GAME_POINTS"] and p.pts + 1 - o.pts >= 2) or p.pts + 1 >= C["DEUCE_CAP"]:
                return p.side
        return None

    def snapshot(self) -> dict:
        b = self.ball
        return {
            "frame": self.frame, "state": self.state, "stateT": self.state_t,
            "hitstop": self.hitstop, "slow": self.slow,
            "server": self.server.side, "rally": self.rally,
            "pts": [self.left.pts, self.right.pts],
            "winner": self.winner.side if self.winner else None, "over": self.done,
            "ball": {
                "x": round(b.x, 3), "y": round(b.y, 3), "vx": round(b.vx, 4), "vy": round(b.vy, 4),
                "state": b.state, "fast": b.fast, "chance": b.chance, "netHit": b.net_hit,
                "lastHitter": b.last_hitter, "bounces": b.bounces, "rest": b.rest,
                "serveStage": b.serve_stage, "ticks": b.ticks,
            },
            "left": self.left.snapshot(), "right": self.right.snapshot(),
        }
