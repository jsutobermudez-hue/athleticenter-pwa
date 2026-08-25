'use client';

import React, { useEffect, useState, useRef } from 'react';
import { syncBcvRateAction } from '../actions';
import { SidebarProvider, SidebarInset } from '../../components/ui/sidebar';
import { AppSidebar } from '../../components/layout/sidebar';
import { Header } from '../../components/layout/header';
import { useUser, useFirestore } from '../../firebase/context';
import { CatalogProvider } from '../../firebase/catalog-context';
import { FinanceProvider } from '../../context/FinanceContext';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { InstallBanner } from '../../components/layout/InstallBanner';
import { GlobalSearch } from '../../components/layout/global-search';
import { FloatingSearchButton } from '../../components/layout/floating-search-button';
import { Button } from '../../components/ui/button';
import { initializePushNotifications } from '../../lib/push-notifications';
import { NotificationToastListener } from '../../components/notifications/NotificationToastListener';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * DASHBOARD LAYOUT v5.0.0 (LAUNCH READY)
 * Blindaje: Bootstrap de datos maestros y registro conservador de notificaciones.
 */
function LoadingScreen() {
    return (
        <div className="relative flex h-svh w-full items-center justify-center bg-[#0F172A] overflow-hidden">
            <div className="flex flex-col items-center gap-6 animate-in fade-in duration-700">
                <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                <p className="text-white/40 font-black uppercase text-[10px] tracking-[0.4em]">Sincronizando Terminal</p>
            </div>
        </div>
    );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, isUserLoading } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const hasInitializedPush = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // BOOTSTRAP: Garantía de existencia de documentos críticos para el lanzamiento
  useEffect(() => {
      const initSystem = async () => {
          if (!mounted || !firestore || isUserLoading || !user) return;
          
          try {
              const finRef = doc(firestore, 'system', 'financials');
              const profileRef = doc(firestore, 'companyProfile', 'main');
              
              const [finSnap, profSnap] = await Promise.all([
                  getDoc(finRef),
                  getDoc(profileRef)
              ]);

              const updates = [];
              
              if (!finSnap.exists()) {
                  updates.push(setDoc(finRef, {
                      bcvRate: 54.5, // Valor nominal inicial
                      ivaPercent: 16,
                      defaultBcvDiscount: 35,
                      defaultCommission: 5,
                      salesManagerCommission: 5,
                      adminCommission: 5,
                      defaultOverhead: 10,
                      earlyPayment7Days: 10,
                      earlyPayment15Days: 5,
                      overdueBlockDays: 35,
                      updatedAt: serverTimestamp()
                  }));
              }

              if (!profSnap.exists()) {
                  updates.push(setDoc(profileRef, {
                      companyName: 'Athleticenter Pro',
                      companyRif: 'J-50000000-0',
                      companyAddress: 'Sede Principal, Caracas, Venezuela',
                      headerShowLogo: true,
                      updatedAt: serverTimestamp()
                  }));
              }

              if (updates.length > 0) {
                  await Promise.all(updates);
                  console.log("[Bootstrap] Documentos semilla generados exitosamente.");
              }
          } catch (e) {
              console.warn("[Bootstrap] Ignorado por falta de permisos o conexión.");
          } finally {
              setIsBootstrapping(false);
          }
      };

      initSystem();
  }, [mounted, firestore, isUserLoading, user]);

  // REGISTRO DE NOTIFICACIONES: Blindaje total contra "resource-exhausted"
  useEffect(() => {
    const checkAndInitPush = async () => {
        if (!mounted || isUserLoading || !user || !firestore || hasInitializedPush.current) return;

        const sessionKey = `push_init_${user.uid}`;
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator && !sessionStorage.getItem(sessionKey)) {
            hasInitializedPush.current = true;
            try {
                await initializePushNotifications(user.uid, firestore);
                sessionStorage.setItem(sessionKey, 'true');
            } catch (error) {
                console.warn("[Push] Inicialización fallida, se reintentará en la próxima sesión.");
            }
        }
    };

    checkAndInitPush();
  }, [mounted, isUserLoading, user, firestore]);

  // Sincronización automática de tasa BCV (solo administradores, una vez por sesión)
  useEffect(() => {
    const autoSyncBcv = async () => {
        if (!mounted || isUserLoading || !user || !profile) return;
        
        const isAdmin = ['admin', 'superadmin', 'gerencia'].includes(profile.role);
        if (!isAdmin) return;

        const sessionKey = 'bcv_auto_sync_checked';
        if (typeof window !== 'undefined' && !sessionStorage.getItem(sessionKey)) {
            sessionStorage.setItem(sessionKey, 'true');
            try {
                const res = await syncBcvRateAction();
                if (res.success && res.action === 'updated') {
                    console.log(`[BCV Auto Sync] Tasa oficial actualizada automáticamente a ${res.newRate} Bs.`);
                }
            } catch (error) {
                console.warn("[BCV Auto Sync] Error durante la sincronización automática:", error);
            }
        }
    };

    autoSyncBcv();
  }, [mounted, isUserLoading, user, profile]);

  useEffect(() => {

    if (!isUserLoading && mounted && !user) {
        router.replace('/login');
    }
  }, [user, isUserLoading, router, mounted]);

  if (!mounted || isUserLoading || isBootstrapping) return <LoadingScreen />;
  
  if (user && !profile) {
    return (
        <div className="flex h-svh w-full flex-col items-center justify-center bg-[#0F172A] text-white p-10 text-center gap-8">
            <div className="p-8 rounded-[2.5rem] bg-rose-500/10 text-rose-500">
                <AlertTriangle className="h-16 w-16" />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Fallo de Identidad</h1>
            <Button className="h-14 px-8 rounded-2xl bg-white text-slate-900" onClick={() => window.location.reload()}>REINTENTAR</Button>
        </div>
    );
  }

  if (!user || !profile) return null;

  return (
      <SidebarProvider>
          <CatalogProvider>
              <FinanceProvider>
                  <NotificationToastListener />
                  <AppSidebar />
                  <SidebarInset className="max-w-full overflow-x-hidden">
                      <Header />
                      <main className="p-2 sm:p-4 lg:p-6 mx-auto w-full max-w-[1600px] min-h-[calc(100dvh-60px)] overflow-y-auto overflow-x-hidden relative ios-touch-scroll">
                          {children}
                      </main>
                      <InstallBanner />
                      <GlobalSearch />
                      <FloatingSearchButton />
                  </SidebarInset>
              </FinanceProvider>
          </CatalogProvider>
      </SidebarProvider>
  );
}