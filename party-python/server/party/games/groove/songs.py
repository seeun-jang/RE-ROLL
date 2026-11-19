"""곡 데이터 — 채보를 만드는 데 필요한 부분만(멜로디 · 구간). 원본 js/song.js 와 같은 내용.

화면 쪽 web/src/games/groove/song.js 에는 소리용 데이터(화음 · 드럼 · 베이스)까지 있다.
멜로디 문자열은 두 파일이 같아야 한다 — tests/test_groove_game.py 가 Node 로 만든 채보와 비교한다.

한 마디 = 16칸(16분음표). 'A4' = 그 칸에서 음 시작, '-' = 앞 음을 이어서 길게, '.' = 쉼표.
"""

from __future__ import annotations

import re

SONG_ORDER = ["groove", "moon", "neon"]

SONGS: dict[str, dict] = {
    "groove": {
        "id": "groove", "title": "잭팟 그루브", "artist": "RE:ROLL 하우스 밴드", "bpm": 128,
        "phrases": {
            "i1": "A4 . C5 . E5 . A5 - . G5 . E5 - . D5 .",
            "i2": "C5 - - - . . A4 . C5 . D5 . E5 - - -",
            "i3": "D5 . B4 . G4 . B4 . D5 - . E5 . D5 B4 .",
            "i4": "G#4 - - - B4 - - - E5 - - - - - - -",
            "v1": "E4 . E4 . A4 . . C5 . B4 . A4 - . . .",
            "v2": "F4 . A4 . C5 . . A4 . C5 . D5 - . . .",
            "v3": "D5 . . B4 . G4 . B4 . D5 . E5 - . D5 .",
            "v4": "B4 - - . G#4 - - . E4 - - - . . . .",
            "v6": "F4 . A4 . C5 . . F5 . E5 . D5 . C5 . .",
            "v7": "B4 . D5 . G5 . . F5 . E5 . D5 . B4 . .",
            "v8": "E5 - - - D5 - - - B4 - - - G#4 - - -",
            "p1": "D5 . F5 . A5 . F5 . D5 . F5 . A5 . F5 .",
            "p2": "E5 . G5 . B5 . G5 . E5 . G5 . B5 . G5 .",
            "p3": "F5 . A5 . C6 . A5 . F5 . A5 . C6 . A5 .",
            "p4": "B5 - - - . . . . G#5 . A5 . B5 . E6 .",
            "c1": "A5 . . A5 . . G5 . A5 . C6 . A5 . G5 .",
            "c2": "G5 - - . . . D5 . G5 . B5 . A5 . G5 .",
            "c3": "E5 . . E5 . . D5 . E5 . G5 . B5 - . .",
            "c4": "A5 - - - . . . . C6 . B5 . A5 . E5 .",
            "c7": "G#5 . . G#5 . . B5 . E6 - - - D6 . B5 .",
            "c8": "A5 - - - - - - - . . . . . . . .",
            "b1": "A4 - - - - - - - C5 - - - - - - -",
            "b2": "F4 - - - - - - - A4 - - - C5 - - -",
            "b3": "B4 - - - - - - - D5 - - - G5 - - -",
            "b4": "G#4 - - - B4 - - - E5 - - - G#5 - - -",
            "o1": "F5 . . F5 . . E5 . . . . . . . . .",
            "o2": "A5 - - - - - - - - - - - - - - -",
        },
        "sections": [
            {"name": "intro", "phrases": ["i1", "i2", "i3", "i4"], "fever": False},
            {"name": "verse", "phrases": ["v1", "v2", "v3", "v4", "v1", "v6", "v7", "v8"], "fever": False},
            {"name": "pre", "phrases": ["p1", "p2", "p3", "p4"], "fever": False},
            {"name": "chorus", "phrases": ["c1", "c2", "c3", "c4", "c1", "c2", "c7", "c8"], "fever": True},
            {"name": "break", "phrases": ["b1", "b2", "b3", "b4"], "fever": False},
            {"name": "chorus2", "phrases": ["c1", "c2", "c3", "c4", "c1", "c2", "c7", "c8"], "fever": True},
            {"name": "outro", "phrases": ["o1", "o2"], "fever": False},
        ],
    },
    "moon": {
        "id": "moon", "title": "달빛 칩스", "artist": "RE:ROLL 라운지 트리오", "bpm": 96,
        "phrases": {
            "l1": "D5 - - . F5 . A5 - - . G5 . F5 . E5 .",
            "l2": "D5 - - - . . C5 . D5 . F5 . A5 - - -",
            "l3": "G5 - - . F5 . D5 - - . C5 . A#4 . C5 .",
            "l4": "A4 - - - - - . . C#5 . E5 . A5 - - .",
            "m1": "F5 . E5 . D5 . . A4 . . D5 . F5 - . .",
            "m2": "G5 . F5 . E5 . . C5 . . E5 . G5 - . .",
            "m3": "A5 . G5 . F5 . . D5 . . F5 . A5 - C6 -",
            "m4": "A#5 - - - A5 - - - G5 - - - E5 - - -",
            "s1": "D6 . C6 . A5 . C6 . D6 - . F6 . D6 . C6",
            "s2": "A#5 . A5 . G5 . A5 . A#5 - . D6 . A#5 . A5",
            "s3": "C6 . A#5 . A5 . G5 . A5 - . C6 . E6 - -",
            "s4": "D6 - - - . . . . A5 . . . D6 - - -",
            "b1": "D5 - - - - - - - F5 - - - - - - -",
            "b2": "G5 - - - - - - - A#5 - - - A5 - - -",
            "e1": "F5 . E5 . D5 . . . A4 . . . D5 - - -",
            "e2": "D5 - - - - - - - . . . . . . . .",
        },
        "sections": [
            {"name": "intro", "phrases": ["l1", "l2", "l3", "l4"], "fever": False},
            {"name": "verse", "phrases": ["m1", "m2", "m3", "m4", "m1", "m2", "m3", "m4"], "fever": False},
            {"name": "chorus", "phrases": ["s1", "s2", "s3", "s4", "s1", "s2", "s3", "s4"], "fever": True},
            {"name": "break", "phrases": ["b1", "b2", "b1", "b2"], "fever": False},
            {"name": "outro", "phrases": ["e1", "e2"], "fever": False},
        ],
    },
    "neon": {
        "id": "neon", "title": "네온 러시", "artist": "RE:ROLL 하이퍼 밴드", "bpm": 150,
        "phrases": {
            "n1": "E5 . E5 . G5 . E5 . B5 . A5 . G5 . F#5 .",
            "n2": "E5 . E5 . G5 . A5 . B5 - - . D6 . B5 .",
            "n3": "C6 . B5 . A5 . G5 . A5 . B5 . A5 . G5 .",
            "n4": "F#5 - - - D#5 - - - B4 - - - F#5 - - -",
            "r1": "B4 . . B4 . . E5 . . . G5 . F#5 . E5 .",
            "r2": "C5 . . C5 . . E5 . . . G5 . A5 . G5 .",
            "r3": "D5 . . D5 . . F#5 . . . A5 . G5 . F#5 .",
            "r4": "B4 - - - . . D#5 . F#5 . B5 - - - . .",
            "u1": "A4 . C5 . E5 . A5 . A4 . C5 . E5 . A5 .",
            "u2": "B4 . D5 . G5 . B5 . B4 . D5 . G5 . B5 .",
            "u3": "C5 . E5 . G5 . C6 . D5 . F#5 . A5 . D6 .",
            "u4": "B5 - - - B5 - - - D#6 - - - F#6 - - -",
            "k1": "E6 - . D6 . B5 . . G5 . A5 . B5 - . .",
            "k2": "C6 - . B5 . A5 . . E5 . G5 . A5 - . .",
            "k3": "D6 - . C6 . B5 . . F#5 . A5 . D6 - . .",
            "k4": "B5 . A5 . G5 . F#5 . G5 - - - F#5 - - -",
            "k8": "E6 - - - - - - - . . . . . . . .",
            "z1": "E5 - - - - - - - G5 - - - - - - -",
            "z2": "C5 - - - - - - - D5 - - - F#5 - - -",
            "x1": "E6 . . E6 . . B5 . . . . . . . . .",
            "x2": "E5 - - - - - - - - - - - - - - -",
        },
        "sections": [
            {"name": "intro", "phrases": ["n1", "n2", "n3", "n4"], "fever": False},
            {"name": "verse", "phrases": ["r1", "r2", "r3", "r4", "r1", "r2", "r3", "r4"], "fever": False},
            {"name": "pre", "phrases": ["u1", "u2", "u3", "u4"], "fever": False},
            {"name": "chorus", "phrases": ["k1", "k2", "k3", "k4", "k1", "k2", "k3", "k8"], "fever": True},
            {"name": "break", "phrases": ["z1", "z2", "z1", "z2"], "fever": False},
            {"name": "chorus2", "phrases": ["k1", "k2", "k3", "k4", "k1", "k2", "k3", "k8"], "fever": True},
            {"name": "outro", "phrases": ["x1", "x2"], "fever": False},
        ],
    },
}

