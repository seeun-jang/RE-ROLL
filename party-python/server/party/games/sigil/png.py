"""아주 작은 PNG 만들기 — 표준 라이브러리(zlib · struct)만 쓴다.

Gemini 에게 "이 그림이 무엇처럼 보이는지" 물어볼 때 글(text)과 함께 보낼 그림(image)을 만든다.
(10주차 주제: 글 부분 + 그림 부분을 한 요청에 담는 멀티모달 호출)

PNG 파일 구조:  서명 8바이트 → IHDR(크기 · 색 형식) → IDAT(zlib 로 압축한 픽셀 줄) → IEND
각 덩어리(chunk) = 길이(4) + 이름(4) + 내용 + CRC32(4)
"""

from __future__ import annotations

import base64
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunk(name: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + name + body + struct.pack(">I", zlib.crc32(name + body) & 0xFFFFFFFF)


def encode_gray_png(width: int, height: int, pixels: bytes) -> bytes:
    """회색조(픽셀당 1바이트, 0 = 검정 · 255 = 흰색) 그림을 PNG 바이트로."""
    if len(pixels) != width * height:
        raise ValueError("픽셀 수가 크기와 맞지 않습니다")
    # IHDR: 너비, 높이, 비트 깊이 8, 색 형식 0(회색조), 압축 0, 필터 0, 인터레이스 0
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    # 줄마다 맨 앞에 필터 종류 0(그대로)을 붙인다
    rows = b"".join(b"\x00" + pixels[y * width:(y + 1) * width] for y in range(height))
    return PNG_SIGNATURE + _chunk(b"IHDR", header) + _chunk(b"IDAT", zlib.compress(rows, 9)) + _chunk(b"IEND", b"")


def rasterize(ink: bytes | bytearray, size: int, out: int = 96) -> bytes:
    """잉크 칸(size x size, 0 | 1)을 out x out 회색조 픽셀로 줄인다. 흰 종이에 검은 선.

    줄어드는 칸에 잉크가 하나라도 있으면 검정(선이 끊기지 않게).
    """
    edges = [(i * size) // out for i in range(out + 1)]
    pixels = bytearray([255]) * (out * out)
    for oy in range(out):
        y0, y1 = edges[oy], max(edges[oy] + 1, edges[oy + 1])
        for ox in range(out):
            x0, x1 = edges[ox], max(edges[ox] + 1, edges[ox + 1])
            for y in range(y0, min(size, y1)):
                if ink.find(1, y * size + x0, y * size + min(size, x1)) >= 0:
                    pixels[oy * out + ox] = 0
                    break
    return bytes(pixels)


def paper_png_base64(paper, out: int = 96) -> str:
    """종이(Paper)를 작은 PNG 로 만들어 base64 글자로 (Gemini inlineData 에 그대로 넣는다)."""
    return base64.b64encode(encode_gray_png(out, out, rasterize(paper.ink, paper.size, out))).decode("ascii")
