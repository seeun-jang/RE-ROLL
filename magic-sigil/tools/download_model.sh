#!/bin/sh
# AI 감정 모델을 models/ 에 받아 둠 → 인터넷 없이 시연 가능 (로컬 서버로 열 때)
# 실행: sh tools/download_model.sh  (magic-sigil 폴더에서)
set -e
REPO=Xenova/quickdraw-mobilevit-small
DIR="$(dirname "$0")/../models/$REPO"
mkdir -p "$DIR/onnx"
for f in config.json preprocessor_config.json onnx/model_fp16.onnx; do
  echo "받는 중: $f"
  curl -fsSL --retry 3 -o "$DIR/$f" "https://huggingface.co/$REPO/resolve/main/$f"
done
echo "완료: $DIR"