NOTE_NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
_NOTE_RE = re.compile(r"^([A-G]#?)(\d)$")


def note_to_midi(name: str) -> int | None:
    """'A4' → MIDI 번호 69"""
    m = _NOTE_RE.match(name)
    if not m:
        return None
    return NOTE_NAMES[m.group(1)] + (int(m.group(2)) + 1) * 12


def expand_song(song: dict) -> dict:
    """곡을 펼쳐 시간순 목록으로 만든다 (원본 expandSong).

    bars[]: {index, section, fever, firstOfSection}
    melody[]: {step(곡 전체 16분음표 번호), dur(칸 수), midi, bar, section}
    """
    bars: list[dict] = []
    melody: list[dict] = []
    for sec in song["sections"]:
        for i, key in enumerate(sec["phrases"]):
            bar = len(bars)
            bars.append({"index": bar, "section": sec["name"], "fever": bool(sec.get("fever")), "firstOfSection": i == 0})
            cur = None
            for s, token in enumerate(song["phrases"][key].split()):
                if token == "-":
                    if cur:
                        cur["dur"] += 1
                    continue
                cur = None
                if token == ".":
                    continue
                midi = note_to_midi(token)
                if midi is None:
                    continue
                cur = {"step": bar * 16 + s, "dur": 1, "midi": midi, "bar": bar, "section": sec["name"]}
                melody.append(cur)
    step_sec = 60 / song["bpm"] / 4
    return {
        "bars": bars, "melody": melody, "stepSec": step_sec, "barSec": step_sec * 16, "beatSec": step_sec * 4,
        "totalSteps": len(bars) * 16, "duration": len(bars) * 16 * step_sec,
    }
