-- Seed clients (customers who own one or more data centers)
INSERT INTO clients (company_name, contact_name, contact_email, contract_start_date) VALUES
    ('Nimbus Cloud Holdings', 'Alicia Tan', 'alicia.tan@nimbuscloud.example', '2024-03-12'),
    ('Vertex Financial Group', 'Marcus Lee', 'marcus.lee@vertexfg.example', '2023-11-01'),
    ('Orion Retail Systems', 'Priya Nair', 'priya.nair@orionretail.example', '2025-01-20');

-- Seed data centers, linked to clients
-- Demonstrates the flexible ownership model: Nimbus Cloud owns 3 sites, others own fewer
INSERT INTO data_centers (client_id, name, location) VALUES
    (1, 'DC-Alpha',   'Kuala Lumpur'),
    (1, 'DC-Beta',    'Cyberjaya'),
    (1, 'DC-Gamma',   'Penang'),
    (2, 'DC-Delta',   'Johor Bahru'),
    (2, 'DC-Epsilon', 'Kuching'),
    (3, 'DC-Zeta',    'Kota Kinabalu');