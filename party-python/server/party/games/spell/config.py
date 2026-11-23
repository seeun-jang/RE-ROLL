"""주문을 외쳐라 — 설정. 숫자는 모두 여기서만 바꾼다. (원본 src/config.js, data/spells.js 를 옮김)"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    # 화면 배치(논리 픽셀) — 판정에도 쓰인다
    "LAYOUT": {"GROUND_Y": 118, "LEFT_X": 64, "RIGHT_X": 256},
    "PLAYER": {"MAX_HP": 100, "MAX_MANA": 100, "MANA_REGEN": 6},
    # 위력은 고정(소리 크기와 무관). 원본의 '보통' 단계와 같다.
    "POWER": {"FIXED": 0.5, "MULT": 1.0},
    # 속성 상성 배율 (투사체끼리 부딪칠 때 / 얼음 방패가 불을 막을 때)
    "ELEMENT": {"ICE_SHIELD_VS_FIRE": 1.5},
    # 콤보: 서로 다른 속성을 WINDOW초 안에 연속 시전
    "COMBO": {"WINDOW": 2.2, "STEP_BONUS": 0.1, "MAX_BONUS": 0.3},
    # 주문 텍스트 유사도 매칭 (음성 인식 결과 판정)
    "MATCH": {"MIN_SCORE": 0.68, "SHORT_KEYWORD_LEN": 2, "WINDOW_SLACK": 2},
    "BATTLE": {
        "TIME_LIMIT": 60,        # 결투 한 판 제한 시간(초)
        "COUNTDOWN": 3.0,
        "HITSTOP_BASE": 2,       # 프레임
        "HITSTOP_POWER": 6,
        "CLASH_KEEP": 0.7,       # 상성 승리한 투사체가 상쇄 후 유지하는 위력 비율
        "END_HITSTOP": 12,
    },
    "FLOW": {
        "ROUNDS_FOR_TWO": 3,     # 2명일 때 같은 상대와 하는 판 수
        "INTRO_TIME": 5.0,       # 대진 안내
        "END_HOLD": 2.5,         # 결투가 끝난 뒤 결과 화면으로 넘어가기까지
        "RESULT_TIME": 5.0,
        "FINAL_TIME": 9.0,
    },
    "VOICE": {
        "MAX_SECONDS": 4.0,      # 받는 음성 길이 상한
        "MIN_SECONDS": 0.15,
        "MIN_RMS": 0.004,
        "TIMEOUT": 6.0,          # 음성 인식이 이 시간 안에 안 끝나면 버린다
    },
}

# 주문 데이터 (web/src/games/spell/data/spells.js 와 같아야 한다 — 테스트가 비교한다)
SPELLS: list[dict] = [
    {"id": "fireball", "name": "파이어볼", "element": "fire", "type": "projectile", "damage": 10, "mana": 10,
     "cooldown": 0.8, "speed": 150,
     "keywords": ["파이어볼", "파이어 볼", "화이어볼", "파이어벌", "화염구", "fireball", "fire ball"]},
    {"id": "aqua_shot", "name": "아쿠아 샷", "element": "water", "type": "projectile", "damage": 10, "mana": 10,
     "cooldown": 0.8, "speed": 140,
     "keywords": ["아쿠아 샷", "아쿠아샷", "아쿠아", "워터", "워터볼", "물대포", "aqua shot", "aqua", "water"]},
    {"id": "thunder", "name": "썬더", "element": "lightning", "type": "strike", "damage": 14, "mana": 16,
     "cooldown": 1.6, "delay": 0.18,
     "keywords": ["썬더", "선더", "썬다", "번개", "thunder"]},
    {"id": "wind_cutter", "name": "윈드 커터", "element": "wind", "type": "projectile", "damage": 8, "mana": 7,
     "cooldown": 0.5, "speed": 230,
     "keywords": ["윈드 커터", "윈드커터", "윈드", "바람", "바람칼", "wind cutter", "wind"]},
    {"id": "ice_shield", "name": "아이스 실드", "element": "ice", "type": "shield", "shield": 30, "duration": 3.0,
     "mana": 15, "cooldown": 4.0,
     "keywords": ["아이스 실드", "아이스실드", "아이스 쉴드", "아이스쉴드", "얼음 방패", "얼음방패", "ice shield"]},
    {"id": "heal", "name": "힐", "element": "heal", "type": "heal", "heal": 18, "mana": 22, "cooldown": 6.0,
     "keywords": ["힐", "힐링", "치유", "회복", "heal"]},
]
SPELL_BY_ID = {s["id"]: s for s in SPELLS}

# 상성: key 가 value 를 이긴다 (불 → 바람 → 번개 → 물 → 불)
BEATS = {"fire": "wind", "wind": "lightning", "lightning": "water", "water": "fire"}


def beats(attacker: str | None, defender: str | None) -> bool:
    return bool(attacker) and BEATS.get(attacker) == defender


def merge_config(override: dict | None = None, base: dict | None = None) -> dict:
    out = copy.deepcopy(DEFAULT_CONFIG if base is None else base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_config(value, out[key])
        else:
            out[key] = copy.deepcopy(value)
    return out
