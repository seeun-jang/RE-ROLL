"""보드게임 한 판의 진행 (서버가 모든 판정을 한다. 화면은 보여주고 고른 것만 보낸다).

원본 party.js 의 "이동 / 한 판 / 주사위 고르기 → 굴리기 → 이동 / 칸 효과 / 미니게임" 부분을 옮긴 것이다.
함수 이름과 순서를 원본과 맞춰 두었다 (runGame → run_game, phaseRoll → phase_roll …).

한 턴: 주사위 고르기 → 모두 같이 굴림 → 동시에 이동 → 도착한 칸 효과 → 다 같이 같은 미니게임 → 순위대로 주사위
우승: 결승에 먼저 도착 (마지막 턴까지 아무도 못 가면 결승에 제일 가까운 사람)

난수(room.rng)를 쓰는 순서도 원본과 같게 맞췄다.
"""

from __future__ import annotations

import asyncio
import traceback

from . import data as R
from .jsutil import clean_score, js_round, tidy_number
from .room import Gone, Player, Room
from . import story


NO_LIMIT_CAP = 99   # '턴 제한 없음'일 때의 안전장치 (보통은 그 전에 누군가 결승에 도착한다)


async def together(coros) -> list:
    """여러 일을 동시에 하고 모두 끝날 때까지 기다린다 (원본의 Promise.all).

    하나가 오류로 멈추면 나머지도 취소한다 (원본은 버려 두지만, 파이썬에서는 작업이 계속 남기 때문).
    """
    tasks = [asyncio.ensure_future(c) for c in coros]
    try:
        return await asyncio.gather(*tasks)
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()


# 정렬: 자바스크립트의 sort 와 파이썬의 min/max/sorted 모두 "같은 값이면 앞에 있던 것이 먼저"라서 결과가 같다
def leader_of(players: list[Player]) -> Player:
    """결승에 제일 가까운 사람."""
    return min(players, key=lambda p: p.dist)


def last_of(players: list[Player]) -> Player:
    """결승에서 제일 먼 사람."""
    return max(players, key=lambda p: p.dist)


def player_opts(players: list[Player]) -> list[dict]:
    return [{"value": o.id, "label": o.name, "icon": "", "seat": o.seat} for o in players]


def dice_opt(value: int, dice_id: str) -> dict:
    d = R.DICE[dice_id]
    return {"value": value, "label": d["name"], "icon": d["icon"], "desc": d["desc"]}


def winners(room: Room) -> list[Player]:
    return [p for p in room.players if p.node == R.GOAL]


# ---------------- 이동 ----------------
async def move(room: Room, p: Player, steps: int, *, landing: bool = False) -> int:
    """steps > 0: 앞으로 (갈림길에선 고름) · steps < 0: 왔던 길로 뒤로. 실제로 움직인 칸 수를 돌려준다."""
    moved = 0
    total = abs(steps)
    for i in range(total):
        if steps > 0:
            cur = R.NODES[p.node]
            if cur["id"] == R.GOAL:
                break
            nxt = cur["next"][0]
            if len(cur["next"]) > 1:
                options = [
                    {"value": node_id, "label": "위 길" if k == 0 else "아래 길", "desc": branch_desc(cur["id"], node_id)}
                    for k, node_id in enumerate(cur["next"])
                ]
                nxt = await room.ask(p, "branch", "어느 길로 갈까?", options,
                                     cpu_pick=lambda: room.pick(cur["next"]), meta={"left": total - i})
            p.hist.append(nxt)
        else:
            if len(p.hist) <= 1:
                break
            p.hist.pop()
        moved += 1
        room.broadcast()
        await room.wait(room.T.STEP_MS)
        if p.node == R.GOAL:
            # 남은 걸음 (같은 턴에 여럿 들어오면 많이 남은 사람이 먼저 도착한 셈)
            p.goal_over = total - i - 1
            break
    if landing and moved > 0:
        p.landed = True
    return moved


