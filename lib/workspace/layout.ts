import type { ArtifactType } from "@/types/workspace";
import { safeRelative, slugify } from "@/lib/workspace/naming";

export const SYSTEM_DIRECTORIES = [
  "NOVA/Knowledge",
  "NOVA/Archive",
  "NOVA/Imports",
  "NOVA/Exports",
  "NOVA/Work",
] as const;

export function directoryForArtifact(input: {
  type: ArtifactType;
  organizationSlug: string;
  projectSlug?: string | null;
}): string {
  const org = slugify(input.organizationSlug);
  const project = input.projectSlug ? slugify(input.projectSlug) : "";
  switch (input.type) {
    case "RESEARCH_REPORT":
    case "BRIEFING":
    case "ANALYSIS":
      return safeRelative("NOVA", "Work", org, "Recherche");
    case "DOCUMENT":
      return project ? safeRelative("Projekte", org, project) : safeRelative("Unternehmen", org, "Recherche");
    case "LEAD_LIST":
      return safeRelative("Leads", org);
    case "MAIL_DRAFT":
      return safeRelative("Unternehmen", org, "Mail");
    case "CODING_BRIEF":
      return safeRelative("Entwicklung", "Services", org);
    case "STORYBOARD":
    case "VIDEO_CLIP":
      return safeRelative("Medien", "Video", org);
    case "IMAGE":
      return safeRelative("Medien", "Bilder", org);
    case "AUDIO":
      return safeRelative("Medien", "Audio", org);
    case "EXPORT":
      return safeRelative("NOVA", "Exports", org);
    case "OTHER":
      return safeRelative("NOVA", "Work", org);
    default:
      return safeRelative("NOVA", "Work", org);
  }
}
