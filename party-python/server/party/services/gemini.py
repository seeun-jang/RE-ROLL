"""Google Gemini API 호출(무료 등급) — 표준 라이브러리만 쓴다(추가 설치 없음).

    client = GeminiClient.from_env()       # GEMINI_API_KEY 가 없으면 None
    data = client.generate_json(prompt, schema)   # → 파싱된 JSON (list / dict)

환경 변수
    GEMINI_API_KEY   Google AI Studio 에서 받은 키(무료). 없으면 Gemini 를 쓰지 않는다.
    GEMINI_MODEL     쓸 모델 이름. 비워 두면 아래 후보를 차례로 시도한다.

네트워크를 쓰는 호출이므로 게임 진행 스레드에서 직접 부르지 말고 별도 스레드에서 부른다.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
#: 모델 이름은 자주 바뀌므로 여러 후보를 둔다(앞에서부터 되는 것을 쓴다)
DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.5-flash"]


class GeminiError(RuntimeError):
    pass


class GeminiClient:
    def __init__(self, api_key: str, models: list[str] | None = None, timeout: float = 30.0, opener=None):
        self.api_key = api_key
        self.models = list(models or DEFAULT_MODELS)
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen
        self.last_model: str | None = None

    @classmethod
    def from_env(cls) -> "GeminiClient | None":
        key = (os.environ.get("GEMINI_API_KEY") or "").strip()
        if not key:
            print("[Gemini] 꺼짐 — GEMINI_API_KEY 환경 변수가 없습니다(기본 문제 은행을 씁니다).", flush=True)
            return None
        model = (os.environ.get("GEMINI_MODEL") or "").strip()
        models = [model] + [m for m in DEFAULT_MODELS if m != model] if model else None
        print("[Gemini] 켜짐", flush=True)
        return cls(key, models)

    def generate_json(self, prompt: str, schema: dict | None = None, temperature: float = 1.0,
                      images: list[dict] | None = None, system: str | None = None):
        """프롬프트를 보내고 JSON 으로 답을 받는다. 모든 후보 모델이 실패하면 GeminiError.

        images: [{"mime_type": "image/png", "data": "<base64>"}] — 글과 함께 보낼 사진(멀티모달).
        system: 시스템 프롬프트(역할 · 규칙).
        """
        config: dict = {"responseMimeType": "application/json", "temperature": temperature}
        if schema is not None:
            config["responseSchema"] = schema
        parts: list[dict] = [{"text": prompt}]
        for image in images or []:
            parts.append({"inlineData": {"mimeType": image["mime_type"], "data": image["data"]}})
        request: dict = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
        if system:
            request["systemInstruction"] = {"parts": [{"text": system}]}
        body = json.dumps(request).encode("utf-8")
        errors = []
        # 지난번에 성공한 모델을 먼저 쓴다
        order = ([self.last_model] if self.last_model else []) + [m for m in self.models if m != self.last_model]
        for model in order:
            req = urllib.request.Request(
                f"{API_ROOT}/{model}:generateContent",
                data=body,
                headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
                method="POST",
            )
            try:
                with self._open(req, timeout=self.timeout) as res:
                    payload = json.loads(res.read().decode("utf-8"))
                text = "".join(
                    part.get("text", "") for part in payload["candidates"][0]["content"]["parts"]
                )
                data = json.loads(text)
                self.last_model = model
                return data
            except urllib.error.HTTPError as exc:
                errors.append(f"{model}: HTTP {exc.code}")
            except Exception as exc:  # 네트워크 오류, 형식이 다른 응답 등
                errors.append(f"{model}: {exc!r}")
        raise GeminiError("; ".join(errors))
