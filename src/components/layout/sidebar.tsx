'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarCollapseButton,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Boxes,
  ShoppingCart,
  Truck,
  LayoutDashboard,
  Users,
  Ship,
  ClipboardList,
  Bell,
  Tag,
  Landmark,
  Calculator,
  CreditCard,
  Briefcase,
  ShieldAlert,
  User as UserIcon,
  BarChart3,
  Globe,
  Contact,
  FileBarChart,
  Settings,
  Zap,
  Sparkles,
  Percent,
  Activity
} from 'lucide-react';
import { DynamicAppLogo } from '../icons/dynamic-app-logo';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useUser } from '@/firebase';
import type { User } from '@/lib/definitions';
import { Skeleton } from '../ui/skeleton';
import { SupportDialog } from './support-dialog';
import { cn } from '@/lib/utils';
import { ReloadAppButton } from './ReloadAppButton';

type MenuItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: User['role'][];
};

// --- GRUPO 1: MANDO Y COMUNICACIÓN ---
const mandoItems: MenuItem[] = [
  { href: '/dashboard', label: 'Panel Principal', icon: LayoutDashboard, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito', 'cliente'] },
  { href: '/dashboard/notifications', label: 'Notificaciones', icon: Bell, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito', 'cliente'] },
  { href: '/dashboard/ai-analyst', label: 'Analista IA', icon: Sparkles, roles: ['superadmin', 'gerencia', 'admin', 'ventas'] },
];

// --- GRUPO 2: CICLO COMERCIAL ---
const comercialItems: MenuItem[] = [
  { href: '/dashboard/clients', label: 'Clientes', icon: Users, roles: ['superadmin', 'gerencia', 'admin', 'ventas'] },
  { href: '/dashboard/quotes', label: 'Cotizaciones', icon: ClipboardList, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'cliente'] },
  { href: '/dashboard/orders', label: 'Pedidos', icon: ShoppingCart, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito', 'cliente'] },
];

// --- GRUPO 3: CADENA DE SUMINISTRO (LOGÍSTICA) ---
const logisticaItems: MenuItem[] = [
  { href: '/dashboard/inventory', label: 'Inventario', icon: Boxes, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito', 'cliente'] },
  { href: '/dashboard/dispatch', label: 'Despacho', icon: Truck, roles: ['superadmin', 'gerencia', 'admin', 'deposito', 'cliente'] },
  { href: '/dashboard/purchase-orders', label: 'Importaciones (PO)', icon: Globe, roles: ['superadmin', 'gerencia'] },
  { href: '/dashboard/suppliers', label: 'Proveedores', icon: Contact, roles: ['superadmin', 'gerencia'] },
  { href: '/dashboard/carriers', label: 'Transportistas', icon: Ship, roles: ['superadmin', 'gerencia', 'admin', 'deposito'] },
];

// --- GRUPO 4: INGENIERÍA FINANCIERA ---
const financieraItems: MenuItem[] = [
  { href: '/dashboard/billing', label: 'Facturación', icon: CreditCard, roles: ['superadmin', 'gerencia', 'admin', 'ventas', 'cliente'] },
  { href: '/dashboard/commissions', label: 'Comisiones', icon: Tag, roles: ['superadmin', 'gerencia', 'admin', 'ventas'] },
  { href: '/dashboard/treasury', label: 'Tesorería', icon: Landmark, roles: ['superadmin', 'gerencia', 'admin'] },
  { href: '/dashboard/inventory/pricing-calculator', label: 'Calculadora Smart', icon: Calculator, roles: ['superadmin', 'gerencia', 'admin'] },
];

// --- GRUPO 5: INTELIGENCIA ESTRATÉGICA ---
const inteligenciaItems: MenuItem[] = [
  { href: '/dashboard/intelligence', label: 'Tablero BI', icon: BarChart3, roles: ['superadmin', 'gerencia'] },
  { href: '/dashboard/marketing', label: 'Radar Marketing', icon: Zap, roles: ['superadmin', 'admin'] },
  { href: '/dashboard/reports', label: 'Reportes y BI', icon: FileBarChart, roles: ['superadmin', 'gerencia', 'admin'] },
];

// --- GRUPO 6: ADMINISTRACIÓN DE RED ---
const administracionItems: MenuItem[] = [
  { href: '/dashboard/users', label: 'Gestión de Usuarios', icon: UserIcon, roles: ['superadmin', 'gerencia', 'admin'] },
  { href: '/dashboard/offers', label: 'Gestión de Ofertas', icon: Percent, roles: ['superadmin', 'gerencia', 'admin'] },
  { href: '/dashboard/salespeople', label: 'Equipo de Vendedores', icon: Briefcase, roles: ['superadmin', 'gerencia', 'admin'] },
  { href: '/dashboard/settings', label: 'Configuración', icon: Settings, roles: ['superadmin', 'gerencia', 'admin'] },
  { href: '/dashboard/audit', label: 'Libro de Auditoría', icon: ShieldAlert, roles: ['superadmin'] },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { profile, isUserLoading } = useUser();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  
  const renderMenuItems = (items: MenuItem[]) => {
    if (!profile) return null;
    return items
      .filter(item => item.roles.includes(profile.role))
      .map((item) => {
        let label = item.label;
        if (item.href === '/dashboard/inventory' && (profile.role === 'ventas' || profile.role === 'cliente')) {
            label = 'Catálogo';
        }

        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

        return (
          <SidebarMenuItem key={item.href}>
            <Link href={item.href} onClick={handleLinkClick} className="w-full">
              <SidebarMenuButton
                isActive={isActive}
                className={cn(
                  "font-bold text-[14px] h-11 px-4 transition-all hover:bg-white/10 active:scale-95 text-white/90 relative",
                  isActive && "bg-white/15 text-white shadow-sm"
                )}
                tooltip={{ children: label }}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{label}</span>
              </SidebarMenuButton>
            </Link>
          </SidebarMenuItem>
        );
      });
  };

  return (
    <Sidebar variant="sidebar" collapsible="icon" className="border-r-0 bg-sidebar-gradient shadow-2xl overflow-x-hidden">
      <SidebarHeader className="pt-6 pb-4">
        <div className="flex items-center gap-2 px-3 overflow-hidden">
          <DynamicAppLogo className="h-7 w-auto shrink-0" />
          <span className="text-lg font-black uppercase tracking-tighter text-white leading-none group-data-[collapsible=icon]:hidden truncate">
            Athleticenter
          </span>
          <div className="ml-auto flex items-center group-data-[collapsible=icon]:hidden">
            <ReloadAppButton />
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent className="px-2 space-y-4 pb-10 overflow-x-hidden">
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-4 mb-1">Mando y Comunicación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(mandoItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-2 mb-1">Ciclo Comercial</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(comercialItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-2 mb-1">Cadena de Suministro</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(logisticaItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-2 mb-1">Ingeniería Financiera</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(financieraItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(profile?.role === 'admin' || profile?.role === 'gerencia' || profile?.role === 'superadmin') && (
            <SidebarGroup>
                <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-2 mb-1">Inteligencia de Negocio</SidebarGroupLabel>
                <SidebarGroupContent>
                    <SidebarMenu>{renderMenuItems(inteligenciaItems)}</SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        )}

        {(profile?.role === 'admin' || profile?.role === 'gerencia' || profile?.role === 'superadmin') && (
            <SidebarGroup>
                <SidebarGroupLabel className="text-white/40 font-black text-[9px] uppercase tracking-[0.2em] px-4 pt-2 mb-1">Gestión de Red</SidebarGroupLabel>
                <SidebarGroupContent>
                    <SidebarMenu>{renderMenuItems(administracionItems)}</SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="pb-6 px-2 overflow-x-hidden">
        <div className="space-y-1">
            <SidebarMenuItem className="list-none">
                <SupportDialog />
            </SidebarMenuItem>
            
            <div className="py-2">
                <div className="h-px bg-white/10 mx-4" />
            </div>

            <SidebarCollapseButton className="text-white/80 hover:text-white hover:bg-white/10 font-bold" />

            <div className="py-2">
                <div className="h-px bg-white/10 mx-4" />
            </div>

            <div className="px-2 pt-2 group-data-[collapsible=icon]:hidden">
                {isUserLoading ? (
                    <Skeleton className="h-14 w-full rounded-2xl bg-white/10" />
                ) : profile && (
                    <div className="flex items-center gap-3 p-3 bg-black/10 rounded-2xl border border-white/5">
                        <Avatar className="size-10 border-2 border-white/20 shadow-lg rounded-xl">
                            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.name} className="object-cover" />}
                            <AvatarFallback className="bg-white/10 text-white font-black">{profile.name?.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col truncate">
                            <span className="text-[12px] font-black uppercase tracking-tight text-white">{profile.name}</span>
                            <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em]">{profile.role}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
