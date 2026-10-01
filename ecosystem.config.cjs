// pm2-Prozesse von NOVA auf dem Server (Benutzer „nova“, eigenes pm2 – getrennt von den Live-Seiten).
// TZ fest auf deutsche Zeit: Der Server läuft in UTC; Termine, Tagesbetrieb (08–17 Uhr) und „heute“ rechnen in deutscher Zeit.
const gemeinsam = { cwd: __dirname, env: { NODE_ENV: "production", TZ: "Europe/Berlin" }, max_restarts: 20, restart_delay: 5000 };

module.exports = {
  apps: [
    { name: "nova-web", script: "npm", args: "run start", ...gemeinsam },
    // Hintergrund-Läufer: erst beim Umschalten starten (sonst laufen Mac und Server gleichzeitig und Mails gingen doppelt).
    { name: "nova-worker", script: "npm", args: "run worker", autorestart: true, ...gemeinsam },
  ],
};
