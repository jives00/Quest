/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  basePath: '/quest',
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.igdb.com" },
      { protocol: "https", hostname: "cdn2.steamgriddb.com" },
    ],
  },
  rewrites: () => {
    const apiUrl = process.env.API_URL ?? 'http://localhost:3007';
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${apiUrl}/api/:path*`, basePath: false },
      ],
    };
  },
};

export default nextConfig;
