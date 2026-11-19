"""줄다리기 설정값 — 판정·힘·점수에 쓰는 숫자는 모두 여기서 관리한다.

값은 원본(web/src/games/tug/config.js)의 기본값과 같다.
서버가 게임을 시작할 때 이 값을 브라우저로 보내므로, 여기만 고치면 화면에도 같은 값이 적용된다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG: dict = {
    # ---------- 진행 ----------
    "ROUNDS": 3,            # 라운드 수
    "ROUND_TIME": 30,       # 라운드 제한 시간(초)
    "COUNTDOWN": 3,         # 카운트다운 숫자(3, 2, 1)
    # ---------- 서버가 정하는 장면 시간(초) ----------
    "ASSIGN_TIME": 4.2,         # 팀 배정 연출
    "END_HOLD": 1.0,            # 라운드 종료 후 FINISH! 표시
    "ROUND_RESULT_TIME": 4.0,   # 라운드 결과 표시
    "SUMMARY_TIME": 15.0,       # 점수 기록 화면(누가 '결과 확인'을 누르면 바로 넘어감)
    "FINAL_TIME": 8.0,          # 최종 결과 표시 후 대기실로
    # ---------- 팀 ----------
    # 인원이 적은 팀의 힘 보정. "ratio" = 많은 팀 인원 ÷ 적은 팀 인원 (2:3 → 1.5, 1:2 → 2.0).
    # 숫자를 넣으면 그 값으로 고정.
    "SMALL_TEAM_MULT": "ratio",
    # ---------- 줄 (px, 320x180 기준) ----------
    "WIN_DISTANCE": 48,
    "ROPE_SPEED": 10,
    "ROPE_MAX_SPEED": 30,
    "FORCE_DECAY": 2.5,
    "DRAW_EPSILON": 1,
    # ---------- 박자 ----------
    "BPM": 120,
    "FEVER_BPM": 150,
    "PERFECT_WINDOW": 0.06,
    "GOOD_WINDOW": 0.13,
    "SPAM_MAX_PRESSES_PER_BEAT": 2,
    # ---------- 힘 ----------
    "POWER": {"perfect": 1.0, "good": 0.6, "miss": 0.25, "spam": 0.05},
    # ---------- 피버 ----------
    "FEVER_FIRST": 8,
    "FEVER_INTERVAL": 10,
    "FEVER_DURATION": 4,
    "FEVER_WARNING": 1,
    "FEVER_POWER_MULT": 2,
    "FEVER_SCORE_MULT": 2,
    # ---------- 점수 ----------
    "SCORE": {
        "perfect": 100,
        "good": 50,
        "miss": 0,
        "spam": -10,
        "comboStep": 5,
        "comboCap": 20,
        "roundWin": 300,
        "roundDraw": 100,
    },
    # ---------- 입력 시각 검증(초) ----------
    # 브라우저가 보낸 '누른 시각'이 서버 시각과 이 범위 안에서만 다를 때 그대로 믿는다.
    "INPUT_MAX_LAG": 0.35,    # 서버 시각보다 이만큼까지 과거
    "INPUT_MAX_LEAD": 0.05,   # 서버 시각보다 이만큼까지 미래
}

# 시뮬레이션 고정 스텝(초). 원본 게임 로직과 같은 60FPS.
STEP = 1.0 / 60.0


def merge_config(over: dict | None = None) -> dict:
    """기본 설정에 덮어쓸 값을 깊게 병합한 새 dict."""
    out = copy.deepcopy(DEFAULT_CONFIG)
    if not over:
        return out
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out
