"""미니게임 허브 여러 개 관리.

원래 서버에는 허브(대기실 + 미니게임 한 판)가 하나뿐이었다. 보드게임은 방이 여러 개이고,
방마다 미니게임 차례가 올 때마다 그 방 사람들만 모이는 허브가 필요하다.

- 이름이 "" 인 허브: 예전부터 있던 시험용 대기실 (주소 `/ws`)
- 그 밖의 허브: 보드게임이 미니게임 차례마다 만들고(`create`), 끝나면 없앤다(`remove`) (주소 `/ws?room=<이름>`)
"""

from __future__ import annotations

import time

from .hub import Hub


class HubPool:
    def __init__(self, games: dict, services: dict | None = None):
        self.games = games
        self.services = dict(services or {})
        # 시험용 대기실. 게임 준비(prepare)는 여기서 한 번만 한다.
        self.default = Hub(games, services=self.services)
        self.hubs: dict[str, Hub] = {"": self.default}
        self._next_tick: dict[str, float] = {}

    def get(self, name: str | None) -> Hub | None:
        return self.hubs.get(name or "")

    def create(self, name: str) -> Hub:
        """보드게임용 임시 허브를 만든다. 같은 이름이 있으면 새것으로 바꾼다."""
        hub = Hub(self.games, services=self.services, prepare=False)
        self.hubs[name] = hub
        self._next_tick.pop(name, None)
        return hub

    def remove(self, name: str) -> None:
        if name:  # 시험용 대기실은 없애지 않는다
            self.hubs.pop(name, None)
            self._next_tick.pop(name, None)

    def tick(self) -> None:
        """자주(1/60초쯤) 불린다. 허브마다 자기 게임의 주기(tick_hz)에 맞춰 진행한다."""
        now = time.monotonic()
        for name, hub in list(self.hubs.items()):
            if now < self._next_tick.get(name, 0.0):
                continue
            self._next_tick[name] = now + hub.tick_interval
            try:
                hub.tick()
            except Exception as exc:  # 한 방의 오류로 다른 방이 멈추지 않게
                print(f"[party] tick 오류({name or '대기실'}): {exc!r}")
