import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "openai"],
  transpilePackages: ["three"],
};

export default nextConfig;