def branch_desc(fork_id: int, next_id: int) -> str:
    """갈림길 보기에 붙는 설명: 짧은 길 / 긴 길."""
    d = R.DIST[next_id]
    other = [R.DIST[x] for x in R.NODES[fork_id]["next"] if x != next_id]
    if not other:
        return ""
    if d < min(other):
        return "짧지만 위험"
    if d > min(other):
        return "길지만 안전"
    return "쌈뽕한 칸 많음"


def teleport(p: Player, to_player: Player) -> None:
    p.hist = list(to_player.hist)


# ---------------- 한 판 ----------------
def start_game(room: Room) -> None:
    """게임 시작 (원본 runGame 의 앞부분). 준비를 바로 끝내고, 턴 진행은 따로 도는 작업(run_game)에 맡긴다.

    준비를 여기서 바로(기다림 없이) 하는 이유: '시작'을 두 번 눌러도 게임이 두 번 시작되지 않게.
    """
    room.phase = "play"
    room.turn = 0
    room.ranking = None
    room.last_game = None
    room.history = []
    room.log = []
    # 빈 자리 CPU
    used = {p.seat for p in room.players}
    for seat in range(R.MAX_PLAYERS):
        if seat in used:
            continue
        room.players.append(Player(next(room.ids), f"CPU {seat + 1}", seat, cpu=True))
    room.players.sort(key=lambda p: p.seat)
    for p in room.players:
        p.hist = [R.START]
        p.bag = []
        p.flags = {"skip": 0, "mirror": False, "shield": False, "rest": False}
        p.goal_over = None
        p.points = 0
    room.boss = room.ending = None
    # 마법사 대사를 지금 미리 부탁해 둔다 (보스전 때는 이미 와 있다)
    room.wizard = story.make_wizard(room.gemini, [p.name for p in room.players])
    room.announce("게임 시작! 점수를 모아 마법사에게 도전하자", icon="🏁", big=True)
    room.broadcast()
    room.task = asyncio.get_running_loop().create_task(run_game(room))


async def run_game(room: Room) -> None:
    try:
        await room.wait(room.T.START_MS)
        # max_turns 가 0 이면 턴 제한 없음: 누군가 결승에 도착할 때까지 (끝없이 돌지 않게 99턴에서는 멈춘다)
        limit = room.max_turns or NO_LIMIT_CAP
        while room.turn < limit:
            room.turn += 1
            room.history.append([list(p.hist) for p in room.players])
            last = " (마지막!)" if room.turn == limit else ""
            room.announce(f"{room.turn}턴{last}", icon="🎲", big=True)
            await phase_roll(room)
            if winners(room):
                break
            await phase_spaces(room)
            if winners(room):
                break
            await phase_minigame(room)
        # 스토리보드 5~7: 최종 순위(누적 점수) → 1위의 보스전 → 엔딩
        room.step = "final"
        room.prompts.clear()
        rows = story.tally(room)
        room.announce(f"최종 1위 {rows[0]['name']}! 보스전 진출!", icon="🏆", big=True)
        room.broadcast()
        await room.wait(room.T.FINAL_MS)
        ending = await story.boss_battle(room)
        finish_game(room, ending)
    except Gone:
        return   # 방이 닫힘
    except Exception:
        # 예상 못 한 오류: 멈춰 있지 않게 지금 위치로 게임을 끝냄
        print("[party] 진행 오류")
        traceback.print_exc()
        try:
            finish_game(room)
        except Exception:
            traceback.print_exc()


def finish_game(room: Room, ending: str | None = None) -> None:
    """게임 끝. ending: 'good'(보스전 승리) · 'bad'(패배) · None(오류로 중간에 끝남 → 순위만 보여 줌)."""
    room.step = None
    room.phase = "end"
    room.prompts.clear()
    room.ending = ending
    if room.ranking is None:
        story.tally(room)
    text = {"good": "저주가 풀렸어요!", "bad": "마법사의 승리…"}.get(ending, f"{room.ranking[0]['name']} 최종 1위!")
    room.announce(text, icon={"good": "🎉", "bad": "🌙"}.get(ending, "🏆"), big=True)
    room.broadcast()


