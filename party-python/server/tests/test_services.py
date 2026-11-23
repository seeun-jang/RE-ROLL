

# ---------------- Gemini 로 받아 적기 (클라우드용 음성 인식) ----------------
class _FakeGemini:
    def __init__(self, text="안녕하세요"):
        self.text, self.calls = text, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append({"schema": schema, "images": images, "system": system})
        return {"text": self.text}


def _wait_ready(stt, seconds=5.0):
    import time
    end = time.time() + seconds
    while stt.status == "loading" and time.time() < end:
        time.sleep(0.01)


def test_stt_gemini_sends_wav_and_returns_text(monkeypatch):
    import base64
    import math
    from array import array

    from party.services.stt import create_stt

    monkeypatch.setenv("PARTY_STT", "gemini")
    gemini = _FakeGemini("무궁화 꽃이 피었습니다")
    stt = create_stt(gemini)
    _wait_ready(stt)
    assert stt.status == "ready" and stt.name == "gemini" and stt.can_embed is False
    tone = array("h", [int(8000 * math.sin(i / 5)) for i in range(16000)]).tobytes()
    assert stt.submit(tone, 16000).result(timeout=5) == "무궁화 꽃이 피었습니다"
    sent = gemini.calls[0]["images"][0]
    wav = base64.b64decode(sent["data"])
    assert sent["mime_type"] == "audio/wav" and wav[:4] == b"RIFF" and wav[8:12] == b"WAVE" and len(wav) == 44 + len(tone)
    # 무음은 API 를 부르지 않고 빈 글자
    assert stt.submit(bytes(32000), 16000).result(timeout=5) == "" and len(gemini.calls) == 1


def test_stt_gemini_needs_key_and_whisper_falls_back(monkeypatch):
    import builtins

    from party.services.stt import create_stt

    monkeypatch.setenv("PARTY_STT", "gemini")
    assert create_stt(None).status == "off"          # 키가 없으면 꺼짐

    # Whisper 를 돌릴 패키지(torch)가 없는 서버: Gemini 가 있으면 자동으로 Gemini 방식
    real_import = builtins.__import__

    def no_torch(name, *args, **kw):
        if name == "torch" or name.startswith("transformers"):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *args, **kw)

    monkeypatch.setattr(builtins, "__import__", no_torch)
    monkeypatch.setenv("PARTY_STT", "whisper")
    stt = create_stt(_FakeGemini())
    _wait_ready(stt)
    assert stt.status == "ready" and stt.name == "gemini"
    off = create_stt(None)                           # Gemini 도 없으면 예전처럼 꺼짐
    _wait_ready(off)
    assert off.status == "off"
