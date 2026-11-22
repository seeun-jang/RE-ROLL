"""스토리보드 5~7번: 최종 결과 집계 → 보스전 → 굿엔딩 / 배드엔딩.

    모든 라운드 종료 → 누적 점수로 최종 순위(tally) → 최종 1위가 마법사와 보스전(boss_battle)
      → 이기면 굿엔딩("저주가 풀렸어요!") · 지면 배드엔딩("다음 판도 준비해 두지")

누적 점수 = 미니게임 순위 점수(1위 500 · 2위 350 · 3위 250 · 4위 150 · 5위 100) + 전진한 칸 × 10

보스전(주사위 대결, 3판 2선승):
    수호자(최종 1위)  타이밍 주사위 1~10  +  동료들의 응원(1명당 +1)
    마법사            주사위 1~10         +  저주의 힘 2
    큰 쪽이 그 판을 이긴다. 같으면 "RE:ROLL!" — 그 판을 다시 굴린다.

마법사의 대사는 서버의 Gemini 가 쓴다(services/caster.py 의 LineBook). Gemini 가 꺼져 있으면 기본 대사.
"""

from __future__ import annotations

import asyncio

from ..services.caster import LineBook
from . import data as R
from .room import Player, Room

# ----- 점수 -----
RANK_POINTS = [500, 350, 250, 150, 100]   # 미니게임 1~5위가 받는 점수
STEP_POINTS = 10                          # 결승 쪽으로 전진한 한 칸의 점수

# ----- 보스전 -----
BOSS_WINS = 2          # 먼저 2판을 이기면 승리
BOSS_MAX_ROUNDS = 7    # 비기는 판이 계속 나와도 이 판 수를 넘기지 않는다
WIZARD_BONUS = 2       # 마법사의 "저주의 힘"
WIZARD_NAME = "마법사"

#: 마법사 대사의 상황 → 설명 (Gemini 에게 주는 목록)
WIZARD_KINDS = {
    "intro": "보스전이 시작될 때, 도전자 {name} 을(를) 비꼬며 맞이한다",
    "wizard_round": "한 판을 마법사가 이겼을 때 여유를 부린다",
    "hero_round": "한 판을 도전자 {name} 에게 졌을 때 당황한다",
    "reroll": "주사위가 비겨서 다시 굴릴 때",
    "good": "최종 패배. 저주가 풀리는 것을 분해하며 인정한다",
    "bad": "최종 승리. 다음 판도 준비해 두겠다고, 새로운 수호자들을 기다리겠다고 말한다",
}
#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
WIZARD_CANNED = {
    "intro": ["{name}, 여기까지 오다니 제법이군요.", "어서 오시죠 {name}. 주사위는 준비됐습니까?"],
    "wizard_round": ["후후, 주사위는 정직하군요.", "이 정도입니까? 실망입니다."],
    "hero_round": ["이, 이럴 리가 없는데…!", "{name}… 운이 좋았을 뿐입니다."],
    "reroll": ["비겼군요. RE:ROLL 입니다.", "다시 굴리시죠. 결과는 같겠지만."],
    "good": ["크윽… 저주가… 풀리고 있어…!", "내가 지다니… 마을을 돌려드리죠."],
    "bad": ["…좋아. 다음 판도 준비해 두지.", "새로운 수호자들이 찾아올 때까지… 후후."],
}


def score_of(p: Player) -> int:
    """누적 점수 = 미니게임 순위 점수 + 전진한 칸 × 10."""
    return p.points + (R.DIST[R.START] - p.dist) * STEP_POINTS


def rank_points(rank: int) -> int:
    """미니게임에서 rank 위가 받는 점수."""
    return RANK_POINTS[rank - 1] if 1 <= rank <= len(RANK_POINTS) else 0


def make_wizard(gemini, players: list[str]) -> LineBook:
    """이 판에 쓸 마법사 대사 묶음. 게임이 시작될 때 한 번 요청해 두면 보스전 때는 이미 와 있다."""
    book = LineBook(gemini, game="보스전 주사위 대결", caster=WIZARD_NAME, kinds=WIZARD_KINDS,
                    canned=WIZARD_CANNED, players=players, per_kind=2, max_chars=30)
    book.prepare()
    return book


