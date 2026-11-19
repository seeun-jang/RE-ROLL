"""FastAPI 서버 — 화면 파일, API, WebSocket 을 한 주소에서 함께 제공한다.

실행(server 폴더에서):
    python -m uvicorn party.main:app --host 0.0.0.0 --port 8000

- /ws          실시간 통신(WebSocket)
- /api/health  서버 상태 확인
- /            빌드된 화면(web/dist). 빌드 전이면 안내 문구만 나온다.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .board import BoardManager, attach_board
from .board_bridge import board_minigames, make_minigame_runner
from .games import GAMES
from .rooms import HubPool
from .services import create_services

DIST_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"

# 미니게임 허브 묶음: 시험용 대기실 하나 + 보드게임이 미니게임 차례마다 만드는 임시 허브들
pool = HubPool(GAMES, services=create_services())
hub = pool.default
# 보드게임(방 코드 · 주사위 · 칸 효과). 미니게임 차례에는 위 허브에서 서버 판정 게임을 돌린다.
board = BoardManager(minigame_runner=make_minigame_runner(pool), minigames=board_minigames(GAMES))


async def _tick_loop() -> None:
    """진행 중인 게임을 주기적으로 진행한다."""
    while True:
        pool.tick()   # 허브마다 자기 게임의 주기에 맞춰 진행한다(오류는 허브별로 잡는다)
        await asyncio.sleep(1 / 120)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(_tick_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="미니게임 파티", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict:
    stt = hub.services.get("stt")
    return {
        "ok": True, "phase": hub.phase, "players": len(hub.participants), "games": list(GAMES),
        "stt": stt.status if stt is not None else "off",          # 음성 인식: loading | ready | off | error
        "gemini": hub.services.get("gemini") is not None,          # Gemini 키가 있는지
    }


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    # /ws 는 시험용 대기실, /ws?room=<이름> 은 보드게임이 만든 미니게임 허브
    hub = pool.get(websocket.query_params.get("room"))
    if hub is None:
        await websocket.close(code=4404)
        return
    queue: asyncio.Queue[dict] = asyncio.Queue()
    conn = hub.connect(queue.put_nowait)

    async def writer() -> None:
        while True:
            msg = await queue.get()
            await websocket.send_text(json.dumps(msg, ensure_ascii=False))

    writer_task = asyncio.create_task(writer())
    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            hub.receive(conn, msg)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(conn)
        writer_task.cancel()


# 보드게임 화면(/party/)과 통신(/_party) — 아래의 '/' 화면 파일보다 먼저 붙인다
attach_board(app, board)

if DIST_DIR.is_dir():
    # 화면 파일은 맨 마지막에 붙인다(/api, /ws 가 먼저 처리되도록)
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="web")
else:

    @app.get("/", response_class=HTMLResponse)
    async def no_build() -> str:
        return (
            "<meta charset='utf-8'><h3>화면이 아직 빌드되지 않았습니다.</h3>"
            "<p>web 폴더에서 <code>npm install</code> 후 <code>npm run build</code> 를 실행하고 서버를 다시 켜세요.<br>"
            "개발 중에는 <code>npm run dev</code> 로 띄운 주소(5173)를 쓰면 됩니다.</p>"
        )
