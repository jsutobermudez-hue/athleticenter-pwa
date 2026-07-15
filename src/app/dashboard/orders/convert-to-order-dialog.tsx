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
import { Loader2, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Order, Quote, QuoteItem, User, Product, Customer } from '@/lib/definitions';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { doc, serverTimestamp, collection, getDocs, getDoc, runTransaction, query, where, type Timestamp } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

type ConvertToOrderDialogProps = {
    quote: Quote;
};

export function ConvertToOrderDialog({ quote }: ConvertToOrderDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [stockCheckResult, setStockCheckResult] = useState<{sufficient: boolean; message: string} | null>(null);
  const [isCheckingStock, setIsCheckingStock] = useState(false);
  
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const quoteItemsQuery = useMemoFirebase(() => (firestore && isOpen) ? collection(firestore, `quotes/${quote.id}/quoteItems`) : null, [firestore, quote.id, isOpen]);
  const { data: quoteItems, isLoading: isLoadingQuoteItems } = useCollection<QuoteItem>(quoteItemsQuery);

  const checkStockPreview = async () => {
    if (!firestore || !quoteItems || quoteItems.length === 0) {
      setStockCheckResult({ sufficient: false, message: 'No se encontraron artículos en la cotización.'});
      return;
    }
    setIsCheckingStock(true);
    
    try {
      const insufficientStockItems: string[] = [];
      for (const item of quoteItems) {
        const productRef = doc(firestore, 'products', item.productId);
        const productSnap = await getDoc(productRef);
        if (!productSnap.exists()) {
          insufficientStockItems.push(`${item.productId} (no encontrado)`);
          continue;
        }
        const productData = productSnap.data() as Product;
        if (productData.stock < item.quantity) {
          insufficientStockItems.push(`${productData.name} (disponible: ${productData.stock}, solicitado: ${item.quantity})`);
        }
      }
      if (insufficientStockItems.length > 0) {
        setStockCheckResult({ sufficient: false, message: `Stock insuficiente para: ${insufficientStockItems.join(', ')}.`});
      } else {
        setStockCheckResult({ sufficient: true, message: 'El stock está disponible para conversión.'});
      }
    } catch (e: any) {
        setStockCheckResult({ sufficient: false, message: `Error al verificar el stock.`});
    } finally {
        setIsCheckingStock(false);
    }
  };

  useEffect(() => {
    if (isOpen && !isLoadingQuoteItems && quoteItems) {
        checkStockPreview();
    }
     if (!isOpen) {
      setStockCheckResult(null);
    }
  }, [isOpen, isLoadingQuoteItems, quoteItems]);


  const handleConvert = () => {
    if (!currentUser || !firestore || !quoteItems) return;
    setIsPending(true);

    const acronym = quote.customerName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const finalOrderId = `P-CONV-${acronym}-${Date.now().toString().slice(-4)}`;
    
    runTransaction(firestore, async (transaction) => {
        const customerRef = doc(firestore, 'customers', quote.customerId);
        const salespersonRef = doc(firestore, 'users', quote.salespersonId);
        const quoteRef = doc(firestore, 'quotes', quote.id);
        
        const [customerSnap, salespersonSnap, currentQuoteSnap] = await Promise.all([
            transaction.get(customerRef),
            transaction.get(salespersonRef),
            transaction.get(quoteRef)
        ]);
        
        if (!customerSnap.exists()) throw new Error("Cliente no encontrado.");
        if (!currentQuoteSnap.exists()) throw new Error("La cotización ya no existe.");
        if (currentQuoteSnap.data().status === 'Convertida') throw new Error("Esta cotización ya ha sido procesada.");
        
        const customerData = customerSnap.data() as Customer;
        const salespersonData = salespersonSnap.exists() ? salespersonSnap.data() as User : null;

        // Validación Final de Stock
        for (const item of quoteItems) {
            const pRef = doc(firestore, 'products', item.productId);
            const pSnap = await transaction.get(pRef);
            if (!pSnap.exists() || pSnap.data().stock < item.quantity) {
                throw new Error(`Stock insuficiente detectado para: ${pSnap.exists() ? pSnap.data().name : item.productId}.`);
            }
        }
        
        const newOrderData = {
            id: finalOrderId,
            sourceQuoteId: quote.id,
            customerId: quote.customerId,
            customerName: quote.customerName,
            customerPhone: customerData.phone || '',
            salespersonId: quote.salespersonId,
            salespersonName: quote.salespersonName,
            salespersonCommissionRate: salespersonData?.commissionRate || 0.05,
            orderDate: serverTimestamp(),
            createdAt: serverTimestamp(),
            totalAmount: quote.totalAmount,
            amountPaid: 0,
            status: 'Pendiente',
        };

        transaction.set(doc(firestore, 'orders', finalOrderId), newOrderData);

        for (const item of quoteItems) {
            const orderItemRef = doc(collection(firestore, `orders/${finalOrderId}/orderItems`));
            transaction.set(orderItemRef, {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size || null,
                customerId: quote.customerId,
                salespersonId: quote.salespersonId,
            });
        }

        transaction.update(quoteRef, { status: 'Convertida', updatedAt: serverTimestamp() });
    })
    .then(() => {
        createAppNotifications(firestore, {
            category: 'Pedidos',
            title: `¡Nueva Conversión de Pedido!`,
            message: `Folio #${finalOrderId} generado desde cotización #${quote.id}.`,
            link: `/dashboard/orders?order=${finalOrderId}`,
            initiatorId: currentUser.id,
            userIds: [quote.salespersonId],
            roles: ['superadmin', 'admin', 'gerencia'],
        });
        toast({ title: '¡Solicitud Enviada!', description: `Se ha creado el pedido #${finalOrderId}.` });
        setIsOpen(false);
    })
    .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
            path: `orders/${finalOrderId}`,
            operation: 'create',
            requestResourceData: { sourceQuoteId: quote.id }
        }, serverError);
        errorEmitter.emit('permission-error', permissionError);
    })
    .finally(() => {
        setIsPending(false);
    });
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
          <DialogDescription className="text-xs font-medium">
            Vas a transformar la cotización <strong className="text-primary">#{quote.id}</strong> en un pedido oficial.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            { isCheckingStock || isLoadingQuoteItems ? (
                <div className='flex items-center gap-2 p-4 bg-muted/20 rounded-xl'><Loader2 className='animate-spin h-4 w-4 text-primary' /><span className="text-xs font-bold uppercase">Validando existencias...</span></div>
            ) : stockCheckResult ? (
                 <Alert variant={stockCheckResult.sufficient ? "default" : "destructive"} className="rounded-2xl border-none shadow-inner bg-slate-50">
                    {stockCheckResult.sufficient ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-rose-500" />}
                    <AlertTitle className="text-[10px] font-black uppercase">{stockCheckResult.sufficient ? "Disponibilidad Confirmada" : "Alerta de Inventario"}</AlertTitle>
                    <AlertDescription className="text-xs">{stockCheckResult.message}</AlertDescription>
                </Alert>
            ) : null }
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} className="font-black uppercase text-[10px] tracking-widest">Cancelar</Button>
            <Button type="submit" disabled={isPending || isCheckingStock || !stockCheckResult?.sufficient} onClick={handleConvert} className="bg-primary hover:bg-primary/90 font-black uppercase text-[10px] tracking-[0.2em] px-6 h-11 rounded-xl shadow-xl">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Confirmar Pedido'}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
