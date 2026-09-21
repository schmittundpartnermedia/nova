/**
 * Generates public/nova/dev-rig/nova-dev-rig.glb
 *
 * This is a DEVELOPMENT RIG only. It is not the final NOVA digital human
 * and must never be presented as photoreal NOVA identity.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { NOVA_BLENDSHAPE_NAMES } from "@/types/avatar";

if (typeof globalThis.FileReader === "undefined") {
  class FileReaderPolyfill {
    result: ArrayBuffer | string | null = null;
    onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
      });
    }
  }
  globalThis.FileReader = FileReaderPolyfill as unknown as typeof FileReader;
}

const HEAD_RADIUS = 0.11;

type Vec = { x: number; y: number; z: number };

function dist(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function falloff(p: Vec, c: Vec, radius: number): number {
  const t = 1 - dist(p, c) / radius;
  return t <= 0 ? 0 : t * t;
}

function shapeHead(x: number, y: number, z: number): Vec {
  const px = x * 0.84;
  let py = y;
  let pz = z * 0.9;
  if (pz < 0) pz *= 0.82;
  if (py < -0.02 && pz > 0) py -= (0.02 + Math.abs(py)) * 0.18;
  if (pz > 0.04 && Math.abs(px) < 0.04 && py > -0.02 && py < 0.05) {
    pz += 0.018;
  }
  if (Math.abs(px) > 0.04 && py > 0.01 && py < 0.05 && pz > 0.04) {
    pz -= 0.012;
  }
  return { x: px, y: py, z: pz };
}

function landmarks() {
  return {
    mouth: { x: 0, y: -0.028, z: 0.09 },
    mouthLeft: { x: -0.028, y: -0.026, z: 0.082 },
    mouthRight: { x: 0.028, y: -0.026, z: 0.082 },
    jaw: { x: 0, y: -0.055, z: 0.06 },
    chin: { x: 0, y: -0.08, z: 0.055 },
    eyeL: { x: -0.032, y: 0.018, z: 0.088 },
    eyeR: { x: 0.032, y: 0.018, z: 0.088 },
    lidL: { x: -0.032, y: 0.03, z: 0.09 },
    lidR: { x: 0.032, y: 0.03, z: 0.09 },
    browL: { x: -0.032, y: 0.048, z: 0.086 },
    browR: { x: 0.032, y: 0.048, z: 0.086 },
    browInner: { x: 0, y: 0.05, z: 0.082 },
    cheekL: { x: -0.05, y: -0.01, z: 0.07 },
    cheekR: { x: 0.05, y: -0.01, z: 0.07 },
    nose: { x: 0, y: 0.004, z: 0.105 },
    tongue: { x: 0, y: -0.034, z: 0.07 },
  };
}

function morphDelta(name: string, p: Vec, rest: Vec): Vec {
  const L = landmarks();
  const out = { x: 0, y: 0, z: 0 };
  const add = (w: number, dx: number, dy: number, dz: number) => {
    if (w <= 0) return;
    out.x += dx * w;
    out.y += dy * w;
    out.z += dz * w;
  };

  switch (name) {
    case "jawOpen":
      add(falloff(p, L.jaw, 0.09) + falloff(p, L.chin, 0.07), 0, -0.055, -0.012);
      add(falloff(p, L.mouth, 0.045), 0, -0.03, -0.004);
      break;
    case "jawForward":
      add(falloff(p, L.jaw, 0.08), 0, 0, 0.018);
      break;
    case "jawLeft":
      add(falloff(p, L.jaw, 0.08), -0.018, 0, 0);
      break;
    case "jawRight":
      add(falloff(p, L.jaw, 0.08), 0.018, 0, 0);
      break;
    case "mouthClose":
      add(falloff(p, L.mouth, 0.04), 0, p.y > L.mouth.y ? -0.006 : 0.006, 0.004);
      break;
    case "mouthFunnel":
      add(falloff(p, L.mouth, 0.05), p.x * 0.35, 0, 0.02);
      break;
    case "mouthPucker":
      add(falloff(p, L.mouth, 0.05), -p.x * 0.8, 0, 0.016);
      break;
    case "mouthLeft":
      add(falloff(p, L.mouth, 0.055), -0.016, 0, 0);
      break;
    case "mouthRight":
      add(falloff(p, L.mouth, 0.055), 0.016, 0, 0);
      break;
    case "mouthSmileLeft":
      add(falloff(p, L.mouthLeft, 0.04), -0.01, 0.016, 0);
      break;
    case "mouthSmileRight":
      add(falloff(p, L.mouthRight, 0.04), 0.01, 0.016, 0);
      break;
    case "mouthFrownLeft":
      add(falloff(p, L.mouthLeft, 0.04), -0.006, -0.014, 0);
      break;
    case "mouthFrownRight":
      add(falloff(p, L.mouthRight, 0.04), 0.006, -0.014, 0);
      break;
    case "mouthDimpleLeft":
      add(falloff(p, L.cheekL, 0.035), -0.006, 0.004, 0.004);
      break;
    case "mouthDimpleRight":
      add(falloff(p, L.cheekR, 0.035), 0.006, 0.004, 0.004);
      break;
    case "mouthStretchLeft":
      add(falloff(p, L.mouthLeft, 0.045), -0.018, 0.004, 0);
      break;
    case "mouthStretchRight":
      add(falloff(p, L.mouthRight, 0.045), 0.018, 0.004, 0);
      break;
    case "mouthRollLower":
      add(falloff(p, { ...L.mouth, y: L.mouth.y - 0.01 }, 0.035), 0, 0.008, -0.006);
      break;
    case "mouthRollUpper":
      add(falloff(p, { ...L.mouth, y: L.mouth.y + 0.01 }, 0.035), 0, -0.008, -0.006);
      break;
    case "mouthShrugLower":
      add(falloff(p, L.chin, 0.05), 0, 0.01, 0);
      break;
    case "mouthShrugUpper":
      add(falloff(p, { ...L.mouth, y: L.mouth.y + 0.012 }, 0.04), 0, 0.008, 0);
      break;
    case "mouthPressLeft":
      add(falloff(p, L.mouthLeft, 0.03), 0, 0, 0.006);
      break;
    case "mouthPressRight":
      add(falloff(p, L.mouthRight, 0.03), 0, 0, 0.006);
      break;
    case "mouthLowerDownLeft":
      add(falloff(p, { ...L.mouthLeft, y: L.mouth.y - 0.01 }, 0.035), 0, -0.014, 0);
      break;
    case "mouthLowerDownRight":
      add(falloff(p, { ...L.mouthRight, y: L.mouth.y - 0.01 }, 0.035), 0, -0.014, 0);
      break;
    case "mouthUpperUpLeft":
      add(falloff(p, { ...L.mouthLeft, y: L.mouth.y + 0.01 }, 0.035), 0, 0.012, 0.004);
      break;
    case "mouthUpperUpRight":
      add(falloff(p, { ...L.mouthRight, y: L.mouth.y + 0.01 }, 0.035), 0, 0.012, 0.004);
      break;
    case "eyeBlinkLeft":
      add(falloff(p, L.lidL, 0.03), 0, -0.016, 0.002);
      add(falloff(p, { ...L.eyeL, y: L.eyeL.y - 0.012 }, 0.025), 0, 0.01, 0);
      break;
    case "eyeBlinkRight":
      add(falloff(p, L.lidR, 0.03), 0, -0.016, 0.002);
      add(falloff(p, { ...L.eyeR, y: L.eyeR.y - 0.012 }, 0.025), 0, 0.01, 0);
      break;
    case "eyeSquintLeft":
      add(falloff(p, L.eyeL, 0.03), 0, -0.006, 0);
      break;
    case "eyeSquintRight":
      add(falloff(p, L.eyeR, 0.03), 0, -0.006, 0);
      break;
    case "eyeLookUpLeft":
    case "eyeLookUpRight":
      add(falloff(p, name.includes("Left") ? L.eyeL : L.eyeR, 0.03), 0, 0.008, 0);
      break;
    case "eyeLookDownLeft":
    case "eyeLookDownRight":
      add(falloff(p, name.includes("Left") ? L.eyeL : L.eyeR, 0.03), 0, -0.008, 0);
      break;
    case "eyeLookInLeft":
      add(falloff(p, L.eyeL, 0.03), 0.008, 0, 0);
      break;
    case "eyeLookInRight":
      add(falloff(p, L.eyeR, 0.03), -0.008, 0, 0);
      break;
    case "eyeLookOutLeft":
      add(falloff(p, L.eyeL, 0.03), -0.008, 0, 0);
      break;
    case "eyeLookOutRight":
      add(falloff(p, L.eyeR, 0.03), 0.008, 0, 0);
      break;
    case "eyeWideLeft":
      add(falloff(p, L.lidL, 0.03), 0, 0.01, 0);
      break;
    case "eyeWideRight":
      add(falloff(p, L.lidR, 0.03), 0, 0.01, 0);
      break;
    case "browDownLeft":
      add(falloff(p, L.browL, 0.04), 0, -0.01, 0);
      break;
    case "browDownRight":
      add(falloff(p, L.browR, 0.04), 0, -0.01, 0);
      break;
    case "browInnerUp":
      add(falloff(p, L.browInner, 0.05), 0, 0.012, 0);
      break;
    case "browOuterUpLeft":
      add(falloff(p, { ...L.browL, x: L.browL.x - 0.012 }, 0.035), 0, 0.012, 0);
      break;
    case "browOuterUpRight":
      add(falloff(p, { ...L.browR, x: L.browR.x + 0.012 }, 0.035), 0, 0.012, 0);
      break;
    case "cheekPuff":
      add(falloff(p, L.cheekL, 0.045), -0.012, 0, 0.01);
      add(falloff(p, L.cheekR, 0.045), 0.012, 0, 0.01);
      break;
    case "cheekSquintLeft":
      add(falloff(p, L.cheekL, 0.04), 0, 0.008, 0.004);
      break;
    case "cheekSquintRight":
      add(falloff(p, L.cheekR, 0.04), 0, 0.008, 0.004);
      break;
    case "noseSneerLeft":
      add(falloff(p, { ...L.nose, x: -0.01 }, 0.03), 0, 0.006, 0.004);
      break;
    case "noseSneerRight":
      add(falloff(p, { ...L.nose, x: 0.01 }, 0.03), 0, 0.006, 0.004);
      break;
    case "tongueOut":
      add(falloff(p, L.tongue, 0.03), 0, -0.004, 0.02);
      break;
    default:
      break;
  }
  return { x: rest.x + out.x, y: rest.y + out.y, z: rest.z + out.z };
}

function createHeadGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(HEAD_RADIUS, 64, 48);
  const pos = geo.attributes.position;
  if (!(pos instanceof THREE.BufferAttribute)) throw new Error("head position buffer missing");
  const rest: number[] = [];
  for (let i = 0; i < pos.count; i += 1) {
    const shaped = shapeHead(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, shaped.x, shaped.y, shaped.z);
    rest.push(shaped.x, shaped.y, shaped.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const targets: THREE.BufferAttribute[] = [];
  for (const name of NOVA_BLENDSHAPE_NAMES) {
    const array = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const current = { x: rest[i * 3] ?? 0, y: rest[i * 3 + 1] ?? 0, z: rest[i * 3 + 2] ?? 0 };
      const next = morphDelta(name, current, current);
      array[i * 3] = next.x;
      array[i * 3 + 1] = next.y;
      array[i * 3 + 2] = next.z;
    }
    const attr = new THREE.BufferAttribute(array, 3);
    attr.name = name;
    targets.push(attr);
  }
  geo.morphAttributes.position = targets;
  geo.morphTargetsRelative = false;
  return geo;
}

function createBones(): { root: THREE.Bone; bones: THREE.Bone[] } {
  const root = new THREE.Bone();
  root.name = "Root";
  root.position.set(0, 0, 0);

  const spine = new THREE.Bone();
  spine.name = "Spine";
  spine.position.set(0, 1.22, 0);
  root.add(spine);

  const neck = new THREE.Bone();
  neck.name = "Neck";
  neck.position.set(0, 0.24, 0);
  spine.add(neck);

  const head = new THREE.Bone();
  head.name = "Head";
  head.position.set(0, 0.12, 0);
  neck.add(head);

  const jaw = new THREE.Bone();
  jaw.name = "Jaw";
  jaw.position.set(0, -0.08, 0.03);
  head.add(jaw);

  const leftEye = new THREE.Bone();
  leftEye.name = "LeftEye";
  leftEye.position.set(-0.032, 0.018, 0.088);
  head.add(leftEye);

  const rightEye = new THREE.Bone();
  rightEye.name = "RightEye";
  rightEye.position.set(0.032, 0.018, 0.088);
  head.add(rightEye);

  return { root, bones: [root, spine, neck, head, jaw, leftEye, rightEye] };
}

function skinMaterial(color: string, metalness: number, roughness: number, emissive = "#000000"): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity: emissive === "#000000" ? 0 : 0.55,
  });
}

async function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise((resolveExport, reject) => {
    exporter.parse(
      root,
      (result: ArrayBuffer | { [key: string]: unknown }) => {
        if (result instanceof ArrayBuffer) resolveExport(result);
        else reject(new Error("GLB Export lieferte kein ArrayBuffer."));
      },
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true },
    );
  });
}

async function main() {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.name = "NOVA_DEVELOPMENT_RIG";
  rig.userData = {
    novaDevelopmentRig: true,
    novaRole: "development-rig",
    novaIdentity: "DEVELOPMENT RIG – not the final NOVA digital human",
  };

  const { root, bones } = createBones();
  const skeleton = new THREE.Skeleton(bones);

  const headGeo = createHeadGeometry();
  const headMat = skinMaterial("#c7a394", 0.04, 0.46);
  headMat.name = "Skin";
  const head = new THREE.Mesh(headGeo, headMat);
  head.name = "HeadMesh";
  head.frustumCulled = false;
  head.morphTargetInfluences = NOVA_BLENDSHAPE_NAMES.map(() => 0);
  head.morphTargetDictionary = Object.fromEntries(NOVA_BLENDSHAPE_NAMES.map((name, index) => [name, index]));

  const headBone = bones.find((bone) => bone.name === "Head");
  const neckBone = bones.find((bone) => bone.name === "Neck");
  const spineBone = bones.find((bone) => bone.name === "Spine");
  const jawBone = bones.find((bone) => bone.name === "Jaw");

  const neckGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.12, 24);
  const neck = new THREE.Mesh(neckGeo, skinMaterial("#b39182", 0.05, 0.5));
  neck.name = "NeckMesh";
  neck.position.set(0, -0.02, 0);
  neckBone?.add(neck);

  const shoulderGeo = new THREE.CapsuleGeometry(0.09, 0.22, 8, 16);
  shoulderGeo.rotateZ(Math.PI / 2);
  const shoulders = new THREE.Mesh(shoulderGeo, skinMaterial("#1a2a38", 0.72, 0.28, "#123044"));
  shoulders.name = "ShoulderMesh";
  shoulders.position.set(0, 0.04, 0);
  (shoulders.material as THREE.MeshStandardMaterial).name = "Cybernetic";
  spineBone?.add(shoulders);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: "#0b1a24",
    emissive: "#3ec6ff",
    emissiveIntensity: 0.7,
    roughness: 0.18,
    metalness: 0.2,
  });
  eyeMat.name = "Eye";
  const corneaMat = new THREE.MeshPhysicalMaterial({
    color: "#d9f4ff",
    transmission: 0.72,
    roughness: 0.04,
    thickness: 0.02,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
  });
  corneaMat.name = "Cornea";

  const makeEye = (name: string, bone: THREE.Bone) => {
    const group = new THREE.Group();
    group.name = name;
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.013, 20, 16), eyeMat);
    eyeball.name = `${name}Ball`;
    const cornea = new THREE.Mesh(new THREE.SphereGeometry(0.014, 20, 16), corneaMat);
    cornea.name = `${name}Cornea`;
    group.add(eyeball, cornea);
    bone.add(group);
  };
  const leftEye = bones.find((bone) => bone.name === "LeftEye");
  const rightEye = bones.find((bone) => bone.name === "RightEye");
  if (leftEye) makeEye("LeftEyeMesh", leftEye);
  if (rightEye) makeEye("RightEyeMesh", rightEye);

  const teeth = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.01, 0.016),
    new THREE.MeshStandardMaterial({ color: "#e8dcd2", roughness: 0.35, metalness: 0.02 }),
  );
  teeth.name = "Teeth";
  teeth.position.set(0, -0.02, 0.082);
  (teeth.material as THREE.MeshStandardMaterial).name = "Teeth";
  headBone?.add(teeth);

  const tongue = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.008, 0.02, 6, 10),
    new THREE.MeshStandardMaterial({ color: "#8a3a42", roughness: 0.55, metalness: 0 }),
  );
  tongue.name = "Tongue";
  tongue.rotation.x = Math.PI / 2;
  tongue.position.set(0, -0.034, 0.07);
  (tongue.material as THREE.MeshStandardMaterial).name = "Tongue";
  jawBone?.add(tongue);

  const mouthInterior = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 12),
    new THREE.MeshStandardMaterial({ color: "#12080a", roughness: 0.9, metalness: 0 }),
  );
  mouthInterior.name = "MouthInterior";
  mouthInterior.position.set(0, -0.03, 0.055);
  mouthInterior.scale.set(1.1, 0.55, 0.7);
  (mouthInterior.material as THREE.MeshStandardMaterial).name = "MouthInterior";
  headBone?.add(head);
  headBone?.add(mouthInterior);

  const dummy = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshStandardMaterial({ visible: false }));
  dummy.name = "SkeletonBind";
  dummy.add(root);
  dummy.frustumCulled = false;
  rig.add(dummy);
  scene.add(rig);
  scene.updateMatrixWorld(true);
  dummy.bind(skeleton);

  const bytes = await exportGlb(scene);
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/nova/dev-rig/nova-dev-rig.glb");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(bytes));
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: out,
        bytes: bytes.byteLength,
        morphTargets: NOVA_BLENDSHAPE_NAMES.length,
        bones: bones.map((bone) => bone.name),
        developmentRig: true,
      },
      null,
      2,
    ),
  );
}

void main();
