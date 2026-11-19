"""음성 인식(STT) 서비스 — Hugging Face 의 Whisper 모델을 서버 PC 에서 직접 돌린다.

    stt = create_stt()                     # 서버 시작 때 한 번. 모델은 뒤에서(스레드) 불러온다.
    stt.status                             # 'loading' | 'ready' | 'off' | 'error'
    future = stt.submit(pcm16_bytes, 16000)  # 인식은 별도 스레드에서. 게임 진행을 막지 않는다.
    future.done(), future.result()         # → 인식된 문장(str)

    stt.can_embed                          # 모델이 소리의 특징 벡터도 뽑아 줄 수 있는지
    stt.submit_embed(pcm16_bytes, 16000)   # → Future(numpy 배열 [프레임 수, 차원]). 초당 50프레임.
                                           #   Whisper 인코더가 소리를 요약한 값이다(소리 따라하기 채점에 쓴다).

환경 변수
    PARTY_STT        whisper(기본) | off | fake
    PARTY_STT_MODEL  Hugging Face 모델 이름. 기본: GPU 가 있으면 openai/whisper-large-v3-turbo, 없으면 openai/whisper-small
    PARTY_STT_FAKE_TEXT  fake 일 때 돌려줄 문장(검증용)

필요한 패키지(torch, transformers, numpy)가 없으면 status 가 'off' 가 되고,
게임은 음성 없이(타자 입력만) 진행된다. 설치 방법은 server/requirements-ai.txt 참고.
"""

from __future__ import annotations

import os
import threading
from array import array
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

SAMPLE_RATE = 16000


