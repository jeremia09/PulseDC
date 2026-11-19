@echo off
setlocal
set "APP_DIR=%~dp0"

if not exist "%APP_DIR%venv\Scripts\python.exe" (
  echo Python virtual environment not found at %APP_DIR%venv.
  echo Create it with: py -3.11 -m venv venv
  echo Then install dependencies with: venv\Scripts\pip install -r requirements.txt
  exit /b 1
)

echo Starting PulseDC backend at http://127.0.0.1:5001
"%APP_DIR%venv\Scripts\python.exe" "%APP_DIR%app.py"
