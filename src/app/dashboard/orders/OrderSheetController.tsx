'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { doc, runTransaction, collection, query, where, serverTimestamp, increment, limit, updateDoc, getDocs } from 'firebase/firestore';
import type { Order, OrderItem, Product, OrderItemClient, Customer } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { OrderDetailsSheet } from './OrderDetailsSheet';
import { UpdateOrderStatusDialog } from './update-order-status-dialog';
import { ApproveOrderDialog } from './approve-order-dialog';
import { InventoryService } from '@/lib/inventory-service';

/**
 * CONTROLADOR DE PEDIDOS v7.0 - BLINDAJE ATÓMICO TOTAL
 * Saneado: Cumple estrictamente con el orden Reads-Before-Writes de Firestore.
 */
export function OrderSheetController({ order, onOpenChange }: { order: Order, onOpenChange: (open: boolean) => void }) {
    const firestore = useFirestore();
    const router = useRouter();
    const { toast } = useToast();
    const { profile: currentUser } = useUser();

    const [actionDialog, setActionDialog] = useState<'status' | 'approve' | null>(null);
    const [isCanceling, setIsCanceling] = useState(false);
    const [isRestoringStock, setIsRestoringStock] = useState(false);
    
    const customerRef = useMemoFirebase(() => (firestore && order) ? doc(firestore, 'customers', order.customerId) : null, [firestore, order?.customerId]);
    const { data: customerData } = useDoc<Customer>(customerRef);

    const orderItemsRef = useMemoFirebase(
        () => (order && firestore && currentUser) ? query(collection(firestore, 'orders', order.id, 'orderItems'), limit(100)) : null,
        [order?.id, firestore, currentUser?.id]
    );
    const { data: orderItemsData, isLoading: isLoadingOrderItems } = useCollection<OrderItem>(orderItemsRef);
    
    const productIds = useMemo(() => {
        if (!orderItemsData || orderItemsData.length === 0) return [];
        return Array.from(new Set(orderItemsData.map(item => item.productId))).slice(0, 30);
    }, [orderItemsData]);
    
    const productsRef = useMemoFirebase(
        () => (firestore && productIds.length > 0 ? query(collection(firestore, 'products'), where('__name__', 'in', productIds), limit(100)) : null),
        [firestore, productIds]
    );
    const { data: productsData, isLoading: isLoadingProducts } = useCollection<Product>(productsRef);

    const itemsWithProductData = useMemo(() => {
        if (!orderItemsData || !productsData) return [];
        const productsMap = new Map(productsData.map(p => [p.id, p]));
        return orderItemsData.map(item => ({
            ...item,
            product: productsMap.get(item.productId)
        })).filter(item => item.product) as OrderItemClient[];
    }, [orderItemsData, productsData]);
    
    const isLoadingDetails = isLoadingOrderItems || isLoadingProducts;

    const handleSuccessClose = () => {
        setIsCanceling(false);
        setIsRestoringStock(false);
        setActionDialog(null);
        onOpenChange(false);
    };

    const handleCertifyStockRestoration = async () => {
        if (!order || !currentUser || !firestore || orderItemsData?.length === 0) return;
        setIsRestoringStock(true);

        try {
            await runTransaction(firestore, async (transaction) => {
                const orderRef = doc(firestore, 'orders', order.id);
                
                // --- 1. LECTURAS (READS FIRST) ---
                const productRefs = productIds.map(id => doc(firestore, 'products', id));
                const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));
                const productDataMap = new Map<string, Product>();
                productSnaps.forEach(snap => { if (snap.exists()) productDataMap.set(snap.id, snap.data() as Product); });

                // --- 2. ESCRITURAS (WRITES) ---
                for (const item of orderItemsData!) {
                    const pData = productDataMap.get(item.productId);
                    await InventoryService.updateStockInTransaction(
                        transaction,
                        firestore,
                        item.productId,
                        item.quantity,
                        currentUser.id,
                        currentUser.name,
                        `Devolución Pedido #${order.id.substring(0, 8)}`,
                        item.size,
                        pData
                    );
                }
                transaction.update(orderRef, { stockRestored: true, updatedAt: serverTimestamp() });
            });

            toast({ title: 'Stock Restaurado' });
            handleSuccessClose();
        } catch (error: any) {
            setIsRestoringStock(false);
            toast({ variant: 'destructive', title: 'Error de Restauración', description: error.message });
        }
    };

    const handleCancelOrder = async () => {
        if (!order || !currentUser || !firestore || !orderItemsData) return;
        if (!window.confirm("¿Confirmar anulación definitiva?")) return;

        setIsCanceling(true);
        const isApproved = ['Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado'].includes(order.status);

        try {
            await runTransaction(firestore, async (transaction) => {
                const orderRef = doc(firestore, 'orders', order.id);
                const custRef = doc(firestore, 'customers', order.customerId);
                
                // --- 1. LECTURAS (READS FIRST) ---
                const productRefs = productIds.map(id => doc(firestore, 'products', id));
                const [orderSnap, ...productSnaps] = await Promise.all([
                    transaction.get(orderRef),
                    ...productRefs.map(ref => transaction.get(ref))
                ]);

                if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");

                const productDataMap = new Map<string, Product>();
                productSnaps.forEach(snap => { if (snap.exists()) productDataMap.set(snap.id, snap.data() as Product); });

                // --- 2. ESCRITURAS (WRITES) ---
                if (isApproved) {
                    transaction.update(custRef, {
                        creditUsed: increment(-order.totalAmount),
                        updatedAt: serverTimestamp()
                    });
                }

                const isStillInHouse = ['Aprobado', 'En Preparación', 'Completado'].includes(order.status);
                if (isStillInHouse) {
                    for (const item of orderItemsData!) {
                        const pData = productDataMap.get(item.productId);
                        await InventoryService.updateStockInTransaction(
                            transaction,
                            firestore,
                            item.productId,
                            item.quantity,
                            currentUser.id,
                            currentUser.name,
                            `Anulación Pedido #${order.id.substring(0, 8)}`,
                            item.size,
                            pData
                        );
                    }
                    transaction.update(orderRef, { status: 'Cancelado', stockRestored: true, updatedAt: serverTimestamp() });
                } else {
                    transaction.update(orderRef, { 
                        status: 'Cancelado', 
                        stockRestored: !isApproved,
                        updatedAt: serverTimestamp() 
                    });
                }
            });

            toast({ title: 'Pedido Anulado' });
            handleSuccessClose();
        } catch (error: any) {
            setIsCanceling(false);
            toast({ variant: 'destructive', title: 'Error al anular', description: error.message });
        }
    };
    
    if (!currentUser) return null;

    return (
        <>
            <OrderDetailsSheet 
                order={order} 
                currentUser={currentUser}
                customerRif={order.customerRif || customerData?.rif}
                isOpen={!!order}
                onOpenChange={onOpenChange}
                onActionTrigger={(action) => {
                    if (action === 'edit') {
                        onOpenChange(false);
                        router.push(`/dashboard/orders/edit?orderId=${order.id}`);
                    } else {
                        setActionDialog(action);
                    }
                }}
                onCancelOrder={handleCancelOrder}
                onRequestCancellation={() => {}}
                onCertifyStockRestoration={handleCertifyStockRestoration}
                isRestoringStock={isRestoringStock}
                isCanceling={isCanceling}
                isRequestingCancellation={false}
                items={itemsWithProductData}
                isLoadingItems={isLoadingDetails}
            />
            {actionDialog === 'status' && (
                <UpdateOrderStatusDialog 
                    order={order} 
                    isOpen={true} 
                    onOpenChange={(open) => !open && setActionDialog(null)} 
                />
            )}
            {actionDialog === 'approve' && (
                <ApproveOrderDialog 
                    order={order} 
                    currentUser={currentUser}
                    isOpen={true} 
                    onOpenChange={(open) => !open && setActionDialog(null)}
                    onSuccess={handleSuccessClose}
                />
            )}
        </>
    );
}
