#!/bin/sh
# 책상 종(소리 판별) 모델을 models/ 에 받아 둠 (fp32, WebGPU 용 약 350MB)
# 실행: sh tools/download_model.sh  (hanomano 폴더에서, 로컬 서버로 열 때 사용)
# ※ AI 라이브러리는 아직 CDN 에서 받으므로 첫 실행엔 인터넷이 필요
set -e
REPO=Xenova/ast-finetuned-audioset-10-10-0.4593
DIR="$(dirname "$0")/../models/$REPO"
mkdir -p "$DIR/onnx"
for f in config.json preprocessor_config.json onnx/model.onnx; do
  echo "받는 중: $f"
  curl -fsSL --retry 3 -o "$DIR/$f" "https://huggingface.co/$REPO/resolve/main/$f"
done
echo "완료: $DIR"