# ---------------- 1) 주사위 고르기 → 굴리기 → 이동 ----------------
async def phase_roll(room: Room) -> None:
    T = room.T
    room.step = "choose"
    room.rolls = {}
    for p in room.players:
        p.landed = False
        p.flags["shield"] = False
    room.broadcast()

    choices = await together(choose_dice(room, p) for p in room.players)

    # 굴리기 (복사 · 질투는 다른 사람 결과를 봐야 해서 뒤에)
    rolls = [{"p": p, **c} for p, c in zip(room.players, choices)]
    for r in rolls:
        if not r.get("skip"):
            roll_one(room, r, rolls)
    for r in rolls:
        if not r.get("skip") and r.get("later"):
            r["later"]()
    for r in rolls:
        if r.get("skip"):
            continue
        if r["p"].flags["mirror"] and r["move"] > 0:
            r["move"] = -r["move"]
            r["text"] += " → 🪞 거울! 뒤로"
        r["p"].flags["mirror"] = False

    room.rolls = {}
    for r in rolls:
        # 쉬는 사람은 face · move 가 없다 (원본에서 undefined → JSON 에 키가 안 나감)
        shown = {"dice": r["dice"]}
        if "face" in r:
            shown["face"] = r["face"]
            shown["move"] = r["move"]
        shown["text"] = r["text"]
        shown["skip"] = bool(r.get("skip"))
        room.rolls[r["p"].id] = shown
    room.step = "reveal"
    room.broadcast()
    await room.wait(T.REVEAL_MS)

    # 이동 (모두 동시에)
    room.step = "move"
    room.broadcast()

    async def go(r: dict) -> None:
        p = r["p"]
        if r.get("skip"):
            return
        if r.get("toStart"):
            p.hist = [R.START]
            room.broadcast()
            return
        if r.get("teleport"):
            teleport(p, r["teleport"])
            p.landed = True
            room.broadcast()
            return
        if r["move"]:
            await move(room, p, r["move"], landing=True)

    await together(go(r) for r in rolls)

    # 남한테 영향 주는 주사위 (저격 · 남 좋은)
    async def push(r: dict) -> None:
        who, steps = r["other"]
        if steps < 0 and who.flags["shield"]:
            room.announce(f"{who.name} 🔰 방패로 막음!", pid=who.id)
            return
        await move(room, who, steps)

    await together(push(r) for r in rolls if r.get("other"))
    await room.wait(T.AFTER_MOVE_MS)


async def choose_dice(room: Room, p: Player) -> dict:
    """p 가 이번 턴에 굴릴 주사위(와 필요한 추가 선택)를 정한다."""
    if p.flags["skip"] > 0:
        p.flags["skip"] -= 1
        return {"skip": True, "dice": None, "text": "😵 쉬는 중"}
    # 쓰레기 주사위는 무조건 먼저
    idx = next((i for i, d in enumerate(p.bag) if R.DICE[d["id"]]["kind"] == "trash"), -1)
    if idx < 0:
        options = [dice_opt(-1, "basic")] + [dice_opt(i, d["id"]) for i, d in enumerate(p.bag)]
        if len(options) == 1:
            idx = -1
        else:
            idx = await room.ask(
                p, "dice", "굴릴 주사위를 골라요", options, timeout=room.T.CHOOSE_MS,
                # CPU: 주사위가 있으면 60% 확률로 그중 하나
                cpu_pick=lambda: room.rand(len(p.bag)) if p.bag and room.rng.random() < 0.6 else -1,
            )
    dice_id = "basic" if idx < 0 else p.bag[idx]["id"]
    # 다 썼으면 가방에서 빼기 (끈끈이는 2번)
    if idx >= 0:
        d = p.bag[idx]
        d["uses"] -= 1
        if d["uses"] <= 0:
            p.bag.pop(idx)
    kind = R.DICE[dice_id].get("input")
    c = {"dice": dice_id}
    if kind == "parity":
        c["parity"] = await room.ask(
            p, "parity", "홀? 짝?",
            [{"value": "odd", "label": "홀", "icon": "⬆️"}, {"value": "even", "label": "짝", "icon": "⬇️"}],
            cpu_pick=lambda: room.pick(["odd", "even"]),
        )
    elif kind == "target":
        others = [o for o in room.players if o is not p]
        c["target"] = await room.ask(p, "target", "누구를 저격할까?", player_opts(others),
                                     cpu_pick=lambda: leader_of(others).id)
    elif kind == "timing":
        c["timing"] = await room.ask(p, "timing", "Space 로 멈춰!", [], timeout=room.T.TIMING_MS,
                                     cpu_pick=lambda: 3 + room.rand(6))
    return c


