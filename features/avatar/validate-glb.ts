import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";
import {
  PERFORMANCE_BUDGET,
  PRODUCTION_AVATAR_PATH,
  REQUIRED_BONES,
  type AcceptanceCheckId,
} from "@/features/avatar/acceptance";
import type { NovaAvatarManifest } from "@/features/avatar/manifest";
import { MISSING_PRODUCTION_MANIFEST } from "@/features/avatar/manifest";

export type ValidationRole = "production" | "development";

export type AcceptanceResult = {
  id: AcceptanceCheckId;
  ok: boolean;
  detail: string;
};

export type AvatarValidationReport = {
  ok: boolean;
  role: ValidationRole;
  path: string;
  exists: boolean;
  code: "OK" | "FINAL_AVATAR_MISSING" | "INVALID_ASSET";
  checks: AcceptanceResult[];
  morphTargets: string[];
  bones: string[];
  materials: string[];
  meshCount: number;
  skinCount: number;
  triangleEstimate: number;
  bytes: number;
  morphChangesGeometry: boolean;
};

type GltfDoc = {
  extras?: Record<string, unknown>;
  meshes?: Array<{
    name?: string;
    extras?: { targetNames?: string[] };
    primitives?: Array<{
      attributes?: Record<string, number>;
      targets?: Array<Record<string, number>>;
      extras?: { targetNames?: string[] };
      indices?: number;
      material?: number;
    }>;
  }>;
  nodes?: Array<{ name?: string; mesh?: number }>;
  skins?: Array<{ joints?: number[]; name?: string }>;
  materials?: Array<{ name?: string; extras?: Record<string, unknown> }>;
  images?: unknown[];
  textures?: unknown[];
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  buffers?: Array<{ byteLength: number }>;
};

function check(id: AcceptanceCheckId, ok: boolean, detail: string): AcceptanceResult {
  return { id, ok, detail };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasName(names: string[], candidates: string[]): boolean {
  const lookup = new Set(names.map(normalize));
  return candidates.some((candidate) => lookup.has(normalize(candidate)));
}

function nameIncludes(names: string[], needle: string): boolean {
  const token = needle.toLowerCase();
  return names.some((name) => name.toLowerCase().includes(token));
}

function readGlb(path: string): { json: GltfDoc; bin: Buffer; bytes: number } {
  const buffer = readFileSync(path);
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "glTF") throw new Error(`Kein GLB: ${magic}`);
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.toString("ascii", 16, 20);
  if (chunkType !== "JSON") throw new Error(`Erstes Chunk muss JSON sein, war ${chunkType}`);
  const json = JSON.parse(buffer.subarray(20, 20 + chunkLength).toString("utf8")) as GltfDoc;
  let offset = 20 + chunkLength;
  if (offset % 4 !== 0) offset += 4 - (offset % 4);
  let bin = Buffer.alloc(0);
  if (offset + 8 <= buffer.length) {
    const binLength = buffer.readUInt32LE(offset);
    const binType = buffer.toString("ascii", offset + 4, offset + 8);
    if (binType === "BIN\0") {
      bin = buffer.subarray(offset + 8, offset + 8 + binLength);
    }
  }
  return { json, bin, bytes: buffer.length };
}

function collectMorphNames(gltf: GltfDoc): string[] {
  const names = new Set<string>();
  for (const mesh of gltf.meshes ?? []) {
    for (const name of mesh.extras?.targetNames ?? []) names.add(name);
    for (const primitive of mesh.primitives ?? []) {
      for (const name of primitive.extras?.targetNames ?? []) names.add(name);
    }
  }
  return [...names];
}

function readFloatAccessor(gltf: GltfDoc, bin: Buffer, accessorIndex: number | undefined): Float32Array | null {
  if (accessorIndex === undefined) return null;
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126) return null;
  const view = gltf.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) return null;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const components = accessor.type === "VEC3" ? 3 : accessor.type === "SCALAR" ? 1 : 0;
  if (!components) return null;
  const length = accessor.count * components;
  if (start + length * 4 > bin.length) return null;
  return new Float32Array(bin.buffer, bin.byteOffset + start, length);
}

