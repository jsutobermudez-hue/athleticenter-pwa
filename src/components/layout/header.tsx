'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { usePathname, useRouter } from 'next/navigation';
import { EditUserDialog } from '@/app/dashboard/users/edit-user-dialog';
import { useAuth, useUser, useDoc, useMemoFirebase, useFirestore } from '@/firebase';
import { signOut } from 'firebase/auth';
import { NotificationsPopover } from './notifications-popover';
import { ReloadAppButton } from './ReloadAppButton';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Search, Wifi, WifiOff, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DynamicAppLogo } from '../icons/dynamic-app-logo';
import { doc } from 'firebase/firestore';
import type { CompanyProfile, FinancialSettings } from '@/lib/definitions';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

const spanishLabels: { [key: string]: string } = {
    dashboard: 'Panel',
    inventory: 'Inventario',
    orders: 'Pedidos',
    dispatch: 'Despacho',
    billing: 'Facturación',
    users: 'Usuarios',
    clients: 'Clientes',
    salespeople: 'Vendedores',
    carriers: 'Transportistas',
    notifications: 'Notificaciones',
    quotes: 'Cotizaciones',
    audit: 'Auditoría',
};

function LiveClock() {
    const [timeStr, setTimeStr] = useState<string>('');

    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setTimeStr(format(now, 'hh:mm a • dd MMM').toUpperCase());
        };
        updateClock();
        const timer = setInterval(updateClock, 1000);
        return () => clearInterval(timer);
    }, []);

    if (!timeStr) return null;

    return (
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 text-[10px] font-mono font-bold shadow-2xs">
            <Clock className="h-3 w-3 text-slate-500" />
            <span>{timeStr}</span>
        </div>
    );
}

function ConnectionStatus() {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        const updateStatus = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', updateStatus);
        window.addEventListener('offline', updateStatus);
        return () => {
            window.removeEventListener('online', updateStatus);
            window.removeEventListener('offline', updateStatus);
        };
    }, []);

    return (
        <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all border shadow-2xs",
            isOnline ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-rose-50 border-rose-100 text-rose-600 animate-pulse"
        )}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span className="text-[8px] font-black uppercase tracking-widest hidden sm:inline">
                {isOnline ? "Sincronizado" : "Sin Conexión"}
            </span>
        </div>
    );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const firestore = useFirestore();
  const { profile } = useUser();
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  const companyProfileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 65.50;

  const isAdmin = useMemo(() => {
    if (!profile) return false;
    return ['superadmin', 'admin', 'gerencia'].includes(profile.role);
  }, [profile]);

  const segments = pathname.split('/').filter(Boolean);
  const userAvatarPlaceholder = PlaceHolderImages.find(p => p.id === 'user-avatar')?.imageUrl || "https://picsum.photos/seed/avatar/40/40";

  const handleLogout = async () => {
    if (!auth) return;
    try {
        await signOut(auth);
        router.push('/login');
    } catch (error) {
        console.error("Error signing out: ", error);
    }
  };

  const getBreadcrumbLabel = (segment: string) => {
    return spanishLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
  };

  const showLogoInHeader = companyProfile?.headerShowLogo ?? true;

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-md px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 mx-auto w-full max-w-[1600px]">
        <SidebarTrigger className="md:hidden" />
        <div className="flex items-center gap-4 flex-1">
          <SidebarTrigger className="hidden md:flex" />
          
          {showLogoInHeader && (
              <div className="hidden sm:flex items-center mr-2 animate-in fade-in zoom-in-95 duration-500">
                  <DynamicAppLogo className="h-6 w-auto" />
              </div>
          )}

          <Breadcrumb className="hidden font-medium md:flex ml-2">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                    <Link href="/dashboard" className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900">Panel</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {segments.slice(1).map((segment) => (
                <React.Fragment key={segment}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-[10px] font-black uppercase tracking-widest text-slate-900">{getBreadcrumbLabel(segment)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        
        <div className="relative ml-auto flex items-center gap-2.5 md:grow-0">
          <LiveClock />

          <div className="hidden sm:flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60 text-[10px] font-black uppercase shadow-2xs">
            <span>💱 BCV: <strong className="text-emerald-950 dark:text-emerald-200 font-black">Bs. {bcvRate.toFixed(2)}</strong></span>
          </div>

          <ConnectionStatus />
          <Badge className="bg-slate-900 text-white font-black text-[9px] uppercase px-2 py-0.5 rounded-md shadow-2xs border border-white/10 hidden sm:inline-flex">v1.7.1</Badge>
          <ReloadAppButton />
          <NotificationsPopover />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="overflow-hidden rounded-full h-9 w-9 border-2 border-slate-200 dark:border-slate-800 hover:scale-105 transition-all">
              <Image src={profile?.avatarUrl || userAvatarPlaceholder} width={40} height={40} alt="User" className="overflow-hidden rounded-full object-cover" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl border-border/60 shadow-xl w-56">
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex justify-between items-center">
              <span>Mi Mando</span>
              <Badge variant="outline" className="text-[8px] font-black uppercase border-none bg-slate-100 text-slate-700 px-1.5 py-0.5">
                {profile?.role || 'USUARIO'}
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {profile && (
              <DropdownMenuItem className="font-bold text-xs" onSelect={() => setIsProfileDialogOpen(true)}>Editar Perfil</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-rose-600 font-bold" onClick={handleLogout}>Cerrar Sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {profile && (
        <EditUserDialog user={profile} isOpen={isProfileDialogOpen} onOpenChange={setIsProfileDialogOpen} />
      )}
    </>
  );
}
