import { NextResponse } from 'next/server';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { doc, getDoc } from 'firebase/firestore';
import type { CompanyProfile } from '@/lib/definitions';

export const dynamic = 'force-dynamic';

const defaultBranding = { 
    logoUrl: null, 
    logoFit: 'contain',
    headerShowLogo: true,
    loginBackgroundType: 'color',
    loginBackgroundValue: '#0F172A',
    loginOverlayEnabled: true,
    loginOverlayColor: '#000000',
    loginOverlayOpacity: 0.5,
    loginBackgroundFit: 'cover',
    loginShowBranding: true,
};

/**
 * API DE BRANDING v103.0.0 - ULTRA RESILIENCIA
 * Respuesta inmediata para evitar bloqueos en la pantalla de login.
 */
export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const { firestore } = initializeFirebaseServer();
    if (!firestore) return NextResponse.json(defaultBranding);

    const profileRef = doc(firestore, 'companyProfile', 'main');
    const profileSnap = await getDoc(profileRef);
    
    clearTimeout(timeoutId);

    if (profileSnap.exists()) {
      const profile = profileSnap.data() as CompanyProfile;
      return NextResponse.json({ 
        ...defaultBranding,
        logoUrl: profile.logoUrl || null,
        logoFit: profile.logoFit || 'contain',
        headerShowLogo: profile.headerShowLogo ?? true,
        loginBackgroundType: profile.loginBackgroundType || 'color',
        loginBackgroundValue: profile.loginBackgroundValue || '#0F172A',
        loginOverlayEnabled: profile.loginOverlayEnabled ?? true,
        loginOverlayColor: profile.loginOverlayColor || '#000000',
        loginOverlayOpacity: profile.loginOverlayOpacity ?? 0.5,
        loginBackgroundFit: profile.loginBackgroundFit || 'cover',
        loginShowBranding: profile.loginShowBranding ?? true,
      });
    }
    
    return NextResponse.json(defaultBranding);

  } catch (error) {
    return NextResponse.json(defaultBranding);
  }
}
