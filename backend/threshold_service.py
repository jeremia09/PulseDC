"""Persistent, validated sensor threshold configuration for PulseDC."""

import math
import sqlite3


DEFAULT_THRESHOLDS = {
    "flow_rate": {"min": 30.0, "max": None, "warning_margin": 5.0, "unit": "L/min"},
    "temperature": {"min": 18.0, "max": 27.0, "warning_margin": 2.0, "unit": "°C"},
    "humidity": {"min": 35.0, "max": 55.0, "warning_margin": 3.0, "unit": "%"},
    "pressure": {"min": 90.0, "max": 110.0, "warning_margin": 5.0, "unit": "kPa"},
}


def initialize_threshold_tables(con):
    """Create threshold storage and seed the existing operating ranges once."""
    con.execute("""
        CREATE TABLE IF NOT EXISTS threshold_settings (
            metric_type TEXT PRIMARY KEY,
            min_value REAL,
            max_value REAL,
            warning_margin REAL NOT NULL,
            unit TEXT NOT NULL,
            updated_by INTEGER,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (updated_by) REFERENCES users(id)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS facility_threshold_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_center_id INTEGER NOT NULL,
            metric_type TEXT NOT NULL,
            min_value REAL,
            max_value REAL,
            warning_margin REAL NOT NULL,
            unit TEXT NOT NULL,
            updated_by INTEGER,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (data_center_id) REFERENCES data_centers(id),
            FOREIGN KEY (updated_by) REFERENCES users(id),
            UNIQUE(data_center_id, metric_type)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS threshold_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_type TEXT NOT NULL DEFAULT 'global',
            data_center_id INTEGER,
            metric_type TEXT NOT NULL,
            old_values TEXT NOT NULL,
            new_values TEXT NOT NULL,
            changed_by INTEGER,
            changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (data_center_id) REFERENCES data_centers(id),
            FOREIGN KEY (changed_by) REFERENCES users(id)
        )
    """)
    # Check if threshold_audit needs migration for scope_type and data_center_id columns
    audit_cols = {row[1] for row in con.execute("PRAGMA table_info(threshold_audit)").fetchall()}
    if "scope_type" not in audit_cols:
        con.execute("ALTER TABLE threshold_audit ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'global'")
    if "data_center_id" not in audit_cols:
        con.execute("ALTER TABLE threshold_audit ADD COLUMN data_center_id INTEGER")

    for metric_type, rule in DEFAULT_THRESHOLDS.items():
        con.execute(
            """INSERT OR IGNORE INTO threshold_settings
               (metric_type, min_value, max_value, warning_margin, unit)
               VALUES (?, ?, ?, ?, ?)""",
            (metric_type, rule["min"], rule["max"], rule["warning_margin"], rule["unit"]),
        )


def get_thresholds(con):
    cursor = con.cursor()
    cursor.execute(
        """SELECT metric_type, min_value, max_value, warning_margin, unit, updated_at
           FROM threshold_settings"""
    )
    cols = [col[0] for col in cursor.description]
    rows = cursor.fetchall()
    result = {}
    for row in rows:
        r = dict(zip(cols, row)) if not isinstance(row, sqlite3.Row) else row
        result[r["metric_type"]] = {
            "min": r["min_value"],
            "max": r["max_value"],
            "warning_margin": r["warning_margin"],
            "unit": r["unit"],
            "updated_at": r["updated_at"],
        }
    # Keep API responses complete if an older or manually edited database is missing a row.
    for metric_type, rule in DEFAULT_THRESHOLDS.items():
        result.setdefault(metric_type, {**rule, "updated_at": None})
    return result


def get_all_facility_thresholds(con):
    """Return all facility threshold overrides keyed by data_center_id -> metric_type."""
    cursor = con.cursor()
    cursor.execute(
        """SELECT fts.data_center_id, dc.name AS data_center_name, fts.metric_type,
                  fts.min_value, fts.max_value, fts.warning_margin, fts.unit, fts.updated_at
           FROM facility_threshold_settings fts
           JOIN data_centers dc ON dc.id = fts.data_center_id
           ORDER BY fts.data_center_id, fts.metric_type"""
    )
    cols = [col[0] for col in cursor.description]
    rows = cursor.fetchall()
    overrides = {}
    for row in rows:
        r = dict(zip(cols, row)) if not isinstance(row, sqlite3.Row) else row
        dc_id = r["data_center_id"]
        if dc_id not in overrides:
            overrides[dc_id] = {
                "data_center_id": dc_id,
                "data_center_name": r["data_center_name"],
                "thresholds": {},
            }
        overrides[dc_id]["thresholds"][r["metric_type"]] = {
            "min": r["min_value"],
            "max": r["max_value"],
            "warning_margin": r["warning_margin"],
            "unit": r["unit"],
            "updated_at": r["updated_at"],
        }
    return overrides


