import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Wegwerf-Postgres für Tests und Nachweise: eigener Datenbank-Cluster in einem temporären Ordner,
 * nur über eine Unix-Socket-Datei erreichbar (kein Netzwerk-Port), wird beim Prozessende beendet und gelöscht.
 * Fasst keine andere Datenbank an. Braucht initdb/pg_ctl (PostgreSQL 16) im PATH oder NOVA_PG_BIN.
 */
export function wegwerfDatenbank(): string {
  const bin = (name: string) => (process.env.NOVA_PG_BIN ? path.join(process.env.NOVA_PG_BIN, name) : name);
  // Kurzer Pfad: Unix-Sockets dürfen auf macOS höchstens ~100 Zeichen lang sein.
  const ordner = fs.mkdtempSync("/tmp/nvpg-");
  const daten = path.join(ordner, "daten");
  const lauf = (befehl: string, args: string[]) => {
    // macOS: ohne gesetztes LC_ALL bricht der Start ab („postmaster became multithreaded during startup“).
    const r = spawnSync(bin(befehl), args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    if (r.status !== 0) throw new Error(`${befehl} fehlgeschlagen: ${r.stderr || r.stdout || r.error?.message}`);
  };
  let pid = 0;
  // Auch bei einem Fehlschlag beim Start wird aufgeräumt.
  process.on("exit", () => {
    if (pid) {
      try {
        process.kill(pid, "SIGQUIT");
      } catch {
        // schon beendet
      }
    }
    spawnSync("rm", ["-rf", ordner]);
  });
  lauf("initdb", ["-D", daten, "-U", "nova", "--auth=trust", "--no-sync", "-E", "UTF8", "--locale=C"]);
  lauf("pg_ctl", ["-D", daten, "-l", path.join(ordner, "log"), "-w", "-o", `-c listen_addresses='' -k ${ordner} -c fsync=off -c full_page_writes=off`, "start"]);
  pid = Number(fs.readFileSync(path.join(daten, "postmaster.pid"), "utf8").split("\n")[0]);
  const url = `postgresql://nova@localhost/postgres?host=${ordner}`;
  process.env.DATABASE_URL = url;
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(`Wegwerf-Datenbank: Schema nicht angelegt:\n${push.stderr || push.stdout}`);
  return url;
}
