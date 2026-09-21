# NOVA Final Character Pipeline

Dieses Dokument ist die Produktionsanleitung für das fotorealistische NOVA-Gesicht.
Die Engine existiert. Das Character-Asset existiert **nicht**.

Die weiße Figur im Interface ist die **DEVELOPMENT RIG**. Sie ist kein Zwischen-NOVA und darf nicht verschönert, texturiert oder mit dem Referenzbild beklebt werden.

## Entscheidung

Kann Cursor das finale fotorealistische NOVA-Character-Asset mit den Mitteln dieses Repos erstellen?

**NEIN.**

TypeScript, Three.js-Primitive und das Referenz-WebP erzeugen keinen Digital Human.
Das Asset muss extern von Character Art / Rigging / Lookdev erstellt und als validiertes `public/nova/avatar/nova.glb` geliefert werden.

---

## 1. Ausgangspunkt

Vorhanden:

- Three.js/WebGL Avatar Runtime
- ARKit-52 Facial Contract + `NovaFacialRigAdapter`
- Bones, Morph Targets, Timeline, Behavior, Emotion
- Development Rig nur zum Testen der Engine
- Referenzidentität: `reference/nova-face.webp`
- Validator: `npm run validate:avatar`
- Manifest: `public/nova/avatar/manifest.json` (`validated: false`)

Nicht vorhanden:

- `public/nova/avatar/nova.glb`
- PBR-Skin, echte Augen, Zähne, Zunge, cybernetische Geometrie von NOVA

## 2. Referenzbild

`reference/nova-face.webp` ist verbindliche Designreferenz.

Erlaubt: Sculpt, Proportion, Material, Lighting, Identität.
Verboten: Face Plane, Billboard, Image Warp, Albedo-Projektion, Fake-Depth-Mesh, animiertes Foto.

NOVA muss auf den ersten Blick dieselbe Person sein: weiblich, intensive Augen, klare Kontur, Lippen/Nase/Brauen der Referenz, Stirn-Tech, cyan/blaue Emissive, elegante statt aggressive Sci-Fi-Ästhetik.

## 3. Zielqualität

Digital Human / Hero Close-up, Portrait-Framing.

Nicht: Game-NPC, Cartoon, Roboterdummy, stilisierter Meta-Avatar, Plastikgesicht.

Abnahme nur, wenn `jawOpen` echte Lippen/Jaw bewegt, Lider echte Meshes sind, Zähne/Zunge/Mundhöhle existieren und das Referenzbild **nicht** das Gesicht ist.

## 4. Character Creation Pipeline

Empfohlene professionelle Kette (aktueller Industriestandard, nicht im Repo ausführbar):

1. **Blocking / Identity Sculpt**
   - ZBrush oder Blender 4 Multires gegen die Referenz (Front + abgeleitete Side-Proportion).
   - Optionaler Start: MetaHuman / Character Creator Headshot als anatomische Basis – danach **Umsculpt auf NOVA-Identität**. Der Foto-Scan darf nicht das finale Face-Albedo bleiben.
2. **Retopology**
   - Maya / Blender / TopoGun. Edge Loops für Mund, Lider, Nasolabial, Stirn.
   - LOD0 40k–80k Tris Kopf+Hals+oberer Torso.
3. **Wrap / Blendshape Transfer**
   - Faceform Wrap oder vergleichbar: ARKit-52 (plus optionale Tongue-Shapes von Audio2Face-3D) auf NOVA-Topo.
   - Quelle: standardisiertes ARKit-Base (MetaHuman / CC Facial Profile / eigenes Neutral).
4. **Lookdev / Texturing**
   - Substance 3D Painter: Skin BaseColor, Normal, Roughness, AO, optionale Thickness.
   - Keine eingebrannten Lights. Micro-Normal für Poren.
   - Augen, Zähne, Zunge, Mundhöhle, Cybernetic eigene Sets.
5. **Eyes**
   - Getrennte Sklera/Iris/Pupille + Cornea-Mesh (Transmission, IOR ~1.4).
   - Eye Bones + `eyeLook*` Blendshapes. Kein flacher Emissive-Billboard.
6. **Mouth interior**
   - Zähne oben/unten, Gums, Zunge, dunkle Cavität. Bei `jawOpen=1` darf kein leerer Schädel sichtbar sein.
7. **Cybernetic**
   - Stirn-Element, Schläfen, Hals als **eigene Geometrie + Emissive-Materials**, nicht nur in die Skin-Map gemalt, wo räumlich sichtbar.
8. **Hair / Head**
   - Referenz ist clean/futuristisch. Keine Standardfrisur. Wenn Haar: groomeable Cards oder Strands in Hero-Qualität, sonst kahl/scalp + Tech.
9. **Export**
   - Blender 4.x glTF 2.0 Binary, Morph Targets erhalten, Skin ≤ 4 influences, Texturen embedded.
10. **Integration**
    - Datei nach `public/nova/avatar/nova.glb`
    - `npm run validate:avatar` muss 0 liefern
    - `manifest.json`: `quality: production`, `validated: true`, `status: PRODUCTION`
    - Runtime lädt das Asset erst nach dieser Validierung

## 5. Modeling Requirements

- Weiblicher Head, Hals, Schulter/oberer Torso
- Anatomische Lippen, Lider, Nase, Ohren soweit im Portrait sichtbar
- Separate Eyes, Cornea, Teeth, Tongue, Mouth Interior
- Cybernetic Inserts als Meshes
- Kein Plane, kein skinned Quad mit Foto

