@echo off
chcp 65001 >nul
rem ============================================================
rem  다른 컴퓨터(다른 네트워크 포함)에서 접속할 주소 만들기 — Cloudflare 무료 터널
rem
rem  1) 먼저 start_server.bat 으로 서버를 켠다.
rem  2) 이 파일을 더블클릭한다.
rem  3) 창에 나오는 https://....trycloudflare.com 주소 뒤에 /party/ 를 붙여 친구에게 알려 준다.
rem       예) https://abcd-efgh.trycloudflare.com/party/
rem
rem  - 주소는 켤 때마다 바뀐다. 서버 창과 이 창을 둘 다 켜 둬야 한다.
rem  - https 주소라서 다른 컴퓨터에서도 마이크 · 카메라 게임이 된다.
rem  - 주소를 아는 사람은 누구나 들어올 수 있으니, 끝나면 이 창을 닫는다(Ctrl+C).
rem ============================================================
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared 가 설치돼 있지 않습니다. 아래 명령을 한 번 실행한 뒤 새 창에서 다시 해 주세요.
  echo.
  echo     winget install Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)
echo 잠시 뒤 아래에 https://....trycloudflare.com 주소가 나옵니다. 그 주소 뒤에 /party/ 를 붙여 여세요.
echo.
cloudflared tunnel --url http://localhost:8000
