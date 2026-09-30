import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "openai"],
  // NOVA.app läuft über „next dev“: das Next-Symbol („N“) unten links gehört nicht in die Oberfläche.
  // Kompilier- und Laufzeitfehler zeigt Next trotzdem an.
  devIndicators: false,
};

export default nextConfig;
