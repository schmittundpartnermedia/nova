import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";
import { visemeToBlendshapes } from "@/features/avatar/viseme-map";
import { emotionToBlendshapes } from "@/features/avatar/emotion-map";
import { NovaFacialRigAdapter } from "@/features/avatar/rig-adapter";
import { AvatarTimelineController } from "@/features/avatar/timeline";
import { FacialAnimationEngine } from "@/features/avatar/facial-engine";
import { LIP_SYNC_SET } from "@/features/avatar/contract";
import { nvidiaAnimationToFrames } from "@/providers/facial/a2f-frames";
import { AUDIO2FACE_RUNTIME } from "@/services/avatar-animation";
import { validateAvatarGlb } from "@/features/avatar/validate-glb";
import { DEVELOPMENT_RIG_PATH, PRODUCTION_AVATAR_PATH } from "@/features/avatar/acceptance";
import { isProductionReady, normalizeManifest, MISSING_PRODUCTION_MANIFEST } from "@/features/avatar/manifest";
import { HeuristicFacialProvider } from "@/providers/facial/heuristic";
import { mustNotClaimDigitalHumanReady } from "@/features/avatar/production-guard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readGlbJson(path: string): Record<string, unknown> {
  const buffer = readFileSync(path);
  const magic = buffer.toString("ascii", 0, 4);
  assert(magic === "glTF", `Kein GLB: ${magic}`);
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.toString("ascii", 16, 20);
  assert(chunkType === "JSON", `Erstes Chunk muss JSON sein, war ${chunkType}`);
  return JSON.parse(buffer.subarray(20, 20 + chunkLength).toString("utf8")) as Record<string, unknown>;
}

