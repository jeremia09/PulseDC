"""
Dynamic operational playbooks and alert policy services for PulseDC.
Allows dynamic root-cause troubleshooting guides and debounce alert policies
persisted in SQLite rather than hardcoded in Python strings.
"""

import sqlite3
import json

DEFAULT_PLAYBOOKS = [
    {
        "condition_key": "TEMP_HIGH_FLOW_LOW",
        "title": "High Temperature with Low Coolant Flow",
        "metric_type": "temperature",
        "condition_description": "Elevated server hall/rack temperature coupled with reduced or restricted coolant loop flow rate.",
        "likely_causes": "Coolant loop pump cavitation or failure, clogged inline strainer, closed secondary solenoid valve, or thermal loop vapor lock.",
        "recommended_actions": "Verify secondary loop pump differential pressure, inspect fluid strainer mesh for particulates, check motorized valve status, and inspect redundant CRAC pump failover.",
    },
    {
        "condition_key": "TEMP_HIGH_HUM_LOW",
        "title": "High Temperature with Low Relative Humidity",
        "metric_type": "temperature",
        "condition_description": "Server aisle temperature exceeds safe threshold while humidity drops below nominal minimum.",
        "likely_causes": "Aisle containment seal leakage, hot-air recirculation over rack tops, CRAC humidifier cylinder scale buildup, or excessive dry air supply bypass.",
        "recommended_actions": "Inspect containment brush strips and blanking panels, check ultrasonic/electrode humidifier supply water, and audit airflow floor tile placement.",
    },
    {
        "condition_key": "PRESSURE_ABNORMAL",
        "title": "Abnormal Differential Air Pressure",
        "metric_type": "pressure",
        "condition_description": "Sub-floor or containment differential air pressure deviating outside safe design margins.",
        "likely_causes": "Supply fan VFD speed hunting, clogged intake/exhaust louver dampers, room perimeter weather seal breach, or perforated tile displacement.",
        "recommended_actions": "Verify plenum VFD drive output signals, inspect air intake filter pressure drops, verify perimeter access door latches, and verify airflow damper actuators.",
    },
    {
        "condition_key": "HUMIDITY_HIGH",
        "title": "Excessive Relative Humidity",
        "metric_type": "humidity",
        "condition_description": "Relative humidity elevated above safe condensation risk limits.",
        "likely_causes": "Outside makeup air economizer damper failure, CRAC cooling coil dehumidification malfunction, or steam line pinhole leak.",
        "recommended_actions": "Check makeup air dampers, verify CRAC reheat and dehumidification modes, and inspect ceiling plenum for steam/condensation leaks.",
    },
    {
        "condition_key": "FLOW_LOW_CRITICAL",
        "title": "Critical Low Coolant Flow",
        "metric_type": "flow_rate",
        "condition_description": "Coolant flow dropping dangerously close to zero flow minimum cutoff.",
        "likely_causes": "Primary circulation pump trip, airlock in main riser, sudden isolation valve closure, or catastrophic piping loss of pressure.",
        "recommended_actions": "Immediately verify primary pump run contactors, trigger backup pump if not auto-started, check expansion tank static pressure, and inspect main header flow sensors.",
    },
]

DEFAULT_ALERT_POLICIES = {
    "debounce_readings": 2,
    "auto_investigate_critical": True,
    "warning_grace_seconds": 120,
    "cooldown_minutes": 15,
}


def initialize_playbook_and_policy_tables(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS operational_playbooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            condition_key TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            metric_type TEXT,
            condition_description TEXT NOT NULL,
            likely_causes TEXT NOT NULL,
            recommended_actions TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS alert_policies (
            policy_key TEXT PRIMARY KEY,
            policy_value TEXT NOT NULL,
            description TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    for pb in DEFAULT_PLAYBOOKS:
        con.execute(
            """INSERT OR IGNORE INTO operational_playbooks
               (condition_key, title, metric_type, condition_description, likely_causes, recommended_actions, is_active)
               VALUES (?, ?, ?, ?, ?, ?, 1)""",
            (pb["condition_key"], pb["title"], pb["metric_type"], pb["condition_description"], pb["likely_causes"], pb["recommended_actions"]),
        )

    for key, val in DEFAULT_ALERT_POLICIES.items():
        con.execute(
            """INSERT OR IGNORE INTO alert_policies (policy_key, policy_value, description)
               VALUES (?, ?, ?)""",
            (key, json.dumps(val), f"Policy setting for {key}"),
        )


def get_active_playbooks(con, metric_type=None):
    cursor = con.cursor()
    if metric_type:
        cursor.execute(
            """SELECT id, condition_key, title, metric_type, condition_description,
                      likely_causes, recommended_actions
               FROM operational_playbooks
               WHERE is_active = 1 AND (metric_type = ? OR metric_type IS NULL)
               ORDER BY id ASC""",
            (metric_type,),
        )
    else:
        cursor.execute(
            """SELECT id, condition_key, title, metric_type, condition_description,
                      likely_causes, recommended_actions
               FROM operational_playbooks
               WHERE is_active = 1
               ORDER BY id ASC"""
        )
    cols = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    return [dict(zip(cols, r)) if not isinstance(r, sqlite3.Row) else dict(r) for r in rows]


def get_playbook_prompt_section(con, metric_type=None):
    playbooks = get_active_playbooks(con, metric_type)
    if not playbooks:
        return "### DATA CENTER ROOT CAUSE PLAYBOOKS:\nNo dynamic playbooks configured.\n"

    lines = ["### DATA CENTER ROOT CAUSE PLAYBOOKS (Dynamic SOPs):"]
    for pb in playbooks:
        lines.append(f"- **{pb['title']}**: {pb['likely_causes']}")
        lines.append(f"  *Suggested Checks*: {pb['recommended_actions']}")
    return "\n".join(lines)


def get_alert_policies(con):
    cursor = con.cursor()
    cursor.execute("SELECT policy_key, policy_value FROM alert_policies")
    cols = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    policies = dict(DEFAULT_ALERT_POLICIES)
    for r in rows:
        row_dict = dict(zip(cols, r)) if not isinstance(r, sqlite3.Row) else dict(r)
        key = row_dict["policy_key"]
        val_str = row_dict["policy_value"]
        try:
            policies[key] = json.loads(val_str)
        except (TypeError, ValueError, json.JSONDecodeError):
            policies[key] = val_str
    return policies
