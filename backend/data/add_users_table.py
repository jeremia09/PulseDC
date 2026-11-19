"""
Adds a `users` table to monitoring.db and seeds one admin account plus one
login per client, so the client/admin role split has something real to
authenticate against.

Run from the data/ folder:  python add_users_table.py

Safe to re-run: drops and recreates the users table each time (so passwords
reset to the defaults below if you ever need to re-seed).
"""

import sqlite3
from werkzeug.security import generate_password_hash

DB_PATH = "monitoring.db"

# username -> (password, role, client_company_name or None for admin, display_name)
SEED_USERS = [
    ("superadmin", "super123", "super_admin", None, "Pulse DC Super Admin"),
    ("admin", "admin123", "admin", None, "Pulse DC Admin"),
    ("nimbus", "nimbus123", "client", "Nimbus Cloud Holdings", "Alicia Tan"),
    ("vertex", "vertex123", "client", "Vertex Financial Group", "Marcus Lee"),
    ("orion", "orion123", "client", "Orion Retail Systems", "Priya Nair"),
]

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

cur.execute("DROP TABLE IF EXISTS users")
cur.execute("""
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'client')),
        client_id INTEGER REFERENCES clients(id),
        display_name TEXT
    )
""")

for username, password, role, company_name, display_name in SEED_USERS:
    client_id = None
    if company_name:
        cur.execute("SELECT id FROM clients WHERE company_name = ?", (company_name,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"Could not find client '{company_name}' in clients table — "
                              f"check company_name spelling matches seed_clients.sql")
        client_id = row[0]

    cur.execute(
        "INSERT INTO users (username, password_hash, role, client_id, display_name) "
        "VALUES (?, ?, ?, ?, ?)",
        (username, generate_password_hash(password), role, client_id, display_name),
    )

con.commit()

print("=== users table seeded ===")
for row in cur.execute(
    "SELECT u.username, u.role, u.client_id, c.company_name, u.display_name "
    "FROM users u LEFT JOIN clients c ON c.id = u.client_id"
):
    print(row)

print("\nLogin credentials (change these before showing anyone outside the team):")
for username, password, role, company_name, _ in SEED_USERS:
    print(f"  {username} / {password}  ({role}{' - ' + company_name if company_name else ''})")

con.close()
