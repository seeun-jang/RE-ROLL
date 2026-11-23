"""소리 따라하기: 차례 진행, 녹음 채점, 무효 처리, 순위. (채점은 음성 모델 없이 대체 채점기로 확인한다)"""

from __future__ import annotations

import base64
import hashlib
import random
from concurrent.futures import Future
from pathlib import Path

import numpy as np
import pytest

from party.games.mimic import game as mimic_game
from party.games.mimic.config import SOUNDS_DIR
from party.games.mimic.game import MimicGame
from party.games.mimic.scoring import (Scorer, SpectralEmbedder, array_to_pcm16, load_sounds, resample, similarity,
                                       spectral_embed, trim_active)

FAST = {"FLOW": {"INTRO_TIME": 0.2, "ROUND_LEAD": 0.1, "LISTEN_GAP": 0.1, "LISTEN_TAIL": 0.1, "TURN_INTRO": 0.1,
                 "CUE_TAIL": 0.1, "BEEP_INTERVAL": 0.1, "SCORE_MIN": 0.1, "SCORE_TIMEOUT": 1.0, "REVEAL_TIME": 0.2,
                 "ROUND_END": 0.2, "FINAL_TIME": 0.2}}
SOUNDS = {s["id"]: s for s in load_sounds()}


def b64(audio, rate=16000):
    return base64.b64encode(array_to_pcm16(np.asarray(audio, dtype=np.float32))).decode()


def clip_of(sound_id, lead=0.3, tail=0.5):
    """제시 소리를 16kHz 로 바꾸고 앞뒤에 무음을 붙인 '완벽한 따라 하기'."""
    s = SOUNDS[sound_id]
    a = resample(s["audio"], s["rate"])
    return np.concatenate([np.zeros(int(lead * 16000), np.float32), a, np.zeros(int(tail * 16000), np.float32)])


def make(n=3, sounds=("beep", "meow", "siren"), services=None, seed=3):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    g = MimicGame(players, {"config": FAST, "sounds": list(sounds)}, random.Random(seed).random)
    g.services = services or {}
    g.start(0.0)
    g.drain()
    return g


def run_until(g, cond, limit=120.0, step=0.05):
    """cond(g) 가 참이 될 때까지 진행. (시각, 그동안의 사건)"""
    events = []
    now = getattr(g, "_now", 0.0)
    while not cond(g):
        now += step
        assert now < limit, f"시간 초과 (phase={g.phase})"
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = now
    return now, events


