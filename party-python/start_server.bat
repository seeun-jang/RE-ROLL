@echo off
chcp 65001 >nul
rem ============================================================
rem  RE:ROLL 서버 켜기 (Windows). 이 파일을 더블클릭하면 된다.
rem  - 처음 한 번: 파이썬 가상환경을 만들고 필요한 패키지를 설치한다.
rem  - Gemini 해설을 쓰려면 이 창을 열기 전에 GEMINI_API_KEY 환경 변수를 넣는다.
rem    (없어도 기본 대사로 게임은 돌아간다)
rem  - 켜진 뒤 브라우저에서 http://localhost:8000/party/ 를 연다.
rem ============================================================
cd /d "%~dp0server"
if not exist ".venv\Scripts\python.exe" (
  echo [1/2] 가상환경을 만드는 중...
  python -m venv .venv || goto :error
  echo [2/2] 패키지를 설치하는 중...
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :error
)
if not exist "..\web\dist\index.html" (
  echo 미니게임 화면이 아직 빌드되지 않았습니다. web 폴더에서 "npm install" 후 "npm run build" 를 먼저 해 주세요.
  pause
  exit /b 1
)
set PYTHONUTF8=1
echo.
echo 브라우저에서 http://localhost:8000/party/ 를 여세요. (끄려면 이 창에서 Ctrl+C)
echo.
".venv\Scripts\python.exe" -m uvicorn party.main:app --host 0.0.0.0 --port 8000
goto :eof

:error
echo 설치에 실패했습니다. 파이썬(3.11 이상)이 설치돼 있는지 확인해 주세요.
pause
