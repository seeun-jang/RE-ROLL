"""보드게임 규칙 · 보드판 데이터.

원본은 화면(board/shared/rules.js, board/shared/board.js)이 쓰는 자바스크립트 파일이다.
손으로 옮겨 적으면 서로 달라질 수 있으므로, tools/export_board_data.mjs 가 뽑아 둔
board_data.json 을 그대로 읽어서 쓴다. (rules.js / board.js 를 고치면 그 스크립트를 다시 돌린다)
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_FILE = Path(__file__).with_name("board_data.json")

_data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

# ----- rules.js -----
MAX_PLAYERS: int = _data["MAX_PLAYERS"]          # 한 방 최대 인원 (5)
BAG_MAX: int = _data["BAG_MAX"]                  # 갖고 있을 수 있는 주사위 수 (넘치면 오래된 것부터 버림)
TURN_CHOICES: list[int] = _data["TURN_CHOICES"]  # 방장이 고를 수 있는 턴 수
DEFAULT_TURNS: int = _data["DEFAULT_TURNS"]
CHARACTERS: list[dict] = _data["CHARACTERS"]
MINIGAMES: list[dict] = _data["MINIGAMES"]       # [{"id", "name"}] (rules.js 에 적힌 순서)
REWARDS: list[str] = _data["REWARDS"]            # 미니게임 1·2·3위 보상 종류
DICE: dict[str, dict] = _data["DICE"]            # 주사위 id → {kind, icon, name, faces, desc, input?, uses?}
SPACES: dict[str, dict] = _data["SPACES"]        # 칸 종류 → {icon, name, color, desc, tier?}

# ----- board.js -----
BOARD: dict = _data["BOARD"]                     # {"width", "height", "nodes", "start", "goal"}
NODES: list[dict] = BOARD["nodes"]               # 칸 번호 → {"id", "x", "y", "type", "next", "island", "theme"}
START: int = BOARD["start"]
GOAL: int = BOARD["goal"]
DIST: list[int] = _data["DIST"]                  # 칸 번호 → 결승까지 남은 칸 수 (가장 짧은 길)


def dice_of(kind: str) -> list[str]:
    """그 종류(basic · normal · fun · trash)의 주사위 id 목록. 순서는 rules.js 에 적힌 순서."""
    return [dice_id for dice_id, d in DICE.items() if d["kind"] == kind]
