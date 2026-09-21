# NOVA 3D Asset Specification

Dieses Dokument beschreibt das **finale** NOVA Digital-Human-Asset `public/nova/avatar/nova.glb`.
Es ist die Produktionsvorgabe für Character Art / Rigging. Das im Repo liegende
`public/nova/dev-rig/nova-dev-rig.glb` ist **nur** eine Development Rig.

Das Referenzbild `reference/nova-face.webp` ist **ausschließlich Designreferenz**.
Es darf nicht auf das Mesh projiziert, als Face-Plane verwendet oder animiert werden.

## Identität

- Weibliche Erscheinung, spätes 20. / frühes 30.
- Gesicht, Proportionen, Augen und Farbwelt am Referenzbild ausrichten.
- Futuristisch / cybernetisch: dezente Implantate, Cyan-Emissive, dunkles Haar/Outfit.
- Kein Cartoon, kein stylisierter Game-Hero, kein Plastikgesicht.

## Format

| Feld | Vorgabe |
| --- | --- |
| Container | **glTF 2.0 Binary (`.glb`)** |
| Dateiname | `public/nova/avatar/nova.glb` |
| Koordinatensystem | Y-up, rechte Hand, glTF |
| Einheit | 1 Einheit = 1 Meter |
| Origin | Füße / Hüfte auf Y=0, Blick +Z |
| Skala | reale Human-Scale, Kopfhöhe ≈ 1.55–1.65 m |
| Animation | Morph Targets + Skeleton, keine baked Mesh-Animation für Lippen |
| Kompression | optional Draco, aber Morph Targets müssen erhalten bleiben |
| Embedding | alle Texturen im GLB |

## Polygon Budget

| LOD | Tris (Kopf+Hals+Oberkörper) | Einsatz |
| --- | --- | --- |
| LOD0 / Hero | 40k–80k | Default Desktop HIGH |
| LOD1 | 20k–35k | MEDIUM |
| LOD2 | 8k–15k | LOW, niemals 2D-Fallback |

Zunge, Zähne, Mundinnenraum und Augen extra, nicht im Kopf-Tris-Limit verstecken.
Wimpern als Geometry oder Hair Cards, nicht als 2D-Overlay auf einem Foto.

## Mesh-Pflichtteile

- Head
- Neck
- Shoulders / Upper chest (Portrait-Framing)
- Eyes (Sklera + Iris + Pupille)
- Cornea (separates, leicht größeres Mesh, Transmission/Clearcoat)
- Eyelids (Blendshapes, nicht Texture-Swap)
- Teeth (upper/lower)
- Tongue
- Mouth interior / cavity
- optionale cybernetische Einsätze als eigene Material-Slots

## Skeleton / Bones

Pflichtknochen (Namen bevorzugt exakt, Alias wird über `NovaFacialRigAdapter` gemappt):

- `Root`
- `Spine` (mindestens eine)
- `Neck`
- `Head`
- `Jaw`
- `LeftEye`
- `RightEye`

Optional: `LeftEyelid`, `RightEyelid`, Clavicles, extra Neck bones.
Jaw-Rotation um lokale X, Eye-Bones als Children von Head.

Bind Pose: Mund geschlossen, Blick geradeaus, Neutralgesicht.

## Blendshapes / Morph Targets

ARKit-/Digital-Human-Semantik. Werte 0.0–1.0, relative oder absolute Morphs,
aber **konsistent** und im GLB als `extras.targetNames` benannt.

Pflicht:

```
jawOpen jawForward jawLeft jawRight
mouthClose mouthFunnel mouthPucker mouthLeft mouthRight
mouthSmileLeft mouthSmileRight mouthFrownLeft mouthFrownRight
mouthDimpleLeft mouthDimpleRight mouthStretchLeft mouthStretchRight
mouthRollLower mouthRollUpper mouthShrugLower mouthShrugUpper
mouthPressLeft mouthPressRight
mouthLowerDownLeft mouthLowerDownRight mouthUpperUpLeft mouthUpperUpRight
eyeBlinkLeft eyeBlinkRight eyeSquintLeft eyeSquintRight
eyeLookUpLeft eyeLookUpRight eyeLookDownLeft eyeLookDownRight
eyeLookInLeft eyeLookInRight eyeLookOutLeft eyeLookOutRight
browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight
cheekPuff cheekSquintLeft cheekSquintRight
noseSneerLeft noseSneerRight
tongueOut
```

