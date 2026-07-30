'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { Order, OrderStatus } from '@/lib/definitions';
import { Check, Package, Cog, Truck, Home } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Timestamp } from 'firebase/firestore';

const steps: { status: OrderStatus; icon: React.ElementType; label: string }[] = [
  { status: 'Aprobado', icon: Package, label: 'Aprobado' },
  { status: 'En Preparación', icon: Cog, label: 'En Preparación' },
  { status: 'Despachado', icon: Truck, label: 'Despachado' },
  { status: 'Entregado', icon: Home, label: 'Entregado' },
];

const statusOrder: Record<OrderStatus, number> = {
    'Borrador': -2,
    'Rechazado': -3,
    'Pendiente': 0,
    'Aprobado': 1,
    'En Preparación': 2,
    'Completado': 3, // Backend status that maps to the UI timeline
    'Despachado': 4,
    'Entregado': 5,
    'En Verificación': 6,
    'Pagado': 7,
    'Cancelado': -1,
};


export function OrderStatusTimeline({ order }: { order: Order }) {
  const currentStatusIndex = statusOrder[order.status] ?? 0;
  
  const getStatusDate = (status: OrderStatus): string | null => {
      let date: Date | null = null;
      if (order.approvalDate && status === 'Aprobado') date = (order.approvalDate as Timestamp).toDate();
      // NOTE: No specific date for "En Preparación"
      if (order.pickupDate && status === 'Despachado') date = (order.pickupDate as Timestamp).toDate();
      if (order.receptionDate && status === 'Entregado') date = (order.receptionDate as Timestamp).toDate();
      
      return date ? date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : null;
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const stepIndex = statusOrder[step.status];
          const isCompleted = currentStatusIndex >= stepIndex;
          const isCurrent = currentStatusIndex === stepIndex;

          return (
            <React.Fragment key={step.status}>
              {index > 0 && (
                <div className={cn(
                  'flex-1 h-0.5',
                  isCompleted ? 'bg-primary' : 'bg-border'
                )} />
              )}
              <Tooltip>
                <TooltipTrigger>
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full border-2',
                        isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
                        isCurrent && 'animate-pulse ring-2 ring-primary ring-offset-2 ring-offset-background'
                      )}
                    >
                      {isCompleted ? <Check className="h-5 w-5" /> : <step.icon className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <p className={cn(
                        'text-xs',
                        isCompleted ? 'text-primary' : 'text-muted-foreground',
                        isCurrent && 'font-bold'
                    )}>
                      {step.label}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{step.label}</p>
                  {getStatusDate(step.status) && <p className="text-xs text-muted-foreground">{getStatusDate(step.status)}</p>}
                </TooltipContent>
              </Tooltip>
            </React.Fragment>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
