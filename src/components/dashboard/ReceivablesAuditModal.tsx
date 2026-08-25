'use client';

import React, { useMemo } from 'react';
import type { Order } from '@/lib/definitions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getInvoiceFromOrder, getEffectiveCashReceived } from '@/lib/billing';
import { 
    Wallet, 
    FileWarning, 
    Clock, 
    ArrowUpRight, 
    MessageSquare, 
    ExternalLink, 
    CheckCircle2, 
    AlertCircle, 
    DollarSign,
    ShieldAlert
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface ReceivablesAuditModalProps {
    isOpen: boolean;
    onClose: () => void;
    orders: Order[] | null;
    onSelectOrder?: (order: Order) => void;
}

const convertToDate = (value: any): Date => {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
};

export function ReceivablesAuditModal({ isOpen, onClose, orders, onSelectOrder }: ReceivablesAuditModalProps) {
    const router = useRouter();

    // Filtrar únicamente órdenes con saldo neto pendiente
    const pendingOrders = useMemo(() => {
        if (!orders) return [];
        return orders
            .filter(o => {
                if (o.status === 'Cancelado' || o.status === 'Rechazado' || o.status === 'Borrador') return false;
                const inv = getInvoiceFromOrder(o);
                return Boolean(inv && inv.remainingBalance > 0.05 && inv.status !== 'Pagado');
            })
            .sort((a, b) => {
                const dateA = convertToDate(a.receptionDate || a.createdAt || a.orderDate);
                const dateB = convertToDate(b.receptionDate || b.createdAt || b.orderDate);
                return dateA.getTime() - dateB.getTime();
            });
    }, [orders]);

    // Desglose de métricas de cartera basadas en getInvoiceFromOrder
    const metrics = useMemo(() => {
        const now = Date.now();
        let totalDebt = 0;
        let totalMoraUSD = 0;
        let totalCurrentUSD = 0;
        let totalCashPaidUSD = 0;
        let moraCount = 0;

        pendingOrders.forEach(o => {
            const inv = getInvoiceFromOrder(o);
            const pending = inv ? inv.remainingBalance : 0;
            const paid = getEffectiveCashReceived(o);
            
            totalDebt += pending;
            totalCashPaidUSD += paid;

            const orderDate = convertToDate(o.receptionDate || o.createdAt || o.orderDate).getTime();
            const daysOld = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));

            if (inv?.status === 'Vencido' || daysOld >= 30) {
                totalMoraUSD += pending;
                moraCount++;
            } else {
                totalCurrentUSD += pending;
            }
        });

        return {
            totalDebt,
            totalMoraUSD,
            totalCurrentUSD,
            totalCashPaidUSD,
            moraCount,
            totalOrders: pendingOrders.length
        };
    }, [pendingOrders]);

    const handleGoToBilling = () => {
        onClose();
        router.push('/dashboard/billing?status=pendientes');
    };

    const generateWhatsAppLink = (o: Order, pendingAmount: number) => {
        const phone = o.customerPhone || (o as any).clientPhone || (o as any).phone || '';
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const message = encodeURIComponent(
            `Hola ${o.customerName || 'Estimado Cliente'}, le saludamos de Athleticenter. Le recordamos amablemente que registra un saldo pendiente de $${pendingAmount.toFixed(2)} USD correspondiente al Pedido #${o.id}. Agradecemos coordinar la conciliación de su pago. ¡Gracias!`
        );
        return `https://wa.me/${cleanPhone.startsWith('58') ? cleanPhone : '58' + cleanPhone}?text=${message}`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] bg-white rounded-[2.5rem] p-0 overflow-hidden shadow-2xl border-none">
                <DialogHeader className="p-8 pb-4 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-400 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-xl flex items-center gap-1">
                                <ShieldAlert className="h-3 w-3 text-rose-400" /> Auditoría Táctica in-situ
                            </Badge>
                        </div>
                        <DialogTitle className="text-2xl font-black italic uppercase tracking-tight text-white flex items-center gap-2">
                            Cuentas por Cobrar & Deuda Activa
                        </DialogTitle>
                        <DialogDescription className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                            Desglose en tiempo real de cartera pendiente, mora vencida y abonos parciales.
                        </DialogDescription>
                    </div>

                    <Button
                        onClick={handleGoToBilling}
                        className="bg-primary hover:bg-primary/90 text-white text-[10px] font-black uppercase tracking-wider px-5 py-3 rounded-2xl shadow-lg shadow-primary/20 flex items-center gap-2 shrink-0"
                    >
                        <Wallet className="h-4 w-4" /> Ir a Facturación Pendientes <ArrowUpRight className="h-4 w-4" />
                    </Button>
                </DialogHeader>

                <div className="p-8 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar">
                    {/* TARJETAS RESUMEN DE LA CARTERA */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-rose-50 border border-rose-100 p-5 rounded-3xl space-y-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-rose-600 flex items-center gap-1.5">
                                <FileWarning className="h-4 w-4 text-rose-500" /> Mora Crítica (+30D)
                            </span>
                            <div className="text-2xl font-black text-rose-700 tracking-tight">
                                ${metrics.totalMoraUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                            <p className="text-[9px] font-bold text-rose-400 uppercase tracking-wider">
                                {metrics.moraCount} expediente(s) con retraso
                            </p>
                        </div>

                        <div className="bg-amber-50 border border-amber-100 p-5 rounded-3xl space-y-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5">
                                <Clock className="h-4 w-4 text-amber-500" /> Por Vencer (En Plazo)
                            </span>
                            <div className="text-2xl font-black text-amber-700 tracking-tight">
                                ${metrics.totalCurrentUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                            <p className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">
                                Cartera activa dentro de crédito
                            </p>
                        </div>

                        <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-3xl space-y-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 flex items-center gap-1.5">
                                <DollarSign className="h-4 w-4 text-emerald-500" /> Abonos Parciales Recibidos
                            </span>
                            <div className="text-2xl font-black text-emerald-700 tracking-tight">
                                ${metrics.totalCashPaidUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                            <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">
                                Recaudado en órdenes activas
                            </p>
                        </div>
                    </div>

                    {/* TABLA DETALLADA DE EXPEDIENTES POR COBRAR */}
                    <div className="border border-slate-100 rounded-3xl overflow-hidden bg-white shadow-sm">
                        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Lista de Expedientes con Saldo Deudor ({pendingOrders.length})
                            </span>
                            <span className="text-xs font-black text-rose-600">
                                Total Cartera: ${metrics.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                        </div>

                        <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                            {pendingOrders.length > 0 ? (
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-50/50 sticky top-0 border-b border-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        <tr>
                                            <th className="p-3 pl-6">Nº Pedido / Cliente</th>
                                            <th className="p-3">Antigüedad</th>
                                            <th className="p-3 text-right">Total Pedido</th>
                                            <th className="p-3 text-right">Abonado</th>
                                            <th className="p-3 text-right">Saldo Pendiente</th>
                                            <th className="p-3 text-center pr-6">Acción Rápida</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-xs">
                                        {pendingOrders.map(o => {
                                            const total = o.totalAmount || 0;
                                            const paid = getEffectiveCashReceived(o);
                                            const pending = Math.max(0, total - paid);
                                            const orderDate = convertToDate(o.receptionDate || o.createdAt || o.orderDate);
                                            const daysOld = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
                                            const isMora = daysOld >= 30;

                                            return (
                                                <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-3 pl-6">
                                                        <div className="font-black text-slate-900 uppercase">
                                                            {o.customerName || 'Cliente N/A'}
                                                        </div>
                                                        <div className="text-[10px] font-mono font-bold text-slate-400 flex items-center gap-1">
                                                            #{o.id} • {o.salespersonName || 'Sistema'}
                                                        </div>
                                                    </td>

                                                    <td className="p-3">
                                                        <Badge className={cn(
                                                            "text-[8px] font-black uppercase px-2 py-0.5 border-none rounded-lg inline-flex items-center gap-1",
                                                            isMora ? "bg-rose-500/10 text-rose-600" : "bg-amber-500/10 text-amber-600"
                                                        )}>
                                                            {isMora ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                                            {daysOld} días
                                                        </Badge>
                                                    </td>

                                                    <td className="p-3 text-right font-black text-slate-700">
                                                        ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>

                                                    <td className="p-3 text-right font-bold text-emerald-600">
                                                        ${paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>

                                                    <td className="p-3 text-right font-black text-rose-600 text-sm">
                                                        ${pending.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>

                                                    <td className="p-3 pr-6 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <a
                                                                href={generateWhatsAppLink(o, pending)}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 transition-colors"
                                                                title="Enviar Recordatorio por WhatsApp"
                                                            >
                                                                <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                                                            </a>

                                                            {onSelectOrder && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        onClose();
                                                                        onSelectOrder(o);
                                                                    }}
                                                                    className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 transition-colors"
                                                                    title="Ver Expediente de Pedido"
                                                                >
                                                                    <ExternalLink className="h-3.5 w-3.5" /> Expediente
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-12 text-center space-y-2 opacity-50">
                                    <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500" />
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-600">
                                        ¡Excelente! No hay expedientes con deudas activas ni morosidad.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
