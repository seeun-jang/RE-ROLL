"""게임들이 함께 쓰는 AI 서비스(음성 인식, Gemini).

서버(main.py)가 한 번 만들어 방(Hub)에 넘기고, 방은 게임을 만들 때 `game.services` 로 건네준다.
게임은 이 서비스가 없거나 꺼져 있어도 진행되도록 만든다(예: 음성 인식이 없으면 타자 입력만).
"""

from __future__ import annotations

from .gemini import GeminiClient
from .stt import SttService, create_stt


def create_services() -> dict:
    """실제 서버용 서비스 묶음. 환경 변수로 켜고 끈다(README 참고)."""
    return {"stt": create_stt(), "gemini": GeminiClient.from_env()}


__all__ = ["GeminiClient", "SttService", "create_stt", "create_services"]
