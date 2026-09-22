#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { getCurrentTenant } from "@/services/tenant";
import { importChatGPTExport } from "@/services/import/chatgpt";

async function main() {
  const fileArg = process.argv.find((item, index) => process.argv[index - 1] === "--file") ?? process.argv[2];
  if (!fileArg) {
    console.error("Nutzung: npm run import:chatgpt -- --file /pfad/zu/chatgpt-export.zip");
    process.exitCode = 1;
    return;
  }
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`Datei nicht gefunden: ${filePath}`);
    process.exitCode = 1;
    return;
  }
  const tenant = await getCurrentTenant();
  const result = await importChatGPTExport({
    organizationId: tenant.organizationId,
    userRequest: `Importiere ChatGPT-Verlauf ${filePath}`,
    filePath,
  });
  console.log(result.reply);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
