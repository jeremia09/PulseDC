"""
Google ADK Agent Service for PulseDC.

Implements Human-in-the-Loop (HITL) tool calling for admin modifications:
1. Admin prompts a change via natural language.
2. ADK Agent triggers the tool with require_confirmation=True.
3. System pauses and requests admin confirmation + passcode verification.
4. Upon verification, the tool executes, audits the action, and outputs notification.
"""

import json
import math
import os
import sqlite3
import time
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.tools import FunctionTool
from google import genai
from werkzeug.security import check_password_hash

from threshold_service import (
    DEFAULT_THRESHOLDS,
    get_thresholds,
    validate_threshold_item,
)

load_dotenv(override=True)

# In-memory store for pending confirmations: action_id -> ActionState
PENDING_ACTIONS: Dict[str, Dict[str, Any]] = {}


def get_db_connection():
    db_path = os.path.join(os.path.dirname(__file__), "data", "monitoring.db")
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


def apply_fleet_or_facility_threshold_change(facility_name_or_id: Optional[str], metric_type: str, min_val: Optional[float] = None, max_val: Optional[float] = None, warning_margin: Optional[float] = None) -> Dict[str, Any]:
    """
    Modifies the threshold limits for a specific facility or fleet-wide (if facility is 'all' or None).
    """
    metric_type = metric_type.lower().strip()
    if metric_type not in DEFAULT_THRESHOLDS:
        return {"status": "error", "message": f"Invalid metric_type '{metric_type}'. Must be one of {list(DEFAULT_THRESHOLDS.keys())}"}

    defaults = DEFAULT_THRESHOLDS[metric_type]
    is_fleet = not facility_name_or_id or str(facility_name_or_id).lower().strip() in ('all', 'fleet', 'all facilities', 'global', 'none', '')

    con = get_db_connection()
    try:
        cur = con.cursor()
        if is_fleet:
            # Fleet-wide update in threshold_settings
            existing = cur.execute(
                "SELECT min_value, max_value, warning_margin, unit FROM threshold_settings WHERE metric_type = ?",
                (metric_type,)
            ).fetchone()

            cur_min = existing["min_value"] if existing else defaults["min"]
            cur_max = existing["max_value"] if existing else defaults["max"]
            cur_margin = existing["warning_margin"] if existing else defaults["warning_margin"]

            new_min = min_val if min_val is not None else cur_min
            new_max = max_val if max_val is not None else cur_max
            new_margin = warning_margin if warning_margin is not None else cur_margin

            validated = validate_threshold_item(metric_type, {"min": new_min, "max": new_max, "warning_margin": new_margin}, defaults)

            cur.execute("""
                INSERT INTO threshold_settings (metric_type, min_value, max_value, warning_margin, unit, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(metric_type) DO UPDATE SET
                    min_value = excluded.min_value,
                    max_value = excluded.max_value,
                    warning_margin = excluded.warning_margin,
                    unit = excluded.unit,
                    updated_at = CURRENT_TIMESTAMP
            """, (metric_type, validated["min"], validated["max"], validated["warning_margin"], validated["unit"]))

            cur.execute("""
                INSERT INTO threshold_audit (scope_type, metric_type, old_values, new_values, changed_at)
                VALUES ('global', ?, ?, ?, CURRENT_TIMESTAMP)
            """, (metric_type, json.dumps({"min": cur_min, "max": cur_max, "warning_margin": cur_margin}), json.dumps(validated)))

            con.commit()
            return {
                "status": "success",
                "facility": "All facilities (Fleet-wide)",
                "metric": metric_type,
                "updated_thresholds": validated,
                "message": f"Successfully updated fleet-wide {metric_type} threshold (min: {validated['min']}, max: {validated['max']}{validated['unit']})."
            }
        else:
            # Specific facility - flexible matching:
            # Matches 'DC-Delta', 'DC Delta', 'Delta', 'dc delta', etc.
            raw_input = str(facility_name_or_id).strip()
            norm_input = raw_input.lower().replace("-", " ").replace("_", " ").strip()
            
            all_dcs = cur.execute("SELECT id, name FROM data_centers").fetchall()
            dc = None
            for row in all_dcs:
                row_name = row["name"].lower().replace("-", " ").replace("_", " ").strip()
                # Direct match, ID match, or partial keyword match (e.g., 'delta' in 'dc delta')
                if (norm_input == row_name or 
                    str(row["id"]) == raw_input or 
                    norm_input in row_name or 
                    row_name in norm_input or
                    norm_input.replace("dc", "").strip() == row_name.replace("dc", "").strip()):
                    dc = row
                    break

            if not dc:
                return {"status": "error", "message": f"Data center facility '{facility_name_or_id}' was not found."}

            dc_id = dc["id"]
            dc_name = dc["name"]

            existing = cur.execute(
                "SELECT min_value, max_value, warning_margin, unit FROM facility_threshold_settings WHERE data_center_id = ? AND metric_type = ?",
                (dc_id, metric_type)
            ).fetchone()

            cur_min = existing["min_value"] if existing else defaults["min"]
            cur_max = existing["max_value"] if existing else defaults["max"]
            cur_margin = existing["warning_margin"] if existing else defaults["warning_margin"]

            new_min = min_val if min_val is not None else cur_min
            new_max = max_val if max_val is not None else cur_max
            new_margin = warning_margin if warning_margin is not None else cur_margin

            validated = validate_threshold_item(metric_type, {"min": new_min, "max": new_max, "warning_margin": new_margin}, defaults)

            cur.execute("""
                INSERT INTO facility_threshold_settings (data_center_id, metric_type, min_value, max_value, warning_margin, unit, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(data_center_id, metric_type) DO UPDATE SET
                    min_value = excluded.min_value,
                    max_value = excluded.max_value,
                    warning_margin = excluded.warning_margin,
                    unit = excluded.unit,
                    updated_at = CURRENT_TIMESTAMP
            """, (dc_id, metric_type, validated["min"], validated["max"], validated["warning_margin"], validated["unit"]))

            cur.execute("""
                INSERT INTO threshold_audit (scope_type, data_center_id, metric_type, old_values, new_values, changed_at)
                VALUES ('facility', ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (dc_id, metric_type, json.dumps({"min": cur_min, "max": cur_max, "warning_margin": cur_margin}), json.dumps(validated)))

            con.commit()
            return {
                "status": "success",
                "facility": dc_name,
                "metric": metric_type,
                "updated_thresholds": validated,
                "message": f"Successfully updated {metric_type} threshold on {dc_name} (min: {validated['min']}, max: {validated['max']}{validated['unit']})."
            }
    except Exception as e:
        con.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        con.close()


# Alias for backward compatibility
apply_facility_threshold_change = apply_fleet_or_facility_threshold_change


# Define Google ADK Tool with require_confirmation=True for safety
facility_threshold_tool = FunctionTool(
    apply_facility_threshold_change,
    require_confirmation=True  # Google ADK HITL feature
)


def create_pulsedc_adk_agent() -> Agent:
    """Creates the Google ADK Agent configured for PulseDC admin workflows."""
    return Agent(
        model="gemini-3.5-flash-lite",
        name="pulsedc_admin_assistant",
        instruction=(
            "You are the PulseDC Facility & Operations AI Agent. "
            "You assist administrators with data center operations, threshold calibrations, and facility monitoring. "
            "When an admin asks to change or update thresholds (such as temperature, humidity, flow rate, or pressure) "
            "for any data center facility (e.g. DC-Alpha, DC-Beta), call the apply_facility_threshold_change tool. "
            "Be precise, clear, and professional."
        ),
        tools=[facility_threshold_tool]
    )


def process_admin_intent(admin_prompt: str, user_id: int = 1, user_role: str = "super_admin") -> Dict[str, Any]:
    """
    Parses admin request using Gemini/ADK.
    If the agent determines a change is needed, it checks role permissions:
    - Super Admin: can change any facility or fleet-wide.
    - Admin: can change single facilities (e.g. DC-Alpha). Fleet-wide changes return permission error.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured in the backend environment.")

    client = genai.Client(api_key=api_key)

    # Fetch recent audit changes so the AI knows what was previously modified if the user asks to revert/undo
    con = get_db_connection()
    recent_changes = []
    try:
        cur = con.cursor()
        rows = cur.execute("""
            SELECT ta.metric_type, ta.old_values, ta.new_values, ta.scope_type, ta.data_center_id, dc.name as dc_name
            FROM threshold_audit ta
            LEFT JOIN data_centers dc ON dc.id = ta.data_center_id
            ORDER BY ta.id DESC LIMIT 5
        """).fetchall()
        for r in rows:
            recent_changes.append({
                "facility": r["dc_name"] or "all",
                "metric": r["metric_type"],
                "old_values": json.loads(r["old_values"] or "{}"),
                "new_values": json.loads(r["new_values"] or "{}")
            })
    except Exception as e:
        pass
    finally:
        con.close()

    # Use Gemini model with tool declaration to inspect intent
    # Gemini 3.5-flash-lite / 3.8-flash parses tool calls natively
    prompt = f"""
You are the PulseDC Assistant. An administrator sent the following request:
"{admin_prompt}"

Recent modification history in the system:
{json.dumps(recent_changes, indent=2)}

If the administrator is requesting to modify, change, update, revert, undo, or reset a threshold (such as temperature, humidity, flow_rate, or pressure) either fleet-wide / across all facilities, or for a specific facility:
(Note: If the user asks to 'revert', 'undo', or 'take back' changes, inspect the Recent modification history to determine the previous min/max values to restore).

You MUST return a JSON object with:
{{
    "action": "propose_change",
    "facility": "<e.g. 'all' or 'DC-Delta' or 'DC-Alpha'>",
    "metric": "<e.g. temperature, humidity, flow_rate, pressure>",
    "min_val": <float or null>,
    "max_val": <float or null>,
    "warning_margin": <float or null>,
    "confirmation_summary": "Are you sure you would like to <action description, e.g. revert/change> <metric> for <facility> to min: <min_val>, max: <max_val>?"
}}

If the administrator is merely asking a question or greeting, return:
{{
    "action": "reply",
    "message": "<your helpful answer>"
}}

Output ONLY the raw JSON object, without code blocks or markdown fences.
"""

    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=prompt
    )

    raw_text = response.text.strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.startswith("json"):
            raw_text = raw_text[4:].strip()

    try:
        parsed = json.loads(raw_text)
    except Exception:
        # Fallback to direct conversational response
        return {
            "status": "ready",
            "type": "message",
            "content": raw_text
        }

    if parsed.get("action") == "propose_change":
        target_facility = parsed.get("facility")
        is_fleet = not target_facility or str(target_facility).lower().strip() in ('all', 'fleet', 'all facilities', 'global', 'none', '')

        # Enforce scope separation:
        # Standard Admin is NOT permitted to make fleet-wide changes.
        if is_fleet and user_role != "super_admin":
            return {
                "status": "ready",
                "type": "message",
                "content": "🔒 **Permission Notice**: Only a **Super Admin** can change fleet-wide defaults across all data centers. As an Admin, you can calibrate individual facilities (e.g. *\"Change humidity for DC-Alpha to 30%\"*)."
            }

        action_id = f"act_{int(time.time() * 1000)}"
        PENDING_ACTIONS[action_id] = {
            "action_id": action_id,
            "created_at": time.time(),
            "user_id": user_id,
            "user_role": user_role,
            "facility": target_facility,
            "metric": parsed.get("metric"),
            "min_val": parsed.get("min_val"),
            "max_val": parsed.get("max_val"),
            "warning_margin": parsed.get("warning_margin"),
            "summary": parsed.get("confirmation_summary"),
        }

        facility_display = "All facilities (Fleet-wide)" if is_fleet else target_facility
        return {
            "status": "requires_confirmation",
            "action_id": action_id,
            "prompt_dialog": parsed.get("confirmation_summary"),
            "details": {
                "facility": facility_display,
                "metric": parsed.get("metric"),
                "min": parsed.get("min_val"),
                "max": parsed.get("max_val"),
                "warning_margin": parsed.get("warning_margin")
            },
            "message": f"I have prepared this change for {facility_display}. Please confirm and enter your passcode to authorize execution."
        }

    return {
        "status": "ready",
        "type": "message",
        "content": parsed.get("message", "How can I assist you with PulseDC facility operations?")
    }


