"""(선택) MediaPipe 손 인식 모델을 내려받아, 인터넷이 느리거나 막힌 곳에서도 손 인식이 되게 한다.

    python tools/download_hand_model.py        (server 폴더에서)

받은 파일은 web/public/models/ 와 (빌드돼 있으면) web/dist/models/ 에 저장된다.
이 파일이 없으면 각 참가자의 브라우저가 게임을 열 때 Google 저장소에서 모델(약 8MB)을 직접 받는다.
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
from pathlib import Path

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
WEB = Path(__file__).resolve().parents[2] / "web"
TARGETS = [WEB / "public" / "models", WEB / "dist" / "models"]


def main() -> None:
    primary = TARGETS[0] / "hand_landmarker.task"
    primary.parent.mkdir(parents=True, exist_ok=True)
    print(f"[*] 다운로드: {MODEL_URL}")
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as res, open(primary, "wb") as out:
            shutil.copyfileobj(res, out)
    except OSError as err:
        sys.exit(f"[!] 다운로드 실패: {err}")
    print(f"[*] 저장: {primary} ({primary.stat().st_size / 1e6:.1f} MB)")
    dist = TARGETS[1]
    if dist.parent.exists():
        dist.mkdir(exist_ok=True)
        shutil.copy2(primary, dist / primary.name)
        print(f"[*] 복사: {dist / primary.name}")


if __name__ == "__main__":
    main()
