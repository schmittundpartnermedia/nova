#!/usr/bin/env bash
# Bringt den NOVA-Code vom Mac auf den Server (als Benutzer „nova“): übertragen, Pakete, Datenbankschema, bauen, neu starten.
# Startet nur Prozesse neu, die schon laufen (der Hintergrund-Läufer wird hier nie von selbst gestartet).
# Übertragen wird der Arbeitsstand dieses Ordners – ohne .env, node_modules, Build und Mac-Teile.
set -euo pipefail
SERVER="${NOVA_SERVER:-nova@87.106.179.99}"
cd "$(dirname "$0")/../.."
rsync -a --delete \
  --exclude='node_modules' --exclude='.next' --exclude='.env' --exclude='.env.*' --exclude='.git' \
  --exclude='.DS_Store' --exclude='.nova' --exclude='macos/build' --exclude='services/desktop-service/native/bin' \
  ./ "$SERVER:nova/"
ssh "$SERVER" 'set -e; cd ~/nova
npm install --no-audit --no-fund 2>&1 | tail -1
npx prisma generate 2>&1 | grep -i "generated" || true
npx prisma migrate deploy 2>&1 | tail -1
npx next build 2>&1 | tail -3
for name in $(pm2 jlist | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status===\"online\").map(p=>p.name).join(\" \")))"); do
  pm2 restart ecosystem.config.cjs --only "$name" --update-env >/dev/null && echo "neu gestartet: $name"
done
pm2 ls'
