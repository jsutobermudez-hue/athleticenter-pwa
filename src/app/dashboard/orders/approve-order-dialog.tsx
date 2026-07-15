
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, FileWarning, ShieldCheck, XCircle, CheckCircle, Package, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Order, User, Invoice, OrderItem, Product, Customer } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, serverTimestamp, collection, query, where, runTransaction, updateDoc, increment, limit, getDocs } from 'firebase/firestore';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createAppNotifications } from '@/lib/notifications';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { getInvoiceFromOrder } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { InventoryService } from '@/lib/inventory-service';

type ApproveOrderDialogProps = {
  order: Order;
  currentUser: User;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function ApproveOrderDialog({ order, currentUser, isOpen, onOpenChange, onSuccess }: ApproveOrderDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [notes, setNotes] = useState('');
  const { toast } = useToast();
  const firestore = useFirestore();

  // Cargamos el historial para el análisis de riesgo en la UI
  const customerOrdersQuery = useMemoFirebase(() => (firestore && isOpen) ? query(collection(firestore, 'orders'), where('customerId', '==', order.customerId), limit(50)) : null, [firestore, isOpen, order.customerId]);
  const { data: customerOrders, isLoading: isLoadingHistory } = useCollection<Order>(customerOrdersQuery);

  const orderItemsQuery = useMemoFirebase(() => (firestore && isOpen) ? query(collection(firestore, `orders/${order.id}/orderItems`), limit(100)) : null, [firestore, order.id, isOpen]);
  const { data: orderItems, isLoading: isLoadingItems } = useCollection<OrderItem>(orderItemsQuery);
  
  const productIds = useMemo(() => {
      const ids = orderItems?.map(i => i.productId) || [];
      // Saneamiento: Limitamos a 30 para evitar que el motor de Firestore falle en la consulta IN de pre-visualización
      return Array.from(new Set(ids)).slice(0, 30);
  }, [orderItems]);

  const productsQuery = useMemoFirebase(() => {
    if (!firestore || !isOpen || productIds.length === 0) return null;
    return query(collection(firestore, 'products'), where('__name__', 'in', productIds), limit(30));
  }, [firestore, isOpen, productIds]);

  const { data: allProducts, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);

  useEffect(() => {
    if (!isOpen) setNotes('');
  }, [isOpen]);

  const customerHistory = useMemo(() => {
    if (!customerOrders) return { vencido: 0, porVencer: 0, totalVencido: 0, totalPorVencer: 0 };
    const invoices = customerOrders.map(getInvoiceFromOrder).filter(Boolean) as Invoice[];
    return invoices.reduce((acc, invoice) => {
      if (invoice.status === 'Vencido') { acc.vencido++; acc.totalVencido += invoice.remainingBalance; }
      if (invoice.status === 'Por Vencer') { acc.porVencer++; acc.totalPorVencer += invoice.remainingBalance; }
      return acc;
    }, { vencido: 0, porVencer: 0, totalVencido: 0, totalPorVencer: 0 });
  }, [customerOrders]);

  const profitabilityData = useMemo(() => {
    if (!orderItems || !allProducts) return null;
    const totalCost = orderItems.reduce((sum, item) => {
        const product = allProducts.find(p => p.id === item.productId);
        return sum + ((product?.cost ?? 0) * item.quantity);
    }, 0);
    const totalRevenue = order.totalAmount;
    const grossProfit = totalRevenue - totalCost;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    return { totalCost, totalRevenue, grossProfit, grossMargin };
  }, [orderItems, allProducts, order.totalAmount]);

  const stockCheck = useMemo(() => {
    if (!orderItems || !allProducts) return { hasError: false, issues: [] };
    const issues = orderItems.filter(item => {
        const product = allProducts.find(p => p.id === item.productId);
        if (!product) return false; // Si no está en el top 30 de pre-visualización, no bloqueamos aquí, el motor transaccional lo hará
        
        if (product.hasSizes && item.size && product.sizes) {
            return (product.sizes[item.size] || 0) < item.quantity;
        }
        const currentStock = Number(product.stockLevel ?? (product as any).stock ?? 0);
        return currentStock < item.quantity;
    }).map(item => {
        const product = allProducts.find(p => p.id === item.productId);
        const currentStock = (product?.hasSizes && item.size && product.sizes) 
            ? product.sizes[item.size] 
            : Number(product?.stockLevel ?? (product as any)?.stock ?? 0);
        return { 
            name: product?.name || `ID: ${item.productId}`, 
            stock: currentStock || 0, 
            needed: item.quantity,
            size: item.size 
        };
    });
    return { hasError: issues.length > 0, issues };
  }, [orderItems, allProducts]);

  const isDataLoading = isLoadingItems || (productIds.length > 0 && isLoadingProducts);

  /**
   * MOTOR DE APROBACIÓN TÁCTICA v9.0
   * Hardening: Ejecuta lecturas completas del catálogo dentro de la transacción para ignorar límites de pre-visualización.
   */
  const handleApprove = async () => {
    if (!firestore || !currentUser || isPending) return;

    if (!orderItems || orderItems.length === 0) {
        toast({ 
            variant: 'destructive', 
            title: 'Expediente Inválido', 
            description: 'No se puede aprobar un pedido sin artículos registrados.' 
        });
        return;
    }

    setIsPending(true);
    
    try {
        await runTransaction(firestore, async (transaction) => {
            const orderRef = doc(firestore, 'orders', order.id);
            const customerRef = doc(firestore, 'customers', order.customerId);
            
            // --- 1. PROTOCOLO DE LECTURA ATÓMICA COMPLETA (READS FIRST) ---
            // Leemos todos los productos del pedido directamente por ID (sin usar IN query de la UI)
            const uniqueProductIds = Array.from(new Set(orderItems.map(i => i.productId)));
            const productRefs = uniqueProductIds.map(id => doc(firestore, 'products', id));
            
            const [orderSnap, customerSnap, ...productSnaps] = await Promise.all([
                transaction.get(orderRef),
                transaction.get(customerRef),
                ...productRefs.map(ref => transaction.get(ref))
            ]);

            if (!orderSnap.exists()) throw new Error('El pedido ya no existe en la red.');
            if (!customerSnap.exists()) throw new Error('Ficha de cliente no encontrada.');
            
            const currentStatus = orderSnap.data().status;
            if (!['Pendiente', 'Borrador', 'Rechazado'].includes(currentStatus)) {
                throw new Error(`Acción abortada: El pedido ya está en fase "${currentStatus}".`);
            }

            const productDataMap = new Map<string, Product>();
            productSnaps.forEach(snap => {
                if (snap.exists()) productDataMap.set(snap.id, snap.data() as Product);
            });

            // --- 2. PROTOCOLO DE ESCRITURA Y AJUSTE DE STOCK (WRITES) ---
            for (const item of orderItems) {
                const pData = productDataMap.get(item.productId);
                if (!pData) throw new Error(`Producto ${item.productId} no encontrado en el catálogo.`);

                await InventoryService.updateStockInTransaction(
                    transaction,
                    firestore,
                    item.productId,
                    -item.quantity,
                    currentUser.id,
                    currentUser.name,
                    `Aprobación Pedido #${order.id.substring(0, 8)}`,
                    item.size,
                    pData // Datos pre-leídos obligatorios
                );
            }

            // Actualización de crédito del cliente
            transaction.update(customerRef, {
                creditUsed: increment(order.totalAmount),
                lastOrderDate: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            // Actualización de estado del pedido
            transaction.update(orderRef, { 
                status: 'Aprobado', 
                approvalDate: serverTimestamp(), 
                approvedBy: currentUser.id, 
                approvedByName: currentUser.name, 
                approvalNotes: notes,
                updatedAt: serverTimestamp()
            });
        });

        await createAppNotifications(firestore, {
            category: 'Pedidos',
            title: `¡Pedido Aprobado! #${order.id.substring(0, 6)}`,
            message: `El pedido de ${order.customerName} ha sido movido a fase de preparación.`,
            link: `/dashboard/dispatch?orderId=${order.id}`,
            initiatorId: currentUser.id,
            userIds: [order.salespersonId, order.customerId],
            roles: ['admin', 'gerencia', 'deposito'],
        });

        toast({ title: '¡Aprobación Exitosa!', description: 'Inventario descontado y crédito asignado.' });
        onSuccess?.();
        onOpenChange(false);
    } catch (error: any) {
        console.error("[Approval Error]", error);
        toast({ 
            variant: 'destructive', 
            title: 'Fallo de Sincronización', 
            description: error.message || 'Error en la transacción de red.' 
        });
    } finally {
        setIsPending(false);
    }
  };

  const handleReject = async () => {
    if (!firestore || !currentUser || isRejecting) return;
    if (!notes.trim()) {
        toast({ 
            variant: 'destructive', 
            title: 'Justificación Faltante', 
            description: 'Debes indicar el motivo de la devolución.' 
        });
        return;
    }
    setIsRejecting(true);

    const orderRef = doc(firestore, 'orders', order.id);
    const updatedData = { 
        status: 'Rechazado', 
        rejectionNotes: notes, 
        rejectedBy: currentUser.id, 
        updatedAt: serverTimestamp() 
    };

    try {
        await updateDoc(orderRef, updatedData as any);
        await createAppNotifications(firestore, {
            category: 'Pedidos',
            title: `Pedido Rechazado: #${order.id.substring(0, 6)}`,
            message: `Motivo: ${notes}.`,
            link: `/dashboard/orders?order=${order.id}`,
            initiatorId: currentUser.id,
            userIds: [order.salespersonId],
        });
        toast({ title: 'Pedido Devuelto' });
        onSuccess?.();
        onOpenChange(false);
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error al procesar devolución' });
    } finally {
        setIsRejecting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isPending && !isRejecting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl">
        <DialogHeader className="p-8 pb-4 bg-slate-900 text-white">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary" /> Terminal de Aprobación</DialogTitle>
          <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[10px] tracking-widest">Auditoría Financiera y de Inventario.</DialogDescription>
        </DialogHeader>
        <div className="p-8 space-y-6">
            {stockCheck.hasError && (
                <div className="p-5 rounded-2xl bg-rose-50 border-2 border-rose-200 space-y-3 animate-in shake duration-500">
                    <div className="flex items-center gap-2 text-rose-600 font-black text-[10px] uppercase">
                        <ShieldAlert className="h-5 w-5" /> BLOQUEO DE INVENTARIO
                    </div>
                    <div className="space-y-2">
                        {stockCheck.issues.map((issue, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[11px] font-bold text-rose-800">
                                <span className="uppercase truncate max-w-[200px]">{issue.name} {issue.size ? `[${issue.size}]` : ''}</span>
                                <Badge variant="destructive" className="font-black text-[9px]">{issue.stock} DISP / {issue.needed} REQ</Badge>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <Accordion type="multiple" defaultValue={[]} className="w-full space-y-3">
                <AccordionItem value="debt" className="border-none rounded-2xl bg-slate-50 overflow-hidden ring-1 ring-slate-100">
                    <AccordionTrigger className="px-5 py-3 hover:no-underline group">
                        <div className="flex items-center gap-3 text-left">
                            <div className="p-2 rounded-xl bg-amber-100 text-amber-600 group-data-[state=open]:rotate-12 transition-transform"><FileWarning className="h-4 w-4" /></div>
                            <div className="space-y-0.5"><p className="text-[10px] font-black uppercase tracking-widest text-slate-900">Estado de Solvencia</p><p className="text-[8px] font-bold text-slate-400 uppercase">Análisis crediticio</p></div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-5">
                        {isLoadingHistory ? <Skeleton className="h-20 w-full rounded-xl" /> : (
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <div className="p-4 rounded-xl bg-white shadow-sm border text-center space-y-1">
                                    <p className="text-[8px] font-black text-rose-500 uppercase tracking-widest">Deuda Vencida</p>
                                    <p className="text-xl font-black text-rose-600 tracking-tighter">${customerHistory.totalVencido.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-xl bg-white shadow-sm border text-center space-y-1">
                                    <p className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Saldo Activo</p>
                                    <p className="text-xl font-black text-amber-600 tracking-tighter">${customerHistory.totalPorVencer.toLocaleString()}</p>
                                </div>
                            </div>
                        )}
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="profit" className="border-none rounded-2xl bg-emerald-50 overflow-hidden ring-1 ring-emerald-100">
                    <AccordionTrigger className="px-5 py-3 hover:no-underline group">
                        <div className="flex items-center gap-3 text-left">
                            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600 group-data-[state=open]:rotate-12 transition-transform"><TrendingUp className="h-4 w-4" /></div>
                            <div className="space-y-0.5"><p className="text-[10px] font-black uppercase tracking-widest text-emerald-900">Rentabilidad</p><p className="text-[8px] font-bold text-emerald-600/70 uppercase">Margen bruto estimado</p></div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-5">
                        {isDataLoading ? <Skeleton className="h-20 w-full rounded-xl" /> : profitabilityData && (
                            <div className="p-4 rounded-xl bg-white/50 space-y-3">
                                <div className="flex justify-between items-center"><span className="text-[9px] font-bold uppercase text-slate-500">Venta Total</span><span className="text-sm font-black text-slate-900">${profitabilityData.totalRevenue.toLocaleString()}</span></div>
                                <div className="flex justify-between items-center border-t border-dashed pt-2"><span className="text-[9px] font-bold uppercase text-emerald-600">Utilidad Bruta</span><span className="text-lg font-black text-emerald-600">+${profitabilityData.grossProfit.toLocaleString()}</span></div>
                            </div>
                        )}
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
            <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-slate-400 px-1 tracking-widest">Observaciones de Mando</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instrucciones o motivo de rechazo..." className="rounded-2xl bg-slate-50 border-none shadow-inner p-4 min-h-[100px] text-sm" />
            </div>
        </div>
        <DialogFooter className="p-8 bg-slate-50 border-t flex flex-col sm:flex-row gap-3">
            <Button variant="outline" onClick={handleReject} disabled={isPending || isRejecting} className="h-12 flex-1 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[9px] tracking-widest">
                {isRejecting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <XCircle className="mr-2 h-4 w-4" />} Devolver Pedido
            </Button>
            <Button onClick={handleApprove} disabled={isPending || isRejecting || stockCheck.hasError} className="h-12 flex-[1.5] rounded-xl bg-primary hover:bg-primary/90 shadow-xl font-black uppercase text-[9px] tracking-[0.2em]">
                {isPending ? <div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4" /> <span>Sincronizando...</span></div> : <div className="flex items-center gap-2"><CheckCircle className="h-4 w-4" /> <span>Certificar Aprobación</span></div>}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
