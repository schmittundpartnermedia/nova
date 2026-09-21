import { Mesh, Object3D } from "three";
import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";
import { NovaFacialRigAdapter } from "@/features/avatar/rig-adapter";

function collectNames(root: Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (object.name) names.push(object.name);
  });
  return names;
}

function collectMorphs(root: Object3D): string[] {
  const names = new Set<string>();
  root.traverse((object) => {
    if (object instanceof Mesh && object.morphTargetInfluences && object.morphTargetDictionary) {
      for (const name of Object.keys(object.morphTargetDictionary)) names.add(name);
    }
  });
  return [...names];
}

export function inspectLoadedRig(root: Object3D) {
  const names = collectNames(root);
  const morphTargets = collectMorphs(root);
  const adapter = new NovaFacialRigAdapter();
  adapter.loadRig({ morphTargetNames: morphTargets, boneNames: names });
  const looksLikeDevRig =
    Boolean(root.userData?.novaDevelopmentRig) ||
    names.some((name) => /development|dev.?rig/i.test(name));
  return {
    names,
    morphTargets,
    mappedBlendshapes: adapter.mappedBlendshapes(),
    mappedBones: adapter.mappedBones(),
    looksLikeDevRig,
    meshCount: names.filter((name) => /mesh/i.test(name)).length || morphTargets.length,
  };
}

export function productionRigAccepted(root: Object3D): { ok: boolean; reason: string } {
  const info = inspectLoadedRig(root);
  if (info.looksLikeDevRig) return { ok: false, reason: "Asset ist als Development Rig markiert." };
  if (info.morphTargets.length < 20) return { ok: false, reason: "Zu wenige Morph Targets für ein Production-Gesicht." };
  const required = ["jawOpen", "eyeBlinkLeft", "eyeBlinkRight"];
  const missing = required.filter((name) => !info.mappedBlendshapes.includes(name) && !info.morphTargets.includes(name));
  if (missing.length) return { ok: false, reason: `Pflicht-Blendshapes fehlen: ${missing.join(", ")}` };
  const bones = ["Head", "Jaw", "LeftEye", "RightEye"];
  const missingBones = bones.filter((name) => !info.mappedBones.includes(name));
  if (missingBones.length) return { ok: false, reason: `Pflichtknochen fehlen: ${missingBones.join(", ")}` };
  if (info.mappedBlendshapes.length < NOVA_BLENDSHAPE_NAMES.length * 0.8) {
    return { ok: false, reason: "Facial Contract unvollständig gemappt." };
  }
  return { ok: true, reason: "runtime structural checks passed" };
}
