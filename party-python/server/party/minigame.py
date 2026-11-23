"""미니게임 공통 규격(서버 쪽).

모든 미니게임은 MiniGame 을 상속해 아래 메서드만 구현한다.
방(Hub)은 이 규격만 알고 게임을 돌리므로, 나중에 판(보드)이 생겨도 게임 코드는 바꾸지 않는다.

    game = SomeGame(players, options, rng)
    game.start(now)                      # 시작
    game.on_input(player_id, data, now)  # 참가자 입력
    game.tick(now)                       # 주기 호출(진행)
    game.drain()                         # 보낼 메시지 꺼내기
    game.finished / game.results         # 끝났는지 / 공통 결과

시간(now)은 서버 시계(초)이며 방이 넘겨준다. 게임은 스스로 시계를 읽지 않는다(테스트하기 쉽게).
"""

from __future__ import annotations

from typing import Callable


class MiniGame:
    #: 게임 식별자(브라우저 registry 의 id 와 같아야 한다)
    id: str = ""
    title: str = ""
    min_players: int = 2
    max_players: int = 5
    #: 초당 tick 횟수
    tick_hz: int = 30
    #: 방이 넘겨주는 공용 서비스(음성 인식 등, party/services). 없으면 빈 dict.
    services: dict = {}

    @classmethod
    def prepare(cls, services: dict) -> None:
        """서버가 켜질 때 한 번 불린다. 미리 준비할 것이 있는 게임만 구현한다."""

    def __init__(self, players: list[dict], options: dict | None, rng: Callable[[], float]):
        """players: [{"id", "name", "index"}], rng: 0 이상 1 미만 난수 함수."""
        self.players = [dict(p) for p in players]
        self.options = dict(options or {})
        self.rng = rng
        self.finished = False
        #: 공통 결과 형식 [{playerId, name, score, rank, isWinner, stats}]
        self.results: list[dict] = []
        self._outbox: list[tuple[str | None, str, dict]] = []

    # ----- 게임이 구현하는 부분 -----
    def client_options(self) -> dict:
        """게임 시작 때 브라우저로 보낼 설정."""
        return {}

    def start(self, now: float) -> None:
        raise NotImplementedError

    def tick(self, now: float) -> None:
        raise NotImplementedError

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        raise NotImplementedError

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        """참가자 연결이 끊기거나 돌아왔을 때. 기본은 아무것도 하지 않는다."""

    def state_for(self, player_id: str, now: float) -> dict | None:
        """다시 접속한 참가자에게 바로 보낼 현재 상태. 없으면 None."""
        return None

    # ----- 게임이 쓰는 도구 -----
    def send_state(self, data: dict, to: str | None = None) -> None:
        """현재 상태(덮어써도 되는 정보). to=None 이면 전원."""
        self._outbox.append((to, "state", data))

    def send_event(self, data: dict, to: str | None = None) -> None:
        """한 번만 일어난 일(판정 결과 등). to=None 이면 전원."""
        self._outbox.append((to, "event", data))

    def finish(self, results: list[dict]) -> None:
        self.results = results
        self.finished = True

    # ----- 방이 쓰는 부분 -----
    def drain(self) -> list[tuple[str | None, str, dict]]:
        out, self._outbox = self._outbox, []
        return out


def rank_results(rows: list[dict]) -> list[dict]:
    """[{playerId, name, score, stats?}] → 공통 결과 형식(점수 내림차순, 동점은 같은 순위)."""
    out = [
        {
            "playerId": r["playerId"], "name": r.get("name", r["playerId"]), "score": r.get("score", 0),
            "rank": 0, "isWinner": False, "stats": r.get("stats", {}),
        }
        for r in rows
    ]
    order = {r["playerId"]: i for i, r in enumerate(out)}
    out.sort(key=lambda r: (-r["score"], order[r["playerId"]]))
    for i, r in enumerate(out):
        r["rank"] = out[i - 1]["rank"] if i > 0 and r["score"] == out[i - 1]["score"] else i + 1
    top = out[0]["score"] if out else 0
    for r in out:
        r["isWinner"] = r["score"] == top
    return out
