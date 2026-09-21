/**
 * NOVA visual identity. The face asset is canonical — do not swap it
 * for another character. Replace only `public/nova/nova-face.webp`
 * when a higher-quality capture of this same identity exists.
 */
export const NOVA_IDENTITY = {
  name: "NOVA",
  tagline: "Dein Business. Deine KI.",
  faceSrc: "/nova/nova-face.webp",
  glowSrc: "/nova/nova-glow.svg",
  particlesSrc: "/nova/nova-particles.svg",
} as const;

export const NOVA_FACE_SRC = NOVA_IDENTITY.faceSrc;
export const NOVA_GLOW_SRC = NOVA_IDENTITY.glowSrc;
export const NOVA_PARTICLES_SRC = NOVA_IDENTITY.particlesSrc;
