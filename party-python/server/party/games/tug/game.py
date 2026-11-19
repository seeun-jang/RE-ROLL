"""줄다리기 — 공통 규격(MiniGame) 연결부."""

from __future__ import annotations

from ...minigame import MiniGame
from .match import TugMatch


class TugGame(MiniGame):
    id = "tug"
    title = "픽셀 줄다리기"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.match = TugMatch(self.players, self.options.get("config"), rng)
        self._last_phase = None
        self._last_state_at = -1.0

    def client_options(self) -> dict:
        return {"config": self.match.config}

    def start(self, now: float) -> None:
        self.match.start(now)
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self.match.advance(now)
        self._emit(now)
        if self.match.finished and not self.finished:
            self.finish(self.match.results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict):
            return
        self.match.advance(now)
        self.match.input(player_id, data, now)
        self._emit(now)

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.match.snapshot(now)

    def _emit(self, now: float, force: bool = False) -> None:
        m = self.match
        for ev in m.pop_events():
            self.send_event(ev)
        # 플레이 중에는 매 tick, 그 밖에는 장면이 바뀔 때와 1초에 한 번
        changed = m.phase != self._last_phase
        due = m.phase == "play" or now - self._last_state_at >= 1.0
        if force or changed or due:
            # 같은 시각에 두 번 보내지 않는다(입력 처리 직후 tick 과 겹치는 경우)
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = m.phase
            self._last_state_at = now
            self.send_state(m.snapshot(now))