def execute_confirmed_action(action_id: str, admin_username: str, passcode: str, user_role: str = "super_admin") -> Dict[str, Any]:
    """
    Verifies user passcode against users table, executes change, and generates audit notification.
    """
    action = PENDING_ACTIONS.get(action_id)
    if not action:
        return {"status": "error", "message": "Action not found or expired. Please submit the change again."}

    con = get_db_connection()
    try:
        cur = con.cursor()
        user = cur.execute(
            "SELECT id, username, password_hash, role, display_name FROM users WHERE username = ?",
            (admin_username,)
        ).fetchone()

        if not user or user["role"] not in ("super_admin", "admin"):
            return {"status": "error", "message": "Administrator privileges are required to confirm this action."}

        # Check password / passcode
        if not check_password_hash(user["password_hash"], passcode):
            return {"status": "error", "message": f"Invalid password or passcode for {admin_username}. Modification rejected."}

        # Validate fleet-wide permission again at execution time
        target_facility = action["facility"]
        is_fleet = not target_facility or str(target_facility).lower().strip() in ('all', 'fleet', 'all facilities', 'global', 'none', '')
        if is_fleet and user["role"] != "super_admin":
            return {"status": "error", "message": "Super Admin privileges required for fleet-wide updates."}

        # Password verified! Now execute the change tool
        result = apply_facility_threshold_change(
            facility_name_or_id=action["facility"],
            metric_type=action["metric"],
            min_val=action["min_val"],
            max_val=action["max_val"],
            warning_margin=action["warning_margin"]
        )

        if result.get("status") != "success":
            return result

        # Clear pending action
        del PENDING_ACTIONS[action_id]

        role_title = "Super Admin" if user["role"] == "super_admin" else "Admin"
        notification = {
            "title": "Facility Configuration Updated",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "operator": f"{admin_username} ({role_title})",
            "facility": result.get("facility", action["facility"]),
            "metric": action["metric"],
            "summary": result["message"]
        }

        return {
            "status": "success",
            "notification": notification,
            "ai_message": (
                f"✅ Change confirmed and applied by {role_title} ({user['display_name'] or admin_username}). "
                f"{result['message']} The monitoring engine and alert thresholds have been updated."
            )
        }
    finally:
        con.close()

