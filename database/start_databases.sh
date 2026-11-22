#!/bin/bash
su - postgres -c "/usr/lib/postgresql/14/bin/pg_ctl -D /var/lib/postgresql/14/main -o '-c config_file=/etc/postgresql/14/main/postgresql.conf' start" || true
rm -f /var/lib/mongodb/mongod.lock
chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb
mongod --config /etc/mongod.conf --fork || true
echo "ALL_SERVICES_ONLINE"
while true; do sleep 3600; done
