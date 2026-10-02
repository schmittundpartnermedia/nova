#!/usr/bin/env bash
# Nächtliche Sicherung von NOVA auf dem Server (läuft als Benutzer „nova“ per crontab, ohne root).
# Sichert: NOVA-Datenbank (pg_dump), ~/Nova (Gedächtnis, Vorlagen, Listen, Zustand, Geheimnisse), ~/projekte (ohne node_modules).
# Ablage: ~/sicherung/<datum>/, 14 Tage aufbewahrt. Außer Haus: das IONOS-Acronis-Backup (ganze Platte, 01:06 UTC) nimmt sie mit.
set -euo pipefail
export TZ=Europe/Berlin
umask 077
ZIEL="$HOME/sicherung/$(date +%Y-%m-%d)"
mkdir -p "$ZIEL"
log() { echo "[$(date '+%F %T')] $*" >> "$HOME/sicherung/sicherung.log"; }

log "Start"
pg_dump -h /var/run/postgresql -p 5433 -d nova -Fc -f "$ZIEL/nova.dump"
tar -czf "$ZIEL/nova-daten.tar.gz" -C "$HOME" Nova
tar -czf "$ZIEL/projekte.tar.gz" -C "$HOME" --exclude=node_modules --exclude=.next --exclude=dist projekte
# Prüfen statt hoffen: Dump lesbar, Archive lesbar.
pg_restore -l "$ZIEL/nova.dump" > /dev/null
tar -tzf "$ZIEL/nova-daten.tar.gz" > /dev/null
tar -tzf "$ZIEL/projekte.tar.gz" > /dev/null
log "OK $ZIEL ($(du -sh "$ZIEL" | cut -f1))"
find "$HOME/sicherung" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
