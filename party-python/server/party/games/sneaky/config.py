"""교수님 몰래 댄스! — 설정. 숫자는 모두 여기서만 바꾼다.

원본 js/config.js 값을 그대로 옮겼다. 시간 단위는 원본과 같은 "프레임"(1/60초)이다.
원본에 없던 값(통신 지연 유예, 장면 길이, AI 수업 계획)에는 (임시 값) 표시를 했다.
"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    "CLASS_TIME": 60 * 60,        # 수업 시간 60초 (프레임)

    # 춤 점수(초당) · 큰 춤은 멈추는 데 시간이 걸린다
    "SMALL_RATE": 6,              # 작은 춤: 초당 6점
    "BIG_RATE": 15,               # 큰 춤: 초당 15점
    "BIG_RECOVER": 14,            # 큰 춤을 멈추고 자리에 앉기까지(이 동안도 춤추는 것으로 보인다)
    "FEVER": [1, 1.5, 2, 3],      # 교수님이 돌아봤을 때 얌전히 버티면 한 단계씩 올라가는 배수
    "CAUGHT_PENALTY": 20,         # 걸리면 깎이는 점수
    "PUNISH_TIME": 150,           # 벌서기 시간(춤 못 춤)
    "MAX_STRIKES": 3,             # 이만큼 걸리면 복도로(남은 수업 동안 못 춤)

    # 교수님 (시간이 갈수록 빨라지고 교활해진다: 앞 값 = 수업 처음, 뒤 값 = 수업 끝)
    "TEACHER": {
        "FIRST_WRITE": 160,                    # 첫 쓰기는 넉넉하게
        "WRITE": [[100, 220], [55, 150]],      # 칠판에 쓰는 시간 [최소, 최대]
        "TELL": [[34, 52], [22, 36]],          # 돌아보기 전 낌새(분필 멈춤 · 흠흠)
        "TURN": 9,                             # 돌아보는 시간(낌새 뒤)
        "SUDDEN_TURN": 26,                     # 낌새 없이 갑자기 돌아볼 때(천천히 돌아서 반응할 틈이 조금 있다)
        "LOOK": [[60, 110], [70, 140]],        # 반 아이들을 보는 시간
        "BACK": 10,                            # 다시 칠판으로 돌아서는 시간
        "FAKE": [0.15, 0.35],                  # 낌새만 주고 안 돌아볼 확률
        "SUDDEN": [0.06, 0.2],                 # 낌새 없이 갑자기 돌아볼 확률
        "SEE_FROM": 0.55,                      # 돌아보는 동작의 이 지점부터 보인다
    },

    # 통신 지연 유예: 교수님이 보기 시작하고 이 시간이 지나도 춤추고 있으면 걸린다. 원본 0 (임시 값)
    "GRACE": 12,

    # 장면 길이(초)
    "FLOW": {
        "INTRO_TIME": 4.0,        # 수업 시작 안내. 원본 2.5초 (임시 값)
        "END_HOLD": 170 / 60,     # "수업 끝!" 다 같이 춤추는 시간 (원본 END_DELAY 170프레임)
        "FINAL_TIME": 8.0,        # 최종 결과 화면 (임시 값)
    },

    # AI(Gemini) 수업 계획 — 한 단계 = 칠판 쓰기 한 번 + 그 뒤의 행동
    "PLAN": {
        "MIN_STEPS": 10,
        "MAX_STEPS": 14,
        "MAX_SUDDEN": 3,          # 한 수업에 갑자기 돌아보기는 이만큼까지(원본 확률 최대 20% × 14단계) (임시 값)
        "MAX_FAKE": 5,            # 페이크는 이만큼까지(원본 확률 최대 35% × 14단계) (임시 값)
    },

    "SAY_GAP": 3.0,               # 교수님 대사 사이 최소 간격(초)
    "LAST_SECONDS": 10,           # "마지막 10초" 대사
}


def merge_config(override: dict | None = None, base: dict | None = None) -> dict:
    """기본 설정 위에 일부 값만 덮어쓴다(테스트에서 시간을 줄일 때 쓴다)."""
    out = copy.deepcopy(DEFAULT_CONFIG if base is None else base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_config(value, out[key])
        else:
            out[key] = copy.deepcopy(value)
    return out
