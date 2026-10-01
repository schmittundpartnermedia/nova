#!/usr/bin/env bash
# Steuerung der NOVA auf dem Server vom Mac aus. Meldet sich als Benutzer „nova“ an (kein root).
# Betrifft nur NOVAs eigenes pm2 – die Live-Seiten (pm2 von root) bleiben unberührt.
#
#   scripts/server/nova.sh status     – läuft alles?
#   scripts/server/nova.sh logs       – Protokoll live (Strg+C beendet)
#   scripts/server/nova.sh stop       – Notschalter: alles von NOVA anhalten
#   scripts/server/nova.sh start      – wieder starten
#   scripts/server/nova.sh oeffnen    – NOVA im Browser auf dem Mac öffnen (sichere Verbindung über SSH)
set -euo pipefail

SERVER="${NOVA_SERVER:-nova@87.106.179.99}"
PORT_LOKAL="${NOVA_PORT_LOKAL:-3200}"

case "${1:-status}" in
  status) ssh "$SERVER" 'pm2 ls' ;;
  logs) ssh -t "$SERVER" 'pm2 logs --lines 50' ;;
  stop) ssh "$SERVER" 'pm2 stop all && pm2 ls' ;;
  start) ssh "$SERVER" 'pm2 start all && pm2 ls' ;;
  oeffnen)
    echo "NOVA ist erreichbar unter http://127.0.0.1:${PORT_LOKAL} – solange dieses Fenster offen ist (Strg+C beendet)."
    (sleep 2 && open "http://127.0.0.1:${PORT_LOKAL}") &
    ssh -N -L "${PORT_LOKAL}:127.0.0.1:3100" "$SERVER"
    ;;
  *)
    echo "Befehle: status | logs | stop | start | oeffnen" >&2
    exit 1
    ;;
esac
