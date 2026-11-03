'use client';

import React, { useState, useMemo, useRef } from 'react';
import type { Customer, Order } from '@/lib/definitions';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Printer, 
  Search, 
  User, 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  CreditCard, 
  Calendar, 
  TrendingUp, 
  FileText, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  DollarSign, 
  Download 
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getEffectiveCashReceived } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface Client360ReportModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  orders: Order[];
  bcvRate?: number;
  initialCustomerId?: string;
}

export function Client360ReportModal({
  isOpen,
  onOpenChange,
  customers = [],
  orders = [],
  bcvRate = 36.5,
  initialCustomerId
}: Client360ReportModalProps) {
  const { toast } = useToast();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomerId || (customers[0]?.id || ''));
  const [searchTerm, setSearchTerm] = useState('');
  const printAreaRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (initialCustomerId) setSelectedCustomerId(initialCustomerId);
    else if (!selectedCustomerId && customers.length > 0) setSelectedCustomerId(customers[0].id || '');
  }, [initialCustomerId, customers, selectedCustomerId]);

  // Filtrado de clientes para el selector
  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) return customers;
    const q = searchTerm.toLowerCase();
    return customers.filter(c => {
      const name = (c.razonSocial || (c as any).nombre || '').toLowerCase();
      const rif = (c.rif || '').toLowerCase();
      const contact = ((c as any).contactPerson || (c as any).contacto || '').toLowerCase();
      return name.includes(q) || rif.includes(q) || contact.includes(q);
    });
  }, [customers, searchTerm]);

  // Cliente seleccionado actual
  const currentClient = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || customers[0] || null;
  }, [customers, selectedCustomerId]);

  // Pedidos asociados a este cliente
  const clientOrders = useMemo(() => {
    if (!currentClient) return [];
    return orders.filter(o => 
      o.customerId === currentClient.id ||
      (currentClient.rif && o.customerRif === currentClient.rif) ||
      (o.customerName && currentClient.razonSocial && o.customerName.toLowerCase() === currentClient.razonSocial.toLowerCase())
    ).sort((a, b) => {
      const timeA = a.createdAt ? (typeof (a.createdAt as any).toMillis === 'function' ? (a.createdAt as any).toMillis() : new Date(a.createdAt as any).getTime()) : 0;
      const timeB = b.createdAt ? (typeof (b.createdAt as any).toMillis === 'function' ? (b.createdAt as any).toMillis() : new Date(b.createdAt as any).getTime()) : 0;
      return timeB - timeA;
    });
  }, [orders, currentClient]);

  // Métricas financieras calculadas del cliente
  const clientMetrics = useMemo(() => {
    let totalPurchasedUSD = 0;
    let totalPaidUSD = 0;
    let pendingBalanceUSD = 0;
    let overdueOrdersCount = 0;

    const now = Date.now();

    clientOrders.forEach(o => {
      if (o.status !== 'Cancelado' && o.status !== 'Rechazado') {
        const orderTotal = Number(o.totalAmount || 0);
        const orderPaid = getEffectiveCashReceived(o);
        const balance = Math.max(0, orderTotal - orderPaid);

        totalPurchasedUSD += orderTotal;
        totalPaidUSD += orderPaid;
        pendingBalanceUSD += balance;

        const dueDate = (o as any).dueDate;
        if (balance > 0 && dueDate) {
          const dueTime = typeof dueDate.toMillis === 'function' ? dueDate.toMillis() : new Date(dueDate).getTime();
          if (dueTime < now) {
            overdueOrdersCount++;
          }
        }
      }
    });

    const creditLimit = Number((currentClient as any)?.creditLimitUSD || (currentClient as any)?.limiteCreditoUSD || 0);
    const creditDays = Number((currentClient as any)?.creditDays || (currentClient as any)?.diasCredito || 0);
    const availableCreditUSD = Math.max(0, creditLimit - pendingBalanceUSD);
    const avgTicket = clientOrders.length > 0 ? totalPurchasedUSD / clientOrders.length : 0;

    return {
      totalPurchasedUSD,
      totalPaidUSD,
      pendingBalanceUSD,
      pendingBalanceVES: pendingBalanceUSD * bcvRate,
      creditLimit,
      creditDays,
      availableCreditUSD,
      overdueOrdersCount,
      avgTicket,
      completedOrdersCount: clientOrders.filter(o => o.status === 'Entregado' || o.status === 'Pagado').length
    };
  }, [clientOrders, currentClient, bcvRate]);

  // Manejador de Impresión Profesional
  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col max-h-[94vh]">
        {/* CABECERA (NO SE IMPRIME) */}
        <DialogHeader className="p-6 bg-slate-900 text-white shrink-0 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-primary/20 text-primary shrink-0">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black uppercase text-white flex items-center gap-2">
                  Ficha Integral de Cliente 360°
                  <Badge className="bg-primary/20 text-primary border-none text-[8px] font-black uppercase">
                    Auditoría & BI
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs">
                  Expediente completo imprimible con datos fiscales, crédito, compras e historial financiero.
                </DialogDescription>
              </div>
            </div>

            {/* Selector de Cliente Rápido */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                className="h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-white uppercase w-full sm:w-64"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial || (c as any).nombre} ({c.rif || 'S/R'})
                  </option>
                ))}
              </select>

              <Button
                type="button"
                onClick={handlePrint}
                className="h-10 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase flex items-center gap-1.5 shrink-0"
              >
                <Printer className="h-4 w-4" /> Imprimir Ficha
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ÁREA DEL REPORTE IMPRIMIBLE */}
        <div className="p-6 sm:p-10 overflow-y-auto flex-1 space-y-6 bg-white text-slate-900 print:p-0 print:overflow-visible" ref={printAreaRef}>
          {currentClient ? (
            <div className="space-y-6 max-w-4xl mx-auto">
              {/* MEMBRETE INSTITUCIONAL PARA IMPRESIÓN */}
              <div className="border-b-2 border-slate-900 pb-5 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black uppercase tracking-tight text-slate-900">ATHLETICENTER</span>
                    <Badge variant="outline" className="border-slate-300 font-mono text-[9px] uppercase font-bold">PRO B2B</Badge>
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-0.5">
                    Distribución Mayorista Deportiva de Alto Rendimiento
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">
                    RIF: J-50157307-7 · Caracas, Venezuela
                  </p>
                </div>
                <div className="text-right">
                  <Badge className="bg-slate-900 text-white font-mono text-[9px] font-black uppercase px-2.5 py-1">
                    EXPEDIENTE AUDITORÍA 360°
                  </Badge>
                  <p className="text-[10px] font-mono text-slate-500 mt-1.5">
                    Emisión: {format(new Date(), "dd 'de' MMMM, yyyy · HH:mm", { locale: es })}
                  </p>
                  <p className="text-[10px] font-mono text-primary font-bold">
                    Tasa Oficial BCV: Bs. {bcvRate.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* SECCIÓN 1: DATOS FISCALES Y DE CONTACTO */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 print:bg-white print:border-slate-300">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider">
                    1. Identificación Fiscal y Contacto Comercial
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Razón Social</span>
                    <p className="font-black text-slate-900 uppercase text-sm mt-0.5">{currentClient.razonSocial || (currentClient as any).nombre}</p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">RIF / Cédula Fiscal</span>
                    <p className="font-mono font-black text-slate-900 mt-0.5">{currentClient.rif || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Persona de Contacto / Compras</span>
                    <p className="font-bold text-slate-800 mt-0.5">{(currentClient as any).contactPerson || (currentClient as any).contacto || 'Encargado de Tienda'}</p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Teléfono Principal / WhatsApp</span>
                    <p className="font-mono font-bold text-slate-900 mt-0.5 flex items-center gap-1">
                      <Phone className="h-3 w-3 text-emerald-600" />
                      {currentClient.phone || (currentClient as any).whatsappPhone || (currentClient as any).telefono || 'Sin registrar'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Correo Electrónico</span>
                    <p className="font-mono text-slate-800 mt-0.5">{currentClient.email || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Asesor Comercial Asignado</span>
                    <p className="font-bold text-primary mt-0.5">{(currentClient as any).salesperson || (currentClient as any).vendedor || 'Venta Directa'}</p>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Dirección de Entrega y Ciudad</span>
                    <p className="font-medium text-slate-700 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                      {currentClient.address || (currentClient as any).direccion || 'Caracas'}, {(currentClient as any).city || 'Distrito Capital'}
                    </p>
                  </div>
                </div>
              </div>

              {/* SECCIÓN 2: CONDICIONES DE CRÉDITO Y ESTADO FINANCIERO */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 print:bg-white print:border-slate-300">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <CreditCard className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider">
                    2. Estado Financiero, Saldo Deudor y Línea de Crédito
                  </h3>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Límite Aprobado</span>
                    <p className="text-sm font-mono font-black text-slate-900 mt-1">${clientMetrics.creditLimit.toFixed(2)} USD</p>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">{clientMetrics.creditDays} días plazo</span>
                  </div>

                  <div className={cn(
                    "p-3 rounded-xl border",
                    clientMetrics.pendingBalanceUSD > 0 ? "bg-rose-50 border-rose-200 text-rose-900" : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  )}>
                    <span className="text-[9px] font-black uppercase block opacity-70">Saldo Deudor Total</span>
                    <p className="text-sm font-mono font-black mt-1">${clientMetrics.pendingBalanceUSD.toFixed(2)} USD</p>
                    <span className="text-[8px] font-bold uppercase block opacity-80">
                      Bs. {clientMetrics.pendingBalanceVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Crédito Disponible</span>
                    <p className="text-sm font-mono font-black text-emerald-600 mt-1">${clientMetrics.availableCreditUSD.toFixed(2)} USD</p>
                    <span className="text-[8px] font-bold text-slate-400 uppercase">Capacidad de compra</span>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200">
                    <span className="text-[9px] font-black uppercase text-slate-400 block">Estatus de Cobranza</span>
                    <div className="mt-1">
                      {clientMetrics.overdueOrdersCount > 0 ? (
                        <Badge className="bg-rose-500 text-white text-[8px] font-black uppercase">
                          {clientMetrics.overdueOrdersCount} Factura(s) Vencida(s)
                        </Badge>
                      ) : clientMetrics.pendingBalanceUSD > 0 ? (
                        <Badge className="bg-amber-100 text-amber-800 text-[8px] font-black uppercase border-none">
                          Por Vencer
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800 text-[8px] font-black uppercase border-none">
                          Al Día (Sin Deuda)
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* SECCIÓN 3: HISTORIAL DE COMPRAS Y PEDIDOS */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider">
                      3. Historial de Operaciones y Facturas ({clientOrders.length} Pedidos Registrados)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono font-black text-slate-500">
                    Total Facturado: ${clientMetrics.totalPurchasedUSD.toFixed(2)} USD
                  </span>
                </div>

                {clientOrders.length === 0 ? (
                  <div className="p-6 text-center rounded-2xl bg-slate-50 border border-slate-200 text-slate-400 text-xs font-bold uppercase">
                    Este cliente aún no registra pedidos en el sistema.
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-100 text-[9px] font-black uppercase text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="p-3 pl-4">N° Pedido</th>
                          <th className="p-3">Fecha</th>
                          <th className="p-3">Estatus</th>
                          <th className="p-3 text-right">Monto Total</th>
                          <th className="p-3 text-right">Abonado</th>
                          <th className="p-3 pr-4 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {clientOrders.slice(0, 15).map((o, idx) => {
                          const total = Number(o.totalAmount || 0);
                          const paid = getEffectiveCashReceived(o);
                          const rem = Math.max(0, total - paid);
                          let dateStr = '—';
                          if (o.createdAt) {
                            const d = typeof (o.createdAt as any).toDate === 'function' ? (o.createdAt as any).toDate() : new Date(o.createdAt as any);
                            if (!isNaN(d.getTime())) dateStr = format(d, 'yyyy-MM-dd');
                          }

                          return (
                            <tr key={o.id || idx} className="hover:bg-slate-50/80">
                              <td className="p-3 pl-4 font-bold text-slate-900">#{o.id?.substring(0, 8)}</td>
                              <td className="p-3 text-slate-500">{dateStr}</td>
                              <td className="p-3 font-sans">
                                <Badge variant="outline" className={cn(
                                  "text-[8px] font-black uppercase border-none px-2 py-0.5",
                                  o.status === 'Entregado' || o.status === 'Pagado' ? "bg-emerald-100 text-emerald-800" :
                                  o.status === 'Cancelado' ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                                )}>
                                  {o.status || 'Pendiente'}
                                </Badge>
                              </td>
                              <td className="p-3 text-right font-black text-slate-900">${total.toFixed(2)}</td>
                              <td className="p-3 text-right font-bold text-emerald-600">${paid.toFixed(2)}</td>
                              <td className={cn("p-3 pr-4 text-right font-black", rem > 0 ? "text-rose-600" : "text-slate-400")}>
                                ${rem.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECCIÓN 4: FIRMA Y CONFORMIDAD INSTITUCIONAL */}
              <div className="pt-8 border-t border-slate-300 grid grid-cols-2 gap-8 text-center text-xs mt-10">
                <div className="space-y-1">
                  <div className="border-b border-slate-400 w-48 mx-auto h-12" />
                  <p className="font-black uppercase text-slate-900 mt-2">Dpto. de Administración</p>
                  <p className="text-[9px] uppercase text-slate-400 font-bold">Athleticenter Pro</p>
                </div>
                <div className="space-y-1">
                  <div className="border-b border-slate-400 w-48 mx-auto h-12" />
                  <p className="font-black uppercase text-slate-900 mt-2">Conformidad del Cliente</p>
                  <p className="text-[9px] uppercase text-slate-400 font-bold">{currentClient.razonSocial || (currentClient as any).nombre}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-400 font-bold uppercase text-xs">
              No hay clientes registrados en la base de datos.
            </div>
          )}
        </div>

        {/* PIE DEL DIÁLOGO (NO SE IMPRIME) */}
        <DialogFooter className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0 print:hidden">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl font-black uppercase text-[10px]"
          >
            Cerrar
          </Button>
          <Button
            type="button"
            onClick={handlePrint}
            className="h-11 px-6 rounded-xl bg-slate-900 hover:bg-primary text-white font-black uppercase text-xs flex items-center gap-1.5"
          >
            <Printer className="h-4 w-4" /> Imprimir Documento Oficial (Carta / A4)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
