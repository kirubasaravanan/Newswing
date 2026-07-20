import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["technicalindicators"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Use Webpack instead of Turbopack to avoid panics
  webpack: (config, { isServer }) => {
    return config;
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
    ],
  },
};

export default nextConfig;
