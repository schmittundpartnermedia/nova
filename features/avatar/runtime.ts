"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { OrbState } from "@/types";
import type { NovaAvatarEmotion, NovaFacialFrame, NovaRenderQuality, NovaRigInfo } from "@/types/avatar";
import { FacialAnimationEngine } from "@/features/avatar/facial-engine";
import { detectQuality, qualitySettings } from "@/features/avatar/quality";
import { FINAL_NOVA_GLB_URL, DEV_RIG_URL, isDevelopmentRigUrl } from "@/features/avatar/asset";

export type DigitalHumanStatus = "loading" | "ready" | "error";

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
  private clock = { getDelta() { return 0; } };
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

  constructor(canvas: HTMLCanvasElement, quality?: NovaRenderQuality) {
    this.canvas = canvas;
    this.quality = quality ?? detectQuality();
    this.reducedMotion = prefersReducedMotion();
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
      antialias: this.quality !== "LOW",
      alpha: true,
      powerPreference: "high-performance",
    });
    if (!renderer.capabilities.isWebGL2 && !renderer.getContext()) {
      throw new Error("WebGL ist auf diesem Gerät nicht verfügbar.");
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.setClearColor(0x03070c, 1);
    renderer.shadowMap.enabled = qualitySettings(this.quality, this.reducedMotion).shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02060c, 0.08);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    camera.position.set(0, 1.58, 0.85);
    camera.lookAt(0, 1.55, 0);
    this.camera = camera;

    this.addLights(scene);
    const settings = qualitySettings(this.quality, this.reducedMotion);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
    if (settings.environment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.28;
      pmrem.dispose();
    }

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (settings.bloom) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.6, 0.85);
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

  private addLights(scene: THREE.Scene) {
    const key = new THREE.SpotLight(0xc8e7ff, 28, 8, Math.PI / 4, 0.45, 1);
    key.position.set(-0.25, 2.2, 1.4);
    key.target.position.set(0, 1.55, 0);
    key.castShadow = qualitySettings(this.quality, this.reducedMotion).shadows;
    scene.add(key, key.target);

    const rim = new THREE.DirectionalLight(0x3ec6ff, 4.2);
    rim.position.set(0.7, 1.8, -0.8);
    scene.add(rim);

    const fill = new THREE.PointLight(0xe39a4e, 2.2, 4.5);
    fill.position.set(0.45, 1.25, 0.6);
    scene.add(fill);

    const ambient = new THREE.HemisphereLight(0x7eb4ff, 0x0a1018, 1.15);
    scene.add(ambient);

    const eyeGlow = new THREE.PointLight(0x5ad2ff, 1.1, 0.8);
    eyeGlow.position.set(0, 1.62, 0.22);
    scene.add(eyeGlow);
  }

  async loadRig() {
    this.status = "loading";
    this.notify();
    const loader = new GLTFLoader();
    const candidates = [FINAL_NOVA_GLB_URL, DEV_RIG_URL];
    let loadedUrl = "";
    let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>> | null = null;
    let lastError: unknown;
    for (const url of candidates) {
      try {
        gltf = await loader.loadAsync(url);
        loadedUrl = url;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!gltf || !loadedUrl) {
      this.status = "error";
      this.errorMessage = "3D-Modell konnte nicht geladen werden. Es gibt keinen Bild-Fallback.";
      this.notify();
      throw lastError instanceof Error ? lastError : new Error(this.errorMessage);
    }

    const root = gltf.scene;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.envMapIntensity = 0.7;
          }
        }
      }
    });

    this.scene?.add(root);
    this.rig = root;
    this.morphMeshes = collectMorphMeshes(root);
    this.bones.clear();
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
      isDevelopmentRig: isDevelopmentRigUrl(loadedUrl) || Boolean(root.userData?.novaDevelopmentRig),
      sourceUrl: loadedUrl,
      morphTargets: [...morphNames],
      bones: [...this.bones.keys()],
      mappedBlendshapes: adapter.mappedBlendshapes(),
      unmappedBlendshapes: adapter.unmappedBlendshapes(),
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

  getDebugSnapshot() {
    const sample = this.engine.sample();
    return {
      status: this.status,
      renderer: this.renderer ? "webgl" : "none",
      webgl: Boolean(this.renderer?.getContext()),
      isMesh: this.morphMeshes.length > 0,
      morphCount: this.morphMeshes.reduce((sum, mesh) => sum + (mesh.morphTargetInfluences?.length ?? 0), 0),
      jawOpen: sample.blendshapes.jawOpen ?? 0,
      eyeBlinkLeft: sample.blendshapes.eyeBlinkLeft ?? 0,
      mapped: sample.mappedBlendshapes,
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
      this.bloom.strength = 0.14 + this.speechIntensity * 0.08;
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
    this.clock.getDelta();
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

export { FINAL_NOVA_GLB_URL, DEV_RIG_URL };
