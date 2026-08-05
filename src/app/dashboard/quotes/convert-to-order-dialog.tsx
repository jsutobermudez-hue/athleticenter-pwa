'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Quote, QuoteItem, User, Product, Customer } from '@/lib/definitions';
import { useFirestore, useUser, useCollection, useMemoFirebase, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, serverTimestamp, collection, getDoc, runTransaction, query, where, limit } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type ConvertToOrderDialogProps = {
    quote: Quote;
};

/**
 * CONVERTIDOR DE COTIZACIÓN A PEDIDO v2.1.0
 * Corregido: Carga de ítems simplificada para evitar errores de permisos en empleados vinculados.
 */
export function ConvertToOrderDialog({ quote }: ConvertToOrderDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [stockCheckResult, setStockCheckResult] = useState<{sufficient: boolean; message: string} | null>(null);
  const [isCheckingStock, setIsCheckingStock] = useState(false);
  
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  // B2B: La subcolección ya está bajo la ruta protegida del presupuesto. No se requiere filtro extra.
  const quoteItemsQuery = useMemoFirebase(() => (firestore && isOpen && currentUser) ? 
    query(collection(firestore, `quotes/${quote.id}/quoteItems`), limit(100)) 
    : null, 
  [firestore, quote.id, isOpen, currentUser?.id]);
  
  const { data: quoteItems, isLoading: isLoadingQuoteItems } = useCollection<QuoteItem>(quoteItemsQuery);

  const checkStockPreview = async () => {
    if (!firestore || !quoteItems || quoteItems.length === 0) return;
    setIsCheckingStock(true);
    
    try {
      const insufficientStockItems: string[] = [];
      for (const item of quoteItems) {
        const productRef = doc(firestore, 'products', item.productId);
        const productSnap = await getDoc(productRef);
        if (productSnap.exists()) {
          const productData = productSnap.data() as Product;
          const currentStock = productData.stockLevel ?? (productData as any).stock ?? 0;
          if (currentStock < item.quantity) {
            insufficientStockItems.push(`${productData.name} (disp: ${currentStock})`);
          }
        }
      }

      if (insufficientStockItems.length > 0) {
        setStockCheckResult({ sufficient: false, message: `Stock insuficiente: ${insufficientStockItems.join(', ')}.`});
      } else {
        setStockCheckResult({ sufficient: true, message: 'Stock disponible para conversión inmediata.'});
      }
    } catch (e) {
        setStockCheckResult({ sufficient: false, message: `Error al verificar inventario.`});
    } finally {
        setIsCheckingStock(false);
    }
  };

  useEffect(() => {
    if (isOpen && !isLoadingQuoteItems && quoteItems) checkStockPreview();
    if (!isOpen) setStockCheckResult(null);
  }, [isOpen, isLoadingQuoteItems, quoteItems]);

  const handleConvert = async () => {
    if (!currentUser || !firestore || !quoteItems) return;
    
    setIsPending(true);
    const acronym = quote.customerName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const finalOrderId = `P-CONV-${acronym}-${Date.now().toString().slice(-4)}`;

    try {
        await runTransaction(firestore, async (transaction) => {
            const customerRef = doc(firestore, 'customers', quote.customerId);
            const quoteRef = doc(firestore, 'quotes', quote.id);
            const [customerSnap, quoteSnap] = await Promise.all([
                transaction.get(customerRef),
                transaction.get(quoteRef)
            ]);
            
            if (!customerSnap.exists()) throw new Error("Ficha de cliente no encontrada.");
            if (!quoteSnap.exists() || quoteSnap.data().status === 'Convertida') throw new Error("Cotización no disponible.");
            
            const customerData = customerSnap.data() as Customer;

            // 1. CREACIÓN DEL PEDIDO (CONSERVANDO IDENTIDAD Y RIF DEL CLIENTE)
            const targetCompanyId = quote.customerId || currentUser.associatedCustomerId || currentUser.id;

            const newOrderData = {
                id: finalOrderId,
                sourceQuoteId: quote.id,
                customerId: targetCompanyId,
                customerName: quote.customerName,
                customerRif: customerData.rif || quote.customerRif || '',
                customerPhone: customerData.phone || '',
                salespersonId: quote.salespersonId,
                salespersonName: quote.salespersonName,
                salespersonCommissionRate: 0.05,
                orderDate: serverTimestamp(),
                createdAt: serverTimestamp(),
                totalAmount: quote.totalAmount,
                amountPaid: 0,
                status: 'Pendiente',
                updatedAt: serverTimestamp()
            };

            transaction.set(doc(firestore, 'orders', finalOrderId), newOrderData);

            // 2. CREACIÓN DE ÍTEMS CON BINDING DE IDENTIDAD CORPORATIVA
            for (const item of quoteItems) {
                const itemRef = doc(collection(firestore, `orders/${finalOrderId}/orderItems`));
                transaction.set(itemRef, {
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    size: item.size || null,
                    customerId: targetCompanyId, 
                    salespersonId: quote.salespersonId,
                    createdAt: serverTimestamp()
                });
            }

            // 3. ACTUALIZACIÓN DE COTIZACIÓN
            transaction.update(quoteRef, { status: 'Convertida', updatedAt: serverTimestamp() });
        });

        await createAppNotifications(firestore, {
            category: 'Pedidos',
            title: `¡Conversión Exitosa!`,
            message: `Se ha generado el pedido #${finalOrderId} desde cotización #${quote.id}.`,
            link: `/dashboard/orders?order=${finalOrderId}`,
            initiatorId: currentUser.id,
            userIds: [quote.salespersonId],
            roles: ['admin', 'gerencia'],
        });

        toast({ title: '¡Pedido Generado!', description: `Folio #${finalOrderId} en proceso.` });
        setIsOpen(false);
    } catch (error: any) {
        const permissionError = new FirestorePermissionError({
            path: `orders/${finalOrderId}`,
            operation: 'create',
            requestResourceData: { customerId: currentUser.id, totalAmount: quote.totalAmount }
        });
        errorEmitter.emit('permission-error', permissionError);
    } finally {
        setIsPending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700 font-black uppercase tracking-widest h-12 rounded-xl shadow-lg">
           <CheckCircle className="mr-2 h-4 w-4" /> Convertir en Pedido
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Confirmar Conversión</DialogTitle>
          <DialogDescription className="text-xs font-medium">Transformando cotización <strong className="text-primary">#{quote.id}</strong> en pedido oficial.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
            { isCheckingStock ? (
                <div className='flex items-center gap-2 p-4 bg-muted/20 rounded-xl'><Loader2 className='animate-spin h-4 w-4 text-primary' /><span className="text-xs font-bold uppercase">Validando...</span></div>
            ) : stockCheckResult && (
                 <Alert variant={stockCheckResult.sufficient ? "default" : "destructive"} className="rounded-2xl border-none bg-slate-50">
                    <AlertTitle className="text-[10px] font-black uppercase">{stockCheckResult.sufficient ? "Stock Listo" : "Alerta Inventario"}</AlertTitle>
                    <AlertDescription className="text-xs">{stockCheckResult.message}</AlertDescription>
                </Alert>
            )}
        </div>
        <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} className="font-black uppercase text-[10px]">Cancelar</Button>
            <Button type="submit" disabled={isPending || isCheckingStock || !stockCheckResult?.sufficient} onClick={handleConvert} className="bg-primary hover:bg-primary/90 font-black uppercase text-[10px] px-6 h-11 rounded-xl shadow-xl">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Confirmar Conversión'}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
