import type { NextConfig } from "next";

const repoBase = "/KPI-VN30-dashboard";

const nextConfig: NextConfig = {
  output: "export",
  basePath: repoBase,
  assetPrefix: `${repoBase}/`,
  trailingSlash: true,
};

export default nextConfig;
