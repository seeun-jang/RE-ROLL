# ============================================================
# RE:ROLL 서버를 클라우드(Render 등)에 올리기 위한 설계도.
# 내 컴퓨터가 꺼져 있어도 인터넷 주소 하나로 게임이 열려 있게 한다.
#
#   1단계(web)  : Node 로 미니게임 화면을 빌드한다  → web/dist
#   2단계(실행) : Python 서버만 담은 가벼운 이미지에 화면 파일을 넣고 서버를 켠다
#
# 내 컴퓨터에서 시험:  docker build -t reroll . && docker run -p 8000:8000 reroll
# ============================================================

# ----- 1단계: 미니게임 화면 빌드 -----
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ----- 2단계: 서버 실행 -----
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ server/
COPY board/ board/
COPY --from=web /app/web/dist web/dist

# 음성 인식(Whisper)은 용량 · 메모리가 커서 클라우드 무료 서버에서는 끈다 → 음성 게임은 타자 입력 · 간단한 채점으로 진행
ENV PYTHONUTF8=1 PYTHONUNBUFFERED=1 PARTY_STT=off
WORKDIR /app/server
# 클라우드가 정해 주는 포트(PORT)로 켠다. 없으면 8000.
CMD ["sh", "-c", "uvicorn party.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
