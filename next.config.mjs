/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // TopoJSON is served statically from /public and gzipped by Vercel's edge.
  async headers() {
    return [
      {
        source: '/india-states.topo.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
