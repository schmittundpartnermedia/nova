"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaFacialFrame, NovaRenderQuality, NovaRigInfo, NovaVec3 } from "@/types/avatar";
import { FacialAnimationEngine } from "@/features/avatar/facial-engine";
import { detectQuality, qualitySettings } from "@/features/avatar/quality";
import { DEVELOPMENT_RIG_URL, PRODUCTION_AVATAR_URL } from "@/features/avatar/acceptance";
import { loadAvatarManifest, isProductionReady } from "@/features/avatar/manifest";
import { allowDevelopmentRig, missingAvatarMessage } from "@/features/avatar/production-guard";
import { applyNovaLighting, lightingPreset, type NovaLightingPresetId } from "@/features/avatar/lighting";
import { applyNovaCamera, cameraPreset, type NovaCameraPresetId } from "@/features/avatar/camera";
import { prepareAvatarMaterials, selectLodMeshes } from "@/features/avatar/materials";
import { productionRigAccepted } from "@/features/avatar/runtime-validate";

export type DigitalHumanStatus = "loading" | "ready" | "error" | "missing";

type MorphMesh = THREE.Mesh | THREE.SkinnedMesh;

function collectMorphMeshes(root: THREE.Object3D): MorphMesh[] {
  const meshes: MorphMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.morphTargetInfluences && object.morphTargetDictionary) {
      meshes.push(object);
    }
  });
  return meshes;
}

