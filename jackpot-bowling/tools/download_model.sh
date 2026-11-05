#!/bin/sh
# 리액션 캠 모델을 models/ 에 받아 둠 (fp32, 약 600MB — 압축본은 판정이 엉망이라 사용 안 함)
# 실행: sh tools/download_model.sh  (jackpot-bowling 폴더에서, 로컬 서버로 열 때 사용)
# ※ AI 라이브러리는 아직 CDN 에서 받으므로 첫 실행엔 인터넷이 필요
set -e
REPO=Xenova/clip-vit-base-patch32
DIR="$(dirname "$0")/../models/$REPO"
mkdir -p "$DIR/onnx"
for f in config.json preprocessor_config.json tokenizer.json tokenizer_config.json special_tokens_map.json onnx/model.onnx; do
  echo "받는 중: $f"
  curl -fsSL --retry 3 -o "$DIR/$f" "https://huggingface.co/$REPO/resolve/main/$f"
done
echo "완료: $DIR"