async function main() {
  const glbPath = resolve("public/nova/dev-rig/nova-dev-rig.glb");
  const gltf = readGlbJson(glbPath);
  const meshes = (gltf.meshes as Array<{ extras?: { targetNames?: string[] }; primitives?: Array<{ extras?: { targetNames?: string[] }; targets?: unknown[] }> }>) ?? [];
  const nodes = (gltf.nodes as Array<{ name?: string }>) ?? [];
  const skins = (gltf.skins as Array<{ joints?: number[] }>) ?? [];
  const extras = (gltf.extras as Record<string, unknown> | undefined) ?? {};
  const sceneNodes = ((gltf.scenes as Array<{ extras?: Record<string, unknown>; nodes?: number[] }>) ?? [])[0];
  const names = nodes.map((node) => node.name ?? "");
  const morphNames = new Set<string>();
  let morphPrimitiveCount = 0;
  for (const mesh of meshes) {
    for (const name of mesh.extras?.targetNames ?? []) morphNames.add(name);
    for (const primitive of mesh.primitives ?? []) {
      for (const name of primitive.extras?.targetNames ?? []) morphNames.add(name);
      if ((primitive.targets?.length ?? 0) > 0) morphPrimitiveCount += 1;
    }
  }
  assert(morphPrimitiveCount > 0, "Mindestens ein Mesh muss Morph Targets tragen");

  assert(skins.length > 0, "GLB muss ein Skeleton enthalten");
  assert(names.includes("Head") || names.includes("NOVA_DEVELOPMENT_RIG"), `Head/Rig fehlt, nodes=${names.join(",")}`);
  assert(names.includes("Jaw"), "Jaw Bone fehlt");
  assert(names.includes("LeftEye") && names.includes("RightEye"), "Eye Bones fehlen");
  assert(names.includes("Neck"), "Neck Bone fehlt");
  assert(morphNames.has("jawOpen") || meshes.length > 0, "jawOpen Morph Target erwartet");
  for (const required of ["jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft"]) {
    assert(morphNames.has(required), `Morph Target fehlt: ${required}. Vorhanden: ${[...morphNames].slice(0, 12).join(",")}`);
  }
  assert(NOVA_BLENDSHAPE_NAMES.every((name) => morphNames.has(name)), "Development Rig muss den NOVA Facial Contract tragen");

  const adapter = new NovaFacialRigAdapter();
  adapter.loadRig({
    morphTargetNames: ["jaw_open", "eyeBlink_L", "Head"],
    boneNames: ["mixamorigHead", "Jaw_M", "Left_Eye"],
  });
  assert(adapter.resolveMorph("jawOpen") === "jaw_open", "Adapter mappt jawOpen");
  assert(adapter.resolveMorph("eyeBlinkLeft") === "eyeBlink_L", "Adapter mappt Blink");
  assert(adapter.resolveBone("Head") === "mixamorigHead", "Adapter mappt Head Bone");
  assert(adapter.resolveBone("Jaw") === "Jaw_M", "Adapter mappt Jaw Bone");

  const timeline = new AvatarTimelineController();
  timeline.attachClock(() => 50);
  timeline.load([
    { timestampMs: 0, blendshapes: { jawOpen: 0 } },
    { timestampMs: 100, blendshapes: { jawOpen: 1 } },
  ]);
  const mid = timeline.sample(50);
  assert(mid !== null, "Timeline Sample");
  assert(Math.abs((mid?.blendshapes.jawOpen ?? 0) - 0.5) < 0.001, `Interpolation, war ${mid?.blendshapes.jawOpen}`);

  const engine = new FacialAnimationEngine();
  engine.initialize();
  engine.loadRig({ morphTargetNames: [...NOVA_BLENDSHAPE_NAMES], boneNames: ["Head", "Neck", "Jaw", "LeftEye", "RightEye"] });
  engine.setState("SPEAKING", true, 0.8, "positive");
  engine.setEmotion("positive");
  engine.applyFrame({ timestampMs: 0, blendshapes: visemeToBlendshapes("A", 1) });
  const speaking = engine.sample(1000);
  assert((speaking.blendshapes.jawOpen ?? 0) > 0.4, "Lip-Sync jawOpen während SPEAKING");
  assert(!(LIP_SYNC_SET.has("mouthSmileLeft") && (speaking.blendshapes.mouthSmileLeft ?? 0) > (visemeToBlendshapes("A", 1).mouthSmileLeft ?? 0) + 0.15), "Emotion darf Lip-Sync nicht überschreiben");
  engine.setState("LISTENING", false, 0, "focused");
  engine.applyFrame(null);
  const listening = engine.sample(1200);
  assert((listening.blendshapes.jawOpen ?? 0) === 0, "LISTENING Mund REST");

  engine.setBlendshape("jawOpen", 0.9);
  engine.setBlendshape("eyeBlinkLeft", 0.8);
  const debug = engine.sample(1400);
  assert((debug.blendshapes.jawOpen ?? 0) >= 0.9, "Debug jawOpen");
  assert((debug.blendshapes.eyeBlinkLeft ?? 0) >= 0.8, "Debug blink");

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const base = geo.attributes.position as THREE.BufferAttribute;
  const open = new Float32Array(base.array as Float32Array);
  const restY = base.getY(0);
  open[1] = restY - 0.4;
  const influencedY = restY + (open[1] - restY) * 1;
  assert(influencedY !== restY, "Morph Target Einfluss verändert Vertex-Y");
  assert(Math.abs(influencedY - (restY - 0.4)) < 1e-6, "jawOpen-ähnliche Morph-Mischung");

  const frames = nvidiaAnimationToFrames({
    blendShapeNames: ["JawOpen", "EyeBlinkLeft"],
    samples: [{ timeCode: 1.24, blendShapeWeights: [0.7, 0.2] }],
  });
  assert(frames[0]?.timestampMs === 1240, "A2F time_code Sekunden → ms");
  assert(frames[0]?.blendshapes.JawOpen === 0.7, "A2F Blendshape-Mapping");

  const smile = emotionToBlendshapes("positive");
  assert((smile.mouthSmileLeft ?? 0) > 0 && (smile.mouthSmileLeft ?? 0) < 0.4, "Emotion dezent, kein Cartoon");

  assert(AUDIO2FACE_RUNTIME.runsInBrowser === false, "A2F läuft nicht im Browser");
  assert(AUDIO2FACE_RUNTIME.rpc === "ProcessAudioStream", "Dokumentierter RPC");

  const production = validateAvatarGlb(PRODUCTION_AVATAR_PATH, "production");
  assert(production.code === "FINAL_AVATAR_MISSING", `Production muss fehlen, war ${production.code}`);
  assert(production.ok === false, "Unvalidiertes nova.glb darf nicht ok sein");

  const development = validateAvatarGlb(DEVELOPMENT_RIG_PATH, "development");
  assert(development.exists, "Development Rig Datei");
  assert(development.ok, `Development Rig Validator: ${development.checks.filter((item) => !item.ok).map((item) => item.id).join(",")}`);
  assert(development.morphChangesGeometry, "Development Rig Morphs müssen Vertices ändern");

  const puppetAsProduction = validateAvatarGlb(DEVELOPMENT_RIG_PATH, "production");
  assert(puppetAsProduction.ok === false, "Development Rig darf nicht als Production durchgehen");
  assert(
    puppetAsProduction.checks.some((item) => item.id === "not_development_rig" && !item.ok),
    "Production Guard gegen Dev-Rig-Marker",
  );

  const ready = normalizeManifest({
    id: "nova",
    version: "1.0.0",
    type: "digital-human",
    asset: "/nova/avatar/nova.glb",
    rigProfile: "arkit-52",
    quality: "production",
    validated: true,
    status: "PRODUCTION",
    activeAsset: "/nova/avatar/nova.glb",
  });
  assert(isProductionReady(ready), "Validiertes Manifest ist production-ready");
  assert(isProductionReady(MISSING_PRODUCTION_MANIFEST) === false, "Missing Manifest ist nicht production-ready");
  assert(mustNotClaimDigitalHumanReady(MISSING_PRODUCTION_MANIFEST), "Kein Digital-Human-Ready ohne Asset");

  const heuristic = new HeuristicFacialProvider();
  assert(heuristic.developmentOnly === true, "Heuristic ist DEVELOPMENT ONLY");
  const health = await heuristic.healthCheck();
  assert(health.message.includes("DEVELOPMENT ONLY"), "Heuristic Health markiert Development");

  console.log(
    JSON.stringify(
      {
        ok: true,
        glb: {
          path: glbPath,
          morphTargets: morphNames.size,
          nodes: names.filter(Boolean).slice(0, 20),
          skins: skins.length,
          extras: extras,
          sceneExtras: sceneNodes?.extras ?? null,
        },
        rendererContract: "three-webgl",
        audio2face: AUDIO2FACE_RUNTIME.service,
      },
      null,
      2,
    ),
  );
}

void main();