def wizard_says(room: Room, kind: str, name: str = "") -> None:
    """마법사 대사 한 줄을 room.boss 에 적는다(화면의 말풍선). source: 'gemini' | 'canned'."""
    if room.wizard is None:
        room.wizard = make_wizard(None, [])
    text, source = room.wizard.line(kind, room.rng.random, name=name)
    room.boss["line"] = text
    room.boss["lineSource"] = source


# ---------------- 5) 최종 결과 집계 ----------------
def tally(room: Room) -> list[dict]:
    """누적 점수로 최종 순위를 매긴다. 점수가 같으면 결승에 가까운 사람 → 먼저 들어온 사람 → 랜덤."""
    rows = [
        {"id": p.id, "name": p.name, "cpu": p.cpu, "seat": p.seat, "dist": p.dist, "score": score_of(p),
         "over": p.goal_over if p.goal_over is not None else -1}
        for p in room.players
    ]
    ties = {row["id"]: room.rng.random() for row in rows}
    rows.sort(key=lambda row: (-row["score"], row["dist"], -row["over"], ties[row["id"]]))
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    room.ranking = rows
    return rows


# ---------------- 보스전 ----------------
async def boss_battle(room: Room) -> str:
    """최종 1위가 마법사와 주사위 대결을 한다. 'good'(승리) 또는 'bad'(패배)를 돌려준다."""
    T = room.T
    hero = room.player(room.ranking[0]["id"])
    friends = [p for p in room.players if p is not hero]
    room.step = "boss"
    room.boss = {"hero": hero.id, "round": 0, "heroWins": 0, "wizWins": 0, "stage": "intro",
                 "last": None, "line": "", "lineSource": "canned", "need": BOSS_WINS, "bonus": WIZARD_BONUS}
    boss = room.boss
    wizard_says(room, "intro", hero.name)
    room.announce(f"보스전! {hero.name} vs {WIZARD_NAME}", icon="🧙", big=True)
    room.broadcast()
    await room.wait(T.BOSS_INTRO_MS)

    while max(boss["heroWins"], boss["wizWins"]) < BOSS_WINS and boss["round"] < BOSS_MAX_ROUNDS:
        boss["round"] += 1
        boss["stage"] = "roll"
        boss["last"] = None
        room.broadcast()

        # 수호자는 타이밍 주사위(1~10), 동료들은 응원(누르면 +1). 모두 동시에 묻는다.
        roll_job = room.ask(hero, "timing", "주사위를 멈춰라! (1~10)", [], timeout=T.TIMING_MS,
                            cpu_pick=lambda: 1 + room.rand(10), meta={"boss": True})
        cheer_jobs = [
            room.ask(p, "cheer", f"{hero.name} 응원하기! (+1)", [{"value": 1, "label": "힘내라!", "icon": "📣"}],
                     timeout=T.TIMING_MS, meta={"boss": True},
                     # CPU 는 절반 확률로 응원 · 사람은 시간 안에 눌러야 응원
                     cpu_pick=(lambda: room.rand(2)) if (p.cpu or not p.online) else (lambda: 0))
            for p in friends
        ]
        answers = await asyncio.gather(roll_job, *cheer_jobs)
        hero_die = int(answers[0])
        cheers = sum(1 for value in answers[1:] if value == 1)
        wizard_die = 1 + room.rand(10)

        hero_total, wizard_total = hero_die + cheers, wizard_die + WIZARD_BONUS
        winner = "hero" if hero_total > wizard_total else "wizard" if wizard_total > hero_total else "tie"
        if winner == "hero":
            boss["heroWins"] += 1
        elif winner == "wizard":
            boss["wizWins"] += 1
        boss["last"] = {"round": boss["round"], "heroDie": hero_die, "cheers": cheers, "heroTotal": hero_total,
                        "wizardDie": wizard_die, "wizardTotal": wizard_total, "winner": winner}
        boss["stage"] = "reveal"
        wizard_says(room, {"hero": "hero_round", "wizard": "wizard_round", "tie": "reroll"}[winner], hero.name)
        room.log.append(f"🧙 보스전 {boss['round']}판: {hero.name} {hero_total} vs {WIZARD_NAME} {wizard_total}")
        room.broadcast()
        await room.wait(T.BOSS_REVEAL_MS)

    # 판 수를 다 썼는데도 같으면 수호자의 승리 (끝까지 버틴 쪽)
    ending = "good" if boss["heroWins"] >= boss["wizWins"] else "bad"
    boss["stage"] = "done"
    boss["last"] = None
    wizard_says(room, ending, hero.name)
    return ending
