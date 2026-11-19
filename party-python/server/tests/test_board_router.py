"""보드게임 라우터(party/board/router.py) 테스트 — WebSocket /_party · /_party/info · /_party/status · /party/ 화면 파일.

두 가지 방법으로 확인한다.
1) FastAPI 의 TestClient (httpx 가 필요하다. 가상환경에 없으면 이 테스트들은 건너뛴다 — 따로 설치하지 않는다)
2) ASGI 규격대로 앱을 직접 부르기 (추가로 필요한 것이 없어서 항상 돈다)

실행(server 폴더에서):  python -m pytest -q tests/test_board_router.py
"""

from __future__ import annotations

import asyncio
import json
import random
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from party.board import BoardManager, attach_board
from party.board.room import Timings

try:
    import httpx  # noqa: F401  (TestClient 가 내부에서 쓴다)
    from fastapi.testclient import TestClient
except Exception:   # httpx 가 없으면 TestClient 를 만들 수 없다
    TestClient = None

needs_testclient = pytest.mark.skipif(
    TestClient is None, reason="httpx 가 설치되어 있지 않아 FastAPI TestClient 를 쓸 수 없음 (pip install httpx 후 실행)"
)

BOARD_DIR = Path(__file__).resolve().parents[2] / "board"


def make_app() -> tuple[FastAPI, BoardManager]:
    manager = BoardManager(rng_factory=lambda: random.Random(11), timings=Timings())
    app = FastAPI()
    attach_board(app, manager, BOARD_DIR)
    # main.py 처럼 맨 끝에 "남은 주소 전부"를 가져가는 화면 파일 mount 가 있어도 되는지 같이 확인
    app.mount("/", StaticFiles(directory=str(BOARD_DIR / "shared"), html=True), name="web")
    return app, manager


# ---------------- 1) TestClient ----------------
@needs_testclient
def test_party_websocket_with_testclient(monkeypatch):
    monkeypatch.setenv("PUBLIC_URL", "https://example.test")
    app, manager = make_app()
    client = TestClient(app)
    assert client.get("/_party/info").json() == {"publicUrl": "https://example.test"}
    assert client.get("/_party/status").json() == []
    with client.websocket_connect("/_party") as a, client.websocket_connect("/_party") as b:
        a.send_text("not json")                    # JSON 이 아닌 것 · binary 는 무시
        a.send_bytes(b"\x00\x01")
        a.send_json({"t": "hello", "token": "ta", "name": "철수"})
        assert a.receive_json() == {"t": "welcome", "id": None}
        a.send_json({"t": "create", "name": "철수"})
        assert a.receive_json()["t"] == "welcome"
        room = a.receive_json()
        assert room["t"] == "room" and room["phase"] == "lobby"
        b.send_json({"t": "hello", "token": "tb", "name": "영희"})
        assert b.receive_json() == {"t": "welcome", "id": None}
        b.send_json({"t": "join", "name": "영희", "code": room["code"]})
        assert b.receive_json()["t"] == "welcome"
        assert [p["name"] for p in b.receive_json()["players"]] == ["철수", "영희"]
        assert [p["name"] for p in a.receive_json()["players"]] == ["철수", "영희"]
        assert client.get("/_party/status").json() == [
            {"code": room["code"], "phase": "lobby", "turn": 0, "players": ["철수", "영희"]}
        ]
    assert client.get("/party/").status_code == 200
    assert "export const DICE" in client.get("/party/shared/rules.js").text


# ---------------- 2) ASGI 직접 호출 ----------------
class Socket:
    """ASGI 규격으로 흉내 낸 브라우저 WebSocket 하나."""

    def __init__(self, app, path="/_party"):
        self.to_app: asyncio.Queue = asyncio.Queue()
        self.from_app: asyncio.Queue = asyncio.Queue()
        scope = {
            "type": "websocket", "asgi": {"version": "3.0"}, "scheme": "ws", "http_version": "1.1",
            "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"", "headers": [],
            "client": ("testclient", 50000), "server": ("testserver", 80), "subprotocols": [], "state": {},
        }
        self.to_app.put_nowait({"type": "websocket.connect"})
        self.task = asyncio.create_task(app(scope, self.to_app.get, self.from_app.put))

    async def event(self) -> dict:
        return await asyncio.wait_for(self.from_app.get(), 5)

    async def recv(self) -> dict:
        event = await self.event()
        assert event["type"] == "websocket.send", event
        return json.loads(event["text"])

    def send(self, obj) -> None:
        self.to_app.put_nowait({"type": "websocket.receive", "text": obj if isinstance(obj, str) else json.dumps(obj)})

    async def close(self) -> None:
        self.to_app.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, 5)


