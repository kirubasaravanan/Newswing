import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone", -- disabled, using next start directly
  serverExternalPackages: ["technicalindicators"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
    ],
  },
};

export default nextConfig;
