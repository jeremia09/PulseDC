"""
Sensor data simulator for the IoT Data Center Monitoring POC.

Generates historical dummy readings for `sensor_readings`, keyed to
individual sensors (via rooms_sensors.json).

--------------------------------------------------------------------------
WHY THIS VERSION IS DIFFERENT FROM A NAIVE SIMULATOR
--------------------------------------------------------------------------
The four metrics we track are not physically independent of each other:

  - Coolant FLOW RATE is affected by coolant viscosity, which changes with
    TEMPERATURE (warmer coolant is thinner and flows more easily for the
    same pump effort), and by system PRESSURE (a pump struggling to
    maintain differential pressure will also struggle to maintain flow).
  - HUMIDITY (relative humidity) is temperature-relative by definition —
    the same absolute moisture content reads as a different %RH depending
    on temperature.

So instead of generating each metric as its own independent random walk,
this simulator generates TEMPERATURE first (per room, per timestep) as the
primary driver, then derives PRESSURE, HUMIDITY, and FLOW_RATE from it with
small realistic coupling coefficients plus their own independent noise.

DC-Epsilon's Mechanical Room flow rate sensor (DC-E-B01-FLOW-01) still
drifts toward failure over the window — this is the anomaly demo story.
That drift is layered ON TOP of the physics-based coupling below, so it
reads as "a real equipment fault on top of otherwise-normal physical
behavior" rather than "an arbitrary downward line."

Output: sensor_readings.csv (import into your DB via build_database.py)
"""

import csv
import json
import math
import random
from datetime import datetime, timedelta
from faker import Faker

fake = Faker()
fake.seed_instance(42)

# ---------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------

TOPOLOGY_FILE = "rooms_sensors.json"
OUTPUT_CSV = "sensor_readings.csv"
ANOMALIES_CSV = "anomalies.csv"
FORECASTS_CSV = "forecasts.csv"

DAYS_OF_HISTORY = 7
READING_INTERVAL_MINUTES = 15

# Baseline "normal" operating ranges per metric: (mean, stddev)
# stddev here represents the size of the daily cycle swing + noise floor,
# same meaning as before.
METRIC_BASELINES = {
    "temperature": (22.0, 0.8),   # Celsius
    "humidity":    (45.0, 3.0),   # %RH
    "pressure":    (100.0, 4.0),  # kPa; absolute room pressure near atmospheric pressure
    "flow_rate":   (40.0, 2.0),   # L/min
}

# --- Coupling coefficients (how strongly each metric responds to a 1-unit
#     deviation in temperature away from its baseline) ---
# Humidity: relative humidity drops as temperature rises (same absolute
# moisture reads as lower %RH when warmer). Roughly -1.5 %RH per +1°C is a
# reasonable simplified approximation for a controlled server room.
HUMIDITY_TEMP_COEFFICIENT = -1.5

# Flow rate: warmer coolant is less viscous -> flows slightly more easily
# for the same pump effort. This is a small effect under normal operation.
FLOW_TEMP_COEFFICIENT = 0.6   # L/min per +1°C

# Flow rate also tracks differential pressure directly — a pump that can't
# maintain pressure can't maintain flow either. Only applied in rooms that
# actually have a pressure sensor to derive from; mechanical rooms with
# flow sensors typically don't also have a pressure sensor in this
# topology, so this mainly matters if that changes later.
FLOW_PRESSURE_COEFFICIENT = 0.15  # L/min per +1 kPa deviation from baseline

# Pressure: mild thermal-expansion coupling to temperature — small on
# purpose, since pressure is mostly driven by pump/fan behavior, not heat.
PRESSURE_TEMP_COEFFICIENT = 0.3   # kPa per +1°C

# The specific sensor(s) that should drift toward failure.
# Referenced by sensor_code so the story stays pinned to one real device.
DRIFT_SENSOR_CODES = ["DC-E-B01-FLOW-01"]  # DC-Epsilon, Mechanical Room, Flow sensor
DRIFT_MAGNITUDE = -18.0  # flow rate dropping toward a blockage/leak, layered
                         # on top of the physics-coupled baseline below

# ---------------------------------------------------------------
# GENERATION LOGIC
# ---------------------------------------------------------------


def load_topology():
    with open(TOPOLOGY_FILE) as f:
        return json.load(f)


