'use client';

import React from 'react';
import type { Order } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, ClipboardCheck, Package, Truck, CheckCircle2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderTrackerTimelineProps {
  order: Order | null;
  isLoading?: boolean;
}

export function OrderTrackerTimeline({ order, isLoading = false }: OrderTrackerTimelineProps) {
  const steps = [
    { label: 'Creado', status: ['Pendiente'], icon: ShoppingCart },
    { label: 'Aprobado', status: ['Aprobado'], icon: ClipboardCheck },
    { label: 'Preparado', status: ['En Preparación', 'Completado'], icon: Package },
    { label: 'Despachado', status: ['Despachado'], icon: Truck },
    { label: 'Entregado', status: ['Entregado'], icon: CheckCircle2 },
  ];

  const getCurrentStepIndex = () => {
    if (!order) return -1;
    const status = order.status;
    
    if (status === 'Pendiente') return 0;
    if (status === 'Aprobado') return 1;
    if (['En Preparación', 'Completado'].includes(status)) return 2;
    if (status === 'Despachado') return 3;
    if (status === 'Entregado') return 4;
    return -1;
  };

  const currentStepIndex = getCurrentStepIndex();

  if (isLoading) {
    return (
      <Card className="border border-slate-200/50 shadow-xl rounded-[2.5rem] bg-white h-44 flex items-center justify-center animate-pulse">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando Rastreador...</p>
      </Card>
    );
  }

  if (!order) {
    return (
      <Card className="border border-slate-200/50 shadow-xl rounded-[2.5rem] bg-white p-8">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
            <Truck className="h-5 w-5 text-primary" /> Rastrear Pedido Activo
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex h-24 items-center justify-center text-slate-400 text-[10px] font-black uppercase tracking-widest border border-dashed border-slate-200/50 rounded-2xl">
          Sin Pedidos Activos en Curso
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-slate-200/50 shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group">
      <CardHeader className="p-8 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
            <Truck className="h-5 w-5 text-primary" /> Estado de Envío
          </CardTitle>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">Ped. #{order.id.substring(0, 6).toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-primary/10 text-primary border-none text-[8px] font-black uppercase px-3 h-5">
            {order.status}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-8 pt-4">
        {/* Línea de Tiempo Responsiva */}
        <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-6 md:gap-2 w-full pt-2">
          {/* Línea conectora de fondo */}
          <div className="absolute left-[18px] top-6 bottom-6 w-[2px] md:left-0 md:right-0 md:top-1/2 md:-translate-y-1/2 md:h-[2px] md:w-full bg-slate-100 -z-10" />
          
          {/* Línea conectora de progreso */}
          {currentStepIndex >= 0 && (
            <div 
              className="absolute left-[18px] top-6 w-[2px] md:left-0 md:top-1/2 md:-translate-y-1/2 md:h-[2px] bg-primary -z-10 transition-all duration-1000"
              style={{
                height: typeof window !== 'undefined' && window.innerWidth < 768 
                  ? `${(currentStepIndex / 4) * 80}%` 
                  : '2px',
                width: typeof window !== 'undefined' && window.innerWidth >= 768 
                  ? `${(currentStepIndex / 4) * 100}%` 
                  : '2px'
              }}
            />
          )}

          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isCompleted = idx <= currentStepIndex;
            const isActive = idx === currentStepIndex;

            return (
              <div 
                key={idx} 
                className="flex md:flex-col items-center gap-4 md:gap-2 relative z-10 md:flex-1 text-left md:text-center"
              >
                <div 
                  className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center border-2 transition-all duration-500 shadow-sm",
                    isCompleted 
                      ? "bg-primary border-primary text-white" 
                      : "bg-white border-slate-200 text-slate-400",
                    isActive && "ring-4 ring-primary/20 scale-110"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                
                <div className="space-y-0.5">
                  <p className={cn(
                    "text-[10px] font-black uppercase tracking-wider",
                    isCompleted ? "text-slate-900" : "text-slate-400",
                    isActive && "text-primary"
                  )}>
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Mini wrapper de badge para compatibilidad
function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
      {children}
    </span>
  );
}
