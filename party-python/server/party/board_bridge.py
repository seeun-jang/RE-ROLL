"""보드게임 ↔ 미니게임 연결.

보드게임(party/board)은 턴마다 미니게임 차례가 온다. 원래(Node 서버)는 각자 브라우저에서 따로 게임을 하고
점수만 서버로 보냈다. 여기서는 **그 방 사람들만 모이는 미니게임 허브**를 만들어 서버가 직접 게임을 시작하고,
서버가 판정한 순위를 보드게임에 돌려준다.

    보드 방(1234)의 미니게임 차례
      → 허브 "1234-3-777" 을 만든다 (pool.create)
      → 보드 화면이 iframe 으로 미니게임 화면을 열고 그 허브에 접속한다 (/ws?room=1234-3-777)
      → 모두 들어오면 서버가 게임을 시작한다 (hub.start_game)
      → 게임이 끝나면 결과(점수 · 순위)를 보드게임에 넘긴다 → 순위에 따라 주사위 보상

사람이 1명뿐이면 서버 판정 게임(2명 이상 필요)을 할 수 없으므로, 화면이 시험용 봇과 한 판 하고
점수를 보내는 원래 방식으로 돌아간다(mg["solo"] = True).
"""

from __future__ import annotations

import asyncio

from .rooms import HubPool

JOIN_WAIT = 25.0        # 미니게임 화면이 허브에 접속하기를 기다리는 시간(초)
MAX_WAIT = 10 * 60.0    # 한 판의 최대 시간(초) — 넘으면 중단
POLL = 0.25


def board_minigames(games: dict) -> list[dict]:
    """보드게임이 고를 미니게임 목록 [{id, name}] — 서버에 등록된 게임 전부."""
    return [{"id": gid, "name": cls.title} for gid, cls in games.items()]


def make_minigame_runner(pool: HubPool, *, join_wait: float = JOIN_WAIT, max_wait: float = MAX_WAIT):
    """BoardManager(minigame_runner=…) 에 넣을 함수를 만든다."""

    async def runner(room, mg: dict):
        cls = pool.games.get(mg["id"])
        humans = [p for p in room.humans() if p.online]
        if cls is None or len(humans) < cls.min_players:
            return _solo(room, mg)

        name = f"{room.code}-{room.turn}-{mg['seed']}"
        hub = pool.create(name)
        loop = asyncio.get_running_loop()
        ended: asyncio.Future = loop.create_future()

        def on_end(_game_id, results, aborted):
            if not ended.done():
                ended.set_result((results, aborted))

        hub.on_game_end = on_end
        mg["hub"] = name            # 화면이 이 이름으로 접속한다 (스냅샷의 mg 에 그대로 실린다)
        room.broadcast()

        try:
            # ① 소개 화면이 끝날 때까지 + 모두 접속할 때까지 기다린다
            wanted = {p.token for p in humans}
            waited = 0.0
            intro = max(0.0, (mg["startAt"] - room.clock()) / 1000.0)
            while True:
                joined = {x.tag for x in hub.participants.values() if x.connected}
                if waited >= intro and wanted <= joined:
                    break
                if waited >= intro + join_wait:
                    break
                if mg.get("skip") or room.dead:
                    return {}
                await asyncio.sleep(POLL)
                waited += POLL

            # ② 서버가 게임을 시작한다. 모인 사람이 모자라면 원래 방식으로.
            tag_of = {x.id: x.tag for x in hub.participants.values()}   # 허브 참가자 번호 → 보드 참가자 표식
            if not hub.start_game(mg["id"]):
                return _solo(room, mg)

            # ③ 끝날 때까지 기다린다 (방장의 건너뛰기 · 시간 초과면 중단)
            waited = 0.0
            while not ended.done():
                if mg.get("skip") or room.dead or waited >= max_wait:
                    hub._end_game(aborted=True)
                    break
                await asyncio.sleep(POLL)
                waited += POLL
            results, aborted = ended.result() if ended.done() else ([], True)
            if aborted:
                return {}

            # ④ 허브의 결과를 보드 참가자 번호로 바꿔 돌려준다
            by_token = {p.token: p for p in humans}
            out = {}
            for row in results:
                player = by_token.get(tag_of.get(row.get("playerId")))
                if player is not None:
                    out[player.id] = {"score": row.get("score", 0), "rank": row.get("rank", 0)}
            return out
        finally:
            hub.on_game_end = None
            pool.remove(name)

    return runner


def _solo(room, mg: dict):
    """서버 판정 게임을 할 수 없을 때: 화면이 시험용 봇과 한 판 하고 점수를 보내게 한다."""
    mg.pop("hub", None)
    mg["solo"] = True
    room.broadcast()
    return None