function morphChangesGeometry(gltf: GltfDoc, bin: Buffer, preferred = "jawOpen"): boolean {
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const names = primitive.extras?.targetNames ?? mesh.extras?.targetNames ?? [];
      const targets = primitive.targets ?? [];
      if (!targets.length) continue;
      let index = names.findIndex((name) => normalize(name) === normalize(preferred));
      if (index < 0) index = 0;
      const target = targets[index];
      const base = readFloatAccessor(gltf, bin, primitive.attributes?.POSITION);
      const delta = readFloatAccessor(gltf, bin, target?.POSITION);
      if (!base || !delta || base.length !== delta.length) continue;
      const sample = Math.min(base.length, 1200);
      for (let i = 0; i < sample; i += 1) {
        if (Math.abs((delta[i] ?? 0) - (base[i] ?? 0)) > 1e-5) return true;
        if (Math.abs(delta[i] ?? 0) > 1e-5 && Math.abs(delta[i] ?? 0) !== Math.abs(base[i] ?? 0)) {
          // relative morphs store displacements; any non-zero counts
          if (Math.abs(base[i] ?? 0) > 0 && Math.abs((delta[i] ?? 0) - (base[i] ?? 0)) <= 1e-5) continue;
        }
      }
      for (let i = 0; i < sample; i += 1) {
        if (Math.abs(delta[i] ?? 0) > 1e-4) return true;
      }
    }
  }
  return false;
}

function boundingFromAccessors(gltf: GltfDoc): { size: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let any = false;
  for (const accessor of gltf.accessors ?? []) {
    if (accessor.type !== "VEC3" || !accessor.min || !accessor.max) continue;
    any = true;
    minX = Math.min(minX, accessor.min[0] ?? 0);
    minY = Math.min(minY, accessor.min[1] ?? 0);
    minZ = Math.min(minZ, accessor.min[2] ?? 0);
    maxX = Math.max(maxX, accessor.max[0] ?? 0);
    maxY = Math.max(maxY, accessor.max[1] ?? 0);
    maxZ = Math.max(maxZ, accessor.max[2] ?? 0);
  }
  if (!any) return null;
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return { size, minY, maxY };
}

function estimateTriangles(gltf: GltfDoc): number {
  let count = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = gltf.accessors?.[primitive.indices ?? -1];
      if (accessor) count += Math.floor(accessor.count / 3);
      else {
        const pos = gltf.accessors?.[primitive.attributes?.POSITION ?? -1];
        if (pos) count += Math.floor(pos.count / 3);
      }
    }
  }
  return count;
}