## 6. Rig Requirements

Pflichtknochen: `Root`, `Spine`, `Neck`, `Head`, `Jaw`, `LeftEye`, `RightEye`

Bind Pose: Mund geschlossen, Blick +Z, Neutral.
Jaw lokale X-Rotation. Eyes Children von Head.
Koordinaten: Y-up, Meter, Kopfhöhe ≈ 1.55–1.65 m.

## 7. Blendshape Requirements

Die 52 Namen aus `docs/NOVA_3D_ASSET_SPEC.md` / `NOVA_BLENDSHAPE_NAMES`.
camelCase ARKit (`jawOpen`). Aliase mappt der Adapter, Liefernorm bleibt camelCase.

Zusätzlich sinnvoll für Audio2Face-3D Tongue (ab v1.3, wenn Zunge enabled):
`TongueTipUp` … `TongueNarrow`.

Werte 0–1. `extras.targetNames` im GLB setzen.
Morphs müssen Vertexpositionen tatsächlich ändern (Validator prüft das).

## 8. Texture Requirements

| Slot | Maps | Hero |
| --- | --- | --- |
| Skin | BaseColor, Normal, Roughness, AO, optional Thickness | 4k (min 2k) |
| Eye | BaseColor, Normal, Emissive | 1k–2k |
| Cornea | Roughness/Transmission | klein |
| Teeth / Tongue / Interior | BaseColor, Roughness | 1k–2k |
| Cybernetic | BaseColor, Metalness, Roughness, Emissive Cyan | 1k–2k |

Color spaces: BaseColor/Emissive sRGB, Data maps Linear.
Keine Light-Bakes im Albedo.

## 9. Cybernetic Requirements

- Forehead-Tech der Referenz als Mesh
- Temple / Neck Details, wo silhouettenwirksam
- Emissive cyan/blue, metallische Roughness niedrig
- Elegante, nicht aggressive Sci-Fi-Form

## 10. Export

- Container: glTF 2.0 `.glb`
- Pfad: `public/nova/avatar/nova.glb`
- `extras.novaIdentity = "NOVA"`
- `extras.novaDevelopmentRig` darf **nicht** true sein
- Keine Camera/Lights im Asset
- Optional Draco, aber Morph Targets müssen erhalten bleiben
- Optional KTX2; Runtime kann später KTX2Loader erhalten. Erstes Asset darf PNG/JPEG embedded sein.

## 11. Validation

```bash
npm run validate:avatar
```

Exit 0 nur bei vollständigem Production-Asset.
Exit 2 = `FINAL_AVATAR_MISSING`.
Exit 1 = Datei da, Acceptance fehlgeschlagen.

Die Development Rig als `nova.glb` zu kopieren **schlägt fehl** (Dev-Marker, keine Skin-Texturen, Identität).

## 12. Integration

1. Asset ablegen
2. Validator grün
3. Manifest auf `validated: true`, `quality: production`
4. Dev-Server: Runtime lädt `/nova/avatar/nova.glb`
5. Avatar Lab: Blendshapes, Viseme, Lighting, Camera, manueller Referenzvergleich
6. Erst dann Production-UI ohne DEVELOPMENT-RIG-Badge

Ohne validiertes Manifest bleibt lokal die Development Rig sichtbar und in `NODE_ENV=production` der Status **FINAL_AVATAR_MISSING**.

## 13. Audio2Face

HeuristicFacialProvider = **DEVELOPMENT ONLY**.

Produktionsziel laut aktueller NVIDIA-Dokumentation:

- [Audio2Face-3D NIM](https://docs.nvidia.com/nim/digital-human/a2f-3d/latest/index.html)
- gRPC `A2FControllerService.ProcessAudioStream`
- [ACE A2F RPC](https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/interacting/a2f-rpc.html)
- Input: PCM 16-bit mono, typisch 16 kHz
- Output: ARKit Blendshapes + optionale Joints, `time_code` in Sekunden
- Läuft **nicht** im Browser; GPU-NIM (Ubuntu, CUDA)
- Lizenz: NVIDIA NIM / ACE Product Terms; Models: NVIDIA Open Model License
- NOVA-Weg: Web App → Voice Audio → `/api/nova/avatar-animation` → gRPC NIM → `NovaFacialFrame[]` → Three.js

## 14. Performance

Siehe `PERFORMANCE_BUDGET` in `features/avatar/acceptance.ts`.

- Desktop-Standard: Quality **HIGH**, 60 FPS Ziel
- **ULTRA** für starke GPUs (Anisotropy 16, Shadows, leichtes Bloom)
- **MEDIUM** reduziert Effekte, bleibt 3D
- Kein Foto-Fallback
- LOD0–2 im Asset optional; Runtime blendet `LOD0/1/2` Meshes nach Quality

## 15. Acceptance Criteria

Production ist erreicht, wenn alle wahr sind:

1. `public/nova/avatar/nova.glb` existiert
2. `npm run validate:avatar` Exit 0
3. Manifest `validated: true` und `quality: production`
4. Renderer zeigt echtes Multi-Mesh PBR, nicht die weiße Testfigur
5. `jawOpen`, Blink, Eye-Look, Jaw/Head Bones funktionieren am NOVA-Mesh
6. Mundhöhle/Zähne/Zunge bei geöffnetem Mund sichtbar
7. Referenzvergleich im Avatar Lab manuell als Identität akzeptiert – Engine behauptet das nicht automatisch
8. Audio2Face-Pfad konfigurierbar; Heuristic nicht als fertiges Lip-Sync verkauft
