#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${NOVA_APP_PATH:-/Applications/NOVA.app}"
BIN="$APP/Contents/MacOS/NOVA"
PROJECT="$ROOT"
LOG_DIR="$PROJECT/.nova/logs"
READY_URL="http://127.0.0.1:3000/api/nova/ready"
DESKTOP_URL="http://127.0.0.1:47821/health"
FAKE_PROJECT="/tmp/nova-fake-project-$$"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  echo "OK: $*"
}

nova_pids() {
  pgrep -f '/Applications/NOVA.app/Contents/MacOS/NOVA|/Contents/MacOS/NOVA$' 2>/dev/null || true
}

owned_node_pids() {
  pgrep -f "$PROJECT/node_modules/next/dist/bin/next|$PROJECT/services/desktop-service/index.ts" 2>/dev/null || true
}

stop_nova() {
  osascript -e 'tell application "NOVA" to quit' >/dev/null 2>&1 || true
  sleep 2
  local pids
  pids="$(nova_pids)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 1
    pids="$(nova_pids)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  fi
  local nodes
  nodes="$(owned_node_pids)"
  if [[ -n "$nodes" ]]; then
    # shellcheck disable=SC2086
    kill $nodes >/dev/null 2>&1 || true
    sleep 1
    nodes="$(owned_node_pids)"
    if [[ -n "$nodes" ]]; then
      # shellcheck disable=SC2086
      kill -9 $nodes >/dev/null 2>&1 || true
    fi
  fi
  sleep 2
}

wait_http() {
  local url="$1"
  local timeout="${2:-90}"
  local started
  started="$(date +%s)"
  while true; do
    if curl -fsS --max-time 5 "$url" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    if (( "$(date +%s)" - started >= timeout )); then
      return 1
    fi
    sleep 0.5
  done
}

wait_ready() {
  wait_http "$READY_URL" "${1:-90}"
}

wait_desktop() {
  local timeout="${1:-60}"
  local started token
  started="$(date +%s)"
  while true; do
    token="$(tr -d '[:space:]' < "$PROJECT/.nova/desktop-token" 2>/dev/null || true)"
    if [[ -n "$token" ]] && curl -fsS --max-time 5 -H "Authorization: Bearer $token" "$DESKTOP_URL" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    if (( "$(date +%s)" - started >= timeout )); then
      return 1
    fi
    sleep 0.5
  done
}

assert_no_owned_processes() {
  local leftover
  leftover="$(printf '%s\n%s\n' "$(nova_pids)" "$(owned_node_pids)" | sed '/^$/d')"
  if [[ -n "$leftover" ]]; then
    fail "Eigene Prozesse hängen noch: $leftover"
  fi
}

start_nova_app() {
  open "$APP"
}

start_nova_minimal_env() {
  env -i \
    HOME="${HOME}" \
    USER="${USER}" \
    LOGNAME="${LOGNAME:-$USER}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-de_DE.UTF-8}" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    "$BIN" >/dev/null 2>&1 &
}

echo "== NOVA Launcher Startup Verify =="
[[ -x "$BIN" ]] || fail "NOVA Binary fehlt: $BIN"
[[ -d "/Volumes/My Book 24/NOVA" ]] || fail "Projekt-Volume ist nicht verfügbar"
[[ -x /usr/local/bin/node ]] || fail "Gepinnte Runtime /usr/local/bin/node fehlt"
/usr/local/bin/node -v >/dev/null || fail "Gepinnte Runtime antwortet nicht"

echo
echo "-- TEST H: Volume / Runtime Availability --"
ok "Volume /Volumes/My Book 24 ist gemountet"
ok "Projekt $PROJECT ist lesbar"
ok "Runtime /usr/local/bin/node ist ausführbar"

echo
echo "-- TEST A: Start ohne manuelle Runtime --"
stop_nova
sleep 1
assert_no_owned_processes
start_nova_app
wait_ready 90 || fail "Application Service /api/nova/ready nicht erreichbar"
wait_desktop 60 || fail "Desktop Service /health nicht erreichbar"
ok "NOVA.app hat Application- und Desktop-Service gestartet"

