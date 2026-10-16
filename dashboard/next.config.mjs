import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this app — the home directory has a stray
  // package-lock.json that otherwise wins Next.js's root inference.
  outputFileTracingRoot: here,
};

export default nextConfig;
