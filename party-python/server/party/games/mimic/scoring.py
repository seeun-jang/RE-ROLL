"""소리 따라하기 채점 — 소리를 "특징 벡터 열"로 바꿔 원본과 얼마나 비슷한지 잰다.

    특징 뽑기(embed)   소리 → [프레임 수, 차원] 배열 (초당 50프레임)
        whisper   Hugging Face 의 Whisper 인코더 출력 (서버의 음성 모델을 함께 쓴다). 기본.
        spectral  음성 모델이 없을 때 쓰는 대체 방법: 소리의 주파수 띠별 세기(로그)
    비교(similarity)   두 벡터 열을 시간 축으로 맞춰 가며(DTW) 프레임끼리 코사인 유사도를 평균한다 → 0~1
    점수(to_score)     유사도를 0~100점으로 바꾼다. 기준은 서버가 스스로 잰다:
                       "다른 제시 소리"와의 평균 유사도 = 0점, 원본과 같음(1)에 가까울수록 100점.

원본 게임의 librosa 채점(음높이·리듬·음량·음색)을 대신한다. numpy 만 있으면 돌아간다.
"""

from __future__ import annotations

import json
import math
import threading
import wave
from concurrent.futures import Future

import numpy as np

from . import config as C

FPS = 50                 # 특징 벡터의 초당 프레임 수
NOISE_ID = "__noise__"
RATE = 16000


# ----------------------------------------------------------------------
# 소리 다루기
# ----------------------------------------------------------------------
def pcm16_to_array(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0


def array_to_pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def resample(audio: np.ndarray, rate: int, to_rate: int = RATE) -> np.ndarray:
    if rate == to_rate or len(audio) < 2:
        return audio.astype(np.float32)
    n = max(1, int(round(len(audio) * to_rate / rate)))
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def read_wav(path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"16비트 WAV 만 읽을 수 있습니다: {path}")
    audio = pcm16_to_array(raw)
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    return audio, rate


def trim_active(audio: np.ndarray, rate: int, rules: dict | None = None) -> tuple[np.ndarray, float]:
    """앞뒤 무음을 잘라낸다. (자른 소리, 소리가 난 시간(초))"""
    V = rules or C.DEFAULT_CONFIG["VOICE"]
    hop = max(1, int(rate * 0.02))
    n = len(audio) // hop
    if n == 0:
        return audio[:0], 0.0
    frames = audio[: n * hop].reshape(n, hop)
    db = 20.0 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    threshold = max(float(db.max()) - V["ACTIVE_REL_DB"], V["ACTIVE_FLOOR_DB"])
    active = np.nonzero(db > threshold)[0]
    if len(active) == 0:
        return audio[:0], 0.0
    pad = 2   # 앞뒤로 40ms 여유
    lo = max(0, int(active[0]) - pad)
    hi = min(n, int(active[-1]) + 1 + pad)
    return audio[lo * hop: hi * hop], float(len(active) * hop / rate)


# ----------------------------------------------------------------------
# 특징 뽑기
# ----------------------------------------------------------------------
_BANDS = 40
_NFFT = 512


def _band_matrix() -> np.ndarray:
    """주파수 칸(0~8kHz)을 80Hz~7.6kHz 의 로그 간격 띠 40개로 묶는 삼각 창."""
    freqs = np.fft.rfftfreq(_NFFT, 1.0 / RATE)
    edges = np.geomspace(80.0, 7600.0, _BANDS + 2)
    m = np.zeros((_BANDS, len(freqs)), dtype=np.float32)
    for b in range(_BANDS):
        lo, mid, hi = edges[b], edges[b + 1], edges[b + 2]
        up = (freqs - lo) / (mid - lo)
        down = (hi - freqs) / (hi - mid)
        m[b] = np.clip(np.minimum(up, down), 0.0, None)
    return m


_BAND_M = _band_matrix()


def spectral_embed(audio: np.ndarray, rate: int) -> np.ndarray:
    """대체 특징: 20ms 마다 주파수 띠 40개의 세기(로그). [프레임 수, 40]"""
    a = resample(audio, rate)
    hop = RATE // FPS
    if len(a) < _NFFT:
        a = np.pad(a, (0, _NFFT - len(a)))
    n = 1 + (len(a) - _NFFT) // hop
    idx = np.arange(_NFFT)[None, :] + hop * np.arange(n)[:, None]
    spec = np.abs(np.fft.rfft(a[idx] * np.hanning(_NFFT)[None, :], axis=1)) ** 2
    logb = np.log(spec @ _BAND_M.T + 1e-8)
    # 프레임마다 평균을 빼서 소리 크기의 영향을 없애고(모양만 남김), 크기 변화는 따로 한 칸에 담는다
    level = logb.mean(axis=1, keepdims=True)
    shape = logb - level
    return np.concatenate([shape, (level - level.max()) * 0.5], axis=1).astype(np.float32)


class SpectralEmbedder:
    """음성 모델 없이 쓰는 대체 방법. 바로 계산해서 돌려준다."""

    name = "spectral"

    @property
    def ready(self) -> bool:
        return True

    def submit(self, pcm16: bytes, rate: int) -> Future:
        f: Future = Future()
        try:
            f.set_result(spectral_embed(pcm16_to_array(pcm16), rate))
        except Exception as exc:  # pragma: no cover - 방어용
            f.set_exception(exc)
        return f


class WhisperEmbedder:
    """Hugging Face Whisper 인코더(서버의 음성 인식 모델)를 쓴다."""

    name = "whisper"

    def __init__(self, stt):
        self.stt = stt

    @property
    def ready(self) -> bool:
        return bool(self.stt is not None and getattr(self.stt, "can_embed", False))

    def submit(self, pcm16: bytes, rate: int) -> Future:
        return self.stt.submit_embed(pcm16, rate)


# ----------------------------------------------------------------------
# 비교
# ----------------------------------------------------------------------
def _unit(x: np.ndarray, mean: np.ndarray | None) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    if mean is not None:
        x = x - mean[None, :]
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-8)


