"""잭팟 탁구왕 설정값 — 원본(pingpong-jackpot/js/config.js)과 같은 값.

단위: 따로 적지 않으면 프레임(1/60초)과 픽셀(320×180 화면 기준).
옆에서 본 탁구대: 왼쪽 선수 ↔ 오른쪽 선수. 같은 값이 web/src/games/pingpong/sim/config.js 에 있다.
"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    "WIDTH": 320,
    "HEIGHT": 180,
    "TABLE": {
        "LEFT": 88,        # 탁구대 왼쪽 끝
        "RIGHT": 232,      # 탁구대 오른쪽 끝
        "Y": 120,          # 탁구대 윗면 높이(공이 튀는 곳)
        "NET_X": 160,
        "NET_TOP": 108,    # 네트 꼭대기
    },
    "FLOOR_Y": 150,        # 선수 발 / 공이 바닥에 떨어지는 높이
    "ZONE": {"NEAR": 84, "FAR": 12},   # 왼쪽 선수가 움직일 수 있는 x 범위(오른쪽은 대칭)
    "HOME_X": 58,          # 왼쪽 선수의 처음 자리(오른쪽은 대칭)

    "GAME_POINTS": 3,      # 3점 먼저 내면 승리
    "DEUCE_CAP": 6,        # 2:2 듀스부터 2점 차가 나야 승리, 6점 먼저면 무조건 승리
    "SERVE_EVERY": 2,      # 2점마다 서브권 교대(듀스에서는 1점마다)
    "POINT_PAUSE": 64,     # 득점 후 쉬는 시간
    "AUTO_SERVE": 240,     # 서브를 안 넣으면 4초 뒤 자동 서브
    "MATCH_INTRO": 90,     # 경기 시작 전 조작 안내 시간
    "MATCH_END": 180,      # "게임 셋!" 을 보여 주는 시간

    "BALL": {"GRAVITY": 0.11, "SIZE": 5},

    "PLAYER": {
        "ACCEL": 0.25,
        "MAX_SPEED": 1.9,
        "FRICTION": 0.75,
        "REACH_X": 18,       # 라켓이 닿는 가로 거리
        "REACH_TOP": 58,     # 발 기준 이 높이까지 닿음
        "REACH_LOW": 4,
        "SWING": 10,         # 휘두르는 시간(이 안에 공이 들어오면 맞음)
        "CHARGE_TIME": 20,   # 이만큼 꾹 누르면 스매시 준비 완료
    },

    # 샷 종류: T = 상대 코트에 떨어질 때까지 프레임, depth = 떨어지는 곳(0 네트 바로 뒤 ~ 1 끝선), bounce = 튀는 힘
    "SHOTS": {
        "drive": {"T": 36, "depth": [0.35, 0.75], "bounce": 0.6},
        "drop": {"T": 40, "depth": [0.3, 0.5], "bounce": 0.5},
        "lob": {"T": 64, "depth": [0.55, 0.85], "bounce": 0.5},
        "smash": {"T": 20, "depth": [0.5, 0.9], "bounce": 0.55},
        "serve": {"T": 34, "depth": [0.5, 0.85], "bounce": 0.7},
    },
    "TABLE_GRIP": 0.78,           # 공이 탁구대에 튈 때 가로 속도가 줄어드는 비율
    "SMASH_MIN_QUALITY": 0.35,    # 스매시는 타이밍이 이보다 나쁘면 네트에 걸림
    "CHANCE_QUALITY": 0.3,        # 타이밍이 이보다 나쁘면 높게 뜨는 '찬스볼'
    "HITSTOP": 3,                 # 공을 친 순간 잠깐 멈추는 프레임(판정 시간에도 영향을 주므로 서버가 관리)
    "HITSTOP_SMASH": 7,
    "SMASH_SLOW": 24,             # 스매시 뒤 반 속도로 흐르는 프레임

    # 서버가 정하는 장면 시간(초)과 리그전 값 — 원본에 없던 값이라 모두 임시 값
    "FLOW": {
        "ROUNDS_FOR_TWO": 1,      # 2명일 때 경기 수 (임시 값)
        "INTRO_TIME": 5.0,        # 라운드 대진 안내 (임시 값)
        "END_HOLD": 1.0,          # 모든 경기의 "게임 셋!" 이 끝난 뒤 잠깐 (임시 값)
        "RESULT_TIME": 5.0,       # 라운드 결과 (임시 값)
        "FINAL_TIME": 10.0,       # 최종 결과 + AI 총평 (임시 값)
        "MATCH_LIMIT": 120.0,     # 한 경기가 이보다 길어지면 다음 득점에서 앞선 쪽이 승리 (임시 값)
        "SAY_GAP": 3.0,           # 해설 대사 사이 최소 간격 (임시 값)
        "LONG_RALLY": 8,          # 이만큼 주고받으면 '긴 랠리' 해설 (임시 값)
    },
    # 순위 점수: 경기마다 기본 점수 + 승리 점수 + 득실차 × 점수. 이긴 횟수가 항상 먼저 반영된다. (임시 값)
    "SCORE": {"BASE": 12, "WIN": 100, "DIFF": 4},
}


def merge_config(over: dict | None = None) -> dict:
    out = copy.deepcopy(DEFAULT_CONFIG)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out
