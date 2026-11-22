#!/bin/bash
set -e
echo "listen_addresses = '*'" >> /etc/postgresql/14/main/postgresql.conf
echo "host all all 0.0.0.0/0 trust" >> /etc/postgresql/14/main/pg_hba.conf
echo "host all all ::0/0 trust" >> /etc/postgresql/14/main/pg_hba.conf
service postgresql restart
echo "POSTGRES_RESTARTED"

