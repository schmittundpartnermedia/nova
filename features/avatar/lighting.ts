import * as THREE from "three";

export type NovaLightingPresetId = "portrait" | "flat";

export type NovaPortraitLightingPreset = {
  id: NovaLightingPresetId;
  clear: number;
  fog: number;
  fogDensity: number;
  exposure: number;
  environmentIntensity: number;
  key: { color: number; intensity: number; position: [number, number, number] };
  rim: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number; position: [number, number, number] };
  ambient: { sky: number; ground: number; intensity: number };
  eyeGlow: { color: number; intensity: number; position: [number, number, number] };
};

export const NOVA_PORTRAIT_LIGHTING: NovaPortraitLightingPreset = {
  id: "portrait",
  clear: 0x03070c,
  fog: 0x02060c,
  fogDensity: 0.06,
  exposure: 1.12,
  environmentIntensity: 0.22,
  key: { color: 0xc8e7ff, intensity: 18, position: [-0.28, 2.15, 1.45] },
  rim: { color: 0x3ec6ff, intensity: 3.4, position: [0.72, 1.82, -0.78] },
  fill: { color: 0xe39a4e, intensity: 1.15, position: [0.42, 1.22, 0.62] },
  ambient: { sky: 0x7eb4ff, ground: 0x0a1018, intensity: 0.72 },
  eyeGlow: { color: 0x5ad2ff, intensity: 0.55, position: [0, 1.62, 0.22] },
};

export const NOVA_FLAT_LIGHTING: NovaPortraitLightingPreset = {
  id: "flat",
  clear: 0x11161c,
  fog: 0x11161c,
  fogDensity: 0,
  exposure: 1,
  environmentIntensity: 0.08,
  key: { color: 0xffffff, intensity: 8, position: [0, 2, 2] },
  rim: { color: 0x8899aa, intensity: 1.2, position: [0, 1.6, -1] },
  fill: { color: 0xffffff, intensity: 2, position: [0.5, 1.4, 0.8] },
  ambient: { sky: 0xffffff, ground: 0x333333, intensity: 0.9 },
  eyeGlow: { color: 0x5ad2ff, intensity: 0.2, position: [0, 1.62, 0.22] },
};

export function lightingPreset(id: NovaLightingPresetId = "portrait"): NovaPortraitLightingPreset {
  return id === "flat" ? NOVA_FLAT_LIGHTING : NOVA_PORTRAIT_LIGHTING;
}

export function applyNovaLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, preset: NovaPortraitLightingPreset) {
  renderer.toneMappingExposure = preset.exposure;
  renderer.setClearColor(preset.clear, 1);
  scene.fog = preset.fogDensity > 0 ? new THREE.FogExp2(preset.fog, preset.fogDensity) : null;
  scene.environmentIntensity = preset.environmentIntensity;

  const group = new THREE.Group();
  group.name = "NovaPortraitLighting";

  const key = new THREE.SpotLight(preset.key.color, preset.key.intensity, 8, Math.PI / 4, 0.5, 1);
  key.name = "NovaKeyLight";
  key.position.set(...preset.key.position);
  key.target.position.set(0, 1.55, 0);
  group.add(key, key.target);

  const rim = new THREE.DirectionalLight(preset.rim.color, preset.rim.intensity);
  rim.name = "NovaRimLight";
  rim.position.set(...preset.rim.position);
  group.add(rim);

  const fill = new THREE.PointLight(preset.fill.color, preset.fill.intensity, 4.5);
  fill.name = "NovaWarmAccent";
  fill.position.set(...preset.fill.position);
  group.add(fill);

  const ambient = new THREE.HemisphereLight(preset.ambient.sky, preset.ambient.ground, preset.ambient.intensity);
  ambient.name = "NovaAmbient";
  group.add(ambient);

  const eyeGlow = new THREE.PointLight(preset.eyeGlow.color, preset.eyeGlow.intensity, 0.8);
  eyeGlow.name = "NovaEyeGlow";
  eyeGlow.position.set(...preset.eyeGlow.position);
  group.add(eyeGlow);

  scene.add(group);
  return group;
}
