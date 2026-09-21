import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const path = resolve(process.cwd(), "reference/nova-face.webp");
  const bytes = await readFile(path);
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=3600",
      "X-Nova-Role": "identity-reference-not-runtime-face",
    },
  });
}
