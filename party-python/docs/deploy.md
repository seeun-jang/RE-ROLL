# 클라우드에 올리기 (내 컴퓨터가 꺼져 있어도 열려 있게)

`share.bat`(Cloudflare 터널)은 **내 컴퓨터의 서버를 인터넷에 잠깐 연결**하는 방식이라, 컴퓨터를 끄면 주소도 죽는다.
컴퓨터와 상관없이 늘 열려 있게 하려면 서버 자체를 클라우드에 올려야 한다. 여기서는 무료로 쓸 수 있는 **Render** 를 쓴다.

## 준비된 파일

| 파일 | 하는 일 |
|---|---|
| `party-python/Dockerfile` | 서버를 담는 설계도. ① Node 로 미니게임 화면을 빌드하고 ② Python 서버 이미지에 넣어 켠다 |
| `party-python/.dockerignore` | 이미지에 넣지 않을 것(node_modules · .venv · .env 등) |
| 저장소 맨 위 `render.yaml` | Render 가 읽는 배포 설정: 위 Dockerfile 로 서버 하나를 만든다 |

## 올리는 순서 (처음 한 번, 5~10분)

1. <https://render.com> 에 가입한다 (GitHub 계정으로 로그인하면 편하다).
2. 대시보드에서 **New → Blueprint** 를 누르고, GitHub 저장소 `seeun-jang/RE-ROLL` 을 연결한다.
   - 저장소가 목록에 안 보이면: 저장소 주인이 Render 의 GitHub 앱에 이 저장소 접근을 허용해야 한다.
3. 브랜치를 `feature/KMJ-storyboard` 로 고른다 → `render.yaml` 을 읽어 `reroll-party` 서비스가 나타난다.
4. `GEMINI_API_KEY` 칸에 Gemini 키를 넣는다 (비워 두면 AI 해설 없이 기본 대사로 돌아간다).
5. **Apply** 를 누르면 빌드가 시작된다 (처음에는 5분쯤).
6. 끝나면 `https://reroll-party-xxxx.onrender.com` 같은 주소가 생긴다. 게임은 그 주소 뒤에 `/party/` 를 붙여 연다.

그 뒤로는 이 브랜치에 푸시할 때마다 Render 가 자동으로 다시 빌드해서 올린다.

## 알아둘 점 (무료 요금제)

- **15분 동안 아무도 안 쓰면 잠든다.** 다음 접속 때 깨어나는 데 1분쯤 걸린다 → 발표 5분 전에 미리 한 번 열어 둔다.
- **잠들면 방이 사라진다.** 방 · 점수는 서버 메모리에만 있어서, 잠들거나 다시 빌드되면 진행 중인 게임이 없어진다.
- **음성 인식은 Gemini 로 한다.** Whisper 모델은 1.6GB 라 무료 서버(메모리 512MB)에 못 올린다.
  그래서 클라우드에서는 녹음한 소리를 Gemini API 에 보내 받아 적게 한다(`PARTY_STT=gemini`).
  음성 퀴즈 · 주문 외치기 · 무궁화 꽃이 피었습니다 가 마이크로 된다. 한 번 인식에 2~6초쯤 걸린다.
  - `GEMINI_API_KEY` 를 꼭 넣어야 한다. 없으면 음성 인식이 꺼지고 타자 입력으로 진행된다.
  - 말할 때마다 Gemini 를 한 번씩 부르므로, 무료 한도(분당 요청 수)를 넘으면 그 순간은 인식이 실패할 수 있다.
  - 소리 따라하기의 채점은 Whisper 가 있을 때보다 단순한 방식(주파수 비교)으로 한다.
  - Whisper 로 보여 주려면 발표 때는 내 컴퓨터 서버 + `share.bat` 을 쓴다.
- **Gemini 키는 Render 의 환경 변수에만** 넣는다. 저장소에는 올리지 않는다.
- 주소가 `https` 라서 다른 컴퓨터에서도 마이크 · 카메라 게임(손 인식 등)이 된다.

## 내 컴퓨터에서 같은 이미지로 시험해 보기 (선택)

Docker Desktop 이 켜져 있을 때, `party-python` 폴더에서:

```
docker build -t reroll .
docker run -p 8000:8000 -e GEMINI_API_KEY=키 reroll
```

브라우저에서 `http://localhost:8000/party/` 를 연다.
