"""매직 파이트 나이트 — 모든 수치.

RING · FIGHTER · PUNCH · COUNTER · GUARD · BOUT 은 원본 js/config.js · js/bout.js 의 값 그대로이다
(단위: 프레임 = 1/60초, 거리 = 320×180 화면의 픽셀).
FLOW 와 SCORE.WIN 은 여러 명이 리그전으로 하도록 바꾸면서 새로 정한 값이다.
같은 값이 web/src/games/fight/config.js 에 있다(서버가 game.start 의 options 로도 보낸다).
"""

from __future__ import annotations

import copy

#: 판정 계산 횟수(초당). 원본과 같다.
LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    "WIDTH": 320,
    "HEIGHT": 180,
    "RING": {
        "FLOOR_Y": 140,      # 선수 발이 닿는 바닥 높이
        "LEFT": 42,          # 로프 안쪽 경계
        "RIGHT": 278,
        "START_GAP": 48,     # 시작할 때 로프에서 떨어진 거리
    },
    "FIGHTER": {
        "HP": 100,
        "ACCEL": 0.22,       # 걸음 가속
        "MAX_SPEED": 1.6,
        "GUARD_SPEED": 1.6,  # 뒷걸음 속도(앞걸음과 같다)
        "FRICTION": 0.8,     # 키를 떼면 미끄러지듯 멈춤
        "DASH_SPEED": 3.8,   # 앞키 두 번 = 대시
        "DASH_WINDOW": 9,    # 두 번 누르는 간격(프레임)
        "BODY_W": 18,        # 몸통 반폭(서로 겹치지 않게)
        "CHARGE_TIME": 20,   # 이만큼 누르고 있다 떼면 강펀치
        "CHARGE_MOVE": 0.75, # 강펀치를 모으는 동안 걷는 속도 비율
    },
    # 펀치: startup(준비) → active(판정) → recovery(회복)
    "PUNCH": {
        "jab": {"startup": 4, "active": 4, "recovery": 9, "range": 47, "damage": 5, "push": 2.3, "stun": 14, "hitstop": 4},
        "power": {"startup": 7, "active": 5, "recovery": 22, "range": 52, "damage": 14, "push": 5, "stun": 26, "hitstop": 9},
    },
    # 슥빡 카운터: 펀치가 닿기 직전(SLIP_WINDOW 프레임 안)에 가드를 시작하면 피한다 → COUNTER_TIME 안에 맞히면 피해 COUNTER_MUL 배
    "COUNTER": {"SLIP_WINDOW": 8, "COUNTER_TIME": 40, "COUNTER_MUL": 2, "ATTACKER_STAGGER": 14},
    "GUARD": {"DAMAGE_MUL": 0.15, "PUSH_MUL": 0.5, "BREAK_POWER": True, "BREAK_STUN": 18},
    "BOUT": {
        "TIME": 45 * 60,     # 한 경기 45초(KO 가 없으면 판정)
        "INTRO_LEN": 150,    # 선수 소개 → 라운드 → FIGHT! 까지
        "COUNT_START": 40,   # KO 뒤 심판 카운트 시작
        "COUNT_STEP": 10,    # 카운트 한 번 간격
        "KO_TAIL": 110,      # 카운트 10 뒤 K.O.! 를 보여 주는 시간
        "DECISION_LEN": 170, # 판정 결과를 보여 주는 시간
        "HURRY": 10 * 60,    # 남은 시간이 이만큼일 때 해설("시간이 없다") (임시 값)
    },
    # 순위 점수: 원본 개인 모드(GAUNTLET)의 KO 보너스 50 · 남은 체력 1당 1점은 그대로, 1승 점수만 키웠다
    "SCORE": {
        "WIN": 1000,         # 1승 (임시 값 — 원본 100. 승수가 항상 먼저 비교되도록 키움)
        "KO_BONUS": 50,      # KO 로 이기면 추가(원본 값)
        "HP_BONUS": 1,       # 이긴 경기에서 남은 체력 1당(원본 값)
    },
    "FLOW": {
        "ROUNDS_FOR_TWO": 3,  # 2명일 때 같은 상대와 몇 판 (임시 값)
        "INTRO_TIME": 4.0,    # 대진 안내 (임시 값)
        "END_HOLD": 0.5,      # 마지막 경기가 끝난 뒤 잠깐 (임시 값)
        "RESULT_TIME": 4.0,   # 라운드 결과 (임시 값)
        "FINAL_TIME": 9.0,    # 최종 결과 + AI 총평 (임시 값)
        "SAY_GAP": 3.0,       # 해설 대사 사이 최소 간격(초)
    },
}


def merge_config(over: dict | None = None) -> dict:
    """기본 값에 바꿀 값만 덮어쓴 설정(테스트에서 시간을 줄일 때 쓴다)."""
    out = copy.deepcopy(DEFAULT_CONFIG)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out
