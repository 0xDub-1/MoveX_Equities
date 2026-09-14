import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The portfolio is the home page. Keep the old address working.
  async redirects() {
    return [{ source: "/portfolio", destination: "/", permanent: true }];
  },
};

export default nextConfig;
