/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  generateBuildId: async () => 'build-' + Date.now(),
  // Raise API body size limit for large CSV uploads (Bybit spot ~7MB)
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
    responseLimit: '20mb',
  },
}
module.exports = nextConfig
