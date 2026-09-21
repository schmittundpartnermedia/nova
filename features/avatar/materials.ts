import * as THREE from "three";

function materialName(material: THREE.Material): string {
  return material.name.toLowerCase();
}

function objectName(object: THREE.Object3D): string {
  return object.name.toLowerCase();
}

function upgradePhysical(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  if (source instanceof THREE.MeshPhysicalMaterial) return source;
  const next = new THREE.MeshPhysicalMaterial();
  next.color.copy(source.color);
  next.roughness = source.roughness;
  next.metalness = source.metalness;
  next.emissive.copy(source.emissive);
  next.emissiveIntensity = source.emissiveIntensity;
  next.name = source.name;
  next.map = source.map;
  next.normalMap = source.normalMap;
  next.roughnessMap = source.roughnessMap;
  next.metalnessMap = source.metalnessMap;
  next.aoMap = source.aoMap;
  next.emissiveMap = source.emissiveMap;
  next.envMap = source.envMap;
  next.envMapIntensity = source.envMapIntensity;
  next.transparent = source.transparent;
  next.opacity = source.opacity;
  next.side = source.side;
  return next;
}

function classify(object: THREE.Mesh, material: THREE.MeshStandardMaterial): "skin" | "cornea" | "eye" | "teeth" | "tongue" | "mouth" | "cyber" | "other" {
  const blob = `${objectName(object)} ${materialName(material)}`;
  if (blob.includes("cornea")) return "cornea";
  if (blob.includes("eye") || blob.includes("iris") || blob.includes("sclera")) return "eye";
  if (blob.includes("teeth") || blob.includes("tooth") || blob.includes("gum")) return "teeth";
  if (blob.includes("tongue")) return "tongue";
  if (blob.includes("mouth") || blob.includes("interior") || blob.includes("cavity")) return "mouth";
  if (blob.includes("cyber") || blob.includes("implant") || blob.includes("metal")) return "cyber";
  if (blob.includes("skin") || blob.includes("head") || blob.includes("neck") || blob.includes("face") || blob.includes("body")) {
    return "skin";
  }
  return "other";
}

function prepareMaps(material: THREE.MeshStandardMaterial, anisotropy: number) {
  const maps = [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap];
  for (const map of maps) {
    if (!map) continue;
    map.anisotropy = anisotropy;
    if ("colorSpace" in map && material.map === map) {
      map.colorSpace = THREE.SRGBColorSpace;
    }
  }
}

export function prepareAvatarMaterials(root: THREE.Object3D, anisotropy: number) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.frustumCulled = false;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const nextMaterials = materials.map((material) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      prepareMaps(material, anisotropy);
      const kind = classify(object, material);
      if (kind === "cornea") {
        const physical = material instanceof THREE.MeshPhysicalMaterial ? material : upgradePhysical(material);
        physical.transmission = Math.max(physical.transmission, 0.72);
        physical.thickness = physical.thickness || 0.02;
        physical.ior = physical.ior || 1.4;
        physical.roughness = Math.min(physical.roughness, 0.06);
        physical.metalness = 0;
        physical.transparent = true;
        physical.envMapIntensity = 1.1;
        return physical;
      }
      if (kind === "skin") {
        const physical = material instanceof THREE.MeshPhysicalMaterial ? material : upgradePhysical(material);
        physical.metalness = Math.min(physical.metalness, 0.04);
        physical.roughness = THREE.MathUtils.clamp(physical.roughness || 0.48, 0.38, 0.62);
        physical.sheen = 0.28;
        physical.sheenRoughness = 0.55;
        physical.sheenColor = new THREE.Color("#c08a78");
        physical.envMapIntensity = 0.35;
        return physical;
      }
      if (kind === "eye") {
        material.roughness = Math.min(material.roughness, 0.22);
        material.metalness = Math.min(material.metalness, 0.12);
        material.envMapIntensity = 0.85;
        if (material.emissive.getHex() === 0) {
          material.emissive = new THREE.Color("#1a6a88");
          material.emissiveIntensity = 0.18;
        }
        return material;
      }
      if (kind === "teeth") {
        material.roughness = Math.min(material.roughness || 0.35, 0.4);
        material.metalness = 0.02;
        material.envMapIntensity = 0.45;
        return material;
      }
      if (kind === "tongue" || kind === "mouth") {
        material.roughness = Math.max(material.roughness, 0.55);
        material.metalness = 0;
        material.envMapIntensity = 0.2;
        return material;
      }
      if (kind === "cyber") {
        material.metalness = Math.max(material.metalness, 0.65);
        material.roughness = Math.min(material.roughness || 0.28, 0.35);
        material.envMapIntensity = 0.9;
        if (material.emissive.getHex() === 0) {
          material.emissive = new THREE.Color("#123044");
          material.emissiveIntensity = 0.45;
        }
        return material;
      }
      material.envMapIntensity = 0.55;
      return material;
    });
    object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
  });
}

export function selectLodMeshes(root: THREE.Object3D, quality: "ULTRA" | "HIGH" | "MEDIUM" | "LOW") {
  const wanted = quality === "MEDIUM" || quality === "LOW" ? ["lod1", "lod2"] : ["lod0"];
  const hasLod = { current: false };
  root.traverse((object) => {
    const name = object.name.toLowerCase();
    if (name.includes("lod0") || name.includes("lod1") || name.includes("lod2")) hasLod.current = true;
  });
  if (!hasLod.current) return;
  root.traverse((object) => {
    const name = object.name.toLowerCase();
    if (name.includes("lod0")) object.visible = quality === "ULTRA" || quality === "HIGH";
    else if (name.includes("lod1")) object.visible = quality === "MEDIUM" || (quality === "LOW" && wanted.includes("lod1"));
    else if (name.includes("lod2")) object.visible = quality === "LOW" || quality === "MEDIUM";
  });
}
