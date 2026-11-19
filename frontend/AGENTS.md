# PulseDC frontend guidance

## Project shape

- This is a static HTML, CSS, and vanilla JavaScript dashboard. There is no frontend build step or framework.
- `dashboard/index.html` owns page structure and script/style loading.
- Page behavior is split across `dashboard/js/` modules. Shared helpers and API configuration live in `dashboard/js/core/utils.js`.
- Main design tokens and shared components are in `dashboard/css/styles.css`; investigation-specific styles are in `dashboard/css/alerts/investigation.css`.
- The sibling backend project is `../PulseDC-backend`. Read its `AGENTS.md` and route code when changing API behavior or payload assumptions.

## Frontend/backend contract

- Resolve the API base URL through `window.PulseDC.API.getBaseUrl()` from `core/utils.js`; do not hardcode a host in a page module.
- Keep the frontend hostname aligned with the API hostname (`localhost` with `localhost`, or `127.0.0.1` with `127.0.0.1`) so session cookies work.
- Authenticated API calls use the session cookie and should include `credentials: 'include'`.
- The backend is Flask at `http://127.0.0.1:5001`; the static dashboard is served at `http://127.0.0.1:3000`.

## UI conventions

- Use the existing Flaticon Uicons regular-rounded (`fi-rr-*`) icon family. Avoid emoji icons in the interface.
- Reuse existing CSS variables, alert states, and shared styles before adding new colors or one-off styling.
- Keep user-facing explanations plain-language first; put model and telemetry detail in advanced sections.
- Escape backend-provided or user-controlled text before inserting it into HTML.

## Local workflow

- Start the backend from `../PulseDC-backend/start_backend.bat`, then run `npm start` from `dashboard/`.
- With both servers running, `npm run smoke` checks the frontend page and local assets plus the backend health endpoint. It does not test login-protected flows or full application behavior.
- Do not add frontend dependencies for simple checks that can use Node's built-in APIs.
