"""
Builds a compact, LLM-friendly text summary of the current dashboard state,
grounding the chatbot's answers in real live data from SQLite (monitoring.db).
Supports client-specific isolation so clients only see their own data centers.
"""

import os
import sqlite3
from threshold_service import DEFAULT_THRESHOLDS, get_thresholds, get_all_facility_thresholds

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "monitoring.db")


def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode = WAL;")
    con.execute("PRAGMA synchronous = NORMAL;")
    con.execute("PRAGMA cache_size = -64000;")
    con.execute("PRAGMA temp_store = MEMORY;")
    return con


def _status_for(metric_type, value, thresholds):
    rule = thresholds.get(metric_type)
    if not rule:
        return "ok"
    if rule["min"] is not None and value < rule["min"]:
        return "critical_low"
    if rule["max"] is not None and value > rule["max"]:
        return "critical_high"
    return "ok"


def build_context_summary(client_id=None, role="admin", user_name=None, crm_data=None, thresholds=None):
    """
    Returns a plain-text summary of current system state directly from monitoring.db.
    If role == 'client', filters to data centers belonging to that client_id.
    Accepts optional crm_data=(clients, data_centers, rooms, sensors) to reuse cached metadata.
    """
    if not os.path.exists(DB_PATH):
        return f"Database not found at {DB_PATH}. Please ensure monitoring.db is initialized."

    facility_threshold_map = {}
    if thresholds is None:
        con = get_db()
        try:
            thresholds = get_thresholds(con)
            facility_threshold_map = get_all_facility_thresholds(con)
        except sqlite3.OperationalError:
            thresholds = DEFAULT_THRESHOLDS
        finally:
            con.close()
    else:
        con = get_db()
        try:
            facility_threshold_map = get_all_facility_thresholds(con)
        except sqlite3.OperationalError:
            facility_threshold_map = {}
        finally:
            con.close()

    if crm_data:
        clients, dcs, rooms, sensors = crm_data
    else:
        con = get_db()
        # 1. Fetch Clients & Data Centers based on role
        if role == "client" and client_id:
            clients = con.execute(
                "SELECT id, company_name, contact_name, contact_email FROM clients WHERE id = ?",
                (client_id,),
            ).fetchall()
            dcs = con.execute(
                "SELECT id, client_id, name, location FROM data_centers WHERE client_id = ?",
                (client_id,),
            ).fetchall()
        else:
            clients = con.execute(
                "SELECT id, company_name, contact_name, contact_email FROM clients"
            ).fetchall()
            dcs = con.execute(
                "SELECT id, client_id, name, location FROM data_centers"
            ).fetchall()

        dc_ids = [dc["id"] for dc in dcs]
        if not dc_ids:
            con.close()
            return "No data centers are registered or accessible for this account."

        placeholders = ",".join("?" * len(dc_ids))

        # 2. Rooms
        rooms = con.execute(
            f"SELECT id, data_center_id, room_code, name, room_type, floor_level "
            f"FROM rooms WHERE data_center_id IN ({placeholders})",
            dc_ids,
        ).fetchall()
        room_ids = [r["id"] for r in rooms]

        if not room_ids:
            con.close()
            return f"Data Centers found ({len(dcs)}), but no server rooms are configured yet."

        room_placeholders = ",".join("?" * len(room_ids))

        # 3. Sensors
        sensors = con.execute(
            f"SELECT id, room_id, sensor_code, serial_id, name, metric_type, unit "
            f"FROM sensors WHERE room_id IN ({room_placeholders})",
            room_ids,
        ).fetchall()
        con.close()

    dc_ids = [dc["id"] for dc in dcs]
    if not dc_ids:
        return "No data centers are registered or accessible for this account."

    room_ids = [r["id"] for r in rooms]
    if not room_ids:
        return f"Data Centers found ({len(dcs)}), but no server rooms are configured yet."

    sensor_by_id = {s["id"]: s for s in sensors}
    room_placeholders = ",".join("?" * len(room_ids))

    con = get_db()

    # 4. Latest Reading per Sensor using correlated subquery
    latest_readings = con.execute(
        f"""
        SELECT sr.sensor_id, sr.value, sr.timestamp
        FROM sensor_readings sr
        INNER JOIN (
            SELECT sensor_id, MAX(timestamp) as max_ts
            FROM sensor_readings
            WHERE sensor_id IN (SELECT id FROM sensors WHERE room_id IN ({room_placeholders}))
            GROUP BY sensor_id
        ) latest ON sr.sensor_id = latest.sensor_id AND sr.timestamp = latest.max_ts
        """,
        room_ids,
    ).fetchall()

    sensor_ids = list(sensor_by_id.keys())
    anomalies_rows = []
    forecast_rows = []
    if sensor_ids:
        sp = ",".join("?" * len(sensor_ids))
        anomalies_rows = con.execute(
            f"SELECT a.severity, a.description, a.detected_at, s.sensor_code "
            f"FROM anomalies a JOIN sensors s ON a.sensor_id = s.id "
            f"WHERE s.id IN ({sp}) ORDER BY a.detected_at DESC LIMIT 5",
            sensor_ids,
        ).fetchall()
        forecast_rows = con.execute(
            f"SELECT f.predicted_value, f.target_timestamp, f.risk_level, s.sensor_code, s.metric_type, s.unit "
            f"FROM forecasts f JOIN sensors s ON f.sensor_id = s.id "
            f"WHERE s.id IN ({sp}) AND f.risk_level IN ('high', 'medium') ORDER BY f.target_timestamp ASC LIMIT 5",
            sensor_ids,
        ).fetchall()

    con.close()

    room_by_id = {r["id"]: r for r in rooms}
    dc_by_id = {d["id"]: d for d in dcs}
    client_by_id = {c["id"]: c for c in clients}

    problem_sensors = []
    healthy_sensor_count = 0

    for r in latest_readings:
        sid = r["sensor_id"]
        sensor = sensor_by_id.get(sid)
        if not sensor:
            continue

        val = round(float(r["value"]), 2)
        room = room_by_id.get(sensor["room_id"])
        dc_id = room["data_center_id"] if room else None
        sensor_thresholds = facility_threshold_map.get(dc_id, {}).get("thresholds", {}) if dc_id else {}
        effective_rule = sensor_thresholds.get(sensor["metric_type"]) or thresholds.get(sensor["metric_type"])
        single_threshold = {sensor["metric_type"]: effective_rule} if effective_rule else thresholds

        status = _status_for(sensor["metric_type"], val, single_threshold)

        if status != "ok":
            dc = dc_by_id.get(room["data_center_id"]) if room else None
            problem_sensors.append({
                "dc_name": dc["name"] if dc else "Unknown",
                "location": dc["location"] if dc else "Unknown",
                "room_name": room["name"] if room else "Unknown",
                "room_code": room["room_code"] if room else "?",
                "sensor_name": sensor["name"],
                "sensor_code": sensor["sensor_code"],
                "metric_type": sensor["metric_type"],
                "value": val,
                "unit": sensor["unit"],
                "status": status,
                "timestamp": r["timestamp"],
            })
        else:
            healthy_sensor_count += 1

    unhealthy_dc_names = sorted(set(p["dc_name"] for p in problem_sensors))
    all_dc_names = [d["name"] for d in dcs]
    healthy_dc_names = [n for n in all_dc_names if n not in unhealthy_dc_names]

    lines = []
    if role == "client" and clients:
        client_name = clients[0]["company_name"]
        lines.append(f"Viewing client tenant: {client_name} (Role: Client, User: {user_name or 'Authorized User'}).")
    else:
        lines.append(f"Viewing global fleet: Administrator level access ({len(clients)} clients managed).")

    lines.append(f"Monitored Sites: {len(dcs)} data centers ({', '.join(all_dc_names)}), {len(rooms)} rooms, {len(sensors)} sensors.")
    lines.append(f"Operational Health: {len(healthy_dc_names)}/{len(all_dc_names)} data centers optimal.")

    lines.append("\nCurrent administrator-configured sensor limits:")
    for metric_type, rule in thresholds.items():
        low = f"{rule['min']:g}" if rule.get("min") is not None else "no minimum"
        high = f"{rule['max']:g}" if rule.get("max") is not None else "no maximum"
        lines.append(
            f"  - {metric_type}: {low} to {high} {rule.get('unit', '')}; "
            f"warning margin {rule.get('warning_margin', rule.get('warningMargin', 0)):g}."
        )

    if problem_sensors:
        lines.append(f"\nCRITICAL ALERTS & THRESHOLD BREACHES ({len(problem_sensors)} active):")
        for p in problem_sensors:
            dir_str = "HIGH" if p["status"] == "critical_high" else "LOW"
            expected = thresholds.get(p["metric_type"], {})
            low = expected.get("min") if expected.get("min") is not None else "no minimum"
            high = expected.get("max") if expected.get("max") is not None else "no maximum"
            exp_str = f"safe range: {low} to {high} {p['unit']}"
            lines.append(
                f"  - [{dir_str}] {p['dc_name']} ({p['location']}) -> Room {p['room_code']} ({p['room_name']}): "
                f"{p['sensor_name']} [{p['sensor_code']}] = {p['value']} {p['unit']} (Expected {exp_str}) [Recorded: {p['timestamp']}]"
            )
    else:
        lines.append("\nActive Alerts: All current readings are within their administrator-configured operating limits.")

    if anomalies_rows:
        lines.append(f"\nLOGGED ANOMALIES & DIAGNOSTICS ({len(anomalies_rows)} recent samples):")
        for a in anomalies_rows:
            lines.append(f"  - [{a['severity'].upper()}] {a['sensor_code']}: {a['description']} (Detected: {a['detected_at']})")

    if forecast_rows:
        lines.append(f"\nPREDICTIVE RISK FORECASTS ({len(forecast_rows)} key projections):")
        for f in forecast_rows:
            lines.append(f"  - [{f['risk_level'].upper()} RISK] {f['sensor_code']}: Projected {f['predicted_value']} {f['unit']} by {f['target_timestamp']}")

    lines.append("\nFacility Hierarchy:")
    for dc in dcs:
        c = client_by_id.get(dc["client_id"])
        c_str = f" (Client: {c['company_name']})" if c and role != "client" else ""
        dc_rooms = [r for r in rooms if r["data_center_id"] == dc["id"]]
        r_str = ", ".join([f"{r['room_code']} ({r['name']})" for r in dc_rooms])
        lines.append(f"  * {dc['name']} [{dc['location']}]{c_str}: {r_str}")

    return "\n".join(lines)


