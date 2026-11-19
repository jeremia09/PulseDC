@echo off
setlocal
set "DATA_DIR=%~dp0"
set "PYTHON=%DATA_DIR%..\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Python virtual environment not found. Run the setup steps in ..\README.md first.
  exit /b 1
)

pushd "%DATA_DIR%"
echo Generating simulated telemetry, anomalies, and forecasts...
"%PYTHON%" simulate_sensor_data.py
if errorlevel 1 goto :error

echo Rebuilding monitoring.db...
"%PYTHON%" build_database.py
if errorlevel 1 goto :error

echo Demo data refreshed successfully.
popd
exit /b 0

:error
echo Demo data refresh failed.
popd
exit /b 1
