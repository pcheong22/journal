/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This fixes the 'eval' error by allowing safe dynamic imports
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.output.globalObject = 'self'
    }
    return config
  },
}

module.exports = nextConfig