def get_sensor_trend_history(sensor_code_or_name, hours=24, client_id=None, role="admin"):
    """
    Utility tool to retrieve historical sensor readings for trends and diagnostics.
    """
    con = get_db()
    # Find sensor
    query = (
        "SELECT s.id, s.sensor_code, s.name, s.metric_type, s.unit FROM sensors s "
        "JOIN rooms r ON s.room_id = r.id "
        "JOIN data_centers dc ON r.data_center_id = dc.id "
        "WHERE (s.sensor_code = ? OR s.name LIKE ?)"
    )
    params = [sensor_code_or_name, f"%{sensor_code_or_name}%"]
    if role == "client":
        query += " AND dc.client_id = ?"
        params.append(client_id)
    query += " LIMIT 1"
    sensor = con.execute(query, params).fetchone()

    if not sensor:
        con.close()
        return f"Sensor '{sensor_code_or_name}' not found."

    readings = con.execute(
        "SELECT timestamp, value FROM sensor_readings WHERE sensor_id = ? "
        "ORDER BY timestamp DESC LIMIT ?",
        (sensor["id"], hours * 4),  # 15-min intervals = 4 per hour
    ).fetchall()
    con.close()

    if not readings:
        return f"No telemetry readings found for sensor {sensor['sensor_code']}."

    readings = list(reversed(readings))
    values = [r["value"] for r in readings]
    min_val = min(values)
    max_val = max(values)
    avg_val = sum(values) / len(values)
    latest = values[-1]

    summary = (
        f"Sensor History for {sensor['name']} ({sensor['sensor_code']}) - Past {len(readings)} data points:\n"
        f"- Metric: {sensor['metric_type']} ({sensor['unit']})\n"
        f"- Current Value: {latest:.2f} {sensor['unit']}\n"
        f"- Min: {min_val:.2f} | Max: {max_val:.2f} | Avg: {avg_val:.2f}\n"
        f"- Recent sample readings:\n"
    )
    step = max(1, len(readings) // 5)
    for r in readings[::step]:
        summary += f"  • {r['timestamp']}: {r['value']:.2f} {sensor['unit']}\n"

    return summary


def list_sensors(data_center_name=None, room_code=None, client_id=None, role="admin"):
    """
    Lists sensors and their codes in a data center or room.
    """
    con = get_db()
    query = """
        SELECT s.sensor_code, s.name, s.metric_type, s.unit, r.room_code, r.name as room_name, dc.name as dc_name
        FROM sensors s
        JOIN rooms r ON s.room_id = r.id
        JOIN data_centers dc ON r.data_center_id = dc.id
        WHERE 1=1
    """
    params = []
    if data_center_name:
        query += " AND (dc.name LIKE ? OR dc.location LIKE ?)"
        params.extend([f"%{data_center_name}%", f"%{data_center_name}%"])
    if room_code:
        query += " AND (r.room_code LIKE ? OR r.name LIKE ?)"
        params.extend([f"%{room_code}%", f"%{room_code}%"])
    if role == "client":
        query += " AND dc.client_id = ?"
        params.append(client_id)

    query += " LIMIT 25"
    sensors = con.execute(query, params).fetchall()
    con.close()

    if not sensors:
        return "No sensors found matching the criteria."

    lines = ["Available Sensors:"]
    for s in sensors:
        lines.append(f"  - [{s['sensor_code']}] {s['dc_name']} {s['room_code']} ({s['room_name']}): {s['name']} ({s['metric_type']} in {s['unit']})")
    return "\n".join(lines)


def get_data_center_comparison(metric_type="temperature", client_id=None, role="admin"):
    """
    Compares average, min, max metrics across all data centers for a given metric_type.
    """
    con = get_db()
    rows = con.execute(
        """
        SELECT dc.name as dc_name, AVG(sr.value) as avg_val, MIN(sr.value) as min_val, MAX(sr.value) as max_val, s.unit
        FROM sensor_readings sr
        JOIN sensors s ON sr.sensor_id = s.id
        JOIN rooms r ON s.room_id = r.id
        JOIN data_centers dc ON r.data_center_id = dc.id
        WHERE s.metric_type LIKE ?
        """ + (" AND dc.client_id = ?" if role == "client" else "") + """
        GROUP BY dc.name
        """,
        (f"%{metric_type}%", client_id) if role == "client" else (f"%{metric_type}%",),
    ).fetchall()
    con.close()

    if not rows:
        return f"No comparison data found for metric '{metric_type}'."

    unit = rows[0]["unit"] if rows else ""
    lines = [f"Facility Comparison for {metric_type.capitalize()} ({unit}):"]
    for r in rows:
        lines.append(f"  * {r['dc_name']}: Avg {r['avg_val']:.2f} {unit} | Min {r['min_val']:.2f} | Max {r['max_val']:.2f}")
    return "\n".join(lines)


if __name__ == "__main__":
    print("=== Admin Overview ===")
    print(build_context_summary(role="admin"))
    print("\n=== Client 1 (Nimbus) Overview ===")
    print(build_context_summary(client_id=1, role="client"))