def generate_readings(topology, end_time=None):
    rows = []
    # Use the present time so a regenerated demo looks current. A caller may
    # still pass a fixed value when reproducible timestamps are needed.
    end_time = end_time or datetime.now().replace(second=0, microsecond=0)
    start_time = end_time - timedelta(days=DAYS_OF_HISTORY)
    total_minutes = DAYS_OF_HISTORY * 24 * 60
    total_steps = total_minutes // READING_INTERVAL_MINUTES
    steps_per_day = 24 * 60 // READING_INTERVAL_MINUTES

    reading_id = 1
    temp_mean, temp_stddev = METRIC_BASELINES["temperature"]
    hum_mean, hum_stddev = METRIC_BASELINES["humidity"]
    press_mean, press_stddev = METRIC_BASELINES["pressure"]
    flow_mean, flow_stddev = METRIC_BASELINES["flow_rate"]

    for room in topology:
        sensors_by_metric = {s["metric_type"]: s for s in room["sensors"]}

        for step in range(total_steps + 1):
            ts = start_time + timedelta(minutes=step * READING_INTERVAL_MINUTES)
            progress = step / total_steps
            daily_phase = 2 * math.pi * (step % steps_per_day) / steps_per_day
            daily_cycle = math.sin(daily_phase)

            # --- 1. Temperature: the primary driver, generated first ---
            temp_noise = random.gauss(0, temp_stddev * 0.3)
            temperature = temp_mean + daily_cycle * temp_stddev + temp_noise
            temp_deviation = temperature - temp_mean

            # --- 2. Pressure: mostly its own signal, mild temp coupling ---
            pressure = None
            if "pressure" in sensors_by_metric:
                press_noise = random.gauss(0, press_stddev * 0.3)
                pressure = (
                    press_mean
                    + daily_cycle * press_stddev * 0.5   # weaker daily cycle than temp
                    + PRESSURE_TEMP_COEFFICIENT * temp_deviation
                    + press_noise
                )

            # --- 3. Humidity: derived from temperature (RH behavior) ---
            if "humidity" in sensors_by_metric:
                hum_noise = random.gauss(0, hum_stddev * 0.3)
                humidity = (
                    hum_mean
                    + HUMIDITY_TEMP_COEFFICIENT * temp_deviation
                    + hum_noise
                )
                rows.append({
                    "id": reading_id,
                    "sensor_code": sensors_by_metric["humidity"]["sensor_code"],
                    "value": round(humidity, 2),
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                })
                reading_id += 1

            # --- 4. Flow rate: derived from temperature + pressure ---
            if "flow_rate" in sensors_by_metric:
                flow_noise = random.gauss(0, flow_stddev * 0.3)
                pressure_term = (
                    FLOW_PRESSURE_COEFFICIENT * (pressure - press_mean)
                    if pressure is not None else 0.0
                )
                flow_rate = (
                    flow_mean
                    + FLOW_TEMP_COEFFICIENT * temp_deviation
                    + pressure_term
                    + flow_noise
                )

                flow_sensor_code = sensors_by_metric["flow_rate"]["sensor_code"]
                if flow_sensor_code in DRIFT_SENSOR_CODES:
                    drift_progress = max(0.0, (progress - 0.4) / 0.6)  # starts ~40% through
                    flow_rate += DRIFT_MAGNITUDE * drift_progress

                rows.append({
                    "id": reading_id,
                    "sensor_code": flow_sensor_code,
                    "value": round(flow_rate, 2),
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                })
                reading_id += 1

            # --- 5. Temperature reading itself (every room has one) ---
            if "temperature" in sensors_by_metric:
                rows.append({
                    "id": reading_id,
                    "sensor_code": sensors_by_metric["temperature"]["sensor_code"],
                    "value": round(temperature, 2),
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                })
                reading_id += 1

            # --- 6. Pressure reading itself, if this room has one ---
            if pressure is not None:
                rows.append({
                    "id": reading_id,
                    "sensor_code": sensors_by_metric["pressure"]["sensor_code"],
                    "value": round(pressure, 2),
                    "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
                })
                reading_id += 1

    return rows


