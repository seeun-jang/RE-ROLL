"""서버에 등록된 미니게임 목록. 새 게임은 여기에 한 줄 추가한다."""

from __future__ import annotations

from ..minigame import MiniGame
from .fruit.game import FruitGame
from .garden.game import GardenGame
from .kendo.game import KendoGame
from .mimic.game import MimicGame
from .mugunghwa.game import MugunghwaGame
from .palm.game import PalmGame
from .quiz.game import QuizGame
from .racing.game import RacingGame
from .spell.game import SpellGame
from .tug.game import TugGame

GAMES: dict[str, type[MiniGame]] = {
    TugGame.id: TugGame,
    PalmGame.id: PalmGame,
    QuizGame.id: QuizGame,
    SpellGame.id: SpellGame,
    MugunghwaGame.id: MugunghwaGame,
    MimicGame.id: MimicGame,
    FruitGame.id: FruitGame,
    GardenGame.id: GardenGame,
    KendoGame.id: KendoGame,
    RacingGame.id: RacingGame,
}

# ----- 두 번째 묶음(미니게임 10개) -----
# 폴더 이름과 클래스 이름만 적으면 등록된다. 폴더가 아직 없으면 건너뛴다(개발 중인 게임 때문에 서버가 멈추지 않게).
_MORE_GAMES = [
    ("claw", "ClawGame"),          # 잭팟 인형뽑기
    ("fight", "FightGame"),        # 매직 파이트 나이트
    ("hanomano", "HanomanoGame"),  # 하노마노
    ("bowling", "BowlingGame"),    # 잭팟 볼링
    ("groove", "GrooveGame"),      # 잭팟 그루브
    ("homerun", "HomerunGame"),    # 잭팟 홈런 더비
    ("livefire", "LivefireGame"),  # 실거리 사격
    ("sigil", "SigilGame"),        # 마법진 그리기
    ("pingpong", "PingpongGame"),  # 잭팟 탁구왕
    ("sneaky", "SneakyGame"),      # 교수님 몰래 댄스!
]


def _register_more() -> None:
    import importlib
    from pathlib import Path

    here = Path(__file__).resolve().parent
    for folder, class_name in _MORE_GAMES:
        if not (here / folder / "game.py").is_file():
            continue
        module = importlib.import_module(f"{__name__}.{folder}.game")
        cls = getattr(module, class_name)
        GAMES[cls.id] = cls


_register_more()
