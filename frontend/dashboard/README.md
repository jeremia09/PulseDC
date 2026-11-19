# PulseDC dashboard — demo setup

This is the browser frontend for the PulseDC demo. It reads dashboard data from the Flask backend at `http://127.0.0.1:5001`.

## Run

1. Start the backend using `..\..\backend\start_backend.bat`.
2. In this folder, run:

   ```powershell
   npm start
   ```

3. Open either `http://127.0.0.1:3000` or `http://localhost:3000` and sign in with a demo account from the backend README. The dashboard matches the API hostname automatically so the session cookie is retained correctly.

The dashboard uses a session-based login. Administrator accounts see all demo sites; client accounts see only their own site data. Keep the backend local because the demo credentials are intentionally simple.

Alert acknowledgements and resolutions are saved by the backend and shared with other users who can access the same tenant's alerts.

## Quick smoke check

With both servers running, open a second terminal in this folder and run:

```powershell
npm run smoke
```

The check confirms that the dashboard page and its local JavaScript/CSS assets are served, and that the backend `/api/health` endpoint reports `ok`. It does not sign in or test authenticated API behavior. To use non-default local addresses, set `PULSE_DC_FRONTEND_URL` and/or `PULSE_DC_BACKEND_URL` before running the command.
