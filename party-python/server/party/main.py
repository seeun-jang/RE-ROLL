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

from .games import GAMES
from .hub import Hub
from .services import create_services

DIST_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"

hub = Hub(GAMES, services=create_services())


async def _tick_loop() -> None:
    """진행 중인 게임을 주기적으로 진행한다."""
    while True:
        try:
            hub.tick()
        except Exception as exc:  # 게임 한 판의 오류로 서버 전체가 멈추지 않게
            print(f"[party] tick 오류: {exc!r}")
        await asyncio.sleep(hub.tick_interval)


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