def roll_one(room: Room, r: dict, all_rolls: list[dict]) -> None:
    """주사위 하나를 굴려서 r 에 결과(face 눈 · move 움직일 칸 · text 화면 글자)를 적는다."""
    d = R.DICE[r["dice"]]
    p: Player = r["p"]
    face = room.pick(d["faces"]) if d["faces"] else 0
    r["face"] = face
    r["move"] = face
    r["text"] = f"{d['icon']} {face}"
    others = [o for o in room.players if o is not p]
    dice = r["dice"]

    if dice == "double":
        a, b = 1 + room.rand(6), 1 + room.rand(6)
        r["face"] = r["move"] = a + b
        r["text"] = f"🎲 {a} + {b} = {a + b}"
    elif dice == "timing":
        r["face"] = r["move"] = r["timing"]
        r["text"] = f"⏱️ {r['timing']}"
    elif dice == "parity":
        ok = (face % 2 == 1) == (r["parity"] == "odd")
        r["move"] = face * 2 if ok else 0
        said = "홀" if r["parity"] == "odd" else "짝"
        result = f"맞힘! ×2 = {r['move']}" if ok else "틀림… 0"
        r["text"] = f"☯️ {face} ({said}) {result}"
    elif dice == "roulette":
        r["face"] = r["move"] = 1 + room.rand(20)
        r["text"] = f"🎡 {r['face']}"
        if r["face"] == 13:
            r["move"] = 0
            r["toStart"] = True
            r["text"] += " 💀 출발점으로!"
    elif dice == "magnet":
        # 나보다 앞선 사람 중 제일 가까운 사람
        ahead = [o for o in others if o.dist < p.dist]
        if ahead:
            target = max(ahead, key=lambda o: o.dist)
            r["teleport"] = target
            r["move"] = 0
            r["face"] = "🧲"
            r["text"] = f"🧲 {target.name}에게 철컥!"
        else:
            r["move"] = r["face"] = 1
            r["text"] = "🧲 앞에 아무도 없음… 1칸"
    elif dice == "envy":
        def later() -> None:
            lead = leader_of(others)
            # Math.floor 와 파이썬의 // 는 음수에서도 똑같이 내림한다
            r["move"] = r["face"] = max(1, (p.dist - lead.dist) // 2)
            r["text"] = f"😤 {lead.name}이(가) 부러워서 {r['move']}칸"
        r["later"] = later
    elif dice == "copy":
        def later() -> None:
            lead = leader_of(others)
            lr = next((x for x in all_rolls if x["p"] is lead), None)
            r["move"] = r["face"] = lr["move"] if lr and not lr.get("skip") and lr["dice"] != "copy" else 3
            r["text"] = f"📋 {lead.name} 따라 {r['move']}칸"
        r["later"] = later
    elif dice == "sniper":
        who = room.player(r["target"])
        r["move"] = 0
        r["other"] = (who, -face)
        r["text"] = f"🔫 {who.name}을(를) {face}칸 뒤로!"
    elif dice == "shield":
        p.flags["shield"] = True
        r["text"] = f"🔰 {face} (방패)"
    elif dice == "helper":
        last = last_of(others)
        r["move"] = 0
        r["other"] = (last, face)
        r["text"] = f"🤡 {face}… {last.name}만 좋은 일"
    elif dice == "slow":
        r["move"] = face // 2
        r["text"] = f"🐌 {face} → 절반 {r['move']}"
    elif dice == "banana":
        if room.rng.random() < 0.5:
            r["move"] = -face
            r["text"] = f"🍌 미끄러져서 {face}칸 뒤로!"
        else:
            r["text"] = f"🍌 {face}칸 앞으로"
    elif dice == "sleepy":
        if room.rng.random() < 0.5:
            r["move"] = 0
            r["text"] = "😴 쿨쿨… 안 움직임"
        else:
            r["text"] = f"😴 {face}"
    elif dice == "reverse":
        r["text"] = f"🔙 {-face}칸 뒤로"


# ---------------- 2) 칸 효과 ----------------
async def phase_spaces(room: Room) -> None:
    room.step = "space"
    room.broadcast()
    # 이번 턴에 움직인 사람만, 결승에 가까운 사람부터
    order = sorted((p for p in room.players if p.landed), key=lambda p: p.dist)
    for p in order:
        if p.node == R.GOAL:
            continue
        kind = R.NODES[p.node]["type"]
        sp = R.SPACES.get(kind)
        if not sp or kind in ("plain", "fork", "start"):
            continue
        room.announce(f"{p.name} · {sp['name']}!", icon=sp["icon"], pid=p.id, big=bool(sp.get("tier")))
        await room.wait(room.T.SPACE_INTRO_MS)
        await apply_space(room, p, kind)
        room.broadcast()
        await room.wait(room.T.EFFECT_MS)
        if winners(room):
            return


async def apply_space(room: Room, p: Player, kind: str) -> None:
    """p 가 도착한 칸(kind)의 효과."""
    others = [o for o in room.players if o is not p]

    def say(text: str, icon: str = "") -> None:
        room.announce(text, icon=icon, pid=p.id)

    if kind == "dice":
        room.give_dice(p, room.pick(R.dice_of("normal")))
    elif kind == "trash":
        room.give_dice(p, room.pick(R.dice_of("trash")), "😩 ")
    elif kind == "trap":
        if p.flags["shield"]:
            say(f"{p.name} 🔰 방패로 함정을 막음!")
        else:
            await move(room, p, -3)

    elif kind == "slot":
        reel = ["7️⃣", "🍒", "🔔", "💩"]
        x = room.rng.random()
        if x < 0.12:
            res = ["7️⃣"] * 3
        elif x < 0.22:
            res = ["💩"] * 3
        else:
            res = [room.pick(reel), room.pick(reel), room.pick(reel)]
        # 🍒🍒🍒 · 🔔🔔🔔 은 없다 → 마지막 그림을 바꿈
        if res[0] == res[1] == res[2] and res[0] not in ("7️⃣", "💩"):
            res[2] = "🔔" if res[0] == "🍒" else "🍒"
        room.announce(" ".join(res), icon="🎰", pid=p.id, big=True)
        await room.wait(room.T.SLOT_MS)
        if res == ["7️⃣"] * 3:
            say("대박! 5칸 앞으로", "🎉")
            await move(room, p, 5)
        elif res == ["💩"] * 3:
            say("똥 3개… 출발점으로", "💀")
            p.hist = [R.START]
        elif res.count("🔔") >= 2:
            room.give_dice(p, room.pick(R.dice_of("fun")))
        elif res.count("🍒") >= 2:
            room.give_dice(p, room.pick(R.dice_of("normal")))
        elif "💩" in res:
            room.give_dice(p, room.pick(R.dice_of("trash")), "😩 ")
        else:
            say("꽝!")
    elif kind == "point":
        target = await room.ask(p, "target", "다음 턴에 쉬게 할 사람", player_opts(others),
                                cpu_pick=lambda: leader_of(others).id)
        who = room.player(target)
        who.flags["skip"] = max(who.flags["skip"], 1)
        say(f"{who.name} 다음 턴 쉬기!", "👉")
    elif kind == "drill":
        say("나만 빼고 모두 2칸 뒤로!", "📢")
        await together(move(room, o, -2) for o in others if not o.flags["shield"])
    elif kind == "gift":
        if not p.bag:
            say("줄 주사위가 없음…")
            return
        idx = await room.ask(
            p, "dice", "남한테 줄 주사위", [dice_opt(i, d["id"]) for i, d in enumerate(p.bag)],
            # CPU: 쓰레기 주사위가 있으면 그걸 줌
            cpu_pick=lambda: max(0, next((i for i, d in enumerate(p.bag) if R.DICE[d["id"]]["kind"] == "trash"), -1)),
        )
        d = p.bag.pop(idx)
        to = room.pick(others)
        to.bag.append(d)
        room.trim_bag(to)
        say(f"{R.DICE[d['id']]['icon']} {R.DICE[d['id']]['name']} → {to.name}에게 선물", "🎀")
    elif kind == "slide":
        await move(room, p, 6)
    elif kind == "capsule":
        x = room.rng.random()
        if x < 0.3:
            say("꽝!", "🔮")
        else:
            room.give_dice(p, room.pick(R.dice_of("trash" if x < 0.65 else "fun")), "🔮 ")
    elif kind == "thief":
        rich = [o for o in others if o.bag and not o.flags["shield"]]
        if not rich:
            say("훔칠 주사위가 없음…")
            return
        target = await room.ask(p, "target", "누구 걸 훔칠까?", player_opts(rich),
                                cpu_pick=lambda: max(rich, key=lambda o: len(o.bag)).id)
        who = room.player(target)
        d = room.take_random_dice(who)
        if not d:
            return
        p.bag.append(d)
        room.trim_bag(p)
        say(f"{who.name}의 {R.DICE[d['id']]['icon']} {R.DICE[d['id']]['name']}을(를) 훔침!", "🦹")
    elif kind == "taxi":
        target = await room.ask(p, "target", "누구 칸으로 갈까?", player_opts(others),
                                cpu_pick=lambda: leader_of(others).id)
        who = room.player(target)
        teleport(p, who)
        say(f"{who.name} 칸으로 슝!", "🚕")
    elif kind == "rest":
        p.flags["rest"] = True
        say("다음 미니게임 보상 2배!", "☕")
    elif kind == "mirror":
        p.flags["mirror"] = True
        say("다음 턴엔 굴린 만큼 뒤로…", "🪞")

    elif kind == "quake":
        hists = room.shuffle([o.hist for o in room.players])
        for o, h in zip(room.players, hists):
            o.hist = list(h)
        room.announce("모두의 위치가 섞였다!", icon="🌋", big=True)
    elif kind == "hole":
        near = [o for o in others if abs(o.dist - p.dist) <= 5 and o.node != R.START]
        if not near:
            say("빨려온 사람이 없음…", "🕳️")
            return
        for o in near:
            teleport(o, p)
        room.announce(f"{', '.join(o.name for o in near)} 빨려 들어감!", icon="🕳️", big=True)
    elif kind == "rocket":
        if room.rng.random() < 0.3:
            room.announce("쾅! 로켓 폭발… 6칸 뒤로", icon="💥", big=True)
            await move(room, p, -6)
        else:
            room.announce("발사! 12칸 앞으로", icon="🚀", big=True)
            await move(room, p, 12)
    elif kind == "revolt":
        lead, last = leader_of(room.players), last_of(room.players)
        if lead is last or lead.dist == last.dist:
            say("바꿀 사람이 없음…")
            return
        lead.hist, last.hist = last.hist, lead.hist
        room.announce(f"혁명! {lead.name} ↔ {last.name}", icon="👑", big=True)
    elif kind == "jackpot":
        got = []
        for o in others:
            if o.flags["shield"]:
                continue
            d = room.take_random_dice(o)
            if d:
                p.bag.append(d)
                got.append(R.DICE[d["id"]]["icon"])
        room.trim_bag(p)
        room.announce(f"잭팟! {' '.join(got)} 싹쓸이" if got else "잭팟… 근데 아무도 주사위가 없음", icon="💰", big=True)
    elif kind == "tornado":
        n = 1 + room.rand(15)
        if room.rng.random() < 0.5:
            n = -n
        room.announce(f"{abs(n)}칸 {'앞으로' if n > 0 else '뒤로'} 날아감!", icon="🌪️", big=True)
        await move(room, p, n)
    elif kind == "bigdice":
        n = 1 + room.rand(30)
        room.announce(f"대왕 주사위… {n}!", icon="🎲", big=True)
        await room.wait(room.T.BIGDICE_MS)
        await move(room, p, n)
    elif kind == "timemachine":
        back = room.history[max(0, len(room.history) - 3)]
        for o, h in zip(room.players, back):
            o.hist = list(h)
        room.announce("모두 3턴 전으로 돌아감!", icon="⏪", big=True)


# ---------------- 3) 미니게임 ----------------
async def phase_minigame(room: Room) -> None:
    T = room.T
    # 바로 전 턴의 게임은 빼고 고른다 (게임이 하나뿐이면 그 게임을 다시 한다)
    games = [g for g in room.minigames if g["id"] != room.last_game] or list(room.minigames)
    game = room.pick(games)
    room.last_game = game["id"]
    room.mg = {
        "id": game["id"], "name": game["name"], "seed": 1 + room.rand(99999),
        "startAt": tidy_number(room.clock() + T.MG_INTRO_MS),
        "results": {},   # 참가자 번호 → 점수 (화면에는 번호만 done 으로 나감)
    }
    mg = room.mg
    room.mg_result = None
    room.step = "minigame"
    room.announce(f"미니게임: {mg['name']}", icon="🎮", big=True)
    room.broadcast()

    # 끼워 넣은 러너가 있으면 러너가 게임을 돌리고, 없거나 결과를 안 주면 원래 방식(화면이 점수를 보냄)으로
    ranks = await run_minigame_runner(room, mg) if room.minigame_runner else None
    if ranks is None:
        await wait_for_results(room, mg)
        ranks = {}

    # CPU 점수: 사람 점수 평균 근처에서 랜덤 (사람 점수가 하나도 없으면 평균을 50 으로 봄)
    results = mg["results"]
    hs = [results[pid] for pid in sorted(results)]
    avg = max(10, sum(hs) / len(hs) if hs else 50)
    scores = []
    for p in room.players:
        if p.id in results:
            score = results[p.id]
        elif p.cpu or not p.online:
            score = js_round(avg * (0.5 + room.rng.random() * 0.65))
        else:
            score = 0   # 접속해 있는데 결과를 안 보낸 사람
        scores.append({"p": p, "score": score})
    # 점수가 같으면 랜덤으로 순서를 정함 (모두 0점이면 다 같이 1위가 되지 않게)
    for s in scores:
        s["tie"] = room.rng.random()
    scores.sort(key=lambda s: (-s["score"], s["tie"]))
    if ranks:
        # 러너가 순위를 줬으면: 그 사람들이 차지한 자리는 그대로 두고, 그 자리들을 러너의 순위 순서로 다시 나눠 앉힌다
        slots = [i for i, s in enumerate(scores) if s["p"].id in ranks]
        ordered = sorted((scores[i] for i in slots), key=lambda s: (ranks[s["p"].id], s["tie"]))
        for i, s in zip(slots, ordered):
            scores[i] = s
    for i, s in enumerate(scores):
        s["rank"] = i + 1

    # 순위 점수를 누적 점수에 더한다 (1위 500 · 2위 350 · 3위 250 · 4위 150 · 5위 100)
    for s in scores:
        s["points"] = story.rank_points(s["rank"])
        s["p"].points += s["points"]

    room.step = "mgResult"
    room.mg_result = {
        "name": mg["name"],
        "rows": [{"id": s["p"].id, "name": s["p"].name, "score": s["score"], "rank": s["rank"], "reward": [],
                  "points": s["points"]} for s in scores],
    }
    room.broadcast()
    await room.wait(T.MG_SHOW_MS)

    # 보상: 1위 재밌는 주사위 3개 중 고르기 · 2위 재밌는 랜덤 · 3위 보통 랜덤 (☕ 쉼터면 2번)
    async def reward(s: dict) -> None:
        p: Player = s["p"]
        kind = R.REWARDS[s["rank"] - 1] if s["rank"] <= len(R.REWARDS) else None
        row = next(row for row in room.mg_result["rows"] if row["id"] == p.id)
        times = 2 if p.flags["rest"] else 1
        p.flags["rest"] = False
        if not kind:
            return
        for _ in range(times):
            if kind == "pick-fun":
                three = room.shuffle(R.dice_of("fun"))[:3]
                dice_id = await room.ask(p, "reward", "1위 보상! 하나 골라요",
                                         [dice_opt(d, d) for d in three], cpu_pick=lambda: room.pick(three))
            else:
                dice_id = room.pick(R.dice_of(kind))
            row["reward"].append(dice_id)
            room.give_dice(p, dice_id, f"{s['rank']}위 보상 ")
            room.broadcast()

    await together(reward(s) for s in scores)
    await room.wait(T.MG_RESULT_MS)
    room.mg = None


async def wait_for_results(room: Room, mg: dict) -> None:
    """원래 방식: 접속한 사람이 모두 결과(result)를 보낼 때까지 기다린다 (최대 6분 · 방장이 건너뛰기 가능)."""
    T = room.T
    deadline = room.clock() + T.MG_INTRO_MS + T.MG_MAX_MS
    while room.clock() < deadline and not mg.get("skip"):
        waiting = [p for p in room.humans() if p.online and p.id not in mg["results"]]
        if not waiting:
            break
        await room.wait(T.MG_POLL_MS)


async def run_minigame_runner(room: Room, mg: dict) -> dict | None:
    """끼워 넣은 러너로 미니게임을 돌린다.

    러너가 준 점수를 mg["results"] 에 넣고 {참가자 번호: 순위} 를 돌려준다 (순위를 안 줬으면 빈 dict).
    러너가 결과를 안 줬으면(None · 빈 dict · 오류) None → 원래 방식으로 넘어간다.
    """
    try:
        res = await room.minigame_runner(room, mg)
    except Gone:
        raise
    except Exception:
        print("[party] 미니게임 러너 오류 → 원래 방식으로 진행")
        traceback.print_exc()
        res = None
    if room.dead:
        raise Gone()
    rows = {}
    for pid, row in (res or {}).items():
        p = room.player(pid)
        if p is not None and isinstance(row, dict):
            rows[p.id] = row
    if not rows:
        return None
    for pid, row in rows.items():
        mg["results"][pid] = clean_score(row.get("score"))   # result 메시지와 같은 규칙 (0 이상 정수)
    # 순위는 모두가 갖고 있을 때만 쓴다 (일부만 있으면 점수로 정함)
    if all(row.get("rank") is not None for row in rows.values()):
        return {pid: row["rank"] for pid, row in rows.items()}
    return {}