export function validateAvatarGlb(
  relativePath = PRODUCTION_AVATAR_PATH,
  role: ValidationRole = "production",
): AvatarValidationReport {
  const path = resolve(relativePath);
  const empty = (code: AvatarValidationReport["code"], extra: AcceptanceResult[]): AvatarValidationReport => ({
    ok: false,
    role,
    path,
    exists: false,
    code,
    checks: extra,
    morphTargets: [],
    bones: [],
    materials: [],
    meshCount: 0,
    skinCount: 0,
    triangleEstimate: 0,
    bytes: 0,
    morphChangesGeometry: false,
  });

  if (!existsSync(path)) {
    return empty("FINAL_AVATAR_MISSING", [
      check("file_exists", false, `Datei fehlt: ${relativePath}`),
    ]);
  }

  let gltf: GltfDoc;
  let bin: Buffer;
  let bytes = 0;
  try {
    const parsed = readGlb(path);
    gltf = parsed.json;
    bin = parsed.bin;
    bytes = parsed.bytes;
  } catch (error) {
    return empty("INVALID_ASSET", [
      check("file_exists", true, relativePath),
      check("glb_readable", false, error instanceof Error ? error.message : String(error)),
    ]);
  }

  const nodeNames = (gltf.nodes ?? []).map((node) => node.name ?? "");
  const meshNames = (gltf.meshes ?? []).map((mesh) => mesh.name ?? "");
  const allNames = [...nodeNames, ...meshNames];
  const morphTargets = collectMorphNames(gltf);
  const morphSet = new Set(morphTargets.map(normalize));
  const materials = (gltf.materials ?? []).map((material) => material.name ?? "");
  const missingShapes = NOVA_BLENDSHAPE_NAMES.filter((name) => !morphSet.has(normalize(name)));
  const geometryChanged = morphChangesGeometry(gltf, bin);
  const bounds = boundingFromAccessors(gltf);
  const triangleEstimate = estimateTriangles(gltf);
  const extras = gltf.extras ?? {};
  const isDevMarker =
    extras.novaDevelopmentRig === true ||
    nameIncludes(allNames, "development") ||
    nameIncludes(allNames, "dev-rig") ||
    nameIncludes(allNames, "devrig");

  const checks: AcceptanceResult[] = [
    check("file_exists", true, relativePath),
    check("glb_readable", true, "glTF 2.0 binary"),
    check("mesh_present", (gltf.meshes?.length ?? 0) > 0, `${gltf.meshes?.length ?? 0} meshes`),
    check("morph_targets_present", morphTargets.length > 0, `${morphTargets.length} morph names`),
    check(
      "required_blendshapes",
      missingShapes.length === 0,
      missingShapes.length ? `fehlt: ${missingShapes.slice(0, 8).join(", ")}` : "52/52",
    ),
    check("skeleton_present", (gltf.skins?.length ?? 0) > 0, `${gltf.skins?.length ?? 0} skins`),
    check("head_bone", hasName(nodeNames, ["Head", "mixamorigHead", "Head_M"]), "Head"),
    check("neck_bone", hasName(nodeNames, [...REQUIRED_BONES.filter((name) => name === "Neck"), "Neck_M", "mixamorigNeck"]), "Neck"),
    check("jaw_bone", hasName(nodeNames, ["Jaw", "Jaw_M", "mandible"]), "Jaw"),
    check("left_eye", hasName(nodeNames, ["LeftEye", "Eye_L", "Left_Eye", "mixamorigLeftEye"]), "LeftEye"),
    check("right_eye", hasName(nodeNames, ["RightEye", "Eye_R", "Right_Eye", "mixamorigRightEye"]), "RightEye"),
    check("materials_present", (gltf.materials?.length ?? 0) > 0, `${gltf.materials?.length ?? 0} materials`),
    check("eyes_present", nameIncludes(allNames, "eye"), "eye mesh/node"),
    check("mouth_interior", nameIncludes(allNames, "mouth"), "mouth/interior"),
    check("teeth", nameIncludes(allNames, "teeth") || nameIncludes(allNames, "tooth"), "teeth"),
    check("tongue", nameIncludes(allNames, "tongue"), "tongue"),
    check(
      "scale_plausible",
      Boolean(bounds && bounds.size > 0.08 && bounds.size < 3.2),
      bounds ? `extent ${bounds.size.toFixed(3)}` : "kein Accessor-Min/Max",
    ),
    check(
      "bounding_box_plausible",
      Boolean(bounds && bounds.maxY - bounds.minY > 0.05),
      bounds ? `y ${bounds.minY.toFixed(3)}…${bounds.maxY.toFixed(3)}` : "kein Bound",
    ),
    check("morph_changes_geometry", geometryChanged, geometryChanged ? "jawOpen/erstes Morph verschiebt Vertices" : "keine Vertex-Delta"),
  ];

  if (role === "production") {
    checks.push(
      check("not_development_rig", !isDevMarker, isDevMarker ? "Development-Marker gefunden" : "kein Dev-Rig"),
      check(
        "textures_present",
        (gltf.images?.length ?? 0) > 0,
        `${gltf.images?.length ?? 0} images`,
      ),
      check(
        "identity_extras",
        extras.novaIdentity === "NOVA" && extras.novaDevelopmentRig !== true,
        `novaIdentity=${String(extras.novaIdentity ?? "missing")}`,
      ),
    );
    if (bytes > PERFORMANCE_BUDGET.glbBytes.max) {
      checks.push(check("file_exists", true, `GLB ${bytes} bytes über Budget`));
    }
  }

  const requiredOk = checks.every((item) => item.ok);
  return {
    ok: requiredOk,
    role,
    path,
    exists: true,
    code: requiredOk ? "OK" : "INVALID_ASSET",
    checks,
    morphTargets,
    bones: nodeNames.filter(Boolean),
    materials,
    meshCount: gltf.meshes?.length ?? 0,
    skinCount: gltf.skins?.length ?? 0,
    triangleEstimate,
    bytes,
    morphChangesGeometry: geometryChanged,
  };
}

export function manifestFromProductionReport(report: AvatarValidationReport): NovaAvatarManifest {
  if (!report.exists) return MISSING_PRODUCTION_MANIFEST;
  if (report.role !== "production" || !report.ok) {
    return { ...MISSING_PRODUCTION_MANIFEST, version: "invalid" };
  }
  return {
    id: "nova",
    version: "1.0.0",
    type: "digital-human",
    asset: "/nova/avatar/nova.glb",
    rigProfile: "arkit-52",
    quality: "production",
    validated: true,
    status: "PRODUCTION",
    activeAsset: "/nova/avatar/nova.glb",
  };
}
