#!/bin/bash
# HireBoard — Start All Services
# Run this from the hireboard/ directory

set -e

PG_BIN="/Users/arpit/.homebrew/Cellar/postgresql@17/17.10/bin"
PG_DATA="/Users/arpit/.homebrew/var/postgresql@17"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting HireBoard..."
echo ""

# ─── 1. PostgreSQL ────────────────────────────────────────────────
echo "📦 Starting PostgreSQL..."
if $PG_BIN/pg_ctl -D "$PG_DATA" status > /dev/null 2>&1; then
  echo "   ✅ PostgreSQL already running"
else
  $PG_BIN/pg_ctl -D "$PG_DATA" -l "$PG_DATA/server.log" start
  sleep 2
  echo "   ✅ PostgreSQL started"
fi

# ─── 2. Backend ───────────────────────────────────────────────────
echo ""
echo "⚡ Starting Backend (port 5001)..."
cd "$SCRIPT_DIR/server"

# Kill anything on 5001
lsof -ti:5001 | xargs kill -9 2>/dev/null || true
sleep 1

node index.js &
BACKEND_PID=$!
sleep 2

# Health check
if curl -s http://localhost:5001/api/health > /dev/null 2>&1; then
  echo "   ✅ Backend running (PID $BACKEND_PID)"
else
  echo "   ❌ Backend failed to start — check server/.env"
  exit 1
fi

# ─── 3. Frontend ──────────────────────────────────────────────────
echo ""
echo "🎨 Starting Frontend (port 5173)..."
cd "$SCRIPT_DIR/client"

# Kill anything on 5173
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

npm run dev &
FRONTEND_PID=$!
sleep 3

echo "   ✅ Frontend running (PID $FRONTEND_PID)"

# ─── Done ─────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ HireBoard is fully running!"
echo ""
echo "  🌐 Frontend  →  http://localhost:5173"
echo "  ⚡ Backend   →  http://localhost:5001"
echo "  📦 Database  →  PostgreSQL (hireboard)"
echo "═══════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and cleanup on exit
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; $PG_BIN/pg_ctl -D $PG_DATA stop; echo 'All stopped.'" EXIT
wait
