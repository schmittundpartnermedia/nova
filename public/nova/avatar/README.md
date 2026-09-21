# Production NOVA Avatar

Place the validated photoreal digital human here:

`nova.glb`

Rules:

- Do not copy the Development Rig to this path.
- Do not set `manifest.json` `validated: true` unless `npm run validate:avatar` exits 0.
- The runtime will not treat a file named nova.glb as production unless the manifest is validated and the asset passes acceptance.
