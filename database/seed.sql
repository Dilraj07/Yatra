-- =============================================================================
-- Yatra Seed Data — Heritage Capacity Inventory & Sample Group Trip
-- Password for all seeded accounts: "yatra123"
-- =============================================================================

INSERT INTO app_user (email, full_name, home_city, password_hash) VALUES
('dilraj@yatra.local', 'Dilraj Singh', 'Bengaluru', 'pbkdf2:sha256:260000$yatraSeedSalt01$198168c735f502f813154cbb83c1b57cee7c61c1c4c76fb8bbcf3f1ba4a1955d'),
('arya@yatra.local',   'Arya Wadhwa',  'Bengaluru', 'pbkdf2:sha256:260000$yatraSeedSalt01$198168c735f502f813154cbb83c1b57cee7c61c1c4c76fb8bbcf3f1ba4a1955d'),
('aarush@yatra.local', 'Aarush Luthra','Delhi',     'pbkdf2:sha256:260000$yatraSeedSalt01$198168c735f502f813154cbb83c1b57cee7c61c1c4c76fb8bbcf3f1ba4a1955d'),
('operator@asi.gov.in','ASI Heritage Operator','Agra','pbkdf2:sha256:260000$yatraSeedSalt01$198168c735f502f813154cbb83c1b57cee7c61c1c4c76fb8bbcf3f1ba4a1955d')
ON CONFLICT (email) DO NOTHING;

INSERT INTO supplier (name, kind) VALUES
('Archaeological Survey of India (ASI)', 'SITE_OPERATOR'),
('Karnataka Heritage Trust',             'SITE_OPERATOR'),
('Duffel Flights Sandbox',               'FLIGHT_API'),
('LiteAPI Stays Sandbox',                'HOTEL_API')
ON CONFLICT (name) DO NOTHING;

INSERT INTO poi (supplier_id, name, city, lat, lon, capacity_managed, description) VALUES
((SELECT supplier_id FROM supplier WHERE name = 'Archaeological Survey of India (ASI)'),
 'Taj Mahal Night Viewing', 'Agra', 27.1751, 78.0421, TRUE,
 'ASI regulated full-moon night viewing: capped at 400 visitors/night across 8 timed batches of 50.'),
((SELECT supplier_id FROM supplier WHERE name = 'Archaeological Survey of India (ASI)'),
 'Agra Fort Diwan-i-Khas Circuit', 'Agra', 27.1795, 78.0211, TRUE,
 'Timed heritage entry slot for Mughal palace chambers.'),
((SELECT supplier_id FROM supplier WHERE name = 'Karnataka Heritage Trust'),
 'Hampi Vittala Temple Stone Chariot Slot', 'Hampi', 15.3422, 76.4750, TRUE,
 'Regulated conservation-zone timed entry for Vittala complex.'),
((SELECT supplier_id FROM supplier WHERE name = 'Duffel Flights Sandbox'),
 'BLR -> DEL Flight Corridor', 'Agra', 28.5562, 77.1000, FALSE,
 'Flight corridor into NCR for Golden Triangle group itineraries.'),
((SELECT supplier_id FROM supplier WHERE name = 'LiteAPI Stays Sandbox'),
 'ITC Mughal Agra Resort', 'Agra', 27.1614, 78.0442, FALSE,
 'Group-friendly heritage hotel near East Gate.');

INSERT INTO capacity_slot (poi_id, circuit, entry_window, capacity_total, seats_taken, price_inr)
SELECT p.poi_id, v.circuit, v.entry_window, v.capacity_total, 0, v.price_inr
FROM poi p
JOIN (VALUES
    ('Batch 1 (20:30 - 21:00)', tstzrange('2026-12-18 20:30:00+05:30', '2026-12-18 21:00:00+05:30'), 50, 750.00),
    ('Batch 2 (21:00 - 21:30)', tstzrange('2026-12-18 21:00:00+05:30', '2026-12-18 21:30:00+05:30'), 50, 750.00),
    ('Batch 3 (21:30 - 22:00)', tstzrange('2026-12-18 21:30:00+05:30', '2026-12-18 22:00:00+05:30'), 4,  750.00),
    ('Batch 4 (22:00 - 22:30)', tstzrange('2026-12-18 22:00:00+05:30', '2026-12-18 22:30:00+05:30'), 50, 750.00)
) AS v(circuit, entry_window, capacity_total, price_inr)
ON p.name = 'Taj Mahal Night Viewing';

INSERT INTO capacity_slot (poi_id, circuit, entry_window, capacity_total, seats_taken, price_inr)
SELECT p.poi_id, v.circuit, v.entry_window, v.capacity_total, 0, v.price_inr
FROM poi p
JOIN (VALUES
    ('Morning Royal Circuit', tstzrange('2026-12-19 09:00:00+05:30', '2026-12-19 11:30:00+05:30'), 40, 550.00),
    ('Sunset Rampart Circuit', tstzrange('2026-12-19 16:00:00+05:30', '2026-12-19 18:00:00+05:30'), 30, 550.00)
) AS v(circuit, entry_window, capacity_total, price_inr)
ON p.name = 'Agra Fort Diwan-i-Khas Circuit';

