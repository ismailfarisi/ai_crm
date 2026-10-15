import type { NextConfig } from 'next';
import { appRedirects } from './app-routes.mjs';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Read at build time, like every NEXT_PUBLIC_ value here: the Docker build
  // receives it as a build arg.
  async redirects() {
    return appRedirects(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');
  },
};

export default nextConfig;
