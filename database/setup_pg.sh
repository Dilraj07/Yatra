#!/bin/bash
set -e

echo "Starting PostgreSQL service..."
service postgresql start

echo "Setting up yatra user and fresh yatra_db..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='yatra'\"" | grep -q 1 || su - postgres -c "psql -c \"CREATE USER yatra WITH PASSWORD 'yatra_secret' SUPERUSER;\""
su - postgres -c "psql -c \"DROP DATABASE IF EXISTS yatra_db;\""
su - postgres -c "psql -c \"CREATE DATABASE yatra_db OWNER yatra;\""

echo "Configuring pg_hba.conf for trust on localhost..."
PG_HBA="/etc/postgresql/14/main/pg_hba.conf"
sed -i 's/local   all             all                                     peer/local   all             all                                     trust/' "$PG_HBA"
sed -i 's/host    all             all             127.0.0.1\/32            scram-sha-256/host    all             all             127.0.0.1\/32            trust/' "$PG_HBA"
sed -i 's/host    all             all             ::1\/128                 scram-sha-256/host    all             all             ::1\/128                 trust/' "$PG_HBA"
service postgresql restart

echo "Applying schema.sql..."
psql -h 127.0.0.1 -U yatra -d yatra_db -v ON_ERROR_STOP=1 -f /mnt/c/Users/Dillu/Desktop/EL/yatra-smart-tourism-complete/yatra-smart-tourism/database/schema.sql

echo "Applying seed.sql..."
psql -h 127.0.0.1 -U yatra -d yatra_db -v ON_ERROR_STOP=1 -f /mnt/c/Users/Dillu/Desktop/EL/yatra-smart-tourism-complete/yatra-smart-tourism/database/seed.sql

echo "PostgreSQL setup completed successfully."