INSERT INTO capacity_slot (poi_id, circuit, entry_window, capacity_total, seats_taken, price_inr)
SELECT p.poi_id, v.circuit, v.entry_window, v.capacity_total, 0, v.price_inr
FROM poi p
JOIN (VALUES
    ('Dawn Conservation Batch', tstzrange('2026-12-22 06:30:00+05:30', '2026-12-22 09:00:00+05:30'), 25, 600.00)
) AS v(circuit, entry_window, capacity_total, price_inr)
ON p.name = 'Hampi Vittala Temple Stone Chariot Slot';

INSERT INTO trip (organizer_id, title, travel_window, quorum_pct, status)
VALUES (
    (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'),
    'Agra & Taj Full-Moon Group Expedition',
    daterange('2026-12-18', '2026-12-21', '[]'),
    67,
    'PROPOSED'
);

INSERT INTO trip_member (trip_id, user_id, role, budget_ceiling, joining_city)
SELECT 1, user_id,
       CASE WHEN email = 'dilraj@yatra.local' THEN 'ORGANIZER' ELSE 'MEMBER' END,
       CASE WHEN email = 'dilraj@yatra.local' THEN 18000.00
            WHEN email = 'arya@yatra.local'   THEN 16500.00
            ELSE 15000.00 END,
       home_city
FROM app_user
WHERE email IN ('dilraj@yatra.local', 'arya@yatra.local', 'aarush@yatra.local');

INSERT INTO member_constraint (trip_id, user_id, kind, value, is_hard)
VALUES
(1, (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'), 'DIET', '{"preference": "vegetarian"}'::jsonb, TRUE),
(1, (SELECT user_id FROM app_user WHERE email = 'arya@yatra.local'),   'DEPARTURE_TIME', '{"earliest_departure": "2026-12-18T06:00:00+05:30"}'::jsonb, TRUE),
(1, (SELECT user_id FROM app_user WHERE email = 'aarush@yatra.local'), 'PACE', '{"max_activities_per_day": 3}'::jsonb, FALSE);

INSERT INTO itinerary (trip_id, version, status, summary)
VALUES (1, 1, 'PROPOSED', 'BLR-DEL morning flight, ITC Mughal check-in, and ASI Taj Mahal Night Viewing Batch 1.');

INSERT INTO itinerary_leg (itinerary_id, poi_id, slot_id, seq, kind, title, span, est_cost_inr, supplier_meta)
VALUES
(1,
 (SELECT poi_id FROM poi WHERE name LIKE 'BLR -> DEL%'),
 NULL, 1, 'FLIGHT', 'BLR to DEL Morning Flight (6E-2041)',
 tstzrange('2026-12-18 07:30:00+05:30', '2026-12-18 10:15:00+05:30'),
 5400.00, '{"airline": "IndiGo", "origin": "BLR", "destination": "DEL"}'::jsonb),
(1,
 (SELECT poi_id FROM poi WHERE name = 'ITC Mughal Agra Resort'),
 NULL, 2, 'HOTEL', 'ITC Mughal Agra — 2 Nights Heritage Wing',
 tstzrange('2026-12-18 14:00:00+05:30', '2026-12-18 17:00:00+05:30'),
 9600.00, '{"rooms": 2, "nights": 2, "meal_plan": "breakfast"}'::jsonb),
(1,
 (SELECT poi_id FROM poi WHERE name = 'Taj Mahal Night Viewing'),
 (SELECT slot_id FROM capacity_slot WHERE circuit = 'Batch 1 (20:30 - 21:00)' LIMIT 1),
 3, 'ATTRACTION', 'ASI Taj Mahal Night Viewing — Batch 1',
 tstzrange('2026-12-18 20:30:00+05:30', '2026-12-18 21:00:00+05:30'),
 2250.00, '{"asi_circuit": "Batch 1 (20:30 - 21:00)", "seats": 3}'::jsonb);

INSERT INTO leg_participant (leg_id, user_id)
SELECT il.leg_id, tm.user_id
FROM itinerary_leg il
CROSS JOIN trip_member tm
WHERE il.itinerary_id = 1 AND tm.trip_id = 1;

INSERT INTO proposal (trip_id, itinerary_id, raised_by, status)
VALUES (1, 1, (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'), 'OPEN');

INSERT INTO vote (proposal_id, user_id, choice)
VALUES (1, (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'), 'APPROVE');

BEGIN;
INSERT INTO expense (trip_id, payer_id, leg_id, description, amount, currency, fx_to_inr, rule)
VALUES (1, (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'), 1,
        'Delhi Airport to Agra Express Tempo Traveller Advance', 3000.00, 'INR', 1.0, 'EQUAL');

INSERT INTO ledger_entry (expense_id, trip_id, user_id, amount_inr)
VALUES
(currval('expense_expense_id_seq'), 1, (SELECT user_id FROM app_user WHERE email = 'dilraj@yatra.local'),  2000.00),
(currval('expense_expense_id_seq'), 1, (SELECT user_id FROM app_user WHERE email = 'arya@yatra.local'),   -1000.00),
(currval('expense_expense_id_seq'), 1, (SELECT user_id FROM app_user WHERE email = 'aarush@yatra.local'), -1000.00);
COMMIT;