def test_spectral_scorer_gives_full_marks_to_the_original_and_low_to_noise_and_other_sounds():
    sc = Scorer(SpectralEmbedder())
    assert sc.poll() and sc.ready
    r = np.random.default_rng(0)
    for sid, s in SOUNDS.items():
        same, _ = trim_active(clip_of(sid), 16000)
        assert sc.score_embedding(sid, spectral_embed(same, 16000))["score"] >= 95, sid
        noise = r.normal(0, 0.1, 16000).astype(np.float32)
        assert sc.score_embedding(sid, spectral_embed(noise, 16000))["score"] <= 15, sid
        others = [sc.score_embedding(sid, spectral_embed(resample(o["audio"], o["rate"]), 16000))["score"]
                  for oid, o in SOUNDS.items() if oid != sid]
        assert sorted(others)[len(others) // 2] <= 10, sid            # 다른 소리 대부분은 0점 근처


def test_similarity_is_one_for_identical_and_tolerates_small_time_shifts():
    e = spectral_embed(clip_of("siren", 0, 0), 16000)
    assert similarity(e, e) == pytest.approx(1.0, abs=1e-5)
    shifted = spectral_embed(clip_of("siren", 0.06, 0), 16000)
    assert similarity(e, shifted) > 0.9
    assert similarity(e, e[:0]) == 0.0


def test_trim_active_cuts_silence_and_measures_sound_time():
    a = clip_of("beep", 0.5, 0.8)
    trimmed, active = trim_active(a, 16000)
    assert active == pytest.approx(SOUNDS["beep"]["duration"], abs=0.15)
    assert len(trimmed) / 16000 == pytest.approx(SOUNDS["beep"]["duration"], abs=0.2)
    assert trim_active(np.zeros(16000, np.float32), 16000)[1] == 0.0


def test_turn_order_rotates_each_round_and_everyone_plays_every_sound():
    g = make(n=3)
    seen = []
    for _ in range(9):
        run_until(g, lambda x: x.phase == "record")
        seen.append((g.round, g.current))
        g.on_input(g.current, {"k": "nomic"}, g._now)
        run_until(g, lambda x: x.phase != "scoring" and x.phase != "record")
    base = g.base_order
    assert [p for r, p in seen if r == 1] == base
    assert [p for r, p in seen if r == 2] == base[1:] + base[:1]
    assert [p for r, p in seen if r == 3] == base[2:] + base[:2]
    assert [g.sounds[i]["id"] for i in range(3)] == ["beep", "meow", "siren"]


def test_recording_is_scored_and_played_back_to_everyone():
    g = make(n=2)
    run_until(g, lambda x: x.phase == "record")
    first = g.current
    other = [p for p in g.ids if p != first][0]
    g.on_input(other, {"k": "audio", "pcm": b64(clip_of("beep")), "rate": 16000}, g._now)     # 남의 녹음은 무시
    assert g._audio is None
    audio = b64(clip_of("beep"))
    g.on_input(first, {"k": "audio", "pcm": audio, "rate": 16000}, g._now + 0.1)
    g.on_input(first, {"k": "audio", "pcm": b64(clip_of("meow")), "rate": 16000}, g._now + 0.2)  # 두 번째 녹음은 무시
    _, ev = run_until(g, lambda x: x.phase == "reveal")
    reveal = [e for e in ev if e["type"] == "reveal"][0]
    assert reveal["playerId"] == first and reveal["valid"] and reveal["score"] >= 95 and reveal["grade"] == "S"
    assert reveal["pcm"] == audio and reveal["rate"] == 16000
    assert g.scores[first][0]["score"] == reveal["score"] and g.snapshot(g._now)["scorer"] == "spectral"
    # 다른 소리를 내면 점수가 낮다
    run_until(g, lambda x: x.phase == "record")
    g.on_input(other, {"k": "audio", "pcm": b64(clip_of("siren")), "rate": 16000}, g._now)
    _, ev = run_until(g, lambda x: x.phase == "reveal")
    assert [e for e in ev if e["type"] == "reveal"][0]["score"] <= 40


def test_silence_missing_audio_and_bad_data_score_zero_without_playback():
    g = make(n=2)
    run_until(g, lambda x: x.phase == "record")
    who = g.current
    for data in ("x", {"k": "audio", "pcm": "@@", "rate": 16000}, {"k": "audio", "pcm": b64(clip_of("beep")), "rate": True},
                 {"k": "audio", "pcm": b64(np.zeros(16000 * 30, np.float32)), "rate": 16000}, {"k": "?"}):
        g.on_input(who, data, g._now)
    assert g._audio is None
    g.on_input(who, {"k": "audio", "pcm": b64(np.zeros(16000 * 2, np.float32)), "rate": 16000}, g._now)   # 무음
    _, ev = run_until(g, lambda x: x.phase == "reveal")
    r = [e for e in ev if e["type"] == "reveal"][0]
    assert r == {"type": "reveal", "playerId": who, "round": 1, "score": 0, "valid": False, "grade": "-", "reason": "silent"}
    run_until(g, lambda x: x.phase == "record")                # 다음 사람은 아무것도 보내지 않는다
    _, ev = run_until(g, lambda x: x.phase == "reveal")
    r = [e for e in ev if e["type"] == "reveal"][0]
    assert r["valid"] is False and r["reason"] == "noAudio" and "pcm" not in r


def test_full_game_ranks_by_total_score():
    g = make(n=3)
    good = g.base_order[1]
    while not g.finished:
        run_until(g, lambda x: x.phase == "record" or x.finished)
        if g.finished:
            break
        who = g.current
        clip = clip_of(g.sound["id"]) if who == good else clip_of("rhythm" if g.sound["id"] != "rhythm" else "beep")
        g.on_input(who, {"k": "audio", "pcm": b64(clip), "rate": 16000}, g._now)
        run_until(g, lambda x: x.phase != "record" and x.phase != "scoring")
    res = {r["playerId"]: r for r in g.results}
    assert res[good]["rank"] == 1 and res[good]["isWinner"] and res[good]["score"] >= 285
    assert res[good]["stats"]["rounds"] == [g.scores[good][i]["score"] for i in range(3)]
    assert all(r["score"] <= res[good]["score"] for r in g.results)


def test_whisper_embedder_is_used_when_the_voice_model_can_embed():
    class FakeStt:
        available = True
        can_embed = True

        def __init__(self):
            self.calls = 0

        def submit_embed(self, pcm, rate=16000):
            self.calls += 1
            f = Future()
            f.set_result(spectral_embed(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0, rate)[:, :12])
            return f

    stt = FakeStt()
    mimic_game._scorers.pop("whisper", None)
    g = make(n=2, services={"stt": stt})
    assert g.scorer.name == "whisper" and stt.calls == len(SOUNDS) + 1      # 제시 소리 9개 + 잡음의 특징을 미리 뽑는다
    run_until(g, lambda x: x.phase == "record")
    g.on_input(g.current, {"k": "audio", "pcm": b64(clip_of("beep")), "rate": 16000}, g._now)
    _, ev = run_until(g, lambda x: x.phase == "reveal")
    assert [e for e in ev if e["type"] == "reveal"][0]["score"] >= 95 and stt.calls == len(SOUNDS) + 2
    mimic_game._scorers.pop("whisper", None)


def test_sound_files_match_the_copies_used_by_the_browser():
    web = Path(__file__).resolve().parents[2] / "web" / "src" / "games" / "mimic" / "sounds"
    if not web.is_dir():
        pytest.skip("화면 쪽 소리 폴더가 없음")
    for s in load_sounds():
        a = hashlib.sha256((SOUNDS_DIR / s["file"]).read_bytes()).hexdigest()
        b = hashlib.sha256((web / s["file"]).read_bytes()).hexdigest()
        assert a == b, s["file"]
