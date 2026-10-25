#!/usr/bin/env bash
# UAT: a stable copy of Civitas on its own port, so dev reloads (tsx watch, Vite HMR) never restart what Rich plays.
#
#   scripts/uat.sh promote [ref]   copy a commit (default HEAD; uncommitted work in the dev tree is left out) to
#                                   $UAT_DIR, check it, build, restart UAT (its world is kept)
#   scripts/uat.sh restart   restart UAT as it is
#   scripts/uat.sh stop | status | log
#
# UAT serves the built client and the game on one port (default 9080, http://<lan-ip>:9080/); its test cities
# listen on 9100+n and its world lives in $UAT_DIR/data, apart from dev (8080 / 8100+n / data/). It starts with WARM_DEMOS=london and KEEP_DEMOS=london (London warmed and kept running),
# so London is built (or rebuilt, when its scenario changed) and left running after every promote, not on the first visit.
set -euo pipefail
DEV_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UAT_DIR="${UAT_DIR:-$HOME/code/msimcity-uat}"
UAT_PORT="${UAT_PORT:-9080}"
PIDFILE="$UAT_DIR/uat.pid"
LOG="$UAT_DIR/uat.log"
# the address other machines reach this one on: the default route's interface (Wi-Fi or Ethernet, whichever is up)
LAN_IP="$(ipconfig getifaddr "$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')" 2>/dev/null || true)"
[[ -n "$LAN_IP" ]] || LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ -n "$LAN_IP" ]] || LAN_IP="$(hostname)"

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
  PORT="$UAT_PORT" HOST=0.0.0.0 NODE_ENV=uat WARM_DEMOS=london KEEP_DEMOS=london nohup npx tsx src/index.ts >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://127.0.0.1:$UAT_PORT/" && { echo "UAT up: http://$LAN_IP:$UAT_PORT/  ($(cat "$UAT_DIR/UAT_VERSION" 2>/dev/null))"; return 0; }
    running || { echo "UAT failed to start; tail of $LOG:"; tail -20 "$LOG"; return 1; }
    sleep 1
  done
  echo "UAT did not answer on :$UAT_PORT within 60 s; see $LOG"; return 1
}

promote() {
  local ref="${1:-HEAD}"
  cd "$DEV_DIR"
  local sha; sha="$(git rev-parse --short "$ref^{commit}")"
  echo "== exporting $ref ($sha) to $UAT_DIR"
  mkdir -p "$UAT_DIR/data"
  local lock_before=""; [[ -f "$UAT_DIR/package-lock.json" ]] && lock_before="$(shasum "$UAT_DIR/package-lock.json" | cut -d' ' -f1)"
  local stage; stage="$(mktemp -d)"
  git archive "$sha" | tar -x -C "$stage"
  rsync -a --delete \
    --exclude node_modules --exclude /data --exclude .git --exclude .idea --exclude dist \
    --exclude '*.log' --exclude uat.pid --exclude UAT_VERSION \
    "$stage/" "$UAT_DIR/"
  rm -rf "$stage"
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
  # checked here, on exactly what UAT will run; a failure leaves the running UAT alone
  echo "== checking $sha"
  npm run -s typecheck || { echo "typecheck failed; UAT not restarted"; exit 1; }
  npm run -s buildings:check >/dev/null || { echo "buildings:check failed; UAT not restarted"; exit 1; }
  echo "== building client"
  npm run -s build >/dev/null && npm run -s build:local >/dev/null
  echo "promoted $sha $(date '+%Y-%m-%d %H:%M')" >"$UAT_DIR/UAT_VERSION"
  stop
  start
}

case "${1:-status}" in
  promote) promote "${2:-HEAD}" ;;
  restart) stop; start ;;
  stop) stop ;;
  status) if running; then echo "UAT running (pid $(cat "$PIDFILE")) at http://$LAN_IP:$UAT_PORT/  $(cat "$UAT_DIR/UAT_VERSION" 2>/dev/null)"; else echo "UAT not running"; fi ;;
  log) tail -40 "$LOG" ;;
  *) echo "usage: $0 promote|restart|stop|status|log"; exit 2 ;;
esac