def pcm16_to_floats(pcm: bytes) -> list[float]:
    """16비트 리틀엔디언 PCM → -1~1 실수 목록."""
    a = array("h")
    a.frombytes(pcm[: len(pcm) // 2 * 2])
    if a.itemsize != 2:  # pragma: no cover - 일반 PC 에서는 항상 2
        raise RuntimeError("16비트 정수 배열을 만들 수 없습니다")
    import sys

    if sys.byteorder == "big":  # pragma: no cover
        a.byteswap()
    return [x / 32768.0 for x in a]


def rms_of(pcm: bytes) -> float:
    """소리 크기(RMS, 0~1). 무음인지 가릴 때 쓴다."""
    a = array("h")
    a.frombytes(pcm[: len(pcm) // 2 * 2])
    if not a:
        return 0.0
    return (sum(x * x for x in a) / len(a)) ** 0.5 / 32768.0


class SttService:
    """인식기(backend)를 감싸 스레드에서 돌리는 공통 틀."""

    def __init__(self, loader: Callable[[], object] | None, name: str = "off"):
        """loader: 호출하면 모델을 불러와 `transcribe(pcm16, rate) -> str` 함수를 돌려준다.
        `(transcribe, encode)` 쌍을 돌려주면 특징 벡터 뽑기(encode(pcm16, rate) -> 배열)도 쓸 수 있다."""
        self.name = name
        self.status = "off" if loader is None else "loading"
        self.detail = ""
        self._transcribe: Callable[[bytes, int], str] | None = None
        self._encode: Callable[[bytes, int], object] | None = None
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt")
        if loader is not None:
            threading.Thread(target=self._load, args=(loader,), name="stt-load", daemon=True).start()

    def _load(self, loader) -> None:
        try:
            loaded = loader()
            if isinstance(loaded, tuple):
                self._transcribe, self._encode = loaded
            else:
                self._transcribe = loaded
            self.status = "ready"
            print(f"[음성 인식] 준비 완료 ({self.name}) {self.detail}", flush=True)
        except ImportError as exc:
            self.status = "off"
            self.detail = f"패키지 없음: {exc}"
            print(f"[음성 인식] 꺼짐 — 필요한 패키지가 없습니다({exc}). server/requirements-ai.txt 를 참고하세요.", flush=True)
        except Exception as exc:  # 모델 다운로드 실패 등
            self.status = "error"
            self.detail = repr(exc)
            print(f"[음성 인식] 오류로 꺼짐: {exc!r}", flush=True)

    @property
    def available(self) -> bool:
        """지금 쓸 수 있거나 곧 쓸 수 있는지(불러오는 중 포함)."""
        return self.status in ("ready", "loading")

    def submit(self, pcm16: bytes, rate: int = SAMPLE_RATE) -> Future:
        """인식을 맡긴다. 결과는 Future 로 받는다(문장). 꺼져 있으면 예외가 담긴 Future."""
        if self.status not in ("ready", "loading"):
            f: Future = Future()
            f.set_exception(RuntimeError("음성 인식이 꺼져 있습니다"))
            return f
        return self._pool.submit(self._run, pcm16, rate)

    def _wait_loaded(self) -> None:
        # 모델을 아직 불러오는 중이면 조금 기다린다(게임 쪽에 제한 시간이 따로 있다)
        import time

        waited = 0.0
        while self.status == "loading" and waited < 30.0:
            time.sleep(0.1)
            waited += 0.1

    def _run(self, pcm16: bytes, rate: int) -> str:
        self._wait_loaded()
        if self._transcribe is None:
            raise RuntimeError("음성 인식을 쓸 수 없습니다")
        return (self._transcribe(pcm16, rate) or "").strip()

    @property
    def can_embed(self) -> bool:
        """특징 벡터를 뽑을 수 있는지(준비가 끝난 뒤에만 True)."""
        return self.status == "ready" and self._encode is not None

    def submit_embed(self, pcm16: bytes, rate: int = SAMPLE_RATE) -> Future:
        """소리를 특징 벡터 열로 바꾼다. 결과는 Future([프레임 수, 차원] 배열)."""
        if self.status not in ("ready", "loading"):
            f: Future = Future()
            f.set_exception(RuntimeError("음성 모델이 꺼져 있습니다"))
            return f
        return self._pool.submit(self._run_embed, pcm16, rate)

    def _run_embed(self, pcm16: bytes, rate: int):
        self._wait_loaded()
        if self._encode is None:
            raise RuntimeError("이 음성 모델은 특징 벡터를 뽑을 수 없습니다")
        return self._encode(pcm16, rate)


# ----------------------------------------------------------------------
# Whisper (Hugging Face transformers)
# ----------------------------------------------------------------------
def _whisper_loader(service_ref: list):
    import math

    import numpy as np
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    cuda = torch.cuda.is_available()
    model_name = os.environ.get("PARTY_STT_MODEL") or (
        "openai/whisper-large-v3-turbo" if cuda else "openai/whisper-small"
    )
    device = "cuda" if cuda else "cpu"
    processor = AutoProcessor.from_pretrained(model_name)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(model_name)
    model = model.to(device)
    if cuda:
        model = model.half()
    model.eval()
    dtype = next(model.parameters()).dtype
    if service_ref:
        service_ref[0].detail = f"모델 {model_name}, 장치 {device}"

    def to_audio(pcm16: bytes, rate: int):
        audio = np.frombuffer(pcm16[: len(pcm16) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
        if rate != SAMPLE_RATE and len(audio) > 1:  # 브라우저가 16kHz 로 보내므로 보통은 거치지 않는다
            n = max(1, int(len(audio) * SAMPLE_RATE / rate))
            audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
        return audio

    def features(audio):
        feats = processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
        return feats.to(device=device, dtype=dtype)

    def transcribe(pcm16: bytes, rate: int) -> str:
        with torch.no_grad():
            ids = model.generate(features(to_audio(pcm16, rate)), language="ko", task="transcribe", max_new_tokens=48)
        return processor.batch_decode(ids, skip_special_tokens=True)[0]

    def encode(pcm16: bytes, rate: int):
        """Whisper 인코더의 출력(초당 50프레임)에서 실제 소리 길이만큼만 잘라 돌려준다."""
        audio = to_audio(pcm16, rate)
        with torch.no_grad():
            hidden = model.get_encoder()(features(audio)).last_hidden_state[0]
        frames = max(1, min(int(hidden.shape[0]), int(math.ceil(len(audio) / SAMPLE_RATE * 50))))
        return hidden[:frames].float().cpu().numpy()

    # 첫 인식이 느리지 않도록 한 번 돌려 둔다
    transcribe(b"\x00\x00" * SAMPLE_RATE, SAMPLE_RATE)
    return transcribe, encode


def create_stt() -> SttService:
    kind = (os.environ.get("PARTY_STT") or "whisper").strip().lower()
    if kind in ("off", "0", "none", "no"):
        print("[음성 인식] 꺼짐 (PARTY_STT=off)", flush=True)
        return SttService(None, "off")
    if kind == "fake":
        text = os.environ.get("PARTY_STT_FAKE_TEXT", "")
        return SttService(lambda: (lambda _pcm, _rate: text), "fake")
    ref: list = []
    service = SttService(lambda: _whisper_loader(ref), "whisper")
    ref.append(service)
    return service
