'use client';

import React from 'react';
import type { Order } from '@/lib/definitions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { statusConfig } from '@/lib/status-config';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, User, ArrowRight, MessageCircle, Eye, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function OrderCard({ order, onSelect }: { order: Order; onSelect: (order: Order) => void; }) {
  const config = statusConfig[order.status];
  const StatusIcon = config?.icon || User;

  const paid = order.amountPaid || 0;
  const pendingDebt = Math.max(0, order.totalAmount - paid);

  const handleSendWhatsAppOrder = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rawPhone = (order.customerPhone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
    const itemsCount = ((order as any).items || []).length;
    
    const text = `*ATHLETICENTER C.A. - NOTIFICACIÓN DE PEDIDO B2B*\n\n` +
      `Estimado(a) *${order.customerName}*,\n\n` +
      `Le informamos sobre el estatus de su pedido N° *#${order.id.substring(0, 8).toUpperCase()}*:\n\n` +
      `📦 *Estatus Actual:* ${order.status.toUpperCase()}\n` +
      (order.trackingNumber ? `🚚 *N° Guía / Tracking:* ${order.trackingNumber}\n` : '') +
      `💰 *Monto Total:* $${order.totalAmount.toFixed(2)} USD\n` +
      (pendingDebt > 0.05 ? `⚠️ *Saldo Pendiente:* $${pendingDebt.toFixed(2)} USD\n` : `✅ *Estado de Pago:* Al Día\n`) +
      `📍 *Asesor Asignado:* ${order.salespersonName || 'Atención General'}\n\n` +
      `¿Desea consultar alguna novedad sobre su despacho?\n\n` +
      `¡Estamos a su entera disposición!`;

    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <Card 
      className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 bg-white shadow-sm rounded-2xl p-4 flex flex-col gap-3 ring-1 ring-primary/5 hover:shadow-md hover:-translate-y-0.5" 
      onClick={() => onSelect(order)}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <span className="text-[7px] font-black uppercase tracking-widest text-slate-400">PEDIDO DE VENTA</span>
          <p className="text-[10px] font-bold font-mono text-slate-700">#{order.id.substring(0, 8)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="secondary" className={cn("flex items-center gap-1 px-2 py-0.5 text-[7px] font-black uppercase border-none text-white shadow-sm", config?.color)}>
            <StatusIcon className="h-2.5 w-2.5" />
            {order.status}
          </Badge>
          {order.cancellationRequested && (
            <Badge variant="destructive" className="text-[7px] font-black uppercase h-4 px-1.5 animate-pulse flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> Anulación Solicitada
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-black truncate uppercase leading-tight text-slate-900">{order.customerName}</p>
        <div className="flex items-center justify-between text-[8px] text-slate-400 font-bold uppercase">
          <span className="flex items-center gap-1"><Calendar className="h-3 w-3 text-slate-400" /> {order.orderDate ? format(order.orderDate.toDate(), "dd/MM/yy", { locale: es }) : '...'}</span>
          {order.salespersonName && <span className="truncate max-w-[100px]">{order.salespersonName}</span>}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-100 mt-auto gap-2">
        <div className="space-y-0.5">
          <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest">TOTAL PEDIDO</span>
          <p className="text-sm font-black text-slate-900 leading-none">${order.totalAmount.toFixed(2)}</p>
          {pendingDebt > 0.05 ? (
            <span className="text-[8px] font-black text-rose-600 uppercase block">Deuda: ${pendingDebt.toFixed(2)}</span>
          ) : (
            <span className="text-[8px] font-black text-emerald-600 uppercase block">Solvente ($0.00)</span>
          )}
        </div>
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button 
            size="sm" 
            onClick={handleSendWhatsAppOrder}
            className="h-8 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1 shadow-sm"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onSelect(order)}
            className="h-8 w-8 rounded-xl text-slate-400 group-hover:text-primary transition-colors"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
