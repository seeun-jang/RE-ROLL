"""검도 유효타격 판정 — 원본 js/game/judge.js 를 옮긴 것.

  resolve_strike()   타격이 닿는 순간 무슨 일이 일어났나 (헛침/막힘/받아치기/튕김/접촉)
  evaluate_strike()  접촉 뒤 잔심까지 지켜본 기록으로 한판감인지 계산
      필수 조건: 간격(너무 가깝지 않음) + 기합 게이지 + 잔심 유지 + 상타 아님
      판정 점수: 간격·빈틈·기합 타이밍의 가중합 (+받아치기 보너스, −감점)
"""

from __future__ import annotations

import math


def band(cfg: dict, strike_type: str, reach: float = 0) -> dict:
    c = cfg["STRIKES"][strike_type]["contact"]
    return {"min": c["min"], "idealLo": c["idealLo"] + reach, "idealHi": c["idealHi"] + reach, "max": c["max"] + reach}


def get_openings(cfg: dict, s: dict) -> dict:
    """상대 상태 요약 → 부위별 빈틈(0~1)."""
    O = cfg["OPENINGS"]
    st = s["state"]
    if st == "strike":
        if s["phase"] == "windup":
            return O["windup_" + s["strikeType"]]
        return O["recover_bad"] if s["recoverBad"] else O["recover"]
    if st == "block":
        return O["block"]
    if st == "stagger":
        return O["stagger"]
    if st == "stun":
        return O["stun"]
    if st in ("frozen", "sonkyo"):
        return O["frozen"]
    if s["moveRel"] > 0:
        return O["forward"]
    if s["moveRel"] < 0:
        return O["backward"]
    return O["idle"]


def dist_score(cfg: dict, dist: float, b: dict) -> float:
    E = cfg["JUDGE"]["DIST_EDGE_SCORE"]
    if b["idealLo"] <= dist <= b["idealHi"]:
        return 1
    if dist < b["idealLo"]:
        return E + (1 - E) * max(0, (dist - b["min"]) / max(1, b["idealLo"] - b["min"]))
    return E + (1 - E) * max(0, (b["max"] - dist) / max(1, b["max"] - b["idealHi"]))


def resolve_strike(cfg: dict, att, de) -> dict:
    """타격이 닿는 틱에 호출 — 결과 종류를 정한다."""
    stype = att.strike["type"]
    b = band(cfg, stype, att.reach)
    dist = abs(att.x - de.x)
    ds = de.snapshot()
    if dist > b["max"]:
        return {"kind": "whiff", "dist": dist}
    # 막기는 머리·손목만 막는다(허리는 열림)
    if de.state == "block" and stype != "do":
        if de.parry_active:
            return {"kind": "parried", "dist": dist}
        return {"kind": "blocked", "dist": dist}
    opening = get_openings(cfg, ds)[stype]
    base = {"dist": dist, "opening": opening, "defState": ds["state"], "defPhase": ds["phase"]}
    if dist < b["min"]:
        return {"kind": "contact", "tooClose": True, **base}
    if opening < cfg["DEFLECT_THRESHOLD"]:
        return {"kind": "deflected", **base}
    return {"kind": "contact", "tooClose": False, **base}


def evaluate_strike(cfg: dict, rec: dict) -> dict:
    """유효타격 판정. 돌려주는 값: {type, valid, quality, tags, mainReason}."""
    J = cfg["JUDGE"]
    failed: list[str] = []
    tags: list[str] = []

    d_score = 0 if rec["tooClose"] else dist_score(cfg, rec["dist"], rec["band"])
    if rec["tooClose"]:
        failed.append("너무 가까움 (코등이 거리) (%d)" % math.floor(rec["dist"] + 0.5))

    kiai_value = 0 if not rec["kiaiOk"] else (1 if rec["kiaiTimed"] else J["KIAI_BASE"])
    if not rec["kiaiOk"]:
        failed.append("기합 부족 (%d/%d)" % (rec["kiaiGauge"], cfg["KIAI"]["REQUIRED"]))

    if rec["zanshinBroken"]:
        failed.append(rec["zanshinBroken"])
    if rec["aiuchi"]:
        failed.append("서로 동시에 침 — 무효")

    q = d_score * J["W_DIST"] + rec["opening"] * J["W_OPEN"] + kiai_value * J["W_KIAI"]
    if rec["counter"]:
        q += J["COUNTER_BONUS"]
        tags.append("받아치기")
    if rec["debana"]:
        tags.append("출발기")
    if rec["kiaiOk"] and rec["kiaiTimed"]:
        tags.append("기검체일치")
    if rec["momentum"] < cfg["MOMENTUM"]["LOW"]:
        q -= J["LOW_MOMENTUM_PENALTY"]
    if rec["backward"]:
        q -= J["BACKWARD_PENALTY"]
    q = max(0, min(1.1, q))
    return {"type": rec["type"], "valid": not failed, "quality": q, "tags": tags,
            "mainReason": failed[0] if failed else None}
