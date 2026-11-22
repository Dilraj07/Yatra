import psycopg

conn = psycopg.connect("postgresql://yatra:yatra_secret@localhost:5432/yatra_db")
cur = conn.cursor()

cur.execute("""
INSERT INTO trip (trip_id, organizer_id, title, travel_window, quorum_pct, status) 
VALUES (2, 2, 'Hampi Heritage & Boulder Trail', daterange('2026-12-22', '2026-12-26', '[]'), 60, 'PROPOSED')
ON CONFLICT (trip_id) DO NOTHING;

INSERT INTO trip_member (trip_id, user_id, role, budget_ceiling, joining_city) 
VALUES 
(2, 2, 'ORGANIZER', 14000.00, 'Bengaluru'),
(2, 1, 'MEMBER', 16000.00, 'Bengaluru'),
(2, 3, 'MEMBER', 15000.00, 'Delhi')
ON CONFLICT (trip_id, user_id) DO NOTHING;

SELECT setval('trip_trip_id_seq', (SELECT MAX(trip_id) FROM trip));
""")

conn.commit()
conn.close()
print("Trip 2 added cleanly!")

