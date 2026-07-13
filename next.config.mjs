import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  async redirects() {
    // Old static-page bookmarks land on the matching expanded bento panel.
    return [
      { source: '/index.html', destination: '/?p=goals', permanent: false },
      { source: '/health.html', destination: '/?p=stack', permanent: false },
      { source: '/po-water.html', destination: '/?p=water', permanent: false },
      { source: '/gym.html', destination: '/?p=gym', permanent: false },
      { source: '/finance.html', destination: '/?p=finance', permanent: false },
    ];
  },
};

export default nextConfig;