def similarity(ref: np.ndarray, rec: np.ndarray, mean: np.ndarray | None = None, band: float = 0.25) -> float:
    """두 특징 열의 유사도(0~1). 시간 축을 맞춰 가며(DTW) 프레임별 코사인 유사도를 평균한다."""
    a, b = _unit(ref, mean), _unit(rec, mean)
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return 0.0
    cost = (1.0 - a @ b.T) * 0.5                     # 0(같음) ~ 1(정반대)
    radius = max(2, int(band * max(n, m))) + abs(n - m)
    acc = np.full((n + 1, m + 1), np.inf, dtype=np.float64)
    steps = np.zeros((n + 1, m + 1), dtype=np.int32)
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        center = int(round(i * m / n))
        for j in range(max(1, center - radius), min(m, center + radius) + 1):
            k = min((acc[i - 1, j - 1], 0), (acc[i - 1, j], 1), (acc[i, j - 1], 2))
            if k[0] == np.inf:
                continue
            acc[i, j] = k[0] + cost[i - 1, j - 1]
            prev = (steps[i - 1, j - 1], steps[i - 1, j], steps[i, j - 1])[k[1]]
            steps[i, j] = prev + 1
    if not np.isfinite(acc[n, m]) or steps[n, m] == 0:
        return 0.0
    return float(max(0.0, min(1.0, 1.0 - acc[n, m] / steps[n, m])))


# ----------------------------------------------------------------------
# 제시 소리 + 점수 기준
# ----------------------------------------------------------------------
_sounds_cache: list[dict] | None = None


def load_sounds() -> list[dict]:
    """[{id, name, difficulty, icon, duration, audio(np), rate}]"""
    global _sounds_cache
    if _sounds_cache is None:
        manifest = json.loads((C.SOUNDS_DIR / "manifest.json").read_text(encoding="utf-8"))
        out = []
        for s in manifest["sounds"]:
            audio, rate = read_wav(C.SOUNDS_DIR / s["file"])
            out.append({
                "id": s["id"], "name": s["name"], "difficulty": s["difficulty"], "icon": s.get("icon", "note"),
                "duration": round(len(audio) / rate, 2), "file": s["file"], "audio": audio, "rate": rate,
            })
        _sounds_cache = out
    return _sounds_cache


