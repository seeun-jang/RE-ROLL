"""손바닥 밀치기 설정값 — 원본(web/src/games/palm/config.js)과 같은 값.

단위: 따로 적지 않으면 프레임(1/60초). 균형 값은 각 선수 '자기 기준'으로 +가 앞(상대 쪽), -가 뒤.
서버가 게임을 시작할 때 이 값을 브라우저로 보내므로, 여기만 고치면 화면에도 같은 값이 적용된다.
"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    "MATCH": {
        "TIME_LIMIT": 30,        # 제한 시간(초)
        "COUNTDOWN": 3,          # 카운트다운(초)
        "WOBBLE_START": 12,      # 이 시간(초)부터 받침대가 흔들리기 시작
        "SEED": 20261102,        # 흔들림 패턴 시드(모든 경기가 같은 조건)
    },
    # 서버가 정하는 장면 시간(초)
    "FLOW": {
        "ROUNDS_FOR_TWO": 3,     # 2명일 때 라운드 수(3명 이상은 모두가 서로 한 번씩 만난다)
        "INTRO_TIME": 4.0,       # 대진 안내
        "END_HOLD": 2.5,         # 마지막 경기가 끝난 뒤 넘어지는 모습을 보여주는 시간
        "RESULT_TIME": 5.0,      # 라운드 결과
        "FINAL_TIME": 9.0,       # 최종 결과 표시 후 대기실로
    },
    "BALANCE": {
        "LIMIT": 100, "DAMPING": 0.92, "RECOVER": 0.0006, "TIP": 0.0012, "LEAN_FORCE": 0.065, "MAX_SPEED": 7,
        "SWAY_BASE": 0.026, "SWAY_GROWTH": 0.016, "SWAY_NOISE": 0.02, "DANGER": 70,
        "STAGGER_THRESHOLD": 3.2, "STAGGER_FRAMES": 28, "STAGGER_LEAN_MULT": 0.35,
        "HOLD_LEAN_MULT": 0.5, "HOLD_SWAY_MULT": 0.4, "CHARGE_DRIFT": 0.012,
    },
    "ACTION": {
        "PUSH_WINDUP": 7, "PUSH_ACTIVE": 5, "PUSH_RECOVER": 14,
        "CHARGE_MAX": 50, "CHARGE_OVERHOLD": 70, "CHARGE_RELEASE": 3, "CHARGE_ACTIVE": 7, "CHARGE_RECOVER": 22,
        "FEINT_WINDOW": 16, "FEINT_RECOVER": 16, "FEINT_STREAK_DECAY": 0.6, "FEINT_STREAK_RESET": 45,
        "FEINT_MIN_WINDOW": 4,
        "HOLD_STARTUP": 4, "HOLD_STAMINA": 90, "HOLD_REGEN": 0.5, "HOLD_MIN_STAMINA": 20, "HOLD_RECOVER": 6,
    },
    "IMPACT": {
        "PUSH": 2.3, "CHARGE_MULT_MAX": 2.3, "PUSH_RECOIL": 0.3, "FORWARD_LEAN_POWER": 0.4,
        "WHIFF": 2.6, "WHIFF_LEAN_MULT": 0.5,
        "HOLD_ABSORB": 0.25, "HOLD_REBOUND": 1.7, "HOLD_FAIL_MULT": 1.25, "HOLD_BREAK_MULT": 0.3,
        "FEINT_VS_HOLD": 3.4, "FEINT_EMPTY": 0.5,
        "COUNTER_MULT": 1.2, "EXPOSED_MULT": 1.35, "STAGGER_MULT": 1.15, "CLASH": 1.5, "STAMINA_EMPTY_LURCH": 1.2,
    },
    # 손바닥이 맞은 순간 잠깐 멈추는 프레임 수(판정에도 영향을 주므로 서버가 관리한다)
    "JUICE": {
        "HITSTOP_PUSH": 4, "HITSTOP_CHARGE": 9, "HITSTOP_CLASH": 7, "HITSTOP_WHIFF": 5, "HITSTOP_HOLD": 5,
    },
    "SCORE": {
        "WIN_BONUS": 1000, "BALANCE_POINT": 5, "FEINT_POINT": 150, "FEINT_MAX_COUNT": 5,
        "HOLD_POINT": 80, "PUSH_POINT": 30, "TIME_POINT": 20, "TIME_ONLY_ON_KO": True,
    },
}


def merge_config(over: dict | None = None) -> dict:
    out = copy.deepcopy(DEFAULT_CONFIG)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out
