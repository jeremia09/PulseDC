"""
Generates the room + sensor topology for all 6 data centers.

Each DC gets 4 rooms:
  - Server Room A   (server)      -> temperature, humidity, pressure
  - Server Room B   (server)      -> temperature, humidity, pressure
  - Mechanical Room (mechanical)  -> flow_rate, temperature
  - Electrical Room (electrical)  -> temperature, humidity

Each sensor gets:
  - a readable sensor_code, e.g. DC-A-SRVA-TEMP-01
  - a realistic serial_id, e.g. SNS-88214
  - a unit specific to its metric type

Output: rooms_sensors.json (consumed by build_database.py and the simulator)
"""

import json
import random

random.seed(7)

DC_CODES = {
    "DC-Alpha": "A",
    "DC-Beta": "B",
    "DC-Gamma": "G",
    "DC-Delta": "D",
    "DC-Epsilon": "E",
    "DC-Zeta": "Z",
}

ROOM_TEMPLATE = [
    # (room_code, name, room_type, floor_level, metrics)
    ("101", "Server Room A", "server", "Ground Floor", ["temperature", "humidity", "pressure"]),
    ("201", "Server Room B", "server", "Level 2", ["temperature", "humidity", "pressure"]),
    ("B01", "Mechanical Room", "mechanical", "Basement", ["flow_rate", "temperature"]),
    ("102", "Electrical Room", "electrical", "Ground Floor", ["temperature", "humidity"]),
]

UNITS = {
    "temperature": "°C",
    "humidity": "%RH",
    "pressure": "kPa",
    "flow_rate": "L/min",
}

METRIC_SHORT = {
    "temperature": "TEMP",
    "humidity": "HUM",
    "pressure": "PRESS",
    "flow_rate": "FLOW",
}


def build_topology():
    topology = []  # list of {data_center, room_code, name, room_type, floor_level, sensors: [...]}
    for dc_name, dc_code in DC_CODES.items():
        for room_code, room_name, room_type, floor_level, metrics in ROOM_TEMPLATE:
            sensors = []
            for metric in metrics:
                short = METRIC_SHORT[metric]
                sensor_code = f"DC-{dc_code}-{room_code}-{short}-01"
                serial_id = f"SNS-{random.randint(10000, 99999)}"
                sensors.append({
                    "sensor_code": sensor_code,
                    "serial_id": serial_id,
                    "name": f"{room_name} - {metric.replace('_', ' ').title()} Sensor 1",
                    "metric_type": metric,
                    "unit": UNITS[metric],
                })
            topology.append({
                "data_center": dc_name,
                "room_code": room_code,
                "name": room_name,
                "room_type": room_type,
                "floor_level": floor_level,
                "sensors": sensors,
            })
    return topology


if __name__ == "__main__":
    topology = build_topology()
    with open("rooms_sensors.json", "w") as f:
        json.dump(topology, f, indent=2)

    total_rooms = len(topology)
    total_sensors = sum(len(r["sensors"]) for r in topology)
    print(f"Generated {total_rooms} rooms and {total_sensors} sensors across {len(DC_CODES)} data centers.")
    print("Output written to rooms_sensors.json")
