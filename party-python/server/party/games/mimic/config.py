"""소리 따라하기 — 설정. 숫자는 모두 여기서만 바꾼다."""

from __future__ import annotations

import copy
from pathlib import Path

SOUNDS_DIR = Path(__file__).resolve().parent / "sounds"

DEFAULT_CONFIG: dict = {
    "RULES": {
        "DIFFICULTIES": ["easy", "normal", "hard"],   # 라운드마다 이 난이도에서 소리를 하나씩 뽑는다
        "REC_EXTRA": 1.5,          # 녹음 길이 = 원본 길이 + 이 값(초). 원본 값
        "MIN_ACTIVE_SEC": 0.3,     # 소리가 난 구간이 이보다 짧으면 무효(0점). 원본 값
    },
    "FLOW": {
        "INTRO_TIME": 4.0,         # 게임 안내
        "ROUND_LEAD": 1.5,         # 라운드 안내 뒤 원본을 들려주기까지
        "LISTEN_REPEATS": 2,       # 라운드 시작 때 원본 재생 횟수(원본 값)
        "LISTEN_GAP": 0.8,         # 재생 사이 간격
        "LISTEN_TAIL": 0.6,
        "TURN_INTRO": 1.6,         # "OO 차례" 안내 (원본 값)
        "CUE_TAIL": 0.5,           # 차례마다 원본을 한 번 더 들려준 뒤의 여유
        "COUNT_BEEPS": 3,          # 3·2·1
        "BEEP_INTERVAL": 0.7,
        "SCORE_MIN": 0.8,          # 채점 중 화면을 최소한 이만큼 보여 준다
        "SCORE_TIMEOUT": 8.0,      # 녹음이 도착하지 않거나 채점이 이보다 오래 걸리면 무효 처리
        "REVEAL_TIME": 2.8,        # 점수 공개 시간(녹음을 다시 들려준 뒤)
        "ROUND_END": 3.0,          # 라운드가 끝난 뒤 순위 표시
        "FINAL_TIME": 9.0,
    },
    "SCORE": {
        # 유사도(0~1) → 점수(0~100):  bad 이하면 0점, good 이상이면 100점, 그 사이는 비례.
        #   bad  = 이 소리와 "다른 제시 소리들"의 유사도 중 상위 25% 지점 (서버가 켜질 때 스스로 잰다)
        #   good = bad + GOOD_FRACTION × (1 - bad)   (1 = 원본과 똑같음)
        "GOOD_FRACTION": 0.5,
        "GRADES": [["S", 90], ["A", 75], ["B", 60], ["C", 0]],   # 원본 값
        "DTW_BAND": 0.25,          # 시간 어긋남을 허용하는 폭(전체 길이 비율)
    },
    "VOICE": {
        "MAX_EXTRA_SEC": 1.0,      # 받는 녹음 길이 상한 = 원본 길이 + REC_EXTRA + 이 값
        "ACTIVE_REL_DB": 35.0,     # 가장 큰 소리보다 이만큼 작은 소리까지 "소리 난 구간"으로 본다
        "ACTIVE_FLOOR_DB": -55.0,  # 이보다 작은 소리는 무음
    },
}


def merge_config(override: dict | None = None, base: dict | None = None) -> dict:
    out = copy.deepcopy(DEFAULT_CONFIG if base is None else base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_config(value, out[key])
        else:
            out[key] = copy.deepcopy(value)
    return out