async def http_get(app, path: str) -> tuple[int, dict, bytes]:
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
        "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"", "headers": [],
        "client": ("testclient", 50000), "server": ("testserver", 80), "state": {},
    }
    events = []
    asked = []

    async def receive():
        if asked:   # 요청은 한 번만 준다. 그 뒤로는 (응답이 끝날 때까지) 가만히 기다린다
            await asyncio.Event().wait()
        asked.append(1)
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(event):
        events.append(event)

    await app(scope, receive, send)
    start = next(e for e in events if e["type"] == "http.response.start")
    body = b"".join(e.get("body", b"") for e in events if e["type"] == "http.response.body")
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, body


def test_party_websocket_create_join_status():
    async def main():
        app, manager = make_app()
        assert json.loads((await http_get(app, "/_party/status"))[2]) == []

        a = Socket(app)
        assert (await a.event())["type"] == "websocket.accept"
        a.send("이건 JSON 이 아님")                 # 무시
        a.to_app.put_nowait({"type": "websocket.receive", "bytes": b"\x00\x01"})   # binary 도 무시
        a.send("[1, 2]")                            # JSON 이지만 {…} 가 아님 → 무시
        a.send('{"t": "result", "score": NaN}')     # NaN 은 JSON 이 아님 → 무시
        a.send({"t": "hello", "token": "ta", "name": "철수"})
        assert await a.recv() == {"t": "welcome", "id": None}
        a.send({"t": "create", "name": "철수"})
        welcome = await a.recv()
        room = await a.recv()
        assert welcome["t"] == "welcome" and room["t"] == "room" and room["host"] == welcome["id"]

        b = Socket(app)
        assert (await b.event())["type"] == "websocket.accept"
        b.send({"t": "hello", "token": "tb", "name": "영희"})
        assert await b.recv() == {"t": "welcome", "id": None}
        b.send({"t": "join", "name": "영희", "code": "9999" if room["code"] != "9999" else "1000"})
        assert await b.recv() == {"t": "error", "text": "그런 방이 없어요"}
        b.send({"t": "join", "name": "영희", "code": room["code"]})
        assert (await b.recv())["t"] == "welcome"
        assert [p["name"] for p in (await b.recv())["players"]] == ["철수", "영희"]
        assert [p["name"] for p in (await a.recv())["players"]] == ["철수", "영희"]

        status, headers, body = await http_get(app, "/_party/status")
        assert status == 200 and headers["content-type"].startswith("application/json")
        assert json.loads(body) == [{"code": room["code"], "phase": "lobby", "turn": 0, "players": ["철수", "영희"]}]

        # 같은 token 으로 다른 탭에서 들어오면 옛 연결은 서버가 끊는다
        a2 = Socket(app)
        assert (await a2.event())["type"] == "websocket.accept"
        a2.send({"t": "hello", "token": "ta", "name": "철수"})
        assert await a2.recv() == {"t": "welcome", "id": welcome["id"]}
        assert (await a2.recv())["t"] == "room"
        while True:
            event = await a.event()
            if event["type"] == "websocket.close":
                break
        await a.close()

        # 연결이 끊기면 "연결 끊김" 으로 보인다 (대기실에서는 잠시 뒤 빠짐)
        await b.close()
        snap = await a2.recv()
        while snap["players"][1]["online"]:
            snap = await a2.recv()
        assert [p["online"] for p in snap["players"]] == [True, False]
        await a2.close()

    asyncio.run(main())


def test_party_info_and_static_files(monkeypatch):
    async def main():
        app, _ = make_app()
        monkeypatch.delenv("PUBLIC_URL", raising=False)
        status, headers, body = await http_get(app, "/_party/info")
        assert status == 200 and json.loads(body) == {"publicUrl": ""} and headers["cache-control"] == "no-cache"
        monkeypatch.setenv("PUBLIC_URL", "https://example.test")
        assert json.loads((await http_get(app, "/_party/info"))[2]) == {"publicUrl": "https://example.test"}

        # 화면 파일: /party/ → board/index.html, /party/shared/rules.js → 규칙 파일
        status, headers, body = await http_get(app, "/party/")
        assert status == 200 and headers["content-type"].startswith("text/html")
        assert body == (BOARD_DIR / "index.html").read_bytes()
        status, _, body = await http_get(app, "/party/shared/rules.js")
        assert status == 200 and b"export const DICE" in body
        status, headers, _ = await http_get(app, "/party")       # 끝에 / 가 없으면 /party/ 로 보냄
        assert status in (301, 307, 308) and headers["location"].endswith("/party/")
        # 맨 끝의 "/" mount 도 그대로 동작
        status, _, body = await http_get(app, "/board.js")
        assert status == 200 and b"export const BOARD" in body

    asyncio.run(main())
