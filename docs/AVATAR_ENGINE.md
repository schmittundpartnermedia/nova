# NOVA Digital Human Engine

## Entscheidung: Three.js, nicht React Three Fiber

Die Avatar Runtime ist **imperatives Three.js (WebGL)** hinter einem dünnen React-Canvas-Host.

Begründung:

- Facial Frames laufen mit der Audio-Masterclock bei 60 FPS. Das darf nicht durch React-Reconciliation.
- `FacialAnimationEngine`, Timeline und Rig Adapter müssen unabhängig von React testbar und später in einem eigenen Animation Service nutzbar sein.
- Ein einzelner Portrait-Character braucht keine deklarative Scene-Graph-Schicht.
- Next.js SSR und R3F würden Komplexität ohne Gewinn erzeugen.

React Three Fiber bleibt optional für spätere Editor-Tools, nicht für die produktive NOVA Runtime.

## Architektur

```
NOVA AI
  ├── Cognitive State / Response / Emotion / Voice
  ▼
Avatar Runtime (Browser)
  ├── Voice Sync          (OpenAI TTS Audio, AudioContext clock)
  ├── FacialAnimationEngine
  ├── NovaBehaviorEngine
  ├── EyeTargetController
  └── NovaFacialRigAdapter
        ▼
     3D FACE RIG (glTF Morph Targets + Bones)
        ▼
     Three.js WebGL Renderer
        ▼
     NOVA
```

Voice Provider und Facial Animation Provider sind getrennte Systeme.

Beispielziel:

- OpenAI → Audio
- NVIDIA Audio2Face-3D NIM → Facial Frames (gRPC, nicht Browser)
- Three.js → Rendering

## Audio ist Master Clock

`AvatarTimelineController` sampled Frames an `AudioContext.currentTime`.
Ein Frame mit `timestampMs: 1240` wird gerendert, wenn die Playback-Zeit ≈ 1240 ms ist.

## NVIDIA Audio2Face-3D

Läuft **nicht** im Browser.

Dokumentierte Schnittstelle (ACE Audio2Face-3D NIM v2):

- gRPC `nvidia_ace.services.a2f_controller.v1.A2FControllerService.ProcessAudioStream`
- Input: PCM 16-bit mono, typisch 16 kHz
- Output: ARKit Blendshapes + optionale Joints, `time_code` in Sekunden
- GPU-NIM, Ubuntu, CUDA 12.8–12.9, Treiber R570+
- Lizenz: NVIDIA SLA / Product-Specific Terms; Models: NVIDIA Open Model License;
  Audio2Emotion nicht als eigenständige Emotionserkennung

NOVA-Weg:

`Web App → /api/nova/avatar-animation → Avatar Animation Service → A2F gRPC → NovaFacialFrame[] → Web Runtime`

Ohne `NOVA_A2F_GRPC_URL` bleibt der lokale **HeuristicFacialProvider (DEVELOPMENT ONLY)** aktiv.
Das ist kein Production-Lip-Sync.

## Development Rig vs Production

`public/nova/dev-rig/nova-dev-rig.glb` ist klar als **DEVELOPMENT RIG** gekennzeichnet.

Finale Datei: `public/nova/avatar/nova.glb`.
Sie wird **nur** geladen, wenn `public/nova/avatar/manifest.json` `validated: true` hat **und** `npm run validate:avatar` das Asset akzeptiert.

Eine Datei namens `nova.glb` allein reicht nicht.

In `NODE_ENV=production` ohne validiertes Asset: Status `FINAL_AVATAR_MISSING`.

Siehe [NOVA Final Character Pipeline](NOVA_FINAL_CHARACTER_PIPELINE.md).
