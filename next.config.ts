import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["technicalindicators"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "space-z.ai",
    "preview-chat-28ff4fbd-2816-4981-89d7-dc308f68dd0f.space-z.ai",
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
    ],
  },
};

export default nextConfig;