/**
 * NOVA visual identity.
 * The reference photograph is design-only. It is not a runtime face.
 */
export const NOVA_IDENTITY = {
  name: "NOVA",
  tagline: "Dein Business. Deine KI.",
  referenceFaceSrc: "/reference/nova-face.webp",
  glowSrc: "/nova/nova-glow.svg",
  particlesSrc: "/nova/nova-particles.svg",
  developmentRigSrc: "/nova/dev-rig/nova-dev-rig.glb",
  finalRigSrc: "/nova/avatar/nova.glb",
} as const;

export const NOVA_GLOW_SRC = NOVA_IDENTITY.glowSrc;
export const NOVA_PARTICLES_SRC = NOVA_IDENTITY.particlesSrc;
