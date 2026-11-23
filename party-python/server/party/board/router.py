"""보드게임을 FastAPI 앱에 붙이는 부분.

    from party.board import BoardManager, attach_board
    attach_board(app, BoardManager())      # main.py 에서, 맨 끝의 app.mount("/", …) 보다 먼저 부른다

- WebSocket /_party     화면(board/main.js)과 주고받는 실시간 통신
- GET /_party/info      친구에게 알려줄 접속 주소 {"publicUrl": …} (환경 변수 PUBLIC_URL)
- GET /_party/status    지금 열려 있는 방 목록 (확인용)
- /party/               보드게임 화면 파일 (board 폴더)
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import APIRouter, FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .manager import BoardManager

#: 화면 파일 폴더 (프로젝트의 board 폴더)
BOARD_DIR = Path(__file__).resolve().parents[3] / "board"

#: 이보다 긴 메시지는 무시한다 (원본 서버의 maxPayload 64KB)
MAX_MESSAGE_CHARS = 64 * 1024


def _no_constants(name: str):
    """NaN · Infinity 는 JSON 이 아니다 (자바스크립트의 JSON.parse 도 거절한다)."""
    raise ValueError(name)


def create_router(manager: BoardManager) -> APIRouter:
    router = APIRouter()

    @router.get("/_party/info")
    async def party_info() -> JSONResponse:
        return JSONResponse({"publicUrl": os.environ.get("PUBLIC_URL", "")}, headers={"cache-control": "no-cache"})

    @router.get("/_party/status")
    async def party_status() -> list[dict]:
        return manager.status()

    @router.get("/party", include_in_schema=False)
    async def party_slash(request: Request) -> RedirectResponse:
        """/party 로 들어오면 /party/ 로 보낸다 (화면 파일이 상대 주소로 연결되어 있어서 끝의 / 가 필요)."""
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"/party/{query}")

    @router.websocket("/_party")
    async def party_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        # 보낼 메시지는 줄(queue)에 넣어 두고 writer 가 차례대로 보낸다. None 은 "서버가 끊음" 표시
        queue: asyncio.Queue[dict | None] = asyncio.Queue()
        conn = manager.connect(queue.put_nowait, close=lambda: queue.put_nowait(None))

        async def writer() -> None:
            try:
                while True:
                    msg = await queue.get()
                    if msg is None:
                        await websocket.close()
                        return
                    await websocket.send_text(json.dumps(msg, ensure_ascii=False))
            except Exception:
                pass   # 이미 끊긴 연결에 보내려던 것 → 무시

        writer_task = asyncio.create_task(writer())
        try:
            while True:
                event = await websocket.receive()
                if event["type"] == "websocket.disconnect":
                    break
                text = event.get("text")
                if text is None or len(text) > MAX_MESSAGE_CHARS:   # 글자가 아닌 데이터(binary) · 너무 긴 메시지
                    continue
                try:
                    msg = json.loads(text, parse_constant=_no_constants)
                except ValueError:
                    continue
                await manager.receive(conn, msg)
        except RuntimeError:
            pass   # 서버가 먼저 끊은 뒤에 receive 를 부른 경우
        finally:
            manager.disconnect(conn)
            writer_task.cancel()

    return router


def attach_board(app: FastAPI, manager: BoardManager, board_dir: str | Path | None = None) -> None:
    """보드게임의 WebSocket · API · 화면 파일을 앱에 붙인다.

    주의: main.py 맨 끝의 app.mount("/", …) 는 남은 주소를 전부 가져가므로, 그보다 먼저 불러야 한다.
    """
    app.include_router(create_router(manager))
    board_dir = Path(board_dir) if board_dir is not None else BOARD_DIR
    app.mount("/party", _FreshStatic(directory=str(board_dir), html=True), name="board")


class _FreshStatic(StaticFiles):
    """화면 파일을 고치면 새로고침만으로 바로 보이게 한다(브라우저가 옛 파일을 계속 쓰지 않도록)."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"   # 쓸 때마다 서버에 "바뀌었나요?" 하고 묻는다
        return response
