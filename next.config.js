/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  generateBuildId: async () => 'build-' + Date.now(),
}
module.exports = nextConfig
