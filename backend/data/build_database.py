"""
Builds monitoring.db from scratch — rooms + sensors hierarchy.

1. Applies schema.sql
2. Seeds clients + data_centers from seed_clients.sql
3. Seeds rooms + sensors from rooms_sensors.json
4. Imports sensor_readings.csv, mapping sensor_code -> sensor_id
"""

import csv
import json
import sqlite3
import os

DB_PATH = "monitoring.db"
SCHEMA_PATH = "schema.sql"
SEED_PATH = "seed_clients.sql"
TOPOLOGY_PATH = "rooms_sensors.json"
READINGS_CSV = "sensor_readings.csv"
ANOMALIES_CSV = "anomalies.csv"
FORECASTS_CSV = "forecasts.csv"

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# 1. Schema
with open(SCHEMA_PATH) as f:
    cur.executescript(f.read())

# 2. Seed clients + data_centers
with open(SEED_PATH) as f:
    cur.executescript(f.read())

conn.commit()

# 3. Seed rooms + sensors from topology JSON
cur.execute("SELECT id, name FROM data_centers")
dc_name_to_id = {name: dc_id for dc_id, name in cur.fetchall()}

with open(TOPOLOGY_PATH) as f:
    topology = json.load(f)

sensor_code_to_id = {}

for room in topology:
    dc_id = dc_name_to_id[room["data_center"]]
    cur.execute(
        "INSERT INTO rooms (data_center_id, room_code, name, room_type, floor_level) VALUES (?, ?, ?, ?, ?)",
        (dc_id, room["room_code"], room["name"], room["room_type"], room["floor_level"])
    )
    room_id = cur.lastrowid

    for sensor in room["sensors"]:
        cur.execute(
            """INSERT INTO sensors (room_id, sensor_code, serial_id, name, metric_type, unit)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (room_id, sensor["sensor_code"], sensor["serial_id"], sensor["name"],
             sensor["metric_type"], sensor["unit"])
        )
        sensor_code_to_id[sensor["sensor_code"]] = cur.lastrowid

conn.commit()

# 4. Import sensor readings, mapping sensor_code -> sensor_id
with open(READINGS_CSV) as f:
    reader = csv.DictReader(f)
    rows_to_insert = [
        (sensor_code_to_id[row["sensor_code"]], float(row["value"]), row["timestamp"])
        for row in reader
    ]

cur.executemany(
    "INSERT INTO sensor_readings (sensor_id, value, timestamp) VALUES (?, ?, ?)",
    rows_to_insert
)
conn.commit()

# 5. Import anomalies, mapping sensor_code -> sensor_id
if os.path.exists(ANOMALIES_CSV):
    with open(ANOMALIES_CSV) as f:
        reader = csv.DictReader(f)
        anomalies_to_insert = [
            (sensor_code_to_id[row["sensor_code"]], row["detected_at"], row["severity"], row["description"])
            for row in reader if row["sensor_code"] in sensor_code_to_id
        ]
    cur.executemany(
        "INSERT INTO anomalies (sensor_id, detected_at, severity, description) VALUES (?, ?, ?, ?)",
        anomalies_to_insert
    )
    conn.commit()

# 6. Import forecasts, mapping sensor_code -> sensor_id
if os.path.exists(FORECASTS_CSV):
    with open(FORECASTS_CSV) as f:
        reader = csv.DictReader(f)
        forecasts_to_insert = [
            (sensor_code_to_id[row["sensor_code"]], row["predicted_at"], row["target_timestamp"], float(row["predicted_value"]), row["risk_level"])
            for row in reader if row["sensor_code"] in sensor_code_to_id
        ]
    cur.executemany(
        "INSERT INTO forecasts (sensor_id, predicted_at, target_timestamp, predicted_value, risk_level) VALUES (?, ?, ?, ?, ?)",
        forecasts_to_insert
    )
    conn.commit()

# ---------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------

print("=== clients ===")
for row in cur.execute("SELECT * FROM clients"):
    print(row)

print("\n=== data_centers ===")
for row in cur.execute("SELECT * FROM data_centers"):
    print(row)

print("\n=== rooms count ===")
print(cur.execute("SELECT COUNT(*) FROM rooms").fetchone()[0])

print("\n=== sensors count ===")
print(cur.execute("SELECT COUNT(*) FROM sensors").fetchone()[0])

print("\n=== sensor_readings row count ===")
print(cur.execute("SELECT COUNT(*) FROM sensor_readings").fetchone()[0])

print("\n=== anomalies count ===")
print(cur.execute("SELECT COUNT(*) FROM anomalies").fetchone()[0])

print("\n=== forecasts count ===")
print(cur.execute("SELECT COUNT(*) FROM forecasts").fetchone()[0])

print("\n=== sample: rooms + sensors for DC-Alpha ===")
cur.execute("""
    SELECT r.room_code, r.name, r.room_type, r.floor_level, s.sensor_code, s.serial_id, s.metric_type, s.unit
    FROM rooms r
    JOIN sensors s ON s.room_id = r.id
    JOIN data_centers dc ON r.data_center_id = dc.id
    WHERE dc.name = 'DC-Alpha'
    ORDER BY r.room_code, s.sensor_code
""")
for row in cur.fetchall():
    print(row)

print("\n=== drift check: DC-E-B01-FLOW-01 first and last reading ===")
cur.execute("""
    SELECT sr.timestamp, sr.value
    FROM sensor_readings sr
    JOIN sensors s ON sr.sensor_id = s.id
    WHERE s.sensor_code = 'DC-E-B01-FLOW-01'
    ORDER BY sr.timestamp ASC LIMIT 1
""")
print("first:", cur.fetchone())

cur.execute("""
    SELECT sr.timestamp, sr.value
    FROM sensor_readings sr
    JOIN sensors s ON sr.sensor_id = s.id
    WHERE s.sensor_code = 'DC-E-B01-FLOW-01'
    ORDER BY sr.timestamp DESC LIMIT 1
""")
print("last:", cur.fetchone())

conn.close()

# 7. Seed users table after the database-build connection has been closed.
# This avoids a SQLite file lock when the refresh command runs on Windows.
import add_users_table

print("\nDatabase built successfully: monitoring.db")
