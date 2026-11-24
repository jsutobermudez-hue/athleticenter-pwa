'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useCatalog } from '@/firebase/catalog-context';
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
        () => (order && firestore && currentUser) ? query(collection(firestore, 'orders', order.id, 'orderItems'), limit(300)) : null,
        [order?.id, firestore, currentUser?.id]
    );
    const { data: orderItemsData, isLoading: isLoadingOrderItems } = useCollection<OrderItem>(orderItemsRef);
    
    const productIds = useMemo(() => {
        if (!orderItemsData || orderItemsData.length === 0) return [];
        return Array.from(new Set(orderItemsData.map(item => item.productId)));
    }, [orderItemsData]);
    
    const { products: catalogProducts, isLoading: isLoadingCatalog } = useCatalog();
    const catalogMap = useMemo(
        () => new Map(catalogProducts.map(p => [p.id, p])),
        [catalogProducts]
    );

    const missingProductIdsKey = useMemo(() => {
        if (isLoadingCatalog) return '';
        return productIds.filter(id => !catalogMap.has(id)).join(',');
    }, [productIds, catalogMap, isLoadingCatalog]);

    const [extraProductsMap, setExtraProductsMap] = useState<Map<string, Product>>(new Map());
    const [isLoadingExtraProducts, setIsLoadingExtraProducts] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!firestore || !missingProductIdsKey) {
            setExtraProductsMap(new Map());
            setIsLoadingExtraProducts(false);
            return;
        }
        const idsToFetch = missingProductIdsKey.split(',').filter(Boolean);
        setIsLoadingExtraProducts(true);
        (async () => {
            try {
                const nextMap = new Map<string, Product>();
                for (let i = 0; i < idsToFetch.length; i += 30) {
                    const chunkIds = idsToFetch.slice(i, i + 30);
                    const snap = await getDocs(
                        query(collection(firestore, 'products'), where('__name__', 'in', chunkIds))
                    );
                    snap.forEach(d => {
                        nextMap.set(d.id, { id: d.id, ...d.data() } as Product);
                    });
                }
                if (!cancelled) {
                    setExtraProductsMap(nextMap);
                }
            } catch (err) {
                console.error('Error fetching missing order products:', err);
            } finally {
                if (!cancelled) {
                    setIsLoadingExtraProducts(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [firestore, missingProductIdsKey]);

    const itemsWithProductData = useMemo(() => {
        if (!orderItemsData) return [];
        return orderItemsData.map(item => ({
            ...item,
            product: catalogMap.get(item.productId) || extraProductsMap.get(item.productId)
        })).filter(item => item.product) as OrderItemClient[];
    }, [orderItemsData, catalogMap, extraProductsMap]);
    
    const isLoadingDetails = isLoadingOrderItems || isLoadingCatalog || isLoadingExtraProducts;

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

                const currentOrder = orderSnap.data() as Order;
                if (currentOrder.status === 'Cancelado') {
                    throw new Error("Este pedido ya ha sido cancelado previamente.");
                }

                const productDataMap = new Map<string, Product>();
                productSnaps.forEach(snap => { if (snap.exists()) productDataMap.set(snap.id, snap.data() as Product); });

                const isApproved = ['Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado'].includes(currentOrder.status);
                const isStillInHouse = ['Aprobado', 'En Preparación', 'Completado'].includes(currentOrder.status);
                const orderTotal = currentOrder.totalAmount || order.totalAmount || 0;

                // --- 2. ESCRITURAS (WRITES) ---
                if (isApproved && !(currentOrder as any).creditRestored) {
                    transaction.update(custRef, {
                        creditUsed: increment(-orderTotal),
                        updatedAt: serverTimestamp()
                    });
                }

                if (isStillInHouse && !(currentOrder as any).stockRestored) {
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
                    transaction.update(orderRef, { 
                        status: 'Cancelado', 
                        stockRestored: true, 
                        creditRestored: isApproved,
                        canceledAt: serverTimestamp(),
                        canceledBy: currentUser.id,
                        updatedAt: serverTimestamp() 
                    });
                } else {
                    transaction.update(orderRef, { 
                        status: 'Cancelado', 
                        stockRestored: (currentOrder as any).stockRestored || !isApproved,
                        creditRestored: isApproved,
                        canceledAt: serverTimestamp(),
                        canceledBy: currentUser.id,
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

    const handleDeleteOrder = async () => {
        if (!order || !currentUser || !firestore) return;
        if (!window.confirm(`⚠️ ATENCIÓN: ¿Deseas eliminar FÍSICAMENTE de la base de datos el pedido #${order.id}? Esta acción destruirá el registro duplicado definitivamente.`)) return;

        try {
            const { deleteDoc } = await import('firebase/firestore');
            const orderRef = doc(firestore, 'orders', order.id);
            await deleteDoc(orderRef);

            toast({ title: 'Pedido Eliminado', description: `El pedido #${order.id} fue eliminado permanentemente de la base de datos.` });
            handleSuccessClose();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error al eliminar', description: error.message });
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
                onDeleteOrder={handleDeleteOrder}
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
