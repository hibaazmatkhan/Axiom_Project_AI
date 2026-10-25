/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoids double-mounting the WebGL canvas and socket in dev
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
