'use client';

import React from 'react';
import type { Order } from '@/lib/definitions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { statusConfig } from '@/lib/status-config';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, User, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OrderCard({ order, onSelect }: { order: Order; onSelect: (order: Order) => void; }) {
  const config = statusConfig[order.status];
  const StatusIcon = config?.icon || User;

  return (
    <Card 
      className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 overflow-hidden bg-white shadow-none rounded-xl p-3 flex flex-col gap-3" 
      onClick={() => onSelect(order)}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">REFERENCIA</span>
          <p className="text-[10px] font-bold font-mono">#{order.id.substring(0, 8)}</p>
        </div>
        <Badge variant="secondary" className={cn("flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-black uppercase border-none", config?.color)}>
          <StatusIcon className="h-2.5 w-2.5" />
          {order.status}
        </Badge>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black truncate uppercase leading-tight text-slate-900">{order.customerName}</p>
        <p className="text-[8px] text-slate-400 font-bold uppercase flex items-center gap-1">
          <Calendar className="h-2.5 w-2.5" />
          {order.orderDate ? format(order.orderDate.toDate(), "dd MMM, yy", { locale: es }) : '...'}
        </p>
      </div>

      <div className="flex items-end justify-between pt-2 border-t border-dashed border-slate-100">
        <div className="space-y-0.5">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">TOTAL A FACTURAR</span>
          <p className="text-sm font-black text-primary leading-none">${order.totalAmount.toFixed(2)}</p>
        </div>
        <div className="h-6 w-6 rounded-lg bg-primary/5 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
          <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </Card>
  );
}
