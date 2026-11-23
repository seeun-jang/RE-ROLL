"""검증용 서버 — 추가 패키지 없이(표준 라이브러리만) 화면 파일과 WebSocket 을 제공한다.

실제 실행에는 쓰지 않는다(실제 서버는 party/main.py 의 FastAPI).
FastAPI·uvicorn 을 설치할 수 없는 환경에서 '방(Hub) + 미니게임 + 브라우저 화면'을
진짜 브라우저로 확인하려고 만든 도구다. 방과 게임 로직은 실제 서버와 같은 코드를 쓴다.

    python tests/e2e/nodeps_server.py [포트]     (server 폴더에서)
    → http://127.0.0.1:포트/  에서 web 폴더를 빌드 없이 그대로 연다
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from party.games import GAMES  # noqa: E402
from party.hub import Hub  # noqa: E402
from party.services import create_services  # noqa: E402

WEB_DIR = ROOT.parent / "web"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html",
        ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png"}

hub = Hub(GAMES, services=create_services())

if os.environ.get("PARTY_STT_TEST") == "answer":
    # 검증 전용: 마이크 소리가 들어오면 번갈아 가며 "틀린 말" / 지금 문제의 정답을 인식한 것처럼 돌려준다.
    # (음성 인식 모델 없이 브라우저 녹음 → 서버 판정 흐름을 끝까지 확인하려는 용도)
    from party.services.stt import SttService  # noqa: E402

    _calls = {"n": 0}

    def _fake(_pcm: bytes, _rate: int) -> str:
        _calls["n"] += 1
        q = getattr(hub.game, "question", None)
        return "틀린 말" if _calls["n"] % 2 == 1 or not q else f"정답은 {q['answer']}입니다"

    hub.services["stt"] = SttService(lambda: _fake, "test")

if os.environ.get("PARTY_STT_TEST") == "spell":
    # 검증 전용: 마이크 소리가 들어올 때마다 주문 이름(가끔 엉뚱한 말)을 차례로 인식한 것처럼 돌려준다.
    from party.services.stt import SttService  # noqa: E402

    _words = ["파이어볼!", "윈드 커터", "오늘 점심 뭐 먹지", "썬더", "아쿠아 샷", "아이스 쉴드", "화이어 벌"]
    _n = {"i": 0}

    def _fake_spell(_pcm: bytes, _rate: int) -> str:
        _n["i"] += 1
        return _words[(_n["i"] - 1) % len(_words)]

    hub.services["stt"] = SttService(lambda: _fake_spell, "test")

if os.environ.get("PARTY_STT_TEST") == "phrase":
    # 검증 전용: 마이크 소리가 들어올 때마다 "무궁화 꽃이"(끊김) / 온전한 문장을 번갈아 인식한 것처럼 돌려준다.
    from party.services.stt import SttService  # noqa: E402

    _p = {"i": 0}

    def _fake_phrase(_pcm: bytes, _rate: int) -> str:
        _p["i"] += 1
        return "무궁화 꽃이" if _p["i"] % 3 == 1 else "무궁화 꽃이 피었습니다."

    hub.services["stt"] = SttService(lambda: _fake_phrase, "test")


def ws_frame(text: str) -> bytes:
    data = text.encode("utf-8")
    n = len(data)
    if n < 126:
        head = struct.pack("!BB", 0x81, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x81, 126, n)
    else:
        head = struct.pack("!BBQ", 0x81, 127, n)
    return head + data


async def ws_session(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    queue: asyncio.Queue = asyncio.Queue()
    conn = hub.connect(queue.put_nowait)

    async def pump() -> None:
        while True:
            msg = await queue.get()
            writer.write(ws_frame(json.dumps(msg, ensure_ascii=False)))
            await writer.drain()

    task = asyncio.create_task(pump())
    buf = b""
    try:
        while True:
            b1, b2 = await reader.readexactly(2)
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                (n,) = struct.unpack("!H", await reader.readexactly(2))
            elif n == 127:
                (n,) = struct.unpack("!Q", await reader.readexactly(8))
            mask = await reader.readexactly(4) if b2 & 0x80 else b""
            payload = bytearray(await reader.readexactly(n))
            if mask:
                for i in range(n):
                    payload[i] ^= mask[i % 4]
            if opcode == 0x8:
                break
            if opcode == 0x9:
                writer.write(struct.pack("!BB", 0x8A, len(payload)) + bytes(payload))
                continue
            if opcode in (0x0, 0x1):
                buf += bytes(payload)
                if b1 & 0x80:
                    text, buf = buf, b""
                    try:
                        hub.receive(conn, json.loads(text.decode("utf-8")))
                    except ValueError:
                        pass
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        hub.disconnect(conn)
        task.cancel()


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        head = await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
        writer.close()
        return
    lines = head.decode("latin-1").split("\r\n")
    parts = lines[0].split(" ")
    path = parts[1].split("?")[0] if len(parts) > 1 else "/"
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    def respond(status: str, body: bytes, ctype: str = "text/plain; charset=utf-8") -> None:
        writer.write(
            f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + body
        )

    try:
        if path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
            accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + WS_GUID).encode()).digest()).decode()
            writer.write(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode()
            )
            await writer.drain()
            await ws_session(reader, writer)
            return
        if path == "/api/health":
            respond("200 OK", json.dumps({"ok": True, "phase": hub.phase}).encode(), "application/json")
        else:
            rel = "index.html" if path == "/" else path.lstrip("/")
            target = (WEB_DIR / rel).resolve()
            if WEB_DIR.resolve() in target.parents and target.is_file():
                ctype = MIME.get(target.suffix) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                respond("200 OK", target.read_bytes(), ctype)
            else:
                respond("404 Not Found", b"not found")
        await writer.drain()
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = await asyncio.start_server(handle, "127.0.0.1", port)

    async def ticker() -> None:
        while True:
            hub.tick()
            await asyncio.sleep(hub.tick_interval)

    asyncio.create_task(ticker())
    print(f"[검증용 서버] http://127.0.0.1:{port}/", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