class Scorer:
    """한 가지 특징 뽑기 방법(embedder)에 대한 채점기. 제시 소리의 특징과 점수 기준을 한 번 만들어 둔다."""

    def __init__(self, embedder, cfg: dict | None = None):
        self.embedder = embedder
        self.cfg = cfg or C.DEFAULT_CONFIG
        self.name = embedder.name
        self.refs: dict[str, np.ndarray] = {}
        self.mean: np.ndarray | None = None
        self.bad: dict[str, float] = {}
        self.error = ""
        self._futures: dict[str, Future] | None = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return bool(self.bad)

    def start(self) -> None:
        """제시 소리들의 특징을 뽑기 시작한다(아직 안 했으면)."""
        with self._lock:
            if self.ready or self._futures is not None or not self.embedder.ready:
                return
            self._futures = {}
            for s in load_sounds():
                trimmed, _ = trim_active(s["audio"], s["rate"], self.cfg["VOICE"])
                self._futures[s["id"]] = self.embedder.submit(array_to_pcm16(resample(trimmed, s["rate"])), RATE)
            # 잡음(쉬— 소리)도 0점 기준에 넣는다: 아무 소리나 낸다고 점수가 나오지 않게
            noise = np.random.default_rng(20261117).normal(0.0, 0.1, int(RATE * 1.5)).astype(np.float32)
            self._futures[NOISE_ID] = self.embedder.submit(array_to_pcm16(noise), RATE)

    def poll(self) -> bool:
        """특징이 다 뽑혔으면 점수 기준을 만든다. 준비됐으면 True."""
        if self.ready:
            return True
        self.start()
        with self._lock:
            futs = self._futures
            if futs is None or not all(f.done() for f in futs.values()):
                return False
            self._futures = None
            try:
                refs = {sid: np.asarray(f.result(), dtype=np.float32) for sid, f in futs.items()}
                noise = refs.pop(NOISE_ID)
            except Exception as exc:
                self.error = repr(exc)
                print(f"[소리 따라하기] 채점 준비 실패({self.name}): {exc!r}", flush=True)
                return False
            mean = np.concatenate(list(refs.values()), axis=0).mean(axis=0)
            band = self.cfg["SCORE"]["DTW_BAND"]
            bad = {}
            for sid, ref in refs.items():
                others = [similarity(ref, other, mean, band) for oid, other in refs.items() if oid != sid]
                # 다른 소리 대부분이 0점이 되도록 상위 25% 지점을 기준으로 삼는다
                bad[sid] = float(np.percentile(others, 75)) if others else 0.5
                bad[sid] = max(bad[sid], similarity(ref, noise, mean, band))
            self.refs, self.mean, self.bad = refs, mean, bad
            print(f"[소리 따라하기] 채점 준비 완료({self.name}) — 0점 기준(다른 소리와의 유사도): "
                  + ", ".join(f"{k} {v:.2f}" for k, v in bad.items()), flush=True)
            return True

    def to_score(self, sound_id: str, sim: float) -> int:
        bad = self.bad[sound_id]
        good = bad + self.cfg["SCORE"]["GOOD_FRACTION"] * (1.0 - bad)
        return int(round(100.0 * max(0.0, min(1.0, (sim - bad) / max(1e-6, good - bad)))))

    def score_embedding(self, sound_id: str, emb) -> dict:
        sim = similarity(self.refs[sound_id], np.asarray(emb, dtype=np.float32), self.mean, self.cfg["SCORE"]["DTW_BAND"])
        return {"score": self.to_score(sound_id, sim), "similarity": round(sim, 4), "scorer": self.name}


def grade_of(score: float, grades: list | None = None) -> str:
    for name, lo in grades or C.DEFAULT_CONFIG["SCORE"]["GRADES"]:
        if score >= lo:
            return name
    return "C"
