#!/usr/bin/env bash
# UAT: a stable copy of Civitas on its own port, so dev reloads (tsx watch, Vite HMR) never restart what Rich plays.
#
#   scripts/uat.sh promote   check the dev tree, copy it to $UAT_DIR, build, restart UAT (its world is kept)
#   scripts/uat.sh restart   restart UAT as it is
#   scripts/uat.sh stop | status | log
#
# UAT serves the built client and the game on one port (default 9080, http://<lan-ip>:9080/); its test cities
# listen on 9100+n and its world lives in $UAT_DIR/data, apart from dev (8080 / 8100+n / data/).
set -euo pipefail
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UAT_DIR="${UAT_DIR:-$HOME/code/msimcity-uat}"
UAT_PORT="${UAT_PORT:-9080}"
PIDFILE="$UAT_DIR/uat.pid"
LOG="$UAT_DIR/uat.log"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"

running() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

stop() {
  if running; then
    local pid; pid="$(cat "$PIDFILE")"
    # SIGINT: the server saves the world and stops its test cities (they ran the old code)
    kill -INT "$pid"
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$pid" 2>/dev/null && { echo "UAT pid $pid did not stop; killing"; kill -9 "$pid"; }
    echo "UAT stopped"
  fi
  rm -f "$PIDFILE"
}

start() {
  cd "$UAT_DIR/packages/server"
  PORT="$UAT_PORT" HOST=0.0.0.0 NODE_ENV=uat nohup npx tsx src/index.ts >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://127.0.0.1:$UAT_PORT/" && { echo "UAT up: http://$LAN_IP:$UAT_PORT/  ($(cat "$UAT_DIR/UAT_VERSION" 2>/dev/null))"; return 0; }
    running || { echo "UAT failed to start; tail of $LOG:"; tail -20 "$LOG"; return 1; }
    sleep 1
  done
  echo "UAT did not answer on :$UAT_PORT within 60 s; see $LOG"; return 1
}

promote() {
  cd "$DEV_DIR"
  echo "== checking dev tree"
  npm run -s typecheck
  npm run -s buildings:check >/dev/null || { echo "buildings:check failed; not promoting"; exit 1; }
  echo "== copying to $UAT_DIR"
  mkdir -p "$UAT_DIR/data"
  local lock_before=""; [[ -f "$UAT_DIR/package-lock.json" ]] && lock_before="$(shasum "$UAT_DIR/package-lock.json" | cut -d' ' -f1)"
  rsync -a --delete \
    --exclude node_modules --exclude /data --exclude .git --exclude .idea --exclude dist \
    --exclude '*.log' --exclude uat.pid --exclude UAT_VERSION \
    "$DEV_DIR/" "$UAT_DIR/"
  # first promote: start UAT from a copy of the dev world
  if [[ ! -f "$UAT_DIR/data/world.json" && -f "$DEV_DIR/data/world.json" ]]; then
    cp "$DEV_DIR/data/world.json" "$UAT_DIR/data/world.json"
    # and the pre-built test cities and demos, so the picker doesn't have to grow them from scratch
    for d in test-cities demos; do
      [[ -d "$DEV_DIR/data/$d" ]] && mkdir -p "$UAT_DIR/data/$d" && rsync -a --include '*.json' --exclude 'running.json' --exclude '*' "$DEV_DIR/data/$d/" "$UAT_DIR/data/$d/"
    done
  fi
  cd "$UAT_DIR"
  if [[ ! -d node_modules || "$lock_before" != "$(shasum package-lock.json | cut -d' ' -f1)" ]]; then
    echo "== installing dependencies"; npm ci --no-audit --no-fund >/dev/null
  fi
  echo "== building client"
  npm run -s build >/dev/null
  echo "promoted $(date '+%Y-%m-%d %H:%M')" >"$UAT_DIR/UAT_VERSION"
  stop
  start
}

case "${1:-status}" in
  promote) promote ;;
  restart) stop; start ;;
  stop) stop ;;
  status) if running; then echo "UAT running (pid $(cat "$PIDFILE")) at http://$LAN_IP:$UAT_PORT/  $(cat "$UAT_DIR/UAT_VERSION" 2>/dev/null)"; else echo "UAT not running"; fi ;;
  log) tail -40 "$LOG" ;;
  *) echo "usage: $0 promote|restart|stop|status|log"; exit 2 ;;
esac