def generate_anomalies_and_forecasts(rows, topology, end_time):
    """
    Generates rule-based anomalies and risk forecasts enriched with Faker text.
    """
    anomalies = []
    forecasts = []

    # Map sensor codes to metric types and room info
    sensor_map = {}
    for room in topology:
        for s in room["sensors"]:
            sensor_map[s["sensor_code"]] = {
                "room": room["name"],
                "data_center": room["data_center"],
                "metric_type": s["metric_type"],
                "unit": s["unit"],
            }

    anomaly_id = 1
    forecast_id = 1

    # Filter readings to detect anomalies (focus on significant breaches and drift)
    for r in rows:
        code = r["sensor_code"]
        val = r["value"]
        ts = r["timestamp"]
        info = sensor_map.get(code, {})
        mtype = info.get("metric_type")

        severity = None
        desc = None

        if code in DRIFT_SENSOR_CODES and val < 30.0:
            severity = "critical" if val < 25.0 else "warning"
            desc = (
                f"Coolant flow failure trend on {code} ({info.get('room', 'Mechanical Room')}): "
                f"Current rate {val} {info.get('unit', 'L/min')}. Diagnostic: {fake.catch_phrase()}."
            )
        elif mtype == "temperature" and val > 24.5:
            severity = "warning"
            desc = (
                f"High temperature threshold alert on {code}: {val}°C in {info.get('room', 'Server Room')}. "
                f"Status: {fake.bs().capitalize()}."
            )
        elif mtype == "humidity" and (val < 35.0 or val > 53.0):
            severity = "info"
            desc = f"Relative humidity fluctuation on {code}: {val}%RH. Notice: {fake.sentence(nb_words=6)}."
        elif mtype == "flow_rate" and val < 32.0 and code not in DRIFT_SENSOR_CODES:
            severity = "warning"
            desc = f"Low coolant flow rate warning on {code}: {val} L/min."

        if severity:
            anomalies.append({
                "id": anomaly_id,
                "sensor_code": code,
                "detected_at": ts,
                "severity": severity,
                "description": desc,
            })
            anomaly_id += 1

    # Generate forward-looking forecasts anchored at the end of the history window
    # Sort readings by timestamp to find latest per sensor
    latest_by_sensor = {}
    for r in rows:
        latest_by_sensor[r["sensor_code"]] = r

    for code, info in sensor_map.items():
        latest = latest_by_sensor.get(code)
        if not latest:
            continue

        curr_val = latest["value"]
        mtype = info["metric_type"]

        # Generate 6h, 12h, and 24h predictions
        for hours_ahead in [6, 12, 24]:
            target_ts = (end_time + timedelta(hours=hours_ahead)).strftime("%Y-%m-%d %H:%M:%S")

            if code in DRIFT_SENSOR_CODES:
                # Flow rate continuing to drop
                predicted_val = max(10.0, round(curr_val - (hours_ahead * 0.8), 2))
                risk_level = "high" if predicted_val < 22.0 else "medium"
            elif mtype == "temperature":
                predicted_val = round(curr_val + random.uniform(-0.5, 0.8), 2)
                risk_level = "medium" if predicted_val > 24.0 else "low"
            elif mtype == "flow_rate":
                predicted_val = round(curr_val + random.uniform(-1.0, 0.5), 2)
                risk_level = "medium" if predicted_val < 32.0 else "low"
            else:
                predicted_val = round(curr_val + random.uniform(-1.0, 1.0), 2)
                risk_level = "low"

            forecasts.append({
                "id": forecast_id,
                "sensor_code": code,
                "predicted_at": end_time.strftime("%Y-%m-%d %H:%M:%S"),
                "target_timestamp": target_ts,
                "predicted_value": predicted_val,
                "risk_level": risk_level,
            })
            forecast_id += 1

    return anomalies, forecasts


def write_csv(rows, path, fieldnames):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    random.seed(42)  # reproducible output for consistent demos
    topology = load_topology()
    end_time = datetime.now().replace(second=0, microsecond=0)
    rows = generate_readings(topology, end_time=end_time)
    write_csv(rows, OUTPUT_CSV, ["id", "sensor_code", "value", "timestamp"])

    anomalies, forecasts = generate_anomalies_and_forecasts(rows, topology, end_time=end_time)
    write_csv(anomalies, ANOMALIES_CSV, ["id", "sensor_code", "detected_at", "severity", "description"])
    write_csv(forecasts, FORECASTS_CSV, ["id", "sensor_code", "predicted_at", "target_timestamp", "predicted_value", "risk_level"])

    total_sensors = sum(len(r["sensors"]) for r in topology)
    print(f"Generated {len(rows)} readings across {total_sensors} sensors in {len(topology)} rooms.")
    print(f"Generated {len(anomalies)} anomalies and {len(forecasts)} forecasts using Faker.")
    print(f"Outputs written to {OUTPUT_CSV}, {ANOMALIES_CSV}, and {FORECASTS_CSV}")