Empfohlen zusätzlich: `eyeWideLeft`, `eyeWideRight`, Tongue-Set von Audio2Face-3D
(`TongueTipUp` … `TongueNarrow`) wenn Zunge detailliert ist.

Naming: camelCase ARKit (`jawOpen`). Underscore-Aliase (`jaw_open`, `eyeBlink_L`)
werden vom Adapter verstanden, camelCase ist die Liefernorm.

## Eye Setup

- Getrennte Eye-Meshes, skinned oder parented an Eye Bones.
- Iris/Pupille lesbar bei Portrait-Framing.
- Subtiler emissiver Cyan-Glow (Material, nicht Post-Only).
- Cornea: MeshPhysical, hohe Transmission, niedrige Roughness, IOR ~1.4.
- Blick über Bones **und** `eyeLook*` Blendshapes; Engine mischt beides.

## Materialien

PBR Metallic-Roughness, glTF 2.0.

| Slot | Zweck | Maps |
| --- | --- | --- |
| Skin | Gesicht, Hals | BaseColor, Normal, Roughness, AO, optional Thickness/SSS |
| Eye | Sklera/Iris | BaseColor, Normal, Emissive |
| Cornea | Hornhaut | Transmission / roughness |
| Teeth | Zähne | BaseColor, Roughness, Normal |
| Tongue | Zunge | BaseColor, Roughness |
| MouthInterior | Mundraum | dunkles BaseColor |
| Cybernetic | Implantate / Kragen | BaseColor, Metalness, Roughness, Emissive (Cyan) |
| Hair | optional | Alpha / depth |

Skin: kein reines Metalness-Face. Roughness 0.35–0.55, Metalness ≈ 0.
Subsurface soweit WebGL sinnvoll: `KHR_materials_volume` / transmission sehr gering
oder Thickness-Map. Kein Uniform-Plastic-Shader.

## Texturen

| Map | Auflösung Hero | Color space |
| --- | --- | --- |
| Skin BaseColor | 4k (min 2k) | sRGB |
| Skin Normal | 4k (min 2k) | Linear |
| Skin Roughness/AO | 2k–4k | Linear |
| Eyes | 1k–2k | sRGB + Linear Normal |
| Cybernetic | 1k–2k | sRGB / Linear |
| Emissive | 1k | sRGB |

Keine ins BaseColor eingebrannten Key-/Rim-Lights. Beleuchtung kommt aus der Scene.

## UVs

- Eine Haut-UV0 ohne extreme Stretching im Gesicht.
- Augen/Zähne/Zunge eigene UDIMs oder eigene UV-Sets.
- Nahtführung hinter den Ohren / am Haaransatz, nicht durch Lippen oder Lider.

## Export

- Blender 4.x / Maya / Metahuman-Pipeline → glTF 2.0
- Apply Scale, Triangulate optional (glTF trianguliert)
- Morph Targets **nicht** als Shape-Key-Animation bakken
- Skin weights normalisiert, max 4 influences
- Keine Camera/Light im Asset nötig (NOVA bringt die Scene mit)
- `extras.novaDevelopmentRig` darf auf dem finalen Asset **nicht** true sein
- `extras.novaIdentity = "NOVA"`

## Performance Budget

- GPU Skinning + 52 Morphs auf Desktop 60 FPS
- VRAM Asset < 120 MB entpackt, GLB < 80 MB angestrebt
- Kein Blendshape-Count > 120 ohne LOD-Strategie

## LOD

- LOD0: volle Morphs, 4k Skin, Cornea, Bloom in der Scene
- LOD1: 2k Skin, weniger Geo, Morphs bleiben
- LOD2: 1k Skin, weniger Geo, Morphs bleiben
- **Kein** Rückfall auf statisches Foto

## Audio2Face / ARKit Kompatibilität

Output von NVIDIA Audio2Face-3D NIM nutzt dieselben ARKit-Namen
(`JawOpen`, `MouthSmileLeft`, …). Der Adapter mappt Groß/Kleinschreibung
und gängige Aliase. Joint-Output (`Head`, `Neck`, `Jaw`, Eyes) muss zu
diesem Skeleton passen.

## Abnahme

Ein Asset gilt nur als finales NOVA-Gesicht, wenn:

1. Es ein echtes 3D-Mesh ist, kein Textured Quad.
2. `jawOpen` die Mesh-Geometrie verändert.
3. `eyeBlinkLeft/Right` echte Lider bewegen.
4. Jaw- und Eye-Bones das Rig bewegen.
5. Das Referenzbild nicht als Albedo des Gesichts verwendet wird.
