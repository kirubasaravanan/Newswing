import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["technicalindicators"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  turbopack: {},
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
    ],
  },
};

export default nextConfig;
