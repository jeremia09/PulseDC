-- IoT Data Center Monitoring POC — schema v2 (DRAFT for review)
-- New hierarchy: clients -> data_centers -> rooms -> sensors -> sensor_readings / anomalies / forecasts
-- This is a DRAFT. Not yet applied to monitoring.db.

CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    contract_start_date TEXT
);

CREATE TABLE data_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    name TEXT NOT NULL UNIQUE,          -- e.g. "DC-Alpha"
    location TEXT,                      -- e.g. "Kuala Lumpur"
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- NEW: rooms/floors within a data center
CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_center_id INTEGER NOT NULL,
    room_code TEXT NOT NULL,            -- e.g. "101", "SRVA" -- short code used in sensor codes
    name TEXT NOT NULL,                 -- e.g. "Server Room A"
    room_type TEXT NOT NULL CHECK (room_type IN ('server','mechanical','electrical')),
    floor_level TEXT,                   -- e.g. "Level 1", "Ground Floor"
    FOREIGN KEY (data_center_id) REFERENCES data_centers(id),
    UNIQUE (data_center_id, room_code)
);

-- NEW: individual sensors within a room
CREATE TABLE sensors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    sensor_code TEXT NOT NULL UNIQUE,   -- readable: "DC-A-SRVA-TEMP-01"
    serial_id TEXT NOT NULL UNIQUE,     -- realistic device serial: "SNS-88214"
    name TEXT NOT NULL,                 -- display name: "Server Room A - Temp Sensor 1"
    metric_type TEXT NOT NULL CHECK (metric_type IN ('temperature','humidity','pressure','flow_rate')),
    unit TEXT NOT NULL,                 -- independent per sensor: "°C", "%RH", "kPa", "L/min"
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id INTEGER NOT NULL,
    value REAL NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (sensor_id) REFERENCES sensors(id)
);

CREATE TABLE anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id INTEGER NOT NULL,
    detected_at TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    description TEXT,
    FOREIGN KEY (sensor_id) REFERENCES sensors(id)
);

CREATE TABLE forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id INTEGER NOT NULL,
    predicted_at TEXT NOT NULL,
    target_timestamp TEXT NOT NULL,
    predicted_value REAL,
    risk_level TEXT CHECK (risk_level IN ('low','medium','high')),
    FOREIGN KEY (sensor_id) REFERENCES sensors(id)
);

-- Shared operator workflow state; users is added by add_users_table.py.
CREATE TABLE alert_actions (
    sensor_id INTEGER NOT NULL,
    alert_timestamp TEXT NOT NULL,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    acknowledged_by INTEGER,
    acknowledged_at TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_by INTEGER,
    resolved_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sensor_id, alert_timestamp),
    FOREIGN KEY (sensor_id) REFERENCES sensors(id),
    FOREIGN KEY (acknowledged_by) REFERENCES users(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- Helpful indexes for the dashboard's most common queries
CREATE INDEX idx_sensor_readings_sensor ON sensor_readings(sensor_id);
CREATE INDEX idx_sensor_readings_timestamp ON sensor_readings(timestamp);
CREATE INDEX idx_sensors_room ON sensors(room_id);
CREATE INDEX idx_rooms_dc ON rooms(data_center_id);
