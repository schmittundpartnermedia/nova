/**
 * Umzug der Daten: SQLite (alte NOVA auf dem Mac) → Postgres (DATABASE_URL).
 * Aufruf: tsx scripts/umzug-daten.ts <pfad/zur/kopie.db>
 * Die Quelle wird nur gelesen (am besten eine Kopie per `sqlite3 dev.db ".backup kopie.db"`).
 * Das Ziel muss leer sein (frisch migriert). Alles in einer Transaktion: entweder alles oder nichts.
 * Fremdschlüssel werden während des Einspielens ausgesetzt (session_replication_role = replica, braucht
 * einen Datenbank-Superuser) – die Daten kommen ja aus einer Datenbank, in der sie schon stimmten.
 * Danach: Zeilen je Tabelle verglichen; jede Abweichung ist ein Fehler.
 */
import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";

type Feld = Prisma.DMMF.Field;
// node:sqlite (Node ≥ 22.13) – die installierten Node-Typen kennen es noch nicht.
type SqliteDb = { prepare(sql: string): { all(): unknown[]; get(): unknown } };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (pfad: string, optionen: { readOnly: boolean }) => SqliteDb;
};

async function main() {
  const quelle = process.argv[2];
  if (!quelle) throw new Error("Pfad zur SQLite-Kopie fehlt.");
  if (!process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("DATABASE_URL zeigt nicht auf Postgres.");
  const alt = new DatabaseSync(quelle, { readOnly: true });
  const prisma = new PrismaClient();
  const modelle = Prisma.dmmf.datamodel.models;

  const tabellen = new Set(
    (alt.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>).map((r) => r.name),
  );

  const bericht: Array<{ tabelle: string; alt: number; neu: number }> = [];
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      for (const modell of modelle) {
        const tabelle = modell.dbName ?? modell.name;
        const vorhanden = (await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${tabelle}"`))[0]!.n;
        if (vorhanden > BigInt(0)) throw new Error(`Ziel nicht leer: ${tabelle} hat ${vorhanden} Zeilen.`);
        if (!tabellen.has(tabelle)) {
          bericht.push({ tabelle, alt: 0, neu: 0 });
          continue;
        }
        const spalten = modell.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
        const zeilen = alt.prepare(`select * from "${tabelle}"`).all() as Array<Record<string, unknown>>;
        const daten = zeilen.map((zeile) => {
          const neu: Record<string, unknown> = {};
          for (const feld of spalten) {
            const spalte = feld.dbName ?? feld.name;
            if (!(spalte in zeile)) continue;
            neu[feld.name] = wandle(feld, zeile[spalte]);
          }
          return neu;
        });
        const delegat = (tx as unknown as Record<string, { createMany(a: { data: unknown[] }): Promise<{ count: number }> }>)[
          modell.name.charAt(0).toLowerCase() + modell.name.slice(1)
        ]!;
        for (let i = 0; i < daten.length; i += 500) await delegat.createMany({ data: daten.slice(i, i + 500) });
        const neu = Number((await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${tabelle}"`))[0]!.n);
        bericht.push({ tabelle, alt: zeilen.length, neu });
        if (neu !== zeilen.length) throw new Error(`${tabelle}: ${zeilen.length} gelesen, ${neu} geschrieben.`);
        // Inhalt prüfen: jede Zeile über ihre ID zurücklesen und Feld für Feld vergleichen.
        const id = spalten.find((f) => f.isId);
        if (id && zeilen.length) {
          const zurueck = (await (tx as unknown as Record<string, { findMany(): Promise<Array<Record<string, unknown>>> }>)[
            modell.name.charAt(0).toLowerCase() + modell.name.slice(1)
          ]!.findMany()) as Array<Record<string, unknown>>;
          const nachId = new Map(zurueck.map((z) => [String(z[id.name]), z]));
          for (const vorher of daten) {
            const nachher = nachId.get(String(vorher[id.name]));
            if (!nachher) throw new Error(`${tabelle}: Zeile ${String(vorher[id.name])} fehlt.`);
            for (const [feld, wert] of Object.entries(vorher)) {
              if (!gleich(wert, nachher[feld])) {
                throw new Error(`${tabelle}.${feld} (Zeile ${String(vorher[id.name])}): ${String(wert)} ≠ ${String(nachher[feld])}`);
              }
            }
          }
        }
      }
    },
    { timeout: 15 * 60_000, maxWait: 60_000 },
  );

  // Tabellen in der Quelle, die das Schema nicht kennt, werden nicht stillschweigend übergangen.
  const bekannt = new Set(modelle.map((m) => m.dbName ?? m.name));
  const fremd = [...tabellen].filter((t) => !bekannt.has(t) && !t.startsWith("sqlite_") && t !== "_prisma_migrations");
  for (const t of fremd) {
    const n = (alt.prepare(`select count(*) as n from "${t}"`).get() as { n: number }).n;
    if (n > 0) throw new Error(`Tabelle ${t} (${n} Zeilen) steht nicht im Schema – nichts übernommen? Prüfen.`);
  }

  const gesamt = bericht.reduce((s, b) => s + b.neu, 0);
  for (const b of bericht.filter((b) => b.alt > 0)) console.log(`${b.tabelle.padEnd(32)} ${String(b.neu).padStart(6)}`);
  console.log(`ERGEBNIS: ${bericht.filter((b) => b.alt > 0).length} Tabellen, ${gesamt} Zeilen übernommen; Zählung und jedes Feld jeder Zeile gleich.`);
  await prisma.$disconnect();
}

function gleich(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === "bigint" || typeof b === "bigint") return String(a) === String(b);
  return a === b || (a == null && b == null);
}

function wandle(feld: Feld, wert: unknown): unknown {
  if (wert === null || wert === undefined) return null;
  switch (feld.type) {
    case "DateTime":
      // Prisma speichert in SQLite Millisekunden seit 1970 (ältere Zeilen evtl. als Text).
      return typeof wert === "number" || typeof wert === "bigint" ? new Date(Number(wert)) : new Date(String(wert));
    case "Boolean":
      return wert === 1 || wert === BigInt(1) || wert === true || wert === "1" || wert === "true";
    case "Int":
      return Number(wert);
    case "BigInt":
      return BigInt(wert as number);
    case "Float":
      return Number(wert);
    default:
      return wert;
  }
}

main().catch((error) => {
  console.error(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
