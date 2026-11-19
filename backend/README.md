# PulseDC backend — demo setup

This Flask service supplies the dashboard data, simulated telemetry pipelines, Groq operations assistant, and the **Google ADK (Agent Development Kit)** human-in-the-loop agent. It is intended for local demonstration and development.

---

## Architecture Overview

PulseDC utilizes a **dual-engine AI architecture**:
1. **Groq Engine (`openai/gpt-oss-120b`)**: Provides high-speed streaming conversations, telemetry summaries, root-cause diagnostics, and explainable AI (XAI / SHAP) explanations for operators.
2. **Google ADK & Gemini Engine (`google-adk` + `gemini-3.5-flash-lite`)**: An agentic system capable of modifying facility and fleet configurations. Uses Google ADK's native **Human-in-the-Loop (`require_confirmation=True`)** security gate to pause before critical changes, demanding an admin passcode challenge before applying modifications to the database and audit trail.

---

## First-time setup

Install Python 3.11, then run these commands in this folder:

```powershell
py -3.11 -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder containing:

```env
FLASK_SECRET_KEY=any-long-random-local-demo-value
GROQ_API_KEY=your_groq_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

- `GROQ_API_KEY` powers the low-latency telemetry diagnostics assistant.
- `GEMINI_API_KEY` powers the Google ADK Human-in-the-Loop agent for system modifications.

---

## Run the demo

Double-click `start_backend.bat`, or run:

```powershell
.\start_backend.bat
```

The API runs at `http://127.0.0.1:5001`.

In a second terminal, open the `../frontend/dashboard` folder and run `npm start`. Then open `http://127.0.0.1:3000`.

---

## Demo Accounts & Tiered Role Permissions

The system implements strict **Tiered Governance (Least Privilege)** for both manual and AI-driven actions:

| Role | Username | Password / Passcode | Capabilities |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `superadmin` | `super123` | **Full Master Access**: Everything standard Admin has + exclusive authority to change **Fleet-Wide (Global)** thresholds via AI + single facility overrides with passcode confirmation. |
| **Admin** | `admin` | `admin123` | **Facility-Level Operations**: Full dashboard controls, manual threshold edits, and can modify **individual facility limits** via AI with passcode confirmation (e.g. *"Change humidity for DC-Alpha to 30"*). Blocked from changing fleet-wide limits. |
| **Client** | `nimbus`, `vertex`, `orion` | `<username>123` | **Tenant-Scoped Read-Only**: Can only explore live telemetry, sensors, and alerts for their own leased data center racks. Blocked from system modifications. |

*These are demo-only credentials. Change or remove them before any production deployment.*

---

## Google ADK Human-in-the-Loop (HITL) Workflow

When an administrator prompts the AI to modify or revert operating ranges (e.g. *"Change temperature on DC-Alpha to 28"* or *"help me revert back the changes I made"*):

1. **Dynamic Intent Analysis**: The Google ADK Agent dynamically determines whether the request is a general question or a desired system modification.
2. **ADK Confirmation Gate**: The function tool (`apply_fleet_or_facility_threshold_change`) is registered with `require_confirmation=True`. Execution halts automatically.
3. **Passcode Challenge**: The frontend displays an authorization modal showing the proposed values and requests the admin's password/passcode.
4. **Cryptographic Validation**: The backend validates the password hash against SQLite (`users` table) and checks the user's role scope (e.g., standard admins are prevented from altering fleet-wide limits).
5. **Audit Logging & Live Sync**: Once confirmed, changes are committed to `facility_threshold_settings` or `threshold_settings`, logged to `threshold_audit`, and the dashboard updates live in real-time.
6. **One-Click Revert**: The **Operating Limits** page features a **Revert** button next to each audit history entry, allowing authorized admins to roll back previous calibrations with one click.

---

## Refresh simulated data

To reset telemetry, anomalies, forecasts, and demo database state back to initial values:

```cmd
data\refresh_demo_data.bat
```

*Note: Running the refresh script drops and recreates tables in `data/monitoring.db`.*
