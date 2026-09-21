import * as THREE from "three";

export type NovaCameraPresetId = "portrait" | "wide";

export type NovaPortraitCameraPreset = {
  id: NovaCameraPresetId;
  fov: number;
  near: number;
  far: number;
  position: [number, number, number];
  lookAt: [number, number, number];
};

export const NOVA_PORTRAIT_CAMERA: NovaPortraitCameraPreset = {
  id: "portrait",
  fov: 26,
  near: 0.05,
  far: 20,
  position: [0, 1.58, 0.78],
  lookAt: [0, 1.56, 0],
};

export const NOVA_WIDE_CAMERA: NovaPortraitCameraPreset = {
  id: "wide",
  fov: 34,
  near: 0.05,
  far: 20,
  position: [0, 1.5, 1.15],
  lookAt: [0, 1.48, 0],
};

export function cameraPreset(id: NovaCameraPresetId = "portrait"): NovaPortraitCameraPreset {
  return id === "wide" ? NOVA_WIDE_CAMERA : NOVA_PORTRAIT_CAMERA;
}

export function applyNovaCamera(camera: THREE.PerspectiveCamera, preset: NovaPortraitCameraPreset) {
  camera.fov = preset.fov;
  camera.near = preset.near;
  camera.far = preset.far;
  camera.position.set(...preset.position);
  camera.lookAt(...preset.lookAt);
  camera.updateProjectionMatrix();
}
