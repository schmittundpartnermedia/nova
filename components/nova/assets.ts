/**
 * NOVA visual identity.
 * The canonical photograph is shown untransformed in the main UI.
 * 3D rigs stay isolated in /dev/avatar.
 */
export const NOVA_IDENTITY = {
  name: "NOVA",
  tagline: "Dein Business. Deine KI.",
  referenceFaceSrc: "/api/nova/reference-face",
  glowSrc: "/nova/nova-glow.svg",
  particlesSrc: "/nova/nova-particles.svg",
  developmentRigSrc: "/nova/dev-rig/nova-dev-rig.glb",
  finalRigSrc: "/nova/avatar/nova.glb",
} as const;

export const NOVA_GLOW_SRC = NOVA_IDENTITY.glowSrc;
export const NOVA_PARTICLES_SRC = NOVA_IDENTITY.particlesSrc;
