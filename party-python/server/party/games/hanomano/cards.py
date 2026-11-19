"""하노마노 카드 규칙 (원본 js/cards.js 를 옮김).

카드 = [과일 번호(0~3), 개수(1~5)]. 과일: 0 체리 · 1 레몬 · 2 라임 · 3 포도
"""

from __future__ import annotations

from typing import Callable


def shuffle_cards(cards: list, rng: Callable[[], float]) -> list:
    """섞은 새 목록 (원본과 같은 피셔-예이츠 섞기)."""
    out = list(cards)
    for i in range(len(out) - 1, 0, -1):
        j = min(i, int(rng() * (i + 1)))
        out[i], out[j] = out[j], out[i]
    return out


def make_deck(rules: dict, rng: Callable[[], float]) -> list:
    """52장 덱(섞어서)."""
    deck = []
    for fruit in range(len(rules["FRUITS"])):
        for n, count in rules["CARD_COUNTS"].items():
            deck += [[fruit, int(n)] for _ in range(int(count))]
    return shuffle_cards(deck, rng)


def deal(deck: list, players: int) -> tuple[list[list], list]:
    """모두에게 같은 장수를 나눠 준다. 남는 카드(3명 1장, 5명 2장)는 게임에서 뺀다.

    → (사람별 카드 목록, 빠진 카드)
    """
    each = len(deck) // players
    hands = [deck[i * each:(i + 1) * each] for i in range(players)]
    return hands, deck[players * each:]


def fruit_totals(tops: list, fruits: int = 4) -> list[int]:
    """펼쳐진 카드(각자 맨 위 한 장) 위의 과일별 합계."""
    total = [0] * fruits
    for card in tops:
        if card:
            total[card[0]] += card[1]
    return total


def bell_is_right(tops: list, rules: dict) -> bool:
    return rules["TARGET"] in fruit_totals(tops, len(rules["FRUITS"]))


def bell_reason(tops: list, rules: dict) -> dict:
    """종을 친 순간의 판정과 설명 {ok, text, fruit, near}.

    맞음 → '라임 2+3 = 5개!'   틀림 → '포도 4개뿐! (5개 아님)' (5개에 제일 가까운 과일)
    near = 틀렸지만 어떤 과일이 4개였다(아깝게 틀림).
    """
    target = rules["TARGET"]
    names = rules["FRUITS"]
    total = fruit_totals(tops, len(names))
    if target in total:
        f = total.index(target)
        parts = "+".join(str(c[1]) for c in tops if c and c[0] == f)
        return {"ok": True, "text": f"{names[f]} {parts} = {target}개!", "fruit": f, "near": False}
    best = -1
    for i, v in enumerate(total):
        if v > 0 and (best < 0 or abs(v - target) < abs(total[best] - target)):
            best = i
    if best < 0:
        return {"ok": False, "text": "과일이 없어요!", "fruit": -1, "near": False}
    only = "뿐" if total[best] < target else ""
    return {
        "ok": False, "text": f"{names[best]} {total[best]}개{only}! ({target}개 아님)", "fruit": best,
        "near": (target - 1) in total,
    }
