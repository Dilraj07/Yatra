#!/bin/bash
# ============================================================
# Yatra — One-command demo startup script
# Run: bash start_demo.sh
# ============================================================

set -e
BASE="$(cd "$(dirname "$0")" && pwd)"
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   यात्रा Yatra — Demo Startup       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════╝${NC}"

# ── 1. Frontend (always works, no DB needed) ──────────────────
echo -e "\n${YELLOW}[1/3] Starting React frontend...${NC}"
pkill -f "vite" 2>/dev/null || true
sleep 1
cd "$BASE/frontend"
nohup npx vite --host 0.0.0.0 --port 5173 > /tmp/yatra_vite.log 2>&1 &
VITE_PID=$!
sleep 3
if lsof -i :5173 &>/dev/null; then
  echo -e "${GREEN}✅ Frontend running → http://localhost:5173${NC}"
else
  echo -e "${RED}❌ Frontend failed to start. Check /tmp/yatra_vite.log${NC}"
fi

# ── 2. PostgreSQL ─────────────────────────────────────────────
echo -e "\n${YELLOW}[2/3] Starting PostgreSQL...${NC}"
PG_BIN=""
for dir in \
  "/opt/homebrew/opt/postgresql@16/bin" \
  "/opt/homebrew/opt/postgresql@15/bin" \
  "/usr/local/bin" \
  "/Applications/Postgres.app/Contents/Versions/latest/bin"; do
  [ -f "$dir/pg_isready" ] && PG_BIN="$dir" && break
done

if [ -z "$PG_BIN" ]; then
  echo -e "${RED}❌ PostgreSQL not found.${NC}"
  echo -e "   Install: ${YELLOW}brew install postgresql@16 && brew services start postgresql@16${NC}"
  echo -e "   Or use Docker: ${YELLOW}docker compose up postgres mongo -d${NC}"
  POSTGRES_OK=false
else
  export PATH="$PG_BIN:$PATH"
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 2
  if pg_isready -q; then
    echo -e "${GREEN}✅ PostgreSQL running${NC}"
    # Create DB and load schema if needed
    createdb yatra_db 2>/dev/null || true
    psql yatra_db -c "SELECT 1 FROM app_user LIMIT 1" &>/dev/null || {
      echo "   Loading schema & seed data..."
      psql yatra_db < "$BASE/database/schema.sql" && \
      psql yatra_db < "$BASE/database/seed.sql" && \
      echo -e "${GREEN}   ✅ Database initialized${NC}"
    }
    POSTGRES_OK=true
  else
    echo -e "${RED}❌ PostgreSQL not responding${NC}"
    POSTGRES_OK=false
  fi
fi

# ── 3. Backend ────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/3] Starting FastAPI backend...${NC}"
pkill -f "uvicorn" 2>/dev/null || true
sleep 1

if $POSTGRES_OK; then
  cd "$BASE/backend"
  [ ! -f "$BASE/.env" ] && cp "$BASE/.env.example" "$BASE/.env"
  pip3 install -r requirements.txt -q

  export DATABASE_URL="postgresql://$(whoami)@localhost:5432/yatra_db"
  export MONGO_URL="mongodb://localhost:27017"
  export MONGO_DB="yatra_nosql"
  export JWT_SECRET="yatra-dev-jwt-secret"

  nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/yatra_backend.log 2>&1 &
  sleep 3
  if lsof -i :8000 &>/dev/null; then
    echo -e "${GREEN}✅ Backend running → http://localhost:8000/docs${NC}"
  else
    echo -e "${RED}❌ Backend failed. Check /tmp/yatra_backend.log${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Skipping backend (no PostgreSQL). Frontend runs in offline/mock mode.${NC}"
fi

# ── Summary ───────────────────────────────────────────────────
echo -e "\n${BLUE}════════════════════════════════════${NC}"
echo -e "${GREEN}🌐 Frontend:   http://localhost:5173${NC}"
if $POSTGRES_OK; then
  echo -e "${GREEN}🔌 API Docs:   http://localhost:8000/docs${NC}"
  echo -e "${GREEN}👤 Login:      arya@yatra.local / yatra123${NC}"
  echo -e "${GREEN}👤 Organizer:  dilraj@yatra.local / yatra123${NC}"
fi
echo -e "${BLUE}════════════════════════════════════${NC}"

# Open browser
sleep 1
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || true

