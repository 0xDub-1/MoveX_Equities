import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The portfolio is the home page. Keep the old address working.
      { source: "/portfolio", destination: "/", permanent: true },
      // The board split into two sections; the old one is the equities board.
      { source: "/trading", destination: "/equities", permanent: false },
      // Crypto is built but not listed on this deployment. Keep the address
      // from answering with an empty board until it opens.
      { source: "/crypto", destination: "/equities", permanent: false },
      { source: "/crypto/:path*", destination: "/equities", permanent: false },
    ];
  },
};

export default nextConfig;
