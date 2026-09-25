export function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "artefakt";
}

export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function artifactFileName(input: {
  date: Date;
  organizationSlug: string;
  title: string;
  version: number;
  extension: string;
}): string {
  const version = String(Math.max(1, input.version)).padStart(2, "0");
  const extension = input.extension.replace(/^\./, "").toLowerCase() || "md";
  return `${localDay(input.date)}_${slugify(input.organizationSlug)}_${slugify(input.title)}_v${version}.${extension}`;
}

export function safeRelative(...parts: string[]): string {
  const clean = parts
    .flatMap((part) => part.split(/[/\\]+/))
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  if (!clean.length) {
    throw new Error("Relativer Workspace-Pfad ist leer.");
  }
  return clean.join("/");
}
