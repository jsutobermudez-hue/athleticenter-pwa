
'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import type { User, Quote, QuoteItemClient } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { 
    Printer, 
    User as UserIcon, 
    FileText, 
    ClipboardCheck, 
    AlertCircle, 
    Send, 
    CheckCircle2, 
    Clock,
    Loader2,
    ShieldCheck,
    DollarSign,
    Box,
    Play
} from 'lucide-react';
import { ConvertToOrderDialog } from './convert-to-order-dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface QuoteDetailsSheetProps {
    quote: Quote;
    currentUser: User;
    items: QuoteItemClient[];
    isLoadingItems: boolean;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onPrint: () => void;
    onStatusUpdate: () => void;
    onQuickAction: (newStatus: Quote['status']) => void;
    onContinueDraft?: () => void;
    isActionPending: boolean;
}

export function QuoteDetailsSheet({
    quote,
    currentUser,
    items,
    isLoadingItems,
    isOpen,
    onOpenChange,
    onPrint,
    onStatusUpdate,
    onQuickAction,
    onContinueDraft,
    isActionPending
}: QuoteDetailsSheetProps) {
    const isExpired = quote.expiryDate && quote.expiryDate.toDate() < new Date() && quote.status !== 'Convertida' && quote.status !== 'Borrador';
    const isClient = currentUser.role === 'cliente';
    const canManage = ['superadmin', 'admin', 'gerencia', 'ventas'].includes(currentUser.role);
    
    const getStatusStyles = (status: Quote['status']) => {
        switch (status) {
            case 'Borrador': return 'bg-slate-100 text-slate-700 border-slate-200';
            case 'Enviada': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'Aceptada': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'Convertida': return 'bg-purple-50 text-purple-700 border-purple-200';
            case 'Vencida': return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'Cancelada': return 'bg-rose-50 text-rose-700 border-rose-200';
            default: return '';
        }
    };

    const renderPrimaryAction = () => {
        if (quote.status === 'Borrador' && onContinueDraft) {
            return (
                <Button onClick={onContinueDraft} className="w-full bg-primary hover:bg-primary/90 font-black uppercase tracking-[0.2em] shadow-xl h-14 text-sm animate-in zoom-in-95">
                    <Play className="mr-2 h-5 w-5" /> RETOMAR PRESUPUESTO
                </Button>
            );
        }

        if (isExpired) return (
            <div className="flex items-center gap-2 p-4 rounded-2xl bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold uppercase">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Esta cotización ha expirado. Contacte a su asesor.</span>
            </div>
        );

        if (quote.status === 'Convertida') {
            return (
                <div className="flex items-center justify-center gap-2 p-4 rounded-2xl bg-purple-50 text-purple-700 border border-purple-100 text-[10px] font-black uppercase tracking-widest">
                    <CheckCircle2 className="h-4 w-4" /> PEDIDO PROCESADO
                </div>
            );
        }

        switch (quote.status) {
            case 'Enviada':
                return (
                    <Button onClick={() => onQuickAction('Aceptada')} disabled={isActionPending} className="w-full bg-emerald-600 hover:bg-emerald-700 font-black uppercase tracking-[0.2em] shadow-xl h-12 text-[10px]">
                        {isActionPending ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Aceptar Presupuesto
                    </Button>
                );
            case 'Aceptada':
                return <ConvertToOrderDialog quote={quote} />;
            default:
                return null;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl p-0 flex flex-col max-h-[95vh] overflow-hidden rounded-[2.5rem] border-none shadow-2xl z-[100]">
                <DialogHeader className="p-8 pb-6 shrink-0 border-b bg-slate-50/50">
                    <div className="flex justify-between items-start">
                        <div className="text-left space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                                <DialogTitle className="text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none">COTIZACIÓN</DialogTitle>
                                <Badge variant="outline" className={cn("font-black uppercase text-[10px] px-3 h-6 border-none shadow-sm", getStatusStyles(quote.status))}>
                                    {quote.status}
                                </Badge>
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-xl font-black font-mono tracking-tighter text-primary">#{quote.id}</p>
                                <p className="flex items-center gap-1.5 font-bold text-[9px] uppercase tracking-[0.3em] text-slate-400">
                                    <Clock className="h-3 w-3" /> VENCIMIENTO: {quote.expiryDate ? format(quote.expiryDate.toDate(), 'dd MMM, yyyy', { locale: es }).toUpperCase() : 'N/A'}
                                </p>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <ScrollArea className="flex-1 px-8">
                    <div className="space-y-8 py-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-5 rounded-[1.5rem] border border-slate-100 bg-white shadow-sm space-y-1 group transition-all hover:border-primary/20">
                                <Label className="text-[8px] uppercase font-black text-slate-400 tracking-[0.2em] flex items-center gap-1.5">
                                    <UserIcon className="h-3 w-3 text-primary group-hover:scale-110 transition-transform"/> Cliente Final
                                </Label>
                                <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 leading-tight truncate">{quote.customerName}</p>
                            </div>
                            <div className="p-5 rounded-[1.5rem] border border-slate-100 bg-white shadow-sm space-y-1 group transition-all hover:border-primary/20">
                                <Label className="text-[8px] uppercase font-black text-slate-400 tracking-[0.2em] flex items-center gap-1.5">
                                    <FileText className="h-3 w-3 text-primary group-hover:scale-110 transition-transform"/> Asesor Asignado
                                </Label>
                                <p className="font-black text-[11px] uppercase tracking-tight text-slate-900 leading-tight truncate">{quote.salespersonName}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 flex items-center gap-2 px-1">
                                <ClipboardCheck className="h-4 w-4 text-primary" /> DETALLE DE INVERSIÓN
                            </h3>
                            <div className="rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm bg-slate-50/20">
                                <div className="bg-slate-900 text-white px-6 py-4 text-[8px] font-black uppercase tracking-[0.2em] grid grid-cols-12 gap-2">
                                    <div className="col-span-7">DESCRIPCIÓN DEL EQUIPO</div>
                                    <div className="col-span-2 text-center">CANT</div>
                                    <div className="col-span-3 text-right">TOTAL</div>
                                </div>
                                <div className="divide-y divide-slate-100 bg-white">
                                    {isLoadingItems ? (
                                        Array.from({ length: 3 }).map((_, i) => (
                                            <div key={i} className="p-6"><Skeleton className="h-10 w-full rounded-xl" /></div>
                                        ))
                                    ) : items.length > 0 ? items.map((item) => (
                                        <div key={item.productId} className="px-6 py-4 grid grid-cols-12 gap-2 items-center hover:bg-slate-50 transition-colors">
                                            <div className="col-span-7">
                                                <p className="text-[11px] font-black uppercase text-slate-900 leading-tight truncate">{item.product?.name || 'Cargando...'}</p>
                                                <p className="text-[8px] font-mono font-bold text-slate-400 mt-1 uppercase">SKU: {item.product?.sku || '...'}</p>
                                            </div>
                                            <div className="col-span-2 text-center font-black text-xs text-slate-600">{item.quantity}</div>
                                            <div className="col-span-3 text-right font-black text-sm text-primary tracking-tighter">
                                                ${(item.quantity * item.unitPrice).toFixed(2)}
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="p-12 text-center flex flex-col items-center gap-2 opacity-40">
                                            <Box className="h-8 w-8" />
                                            <p className="text-[10px] font-black uppercase tracking-widest">Sin artículos registrados</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-primary/5 p-8 rounded-[2.5rem] border border-primary/10 flex justify-between items-center shadow-inner relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform"><DollarSign className="h-20 w-20" /></div>
                            <div className="space-y-1 relative z-10">
                                <p className="text-[10px] font-black uppercase text-primary tracking-[0.4em]">INVERSIÓN TOTAL ESTIMADA</p>
                                <p className="text-[9px] text-slate-400 font-bold uppercase italic">Validez sujeta a stock en almacén</p>
                            </div>
                            <div className="text-right relative z-10">
                                <p className="text-5xl font-black text-primary tracking-tighter leading-none">${quote.totalAmount.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="p-8 border-t bg-slate-50/50 shrink-0">
                    <div className="w-full flex flex-col gap-4">
                        {renderPrimaryAction()}
                        
                        <div className="grid grid-cols-2 gap-4">
                            <Button variant="outline" onClick={onPrint} disabled={isLoadingItems || items.length === 0} className="h-12 font-black uppercase tracking-widest text-[9px] border-slate-200 hover:bg-white shadow-sm rounded-xl">
                                <Printer className="mr-2 h-4 w-4" /> EXPORTAR PDF
                            </Button>
                            {canManage && (
                                <Button variant="ghost" onClick={onStatusUpdate} className="h-12 font-black uppercase tracking-widest text-[9px] text-slate-500 hover:text-slate-900 rounded-xl">
                                    GESTIÓN ESTADO
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center justify-center gap-2 text-slate-400">
                            <ShieldCheck className="h-3 w-3" />
                            <span className="text-[8px] font-bold uppercase tracking-[0.3em]">Documento Oficial Athleticenter</span>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
