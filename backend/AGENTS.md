# PulseDC backend guidance

## Project shape

- This is a local-demo Flask API. Start it with `start_backend.bat`; it listens on `127.0.0.1:5001`.
- Main routes, authentication, tenant scoping, and SQLite access are in `app.py`.
- Alert evidence gathering and read-only investigation-agent behavior live in `alert_investigation.py`.
- The sibling frontend project is `../PulseDC-frontend`; read its `AGENTS.md` and `dashboard/js/core/utils.js` when changing API contracts.
- SQLite schema and demo data utilities live under `data/`; `data/monitoring.db` is live local state.

## API and safety contracts

- Preserve session authentication and tenant ownership checks for protected routes. Do not expose another client's data.
- `/api/health` is a public process-health check. Do not make the frontend smoke check depend on credentials or Groq availability.
- Alert investigation is read-only: it may inspect supplied history and model output and recommend human checks, but must not acknowledge/resolve alerts, change limits, or control equipment.
- Keep threshold rules distinct from model predictions. SHAP contributions describe model influence, not physical causation.
- Return JSON errors with useful status codes and avoid leaking secrets or internal exception details to API clients.

## Local data and configuration

- Treat `.env`, model artifacts, and `data/monitoring.db` as local configuration/state. Do not overwrite, regenerate, or delete them unless the user explicitly requests it.
- Demo data rebuild scripts reset the local database and alert action history; inspect their effects before recommending or running them.
- Keep secrets out of source files, logs, and generated reports.

## Local workflow

- Python requirements are in `requirements.txt`; no pytest suite is currently defined.
- To check that both local processes and frontend assets are reachable, start both servers and run `npm run smoke` from `../PulseDC-frontend/dashboard/`.
- That smoke command checks service reachability only; it does not validate authenticated API flows or business logic.
