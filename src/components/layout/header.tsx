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
import { Search, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DynamicAppLogo } from '../icons/dynamic-app-logo';
import { doc } from 'firebase/firestore';
import type { CompanyProfile } from '@/lib/definitions';

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
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all border shadow-sm",
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

  const isAdmin = useMemo(() => {
    if (!profile) return false;
    return ['superadmin', 'admin', 'gerencia'].includes(profile.role);
  }, [profile]);

  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent('open-global-search'));
  };

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
  }

  const getBreadcrumbLabel = (segment: string) => {
    return spanishLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
  }

  const showLogoInHeader = companyProfile?.headerShowLogo ?? true;

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 mx-auto w-full max-w-[1600px]">
        <SidebarTrigger className="md:hidden" />
        <div className="flex items-center gap-4 flex-1">
          <SidebarTrigger className="hidden md:flex" />
          
          {showLogoInHeader && (
              <div className="hidden sm:flex items-center mr-2 animate-in fade-in zoom-in-95 duration-500">
                  <DynamicAppLogo className="h-6 w-auto" />
              </div>
          )}

          {isAdmin && (
            <Button 
                variant="outline" 
                className="hidden lg:flex items-center gap-2 px-4 h-9 rounded-full bg-muted/20 border-none text-muted-foreground font-medium text-xs hover:bg-muted/40 transition-all"
                onClick={handleOpenSearch}
            >
                <Search className="h-3.5 w-3.5" />
                <span>Búsqueda Inteligente...</span>
                <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100 ml-2">
                <span className="text-xs">⌘</span>K
                </kbd>
            </Button>
          )}

          <Breadcrumb className="hidden font-medium md:flex ml-4">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                    <Link href="/dashboard" className="text-[10px] font-black uppercase tracking-widest">Panel</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {segments.slice(1).map((segment) => (
                <React.Fragment key={segment}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="text-[10px] font-black uppercase tracking-widest">{getBreadcrumbLabel(segment)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        
        <div className="relative ml-auto flex items-center gap-2 md:grow-0">
          <ConnectionStatus />
          <ReloadAppButton />
          <NotificationsPopover />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="overflow-hidden rounded-full h-9 w-9 border-2 border-primary/10">
              <Image src={profile?.avatarUrl || userAvatarPlaceholder} width={40} height={40} alt="User" className="overflow-hidden rounded-full object-cover" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl border-border/60 shadow-xl w-56">
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Mi Mando</DropdownMenuLabel>
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