function collectNamed(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((object: THREE.Object3D) => {
    if (object.name) nodes.push(object);
  });
  return nodes;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class DigitalHumanRuntime {
  readonly engine = new FacialAnimationEngine();
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private lightingGroup: THREE.Group | null = null;
  private rig: THREE.Object3D | null = null;
  private morphMeshes: MorphMesh[] = [];
  private bones = new Map<string, THREE.Object3D>();
  private restRotations = new Map<string, THREE.Euler>();
  private raf = 0;
  private quality: NovaRenderQuality;
  private reducedMotion = false;
  private disposed = false;
  private status: DigitalHumanStatus = "loading";
  private errorMessage = "";
  private rigInfo: NovaRigInfo | null = null;
  private listeners = new Set<() => void>();
  private speechIntensity = 0;
  private forceDevelopmentRig: boolean;
  private lightingId: NovaLightingPresetId = "portrait";
  private cameraId: NovaCameraPresetId = "portrait";

  constructor(canvas: HTMLCanvasElement, options?: { quality?: NovaRenderQuality; forceDevelopmentRig?: boolean }) {
    this.canvas = canvas;
    this.quality = options?.quality ?? detectQuality();
    this.reducedMotion = prefersReducedMotion();
    this.forceDevelopmentRig = Boolean(options?.forceDevelopmentRig);
  }

  getStatus(): DigitalHumanStatus {
    return this.status;
  }

  getError(): string {
    return this.errorMessage;
  }

  getRigInfo(): NovaRigInfo | null {
    return this.rigInfo;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  async initialize() {
    this.engine.initialize();
    this.engine.setReducedMotion(this.reducedMotion);
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== "LOW" && this.quality !== "MEDIUM",
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: this.forceDevelopmentRig,
    });
    if (!renderer.capabilities.isWebGL2 && !renderer.getContext()) {
      throw new Error("WebGL ist auf diesem Gerät nicht verfügbar.");
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = qualitySettings(this.quality, this.reducedMotion).shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
    this.camera = camera;
    applyNovaCamera(camera, cameraPreset(this.cameraId));

    this.lightingGroup = applyNovaLighting(scene, renderer, lightingPreset(this.lightingId));
    const settings = qualitySettings(this.quality, this.reducedMotion);
    this.lightingGroup.traverse((object) => {
      if (object instanceof THREE.SpotLight) object.castShadow = settings.shadows;
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
    if (settings.environment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = lightingPreset(this.lightingId).environmentIntensity;
      pmrem.dispose();
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (settings.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.7, 0.88);
      this.bloom = bloom;
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.resize();
    window.addEventListener("resize", this.resize);
    this.engine.start();
    this.loop();
  }

  setLightingPreset(id: NovaLightingPresetId) {
    if (!this.scene || !this.renderer) return;
    this.lightingId = id;
    if (this.lightingGroup) {
      this.scene.remove(this.lightingGroup);
      this.lightingGroup.traverse((object) => {
        if (object instanceof THREE.Light) object.dispose();
      });
    }
    this.lightingGroup = applyNovaLighting(this.scene, this.renderer, lightingPreset(id));
  }

  setCameraPreset(id: NovaCameraPresetId) {
    if (!this.camera) return;
    this.cameraId = id;
    applyNovaCamera(this.camera, cameraPreset(id));
  }

  async loadRig() {
    this.status = "loading";
    this.notify();
    const loader = new GLTFLoader();
    const manifest = await loadAvatarManifest();
    const tryProduction = isProductionReady(manifest) && !this.forceDevelopmentRig;

    if (tryProduction) {
      try {
        const gltf = await loader.loadAsync(PRODUCTION_AVATAR_URL);
        const accepted = productionRigAccepted(gltf.scene);
        if (accepted.ok) {
          this.mountRig(gltf.scene, PRODUCTION_AVATAR_URL, false);
          return;
        }
      } catch {
        // Production file missing or unloadable – never silently treat a named file as NOVA.
      }
    }

    if (!allowDevelopmentRig({ forceDevelopmentRig: this.forceDevelopmentRig })) {
      this.status = "missing";
      this.errorMessage = missingAvatarMessage();
      this.rigInfo = {
        isDevelopmentRig: false,
        sourceUrl: "",
        morphTargets: [],
        bones: [],
        mappedBlendshapes: [],
        unmappedBlendshapes: [],
        quality: "development",
        validated: false,
        readiness: "FINAL_AVATAR_MISSING",
      };
      this.notify();
      return;
    }

    try {
      const gltf = await loader.loadAsync(DEVELOPMENT_RIG_URL);
      this.mountRig(gltf.scene, DEVELOPMENT_RIG_URL, true);
    } catch (error) {
      this.status = "error";
      this.errorMessage = "3D-Modell konnte nicht geladen werden. Es gibt keinen Bild-Fallback.";
      this.notify();
      throw error instanceof Error ? error : new Error(this.errorMessage);
    }
  }

  private mountRig(root: THREE.Object3D, loadedUrl: string, development: boolean) {
    if (this.rig && this.scene) this.scene.remove(this.rig);
    const settings = qualitySettings(this.quality, this.reducedMotion);
    const anisotropy = Math.min(settings.anisotropy, this.renderer?.capabilities.getMaxAnisotropy() ?? 8);
    prepareAvatarMaterials(root, anisotropy);
    selectLodMeshes(root, this.quality);
    this.scene?.add(root);
    this.rig = root;
    this.morphMeshes = collectMorphMeshes(root);
    this.bones.clear();
    this.restRotations.clear();
    for (const node of collectNamed(root)) {
      this.bones.set(node.name, node);
      this.restRotations.set(node.name, node.rotation.clone());
    }

    const morphNames = new Set<string>();
    for (const mesh of this.morphMeshes) {
      for (const name of Object.keys(mesh.morphTargetDictionary ?? {})) morphNames.add(name);
    }
    this.engine.loadRig({
      morphTargetNames: [...morphNames],
      boneNames: [...this.bones.keys()],
    });
    const adapter = this.engine.getAdapter();
    this.rigInfo = {
      isDevelopmentRig: development,
      sourceUrl: loadedUrl,
      morphTargets: [...morphNames],
      bones: [...this.bones.keys()],
      mappedBlendshapes: adapter.mappedBlendshapes(),
      unmappedBlendshapes: adapter.unmappedBlendshapes(),
      quality: development ? "development" : "production",
      validated: !development,
      readiness: development ? "DEVELOPMENT_RIG" : "PRODUCTION",
    };
    this.status = "ready";
    this.notify();
  }

  setState(state: OrbState, isSpeaking: boolean, speechIntensity: number, emotion: NovaAvatarEmotion) {
    this.speechIntensity = speechIntensity;
    this.engine.setState(state, isSpeaking, speechIntensity);
    this.engine.setEmotion(emotion);
  }

  applyFrame(frame: NovaFacialFrame | null) {
    this.engine.applyFrame(frame);
  }

  debugSetBlendshape(name: string, value: number) {
    this.engine.setBlendshape(name, value);
  }

  debugSetHeadPose(rotation: NovaVec3 | null) {
    this.engine.setHeadPose(rotation);
  }

  capturePng(): string | null {
    if (!this.canvas) return null;
    return this.canvas.toDataURL("image/png");
  }

  getDebugSnapshot() {
    const sample = this.engine.sample();
    return {
      status: this.status,
      renderer: this.renderer ? "webgl" : "none",
      webgl: Boolean(this.renderer?.getContext()),
      isMesh: this.morphMeshes.length > 0,
      skinned: this.morphMeshes.some((mesh) => mesh instanceof THREE.SkinnedMesh) || this.bones.size > 0,
      meshCount: this.rig
        ? (() => {
            let count = 0;
            this.rig?.traverse((object) => {
              if (object instanceof THREE.Mesh) count += 1;
            });
            return count;
          })()
        : 0,
      morphCount: this.morphMeshes.reduce((sum, mesh) => sum + (mesh.morphTargetInfluences?.length ?? 0), 0),
      jawOpen: sample.blendshapes.jawOpen ?? 0,
      eyeBlinkLeft: sample.blendshapes.eyeBlinkLeft ?? 0,
      mapped: sample.mappedBlendshapes,
      lighting: this.lightingId,
      camera: this.cameraId,
      quality: this.quality,
      rig: this.rigInfo,
    };
  }

  private applyOutput() {
    const sample = this.engine.sample();
    for (const mesh of this.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;
      for (const [name, value] of Object.entries(sample.mappedBlendshapes)) {
        const index = dict[name];
        if (index === undefined) continue;
        influences[index] = value;
      }
    }

    this.rotateBone("Head", sample.headRotation);
    this.rotateBone("Neck", sample.neckRotation);
    this.rotateBone("Jaw", sample.jawBoneRotation);
    this.rotateBone("LeftEye", sample.eyeBoneRotation);
    this.rotateBone("RightEye", sample.eyeBoneRotation);

    if (this.rig) {
      this.rig.position.y = sample.breath;
    }
    if (this.bloom) {
      this.bloom.strength = 0.1 + this.speechIntensity * 0.06;
    }
  }

  private rotateBone(contractName: string, euler: { x: number; y: number; z: number }) {
    const name = this.engine.getAdapter().resolveBone(contractName);
    if (!name) return;
    const bone = this.bones.get(name);
    const rest = this.restRotations.get(name);
    if (!bone || !rest) return;
    bone.rotation.set(rest.x + euler.x, rest.y + euler.y, rest.z + euler.z);
  }

  private loop = () => {
    if (this.disposed) return;
    this.applyOutput();
    if (this.composer && this.camera) this.composer.render();
    else if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  resize = () => {
    if (!this.renderer || !this.camera || !this.canvas.parentElement) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.bloom?.setSize(width, height);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.engine.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.scene?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer = null;
    this.scene = null;
  }
}

export { PRODUCTION_AVATAR_URL as FINAL_NOVA_GLB_URL, DEVELOPMENT_RIG_URL as DEV_RIG_URL };