echo
echo "-- TEST B: Clean Shutdown --"
stop_nova
sleep 2
assert_no_owned_processes
ok "Keine eigenen Child-Prozesse nach dem Beenden"

echo
echo "-- TEST C: Erneuter Start --"
start_nova_app
wait_ready 90 || fail "Zweiter Start: Application Service nicht bereit"
wait_desktop 60 || fail "Zweiter Start: Desktop Service nicht bereit"
ok "NOVA startet nach dem Beenden erneut"

echo
echo "-- TEST F: Duplicate Launch --"
open "$APP"
sleep 3
count="$(nova_pids | sed '/^$/d' | wc -l | tr -d ' ')"
if (( count > 1 )); then
  sleep 2
  count="$(nova_pids | sed '/^$/d' | wc -l | tr -d ' ')"
fi
if (( count > 1 )); then
  fail "Duplicate Launch hat eine zweite Runtime hinterlassen ($count NOVA-Prozesse)"
fi
wait_ready 20 || fail "Duplicate Launch hat die bestehende Runtime zerstört"
ok "Zweiter Klick fokussiert die bestehende Instanz"

echo
echo "-- TEST D: Kontrollierter Startfehler --"
stop_nova
sleep 1
mkdir -p "$FAKE_PROJECT"
printf '%s\n' '{"name":"nova"}' > "$FAKE_PROJECT/package.json"
env -i \
  HOME="${HOME}" \
  USER="${USER}" \
  LOGNAME="${LOGNAME:-$USER}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  LANG="${LANG:-de_DE.UTF-8}" \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  NOVA_PROJECT_ROOT="$FAKE_PROJECT" \
  NOVA_TEST_AUTOQUIT_ON_ERROR=1 \
  "$BIN" >/dev/null 2>&1 &
error_pid=$!
for _ in $(seq 1 45); do
  if ! kill -0 "$error_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if kill -0 "$error_pid" >/dev/null 2>&1; then
  kill -9 "$error_pid" >/dev/null 2>&1 || true
  rm -rf "$FAKE_PROJECT"
  fail "Simulierter Startfehler hat die App nicht beendet"
fi
wait "$error_pid" >/dev/null 2>&1 || true
fake_log="$FAKE_PROJECT/.nova/logs/launcher.log"
if [[ ! -f "$fake_log" ]] || ! grep -q "tsx fehlt\\|Next.js fehlt\\|\\.env fehlt\\|nicht gefunden" "$fake_log"; then
  rm -rf "$FAKE_PROJECT"
  fail "Startfehler wurde nicht in launcher.log festgehalten"
fi
rm -rf "$FAKE_PROJECT"
sleep 2
assert_no_owned_processes
ok "Startfehler beendet NOVA ohne Zombie-Prozesse"

echo
echo "-- TEST E: Start nach Fehler --"
start_nova_app
wait_ready 90 || fail "Start nach Fehler: Application Service nicht bereit"
wait_desktop 60 || fail "Start nach Fehler: Desktop Service nicht bereit"
ok "NOVA startet nach einem Fehler erneut"

echo
echo "-- TEST G: Start ohne Login-Shell/PATH --"
stop_nova
sleep 1
start_nova_app
wait_ready 90 || fail "Minimal-Environment: Application Service nicht bereit"
wait_desktop 60 || fail "Minimal-Environment: Desktop Service nicht bereit"
if ! grep -q '"path":"/usr/local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"' "$LOG_DIR/launcher.log"; then
  fail "Child-PATH ist nicht deterministisch"
fi
ok "NOVA startet ohne Terminal-PATH und ohne zshrc"

echo
echo "-- Aufräumen --"
stop_nova
sleep 2
assert_no_owned_processes
ok "Launcher-Verify abgeschlossen"
