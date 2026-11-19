# PulseDC — Data Center Operations & Intelligence Platform

PulseDC is an enterprise-grade IoT telemetry monitoring and facilities management platform for data centers. It features real-time sensor monitoring, predictive analytics, root-cause diagnostics, and an autonomous AI agent for operational tuning.

---

## Repository Structure

```
PulseDC/
├── backend/            # Flask REST API, SQLite database, ML forecasting, and dual-engine AI services
└── frontend/           # Static HTML/CSS/Vanilla JS dashboard served locally (or with npx serve)
```

---

## AI Architecture

PulseDC features a **dual-engine AI framework**:
1. **Groq Engine (`openai/gpt-oss-120b`)**: Ultra-low-latency streaming assistant for fleet telemetry exploration, diagnostic playbooks, and SHAP-based feature importance explainability.
2. **Google ADK & Gemini Engine (`google-adk` + `gemini-3.5-flash-lite`)**: Agentic Human-in-the-Loop (`require_confirmation=True`) framework allowing authorized administrators to calibrate and revert facility thresholds safely via natural language.

---

## Quick Start

### 1. Backend Setup
```powershell
cd backend
py -3.11 -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:
```env
FLASK_SECRET_KEY=your_secret_key
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
```

Run the backend:
```powershell
.\start_backend.bat
# Runs at http://127.0.0.1:5001
```

### 2. Frontend Setup
In a separate terminal:
```powershell
cd frontend/dashboard
npm install
npm start
# Runs at http://127.0.0.1:3000
```

---

## Demo Accounts & Permissions

| Role | Username | Password / Passcode | Scope |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `superadmin` | `super123` | Master control: fleet-wide and facility threshold modifications with passcode confirmation |
| **Admin** | `admin` | `admin123` | Facility control: individual facility threshold modifications with passcode confirmation |
| **Client** | `nimbus`, `vertex`, `orion` | `<name>123` | Read-only tenant telemetry monitoring |

