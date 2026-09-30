import fs from "node:fs";
import path from "node:path";

function loadProjectEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadProjectEnv();

async function main() {
  const { tickWorker, writeWorkerHeartbeat } = await import("@/services/worker/runtime");
  let stopping = false;
  const workerId = `nova-worker-${process.pid}`;

  function shutdown() {
    stopping = true;
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const { nachNeustart } = await import("@/services/kampagnen");
  const { tagesbetriebNachNeustart } = await import("@/services/tagesbetrieb/start");
  try {
    await nachNeustart();
    await tagesbetriebNachNeustart();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Kampagnen-Neustart fehlgeschlagen");
  }

  writeWorkerHeartbeat();
  const heartbeat = setInterval(() => writeWorkerHeartbeat(), 5_000);

  while (!stopping) {
    try {
      await tickWorker(workerId);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Worker-Tick fehlgeschlagen");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  clearInterval(heartbeat);
  process.exit(0);
}

void main();
