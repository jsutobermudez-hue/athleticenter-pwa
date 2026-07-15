import { NextResponse } from 'next/server';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { doc, getDoc } from 'firebase/firestore';
import type { CompanyProfile } from '@/lib/definitions';

export const dynamic = 'force-dynamic';

/**
 * GENERADOR DE MANIFIESTO DINÁMICO v12.0
 * Sincroniza el logo corporativo con la identidad PWA del dispositivo.
 */
export async function GET() {
  // Logo por defecto (Athleticenter Blue Triangle)
  const defaultLogoUrl = `data:image/svg+xml;base64,${Buffer.from(`<svg viewBox="0 0 50 45" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M25 0L0 45H8.5L25 15L41.5 45H50L25 0Z" fill="#2563EB"/><path d="M25 21L17.5 45H32.5L25 21Z" fill="white"/></svg>`).toString('base64')}`;

  const manifestBase = {
    name: 'Athleticenter Pro',
    short_name: 'Athleticenter',
    description: 'Gestión B2B de alto rendimiento para distribuidores deportivos.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0F172A',
    orientation: 'portrait',
    icons: [
      { src: defaultLogoUrl, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: defaultLogoUrl, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }
    ]
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const { firestore } = initializeFirebaseServer();
    if (!firestore) return NextResponse.json(manifestBase);

    const profileRef = doc(firestore, 'companyProfile', 'main');
    const profileSnap = await getDoc(profileRef);
    
    clearTimeout(timeoutId);

    if (profileSnap.exists()) {
      const profile = profileSnap.data() as CompanyProfile;
      if (profile.logoUrl) {
        // Detectar tipo MIME para asegurar compatibilidad con Android/iOS
        const logoType = profile.logoUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/)?.[1] || 'image/png';
        
        return NextResponse.json({
            ...manifestBase,
            name: profile.companyName || manifestBase.name,
            short_name: profile.companyName?.split(' ')[0] || manifestBase.short_name,
            icons: [
                { src: profile.logoUrl, sizes: '192x192', type: logoType, purpose: 'any' },
                { src: profile.logoUrl, sizes: '512x512', type: logoType, purpose: 'maskable' },
                // Fallback para iOS
                { src: profile.logoUrl, sizes: '180x180', type: logoType, purpose: 'any' }
            ]
        }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Content-Type': 'application/manifest+json',
            }
        });
      }
    }
    
    return NextResponse.json(manifestBase);

  } catch (error) {
    return NextResponse.json(manifestBase);
  }
}
