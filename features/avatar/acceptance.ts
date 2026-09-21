import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";

/** Canonical production asset. Never the Development Rig. */
export const PRODUCTION_AVATAR_PATH = "public/nova/avatar/nova.glb";
export const PRODUCTION_AVATAR_URL = "/nova/avatar/nova.glb";
export const PRODUCTION_MANIFEST_PATH = "public/nova/avatar/manifest.json";
export const PRODUCTION_MANIFEST_URL = "/nova/avatar/manifest.json";

export const DEVELOPMENT_RIG_PATH = "public/nova/dev-rig/nova-dev-rig.glb";
export const DEVELOPMENT_RIG_URL = "/nova/dev-rig/nova-dev-rig.glb";

export const REQUIRED_BONES = ["Head", "Neck", "Jaw", "LeftEye", "RightEye"] as const;

export const REQUIRED_MESH_HINTS = [
  "head",
  "eye",
  "teeth",
  "tongue",
  "mouth",
  "neck",
] as const;

export const IDENTITY_COMPARE_POINTS = [
  "front proportions",
  "eye position",
  "face silhouette",
  "nose",
  "mouth",
  "jawline",
  "cybernetic details",
  "lighting",
] as const;

export const PERFORMANCE_BUDGET = {
  trianglesLod0: { min: 20_000, max: 120_000 },
  drawCalls: { max: 24 },
  textureMemoryMb: { max: 120 },
  glbBytes: { max: 80 * 1024 * 1024 },
  morphTargets: { min: 52, max: 120 },
  gpuFrameMs: { target: 16.6 },
  fps: { target: 60 },
} as const;

export const REQUIRED_BLENDSHAPES = NOVA_BLENDSHAPE_NAMES;

export type AcceptanceCheckId =
  | "file_exists"
  | "glb_readable"
  | "mesh_present"
  | "morph_targets_present"
  | "required_blendshapes"
  | "skeleton_present"
  | "head_bone"
  | "neck_bone"
  | "jaw_bone"
  | "left_eye"
  | "right_eye"
  | "materials_present"
  | "eyes_present"
  | "mouth_interior"
  | "teeth"
  | "tongue"
  | "scale_plausible"
  | "bounding_box_plausible"
  | "morph_changes_geometry"
  | "not_development_rig"
  | "textures_present"
  | "identity_extras";

export const PRODUCTION_ACCEPTANCE_CHECKS: Array<{ id: AcceptanceCheckId; label: string }> = [
  { id: "file_exists", label: "File exists at public/nova/avatar/nova.glb" },
  { id: "glb_readable", label: "GLB readable (glTF 2.0 binary)" },
  { id: "mesh_present", label: "Mesh vorhanden" },
  { id: "morph_targets_present", label: "Morph Targets vorhanden" },
  { id: "required_blendshapes", label: "52 ARKit-Blendshapes vorhanden" },
  { id: "skeleton_present", label: "Skeleton vorhanden" },
  { id: "head_bone", label: "Head Bone vorhanden" },
  { id: "neck_bone", label: "Neck Bone vorhanden" },
  { id: "jaw_bone", label: "Jaw Bone vorhanden" },
  { id: "left_eye", label: "LeftEye vorhanden" },
  { id: "right_eye", label: "RightEye vorhanden" },
  { id: "materials_present", label: "Materials vorhanden" },
  { id: "eyes_present", label: "Eye Meshes vorhanden" },
  { id: "mouth_interior", label: "Mouth Interior vorhanden" },
  { id: "teeth", label: "Teeth vorhanden" },
  { id: "tongue", label: "Tongue vorhanden" },
  { id: "scale_plausible", label: "Scale plausibel (Meter, Human)" },
  { id: "bounding_box_plausible", label: "Bounding Box plausibel" },
  { id: "morph_changes_geometry", label: "Morph Targets verändern Geometrie" },
  { id: "not_development_rig", label: "Kein Development-Rig-Marker" },
  { id: "textures_present", label: "PBR-Texturen eingebettet" },
  { id: "identity_extras", label: "novaIdentity=NOVA, nicht Development" },
];