def get_effective_thresholds(con, data_center_id=None):
    """
    Return effective thresholds for a specific facility, overlaying facility overrides
    on top of the fleet-wide global defaults.
    """
    global_rules = get_thresholds(con)
    if not data_center_id:
        return global_rules

    cursor = con.cursor()
    cursor.execute(
        """SELECT metric_type, min_value, max_value, warning_margin, unit, updated_at
           FROM facility_threshold_settings
           WHERE data_center_id = ?""",
        (data_center_id,),
    )
    cols = [col[0] for col in cursor.description]
    overrides = cursor.fetchall()

    effective = {m: dict(vals) for m, vals in global_rules.items()}
    for row in overrides:
        r = dict(zip(cols, row)) if not isinstance(row, sqlite3.Row) else row
        effective[r["metric_type"]] = {
            "min": r["min_value"],
            "max": r["max_value"],
            "warning_margin": r["warning_margin"],
            "unit": r["unit"],
            "updated_at": r["updated_at"],
            "is_override": True,
            "data_center_id": data_center_id,
        }
    return effective


def validate_threshold_item(metric_type, rule, defaults):
    """Validate a single metric threshold configuration dictionary."""
    if not isinstance(rule, dict):
        raise ValueError(f"Settings for {metric_type} must be an object.")

    values = {}
    for key in ("min", "max"):
        raw_value = rule.get(key)
        if raw_value in (None, ""):
            values[key] = None
            continue
        if isinstance(raw_value, bool):
            raise ValueError(f"{metric_type} {key} must be a number or blank.")
        try:
            number = float(raw_value)
        except (TypeError, ValueError):
            raise ValueError(f"{metric_type} {key} must be a number or blank.")
        if not math.isfinite(number):
            raise ValueError(f"{metric_type} {key} must be a finite number.")
        values[key] = number

    if isinstance(rule.get("warning_margin"), bool):
        raise ValueError(f"{metric_type} warning margin must be a number.")
    try:
        margin = float(rule.get("warning_margin"))
    except (TypeError, ValueError):
        raise ValueError(f"{metric_type} warning margin must be a number.")
    if not math.isfinite(margin) or margin < 0:
        raise ValueError(f"{metric_type} warning margin must be zero or greater.")
    if values["min"] is None and values["max"] is None:
        raise ValueError(f"{metric_type} needs at least a minimum or maximum limit.")
    if values["min"] is not None and values["max"] is not None:
        span = values["max"] - values["min"]
        if span <= 0:
            raise ValueError(f"{metric_type} maximum must be greater than its minimum.")
        if margin * 2 > span:
            raise ValueError(f"{metric_type} warning margin cannot exceed half of its safe range.")

    return {
        **values,
        "warning_margin": margin,
        "unit": defaults["unit"],
    }


def validate_thresholds(payload):
    """Validate a full replacement map of global settings and return normalized numeric values."""
    if not isinstance(payload, dict) or set(payload) != set(DEFAULT_THRESHOLDS):
        raise ValueError("Provide settings for all four supported sensor types.")

    normalized = {}
    for metric_type, defaults in DEFAULT_THRESHOLDS.items():
        normalized[metric_type] = validate_threshold_item(
            metric_type, payload.get(metric_type), defaults
        )
    return normalized


def validate_facility_overrides(payload):
    """
    Validate a partial or full facility override map (metric_type -> settings).
    Valid metric types: flow_rate, temperature, humidity, pressure.
    """
    if not isinstance(payload, dict) or not payload:
        raise ValueError("Provide an object containing sensor threshold overrides.")

    normalized = {}
    for metric_type, rule in payload.items():
        if metric_type not in DEFAULT_THRESHOLDS:
            raise ValueError(f"Unknown metric type: {metric_type}. Must be one of {list(DEFAULT_THRESHOLDS.keys())}")
        defaults = DEFAULT_THRESHOLDS[metric_type]
        normalized[metric_type] = validate_threshold_item(metric_type, rule, defaults)
    return normalized

