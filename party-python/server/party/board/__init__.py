"""RE:ROLL 보드게임 서버 (원본 docs/kmj-original/party.js 를 파이썬 asyncio 로 옮긴 것).

- data.py     규칙 · 보드판 데이터 (board_data.json)
- jsutil.py   자바스크립트와 계산 결과를 맞추는 작은 도구
- room.py     방 · 참가자 · 질문, 시간 설정
- game.py     한 판의 진행 (주사위 · 이동 · 칸 효과 · 미니게임 · 보상)
- manager.py  방 관리와 메시지 처리 (BoardManager)
- router.py   FastAPI 에 붙이기 (attach_board)
"""

from .manager import BoardManager, Connection
from .room import Gone, Player, Room, Timings, make_timings
from .router import attach_board, create_router

__all__ = ["BoardManager", "Connection", "Gone", "Player", "Room", "Timings", "make_timings", "attach_board", "create_router"]
