import type {NextConfig} from 'next';

/**
 * CONFIGURACIÓN DE PRODUCCIÓN v2.0
 * Endurecimiento: No se permiten fallos de tipos ni de linting durante el build.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
