export const IDENTITY_COMPARE_POINTS = [
  { id: "front-proportions", label: "Front proportions" },
  { id: "eye-position", label: "Eye position" },
  { id: "face-silhouette", label: "Face silhouette" },
  { id: "nose", label: "Nose" },
  { id: "mouth", label: "Mouth" },
  { id: "jawline", label: "Jawline" },
  { id: "cybernetic-details", label: "Cybernetic details" },
  { id: "lighting", label: "Lighting" },
] as const;

export const REFERENCE_IMAGE_URL = "/api/nova/reference-face";

export type IdentityCompareId = (typeof IDENTITY_COMPARE_POINTS)[number]["id"];

export type IdentityCompareState = Record<IdentityCompareId, "unreviewed" | "match" | "mismatch">;

export function emptyIdentityCompare(): IdentityCompareState {
  return {
    "front-proportions": "unreviewed",
    "eye-position": "unreviewed",
    "face-silhouette": "unreviewed",
    nose: "unreviewed",
    mouth: "unreviewed",
    jawline: "unreviewed",
    "cybernetic-details": "unreviewed",
    lighting: "unreviewed",
  };
}
