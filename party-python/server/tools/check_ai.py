"""AI 기능 점검 — 음성 인식(Whisper)과 Gemini 가 이 PC 에서 되는지 확인한다.

    python tools\\check_ai.py                 (server 폴더에서)
    python tools\\check_ai.py 녹음.wav        (WAV 파일을 직접 인식해 보기. 16비트 모노 권장)

Gemini 는 GEMINI_API_KEY 환경 변수가 있을 때만 확인한다.
"""

from __future__ import annotations

import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from party.games.quiz.questions import QuestionPool  # noqa: E402
from party.services import GeminiClient, create_stt  # noqa: E402


def check_stt(wav_path: str | None) -> None:
    print("== 음성 인식 ==")
    stt = create_stt()
    t0 = time.time()
    while stt.status == "loading":
        time.sleep(0.5)
        if time.time() - t0 > 600:
            break
    print(f"상태: {stt.status}  {stt.detail}  (준비 {time.time() - t0:.1f}초, 처음에는 모델을 내려받느라 오래 걸린다)")
    if stt.status != "ready":
        return
    if wav_path:
        with wave.open(wav_path, "rb") as w:
            if w.getsampwidth() != 2:
                print("16비트 WAV 만 읽을 수 있습니다.")
                return
            rate, ch = w.getframerate(), w.getnchannels()
            pcm = w.readframes(w.getnframes())
        if ch == 2:  # 스테레오면 왼쪽만
            pcm = b"".join(pcm[i:i + 2] for i in range(0, len(pcm), 4))
        t1 = time.time()
        text = stt.submit(pcm, rate).result(timeout=120)
        print(f"인식 결과: {text!r}  ({time.time() - t1:.2f}초)")
    else:
        t1 = time.time()
        stt.submit(b"\x00\x00" * 16000, 16000).result(timeout=120)
        print(f"1초짜리 소리 인식에 걸린 시간: {time.time() - t1:.2f}초")


def check_gemini() -> None:
    print("== Gemini ==")
    client = GeminiClient.from_env()
    if client is None:
        return
    pool = QuestionPool(client)
    pool._refill()
    if pool.last_error:
        print("실패:", pool.last_error)
        return
    print(f"쓴 모델: {client.last_model}")
    for q in pool.take(5):
        print(f"  [{q['category']}] {q['question']}  → {q['answer']} {q['aliases']}")


if __name__ == "__main__":
    check_stt(sys.argv[1] if len(sys.argv) > 1 else None)
    check_gemini()
