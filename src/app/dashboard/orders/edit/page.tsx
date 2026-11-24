'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { useCatalog } from '@/firebase/catalog-context';
import {
    collection,
    doc,
    serverTimestamp,
    runTransaction,
    limit,
    getDocs,
    increment,
    query,
    where
} from 'firebase/firestore';
import type {
    Product,
    OrderItemClient,
    Order,
    Offer,
    FinancialSettings,
    OrderItem,
    OrderControlSettings
} from '@/lib/definitions';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    Loader2,
    Search,
    Trash2,
    ArrowLeft,
    ShoppingCart,
    User as UserIcon,
    Box,
    Lock,
    Pencil,
    AlertTriangle,
    CheckCircle2,
    Minus,
    Plus,
    Settings2,
    ShieldCheck
} from 'lucide-react';
import { ProductDetailsSheet } from '../../inventory/product-details-sheet';
import { ProductCard } from '@/components/dashboard/ProductCard';
import { calculateOfferPrice } from '@/lib/offers';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getOrderCommercialDiscountPercent, roundCurrency } from '@/lib/billing';
import { InventoryService } from '@/lib/inventory-service';
import { logActivity } from '@/lib/audit';
import { createAppNotifications } from '@/lib/notifications';
import {
    canUserEditOrder,
    computeStockChangesForOrderEdit,
    buildOrderEditSummary,
    STOCK_COMMITTED_STATUSES
} from '@/lib/order-editing';

export const dynamic = 'force-dynamic';

function normalizeSizeKey(size?: string | null): string {
    return typeof size === 'string' && size.trim().length > 0 ? size.trim() : '';
}

function lineKey(productId: string, size?: string | null): string {
    return `${productId}::${normalizeSizeKey(size)}`;
}

function EditOrderForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const firestore = useFirestore();
    const { profile: currentUser, isUserLoading } = useUser();

    const orderId = searchParams.get('orderId');
    const [orderItems, setOrderItems] = useState<OrderItemClient[]>([]);
    const [originalItems, setOriginalItems] = useState<OrderItemClient[]>([]);
    const [initialDataLoaded, setInitialOrderLoaded] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [productForDetails, setProductForDetails] = useState<Product | null>(null);
    const [productForSizes, setProductForSizes] = useState<Product | null>(null);

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [editReason, setEditReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const canManage = ['admin', 'gerencia', 'superadmin'].includes(currentUser?.role || '');

    const orderRef = useMemoFirebase(
        () => (firestore && orderId ? doc(firestore, 'orders', orderId) : null),
        [firestore, orderId]
    );
    const { data: orderData, isLoading: isLoadingOrder } = useDoc<Order>(orderRef);

    const orderItemsRef = useMemoFirebase(
        () => (firestore && orderId ? query(collection(firestore, 'orders', orderId, 'orderItems'), limit(300)) : null),
        [firestore, orderId]
    );
    const { data: dbItems, isLoading: isLoadingItems } = useCollection<OrderItem>(orderItemsRef);

    const orderControlsRef = useMemoFirebase(
        () => (firestore ? doc(firestore, 'system', 'orderControls') : null),
        [firestore]
    );
    const { data: orderControls, isLoading: isLoadingControls } = useDoc<OrderControlSettings>(orderControlsRef);

    const { products: catalogProducts, isLoading: isLoadingCatalog } = useCatalog();
    const [missingProductsMap, setMissingProductsMap] = useState<Map<string, Product>>(new Map());

    const offersCollection = useMemoFirebase(
        () => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null),
        [firestore]
    );
    const { data: allOffers } = useCollection<Offer>(offersCollection);

    const settingsRef = useMemoFirebase(
        () => (firestore ? doc(firestore, 'system', 'financials') : null),
        [firestore]
    );
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvDiscount = globalSettings?.defaultBcvDiscount || 25;

    // Reset al cambiar de orderId
    useEffect(() => {
        setInitialOrderLoaded(false);
        setOrderItems([]);
        setOriginalItems([]);
        setMissingProductsMap(new Map());
        setEditReason('');
        setIsConfirmOpen(false);
    }, [orderId]);

    // Resuelve cualquier producto archivado que ya no esté en el catálogo en memoria
    const missingIdsKey = useMemo(() => {
        if (isLoadingCatalog || !dbItems) return '';
        const catIds = new Set(catalogProducts.map((p) => p.id));
        const missing = Array.from(new Set(dbItems.map((i) => i.productId).filter((id) => id && !catIds.has(id))));
        return missing.join(',');
    }, [dbItems, catalogProducts, isLoadingCatalog]);

    useEffect(() => {
        let cancelled = false;
        if (!firestore || !missingIdsKey) return;
        const ids = missingIdsKey.split(',').filter(Boolean);
        (async () => {
            try {
                const next = new Map<string, Product>();
                for (let i = 0; i < ids.length; i += 30) {
                    const batch = ids.slice(i, i + 30);
                    const snap = await getDocs(
                        query(collection(firestore, 'products'), where('__name__', 'in', batch))
                    );
                    snap.forEach((d) => {
                        next.set(d.id, { id: d.id, ...d.data() } as Product);
                    });
                }
                if (!cancelled) setMissingProductsMap(next);
            } catch (e) {
                console.warn('[EditOrder] Error cargando productos fuera de catálogo:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [firestore, missingIdsKey]);

    const baseProductsMap = useMemo(() => {
        const map = new Map<string, Product>();
        catalogProducts.forEach((p) => {
            if (p.id) map.set(p.id, p);
        });
        missingProductsMap.forEach((p, id) => {
            if (!map.has(id)) map.set(id, p);
        });
        return map;
    }, [catalogProducts, missingProductsMap]);

    useEffect(() => {
        if (!orderData || !dbItems || isLoadingCatalog || initialDataLoaded) return;
        const hydrated: OrderItemClient[] = dbItems.map((item) => {
            const found = baseProductsMap.get(item.productId);
            const fallbackProduct: Product =
                found ||
                ({
                    id: item.productId,
                    sku: item.productId,
                    name: `Producto (${item.productId})`,
                    category: 'General',
                    stockLevel: 0,
                    price: item.unitPrice,
                    priceCashUSD: item.unitPrice,
                    cost: 0,
                    userId: '',
                } as Product);
            return {
                ...item,
                size: normalizeSizeKey(item.size) || undefined,
                product: fallbackProduct,
            };
        });
        setOrderItems(hydrated);
        setOriginalItems(hydrated);
        setInitialOrderLoaded(true);
    }, [orderData, dbItems, isLoadingCatalog, baseProductsMap, initialDataLoaded]);

    const editPermission = useMemo(
        () => canUserEditOrder({ user: currentUser, order: orderData, controls: orderControls }),
        [currentUser, orderData, orderControls]
    );

    const originalQtyByProduct = useMemo(() => {
        const map = new Map<string, number>();
        originalItems.forEach((it) => {
            map.set(it.productId, (map.get(it.productId) || 0) + (it.quantity || 0));
        });
        return map;
    }, [originalItems]);

    const originalQtyByProductSize = useMemo(() => {
        const map = new Map<string, number>();
        originalItems.forEach((it) => {
            const k = lineKey(it.productId, it.size);
            map.set(k, (map.get(k) || 0) + (it.quantity || 0));
        });
        return map;
    }, [originalItems]);

    const originalPriceByLine = useMemo(() => {
        const map = new Map<string, number>();
        originalItems.forEach((it) => {
            map.set(lineKey(it.productId, it.size), Number(it.unitPrice || 0));
        });
        return map;
    }, [originalItems]);

    // Stock efectivo para pedidos con stock ya reservado: stock actual en bodega + unidades reservadas por este mismo pedido
    const effectiveInventory = useMemo(() => {
        if (!editPermission.isStockCommitted) return catalogProducts;
        return catalogProducts.map((p) => {
            const pId = p.id || '';
            const reservedTotal = pId ? (originalQtyByProduct.get(pId) || 0) : 0;
            const hasReservedSize = p.hasSizes && p.sizes;
            if (reservedTotal === 0 && !hasReservedSize) return p;

            const baseStock = Number(p.stockLevel ?? (p as any).stock ?? 0);
            const nextSizes = p.hasSizes && p.sizes ? { ...p.sizes } : p.sizes;
            if (p.hasSizes && nextSizes && pId) {
                Object.keys(nextSizes).forEach((sz) => {
                    const reservedSz = originalQtyByProductSize.get(lineKey(pId, sz)) || 0;
                    if (reservedSz > 0) {
                        nextSizes[sz] = Number(nextSizes[sz] || 0) + reservedSz;
                    }
                });
            }

            return {
                ...p,
                stockLevel: baseStock + reservedTotal,
                stock: baseStock + reservedTotal,
                sizes: nextSizes,
            } as Product;
        });
    }, [catalogProducts, editPermission.isStockCommitted, originalQtyByProduct, originalQtyByProductSize]);

    const effectiveProductsMap = useMemo(() => {
        const map = new Map<string, Product>();
        effectiveInventory.forEach((p) => {
            if (p.id) map.set(p.id, p);
        });
        missingProductsMap.forEach((p, id) => {
            if (!map.has(id)) map.set(id, p);
        });
        return map;
    }, [effectiveInventory, missingProductsMap]);

    const totalAmount = useMemo(
        () => roundCurrency(orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)),
        [orderItems]
    );

    const editSummary = useMemo(
        () => buildOrderEditSummary(originalItems, orderItems, baseProductsMap),
        [originalItems, orderItems, baseProductsMap]
    );

    const handleQuickQuantityChange = (product: Product, newQuantity: number, size?: string) => {
        const productId = product.id || '';
        if (!productId) return;
        const effectiveProd = effectiveProductsMap.get(productId) || product;
        if (effectiveProd.hasSizes && !size) {
            setProductForSizes(effectiveProd);
            return;
        }

        const normSize = normalizeSizeKey(size);
        const maxStock =
            effectiveProd.hasSizes && normSize && effectiveProd.sizes
                ? Number(effectiveProd.sizes[normSize] || 0)
                : Number(effectiveProd.stockLevel ?? (effectiveProd as any).stock ?? 0);

        setOrderItems((prev) => {
            const idx = prev.findIndex((i) => lineKey(i.productId, i.size) === lineKey(productId, normSize));
            const existingQty = idx !== -1 ? prev[idx].quantity : 0;
            const effectiveMax = editPermission.isStockCommitted ? maxStock : Math.max(maxStock, existingQty);
            const clampedQty = Math.max(0, Math.min(Math.trunc(Number(newQuantity) || 0), effectiveMax));

            if (clampedQty <= 0) {
                if (idx === -1) return prev;
                const copy = [...prev];
                copy.splice(idx, 1);
                return copy;
            }
            if (idx !== -1) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], quantity: clampedQty };
                return copy;
            }
            const originalPrice = originalPriceByLine.get(lineKey(productId, normSize));
            const offer = calculateOfferPrice(effectiveProd, allOffers);
            const resolvedPrice = originalPrice !== undefined ? originalPrice : roundCurrency(offer.finalPrice);

            return [
                ...prev,
                {
                    productId,
                    quantity: clampedQty,
                    unitPrice: resolvedPrice,
                    size: normSize || undefined,
                    picked: false,
                    customerId: orderData?.customerId,
                    salespersonId: orderData?.salespersonId,
                    product: baseProductsMap.get(productId) || effectiveProd,
                },
            ];
        });
    };

    const handleRemoveItem = (productId: string, size?: string) => {
        const targetKey = lineKey(productId, size);
        setOrderItems((prev) => prev.filter((i) => lineKey(i.productId, i.size) !== targetKey));
    };

    const handleUnitPriceChange = (productId: string, size: string | undefined, nextPriceRaw: string) => {
        if (!canManage) return;
        const parsed = parseFloat(nextPriceRaw);
        const cleanPrice = isNaN(parsed) || parsed < 0 ? 0 : roundCurrency(parsed);
        const targetKey = lineKey(productId, size);
        setOrderItems((prev) =>
            prev.map((i) => (lineKey(i.productId, i.size) === targetKey ? { ...i, unitPrice: cleanPrice } : i))
        );
    };

    const handleConfirmUpdate = async () => {
        if (!firestore || !currentUser || !orderData || isSubmitting) return;

        const cleanReason = editReason.trim();
        if (cleanReason.length < 5) {
            toast({
                variant: 'destructive',
                title: 'Motivo Requerido',
                description: 'Indica un motivo claro de al menos 5 caracteres para la auditoría.',
            });
            return;
        }
        if (orderItems.length === 0) {
            toast({
                variant: 'destructive',
                title: 'Pedido Vacío',
                description: 'El pedido debe conservar al menos un producto. Para eliminarlo por completo usa Anular Pedido.',
            });
            return;
        }

        setIsSubmitting(true);
        const actorName = currentUser.name || currentUser.email || 'Usuario';
        const expectedEditCount = Number(orderData.editCount || 0);

        try {
            // Pre-lectura de los ítems actuales en Firestore para reemplazar subcolección y detectar líneas intactas
            const originalItemsSnap = await getDocs(collection(firestore, `orders/${orderData.id}/orderItems`));
            const liveOriginalItems = originalItemsSnap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as OrderItem),
            }));

            const pickedStateByLine = new Map<string, { qty: number; picked: boolean }>();
            liveOriginalItems.forEach((it) => {
                pickedStateByLine.set(lineKey(it.productId, it.size), {
                    qty: Number(it.quantity || 0),
                    picked: Boolean(it.picked),
                });
            });

            const liveSummary = buildOrderEditSummary(liveOriginalItems, orderItems, baseProductsMap);
            const summaryText =
                liveSummary.lines.slice(0, 6).join(' · ') +
                (liveSummary.lines.length > 6 ? ` (+${liveSummary.lines.length - 6} cambios más)` : '');

            let committedStatus = orderData.status;
            let committedOldTotal = Number(orderData.totalAmount || 0);
            let committedNewTotal = totalAmount;

            await runTransaction(firestore, async (transaction) => {
                // --- FASE 1: TODAS LAS LECTURAS PRIMERO (READS-BEFORE-WRITES) ---
                const currentOrderRef = doc(firestore, 'orders', orderData.id);
                const controlsDocRef = doc(firestore, 'system', 'orderControls');

                const [orderSnap, controlsSnap] = await Promise.all([
                    transaction.get(currentOrderRef),
                    transaction.get(controlsDocRef),
                ]);

                if (!orderSnap.exists()) {
                    throw new Error('El pedido ya no existe en el sistema.');
                }

                const dbOrder = { id: orderSnap.id, ...orderSnap.data() } as Order;
                if (Number(dbOrder.editCount || 0) !== expectedEditCount) {
                    throw new Error('Otro usuario modificó este pedido hace unos segundos. Recarga la pantalla para ver la versión más reciente.');
                }

                const dbControls = controlsSnap.exists() ? (controlsSnap.data() as OrderControlSettings) : null;
                const livePerm = canUserEditOrder({ user: currentUser, order: dbOrder, controls: dbControls });
                if (!livePerm.allowed) {
                    throw new Error(livePerm.reason || 'La edición de este pedido ya no está habilitada.');
                }

                const newTotalAmount = roundCurrency(
                    orderItems.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0)
                );
                const discountPct = getOrderCommercialDiscountPercent(dbOrder);
                const isNetOrPromo =
                    (dbOrder as any).incentivesApplied === true ||
                    (dbOrder as any).isNetPrice === true ||
                    Boolean((dbOrder as any).promoName);
                const effectiveDiscount = isNetOrPromo ? 0 : discountPct;
                const newNetPayable = roundCurrency(Math.max(0, newTotalAmount * (1 - effectiveDiscount / 100)));
                const amountPaid = Number(dbOrder.amountPaid || 0);

                if (amountPaid > 0.05 && newNetPayable + 0.05 < amountPaid) {
                    throw new Error(
                        `El nuevo total neto ($${newNetPayable.toFixed(2)}) no puede ser inferior al monto ya abonado ($${amountPaid.toFixed(2)}).`
                    );
                }

                const isStockCommitted = STOCK_COMMITTED_STATUSES.includes(dbOrder.status);
                const stockChanges = isStockCommitted
                    ? computeStockChangesForOrderEdit(liveOriginalItems, orderItems)
                    : [];
                const uniqueProductIds = Array.from(new Set(stockChanges.map((c) => c.productId)));
                const totalDelta = roundCurrency(newTotalAmount - Number(dbOrder.totalAmount || 0));
                const needsCreditAdjust =
                    isStockCommitted && Math.abs(totalDelta) > 0.001 && Boolean(dbOrder.customerId);

                const customerRef = dbOrder.customerId ? doc(firestore, 'customers', dbOrder.customerId) : null;
                const [customerSnap, ...productSnaps] = await Promise.all([
                    needsCreditAdjust && customerRef ? transaction.get(customerRef) : Promise.resolve(null),
                    ...uniqueProductIds.map((pId) => transaction.get(doc(firestore, 'products', pId))),
                ]);

                const productDataMap: Record<string, Product | undefined> = {};
                productSnaps.forEach((snap) => {
                    if (snap.exists()) {
                        productDataMap[snap.id] = { id: snap.id, ...snap.data() } as Product;
                    }
                });

                committedStatus = dbOrder.status;
                committedOldTotal = Number(dbOrder.totalAmount || 0);
                committedNewTotal = newTotalAmount;

                // --- FASE 2: TODAS LAS ESCRITURAS DESPUÉS ---
                if (isStockCommitted && stockChanges.length > 0) {
                    InventoryService.applyGroupedStockChanges(
                        transaction,
                        firestore,
                        stockChanges,
                        currentUser.id,
                        actorName,
                        `Edición Pedido #${orderData.id.substring(0, 8)}: ${cleanReason}`,
                        productDataMap,
                        { isReturn: true }
                    );
                }

                if (needsCreditAdjust && customerRef && customerSnap && customerSnap.exists()) {
                    const currentCreditUsed = Number(customerSnap.data()?.creditUsed || 0);
                    const nextCreditUsed = roundCurrency(Math.max(0, currentCreditUsed + totalDelta));
                    transaction.update(customerRef, {
                        creditUsed: nextCreditUsed,
                        updatedAt: serverTimestamp(),
                    });
                }

                transaction.update(currentOrderRef, {
                    totalAmount: newTotalAmount,
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.id,
                    lastEditedBy: currentUser.id,
                    lastEditedByName: actorName,
                    lastEditedByRole: currentUser.role,
                    lastEditedAt: serverTimestamp(),
                    lastEditReason: cleanReason,
                    editCount: increment(1),
                });

                originalItemsSnap.docs.forEach((d) => transaction.delete(d.ref));

                orderItems.forEach((item) => {
                    const prevLine = pickedStateByLine.get(lineKey(item.productId, item.size));
                    const keepPicked = Boolean(prevLine && prevLine.picked && prevLine.qty === item.quantity);
                    const newItemRef = doc(collection(firestore, `orders/${orderData.id}/orderItems`));
                    transaction.set(newItemRef, {
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        size: item.size || null,
                        picked: keepPicked,
                        customerId: dbOrder.customerId,
                        salespersonId: dbOrder.salespersonId,
                        updatedAt: serverTimestamp(),
                    });
                });

                const historyRef = doc(collection(firestore, `orders/${orderData.id}/statusHistory`));
                transaction.set(historyRef, {
                    stage: 'Editado',
                    title: 'EDICIÓN DE PEDIDO COMERCIAL',
                    description: `${summaryText || 'Actualización de líneas del pedido.'} Total: $${committedOldTotal.toFixed(2)} -> $${newTotalAmount.toFixed(2)} USD.`,
                    timestamp: serverTimestamp(),
                    actorName,
                    actorRole: currentUser.role,
                    metadata: {
                        justification: cleanReason,
                    },
                });
            });

            // Registro inmutable en Auditoría Global (Nivel 3) y notificaciones internas
            try {
                await logActivity(firestore, {
                    userId: currentUser.id,
                    userName: actorName,
                    userRole: currentUser.role,
                    action: 'EDIT_ORDER',
                    resource: 'orders',
                    module: 'orders',
                    resourceId: orderData.id,
                    severity: 'warning',
                    details: `${actorName} (${currentUser.role}) editó el pedido #${orderData.id.substring(0, 8)} (${committedStatus}). ${summaryText} | Motivo: "${cleanReason}"`,
                    previousState: {
                        status: committedStatus,
                        totalAmount: committedOldTotal,
                        items: liveOriginalItems.map((i) => ({
                            productId: i.productId,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                            size: i.size || null,
                        })),
                    },
                    newState: {
                        status: committedStatus,
                        totalAmount: committedNewTotal,
                        reason: cleanReason,
                        items: orderItems.map((i) => ({
                            productId: i.productId,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                            size: i.size || null,
                        })),
                    },
                });
            } catch (auditErr) {
                console.warn('[EditOrder] Error registrando auditoría global:', auditErr);
            }

            try {
                const notifyRoles: Array<'admin' | 'gerencia' | 'deposito'> = ['admin', 'gerencia'];
                const needsWarehouseAlert = ['En Preparación', 'Completado'].includes(committedStatus);
                if (needsWarehouseAlert) notifyRoles.push('deposito');

                await createAppNotifications(firestore, {
                    category: needsWarehouseAlert ? 'Despacho' : 'Pedidos',
                    title: `Pedido Editado #${orderData.id.substring(0, 6)}`,
                    message: `${actorName} modificó el pedido (${committedStatus}) de ${orderData.customerName}. Motivo: ${cleanReason}`,
                    link: `/dashboard/orders`,
                    initiatorId: currentUser.id,
                    salespersonId: orderData.salespersonId,
                    roles: notifyRoles,
                });
            } catch (notifErr) {
                console.warn('[EditOrder] Error enviando notificaciones:', notifErr);
            }

            setIsConfirmOpen(false);
            toast({
                title: 'Pedido Actualizado',
                description: 'Los cambios, ajustes de inventario y auditoría quedaron registrados.',
            });
            router.push('/dashboard/orders');
        } catch (e: any) {
            toast({
                variant: 'destructive',
                title: 'No se pudo guardar la edición',
                description: e?.message || 'Error al sincronizar el pedido.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isUserLoading || isLoadingOrder || isLoadingItems || isLoadingCatalog || isLoadingControls) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="animate-spin text-primary h-10 w-10" />
            </div>
        );
    }

    if (!orderId || !orderData) {
        return (
            <div className="max-w-xl mx-auto mt-16 p-8 bg-white rounded-[2rem] shadow-xl border text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
                <h2 className="text-xl font-black uppercase text-slate-900">Pedido no encontrado</h2>
                <p className="text-xs font-semibold text-slate-500">
                    Verifica el enlace o selecciona el expediente directamente desde el tablero de pedidos.
                </p>
                <Button onClick={() => router.push('/dashboard/orders')} className="rounded-xl font-black uppercase text-xs">
                    Volver a Pedidos
                </Button>
            </div>
        );
    }

    if (!editPermission.allowed) {
        return (
            <div className="max-w-xl mx-auto mt-16 p-8 bg-white rounded-[2rem] shadow-xl border border-slate-200 text-center space-y-5">
                <div className="h-16 w-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                    <Lock className="h-8 w-8" />
                </div>
                <div className="space-y-1.5">
                    <h2 className="text-xl font-black uppercase text-slate-900 tracking-tight">Edición No Disponible</h2>
                    <p className="text-xs font-bold text-slate-500">
                        Pedido #{orderData.id.substring(0, 8)} · Etapa actual: <span className="text-slate-900">{orderData.status}</span>
                    </p>
                </div>
                <p className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700">
                    {editPermission.reason}
                </p>
                <div className="flex flex-wrap justify-center gap-3 pt-2">
                    <Button variant="outline" onClick={() => router.push('/dashboard/orders')} className="rounded-xl font-black uppercase text-xs">
                        <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Pedidos
                    </Button>
                    {canManage && !orderControls?.allowOrderEditing && (
                        <Button asChild className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs">
                            <Link href="/dashboard/settings#order-editing-control">
                                <Settings2 className="mr-2 h-4 w-4" /> Habilitar en Configuración
                            </Link>
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    const filteredInventory = effectiveInventory.filter((p) => {
        const term = searchTerm.toLowerCase().trim();
        if (!term) return true;
        return (
            p.name.toLowerCase().includes(term) ||
            (p.sku || '').toLowerCase().includes(term) ||
            (p.brand || '').toLowerCase().includes(term)
        );
    });

    const totalDelta = roundCurrency(totalAmount - Number(orderData.totalAmount || 0));

    return (
        <div className="flex flex-col gap-4 w-full animate-in fade-in-50 duration-500 pb-20">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/orders')} className="h-9 w-9 rounded-full bg-white shadow-sm">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                                Editor Controlado de Pedido
                            </h1>
                            <Badge className="bg-indigo-600 text-white border-none text-[9px] font-black uppercase">
                                {orderData.status}
                            </Badge>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest flex items-center gap-1.5">
                            <UserIcon className="h-3 w-3 text-primary" />
                            #{orderData.id.substring(0, 8)} · {orderData.customerName}
                        </p>
                    </div>
                </div>
            </header>

            {editPermission.isStockCommitted && (
                <div className="mx-2 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3 text-amber-900">
                    <ShieldCheck className="h-5 w-5 text-amber-600 shrink-0" />
                    <p className="text-[11px] font-bold leading-snug">
                        Este pedido ya reservó inventario ({orderData.status}). Al guardar, el sistema ajustará automáticamente el stock por talla, el crédito del cliente y notificará a Almacén.
                    </p>
                </div>
            )}

            <div className="sticky top-0 z-30 px-2 space-y-4 bg-background/95 backdrop-blur-md pb-4 pt-2 shadow-sm">
                <Card className="border-none shadow-2xl rounded-[2rem] overflow-hidden ring-1 ring-primary/10">
                    <Accordion type="single" collapsible defaultValue="cart-details" className="w-full">
                        <AccordionItem value="cart-details" className="border-none">
                            <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-6 gap-4">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-xl">
                                        <ShoppingCart className="h-5 w-5" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-baseline gap-3 flex-wrap">
                                            <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter">
                                                ${totalAmount.toFixed(2)}
                                            </span>
                                            {Math.abs(totalDelta) > 0.005 && (
                                                <Badge
                                                    className={cn(
                                                        "text-[10px] font-black uppercase border-none",
                                                        totalDelta > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
                                                    )}
                                                >
                                                    {totalDelta > 0 ? '+' : ''}${totalDelta.toFixed(2)} vs. anterior (${Number(orderData.totalAmount || 0).toFixed(2)})
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black text-[9px] px-2 h-5 rounded-lg">
                                                {orderItems.length} LÍNEAS · {orderItems.reduce((s, i) => s + (i.quantity || 0), 0)} UNIDADES
                                            </Badge>
                                            <AccordionTrigger className="p-0 hover:no-underline font-black text-[9px] uppercase text-primary">
                                                Ver y editar ítems
                                            </AccordionTrigger>
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    className="w-full sm:w-auto h-12 px-8 font-black uppercase shadow-xl rounded-xl bg-slate-900 hover:bg-indigo-600 transition-all text-white text-[10px] tracking-wider"
                                    disabled={isSubmitting || orderItems.length === 0 || !editSummary.hasChanges}
                                    onClick={() => setIsConfirmOpen(true)}
                                >
                                    <Pencil className="mr-2 h-4 w-4" /> Revisar y Guardar Cambios
                                </Button>
                            </div>

                            <AccordionContent className="bg-slate-50/60 border-t">
                                <ScrollArea className="max-h-[300px] p-4 sm:p-6">
                                    {orderItems.length === 0 ? (
                                        <div className="p-6 text-center text-xs font-bold uppercase text-slate-400">
                                            No hay artículos seleccionados. Agrega al menos un producto del catálogo inferior.
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                            {orderItems.map((item) => {
                                                const effProd = effectiveProductsMap.get(item.productId) || item.product;
                                                const maxStock =
                                                    effProd.hasSizes && item.size && effProd.sizes
                                                        ? Number(effProd.sizes[item.size] || 0)
                                                        : Number(effProd.stockLevel ?? (effProd as any).stock ?? 0);
                                                const resolvedMax = editPermission.isStockCommitted ? Math.max(maxStock, item.quantity) : 999999;

                                                return (
                                                    <div
                                                        key={lineKey(item.productId, item.size)}
                                                        className="flex flex-col justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm"
                                                    >
                                                        <div className="flex items-center justify-between gap-2.5">
                                                            <div className="min-w-0 flex-1 flex items-center gap-3">
                                                                <Avatar className="h-11 w-11 rounded-xl shrink-0 border border-slate-100">
                                                                    <AvatarImage src={item.product?.imageUrl} className="object-cover" />
                                                                    <AvatarFallback><Box className="h-4 w-4" /></AvatarFallback>
                                                                </Avatar>
                                                                <div className="min-w-0">
                                                                    <p className="text-[11px] font-black uppercase truncate text-slate-900">
                                                                        {item.product?.name || item.productId}
                                                                    </p>
                                                                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                                                        <span className="text-[9px] font-mono font-bold text-slate-400">
                                                                            {item.product?.sku}
                                                                        </span>
                                                                        {item.size && (
                                                                            <Badge variant="outline" className="text-[8px] font-black px-1.5 h-4">
                                                                                TALLA {item.size}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label="Eliminar ítem"
                                                                className="h-8 w-8 text-rose-500 hover:bg-rose-50 shrink-0 rounded-lg"
                                                                onClick={() => handleRemoveItem(item.productId, item.size)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>

                                                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                                                            <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1 border border-slate-200">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 rounded-lg"
                                                                    onClick={() =>
                                                                        handleQuickQuantityChange(effProd, item.quantity - 1, item.size)
                                                                    }
                                                                >
                                                                    <Minus className="h-3 w-3" />
                                                                </Button>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    max={resolvedMax}
                                                                    value={item.quantity}
                                                                    onChange={(e) => {
                                                                        const parsed = parseInt(e.target.value, 10);
                                                                        if (!isNaN(parsed)) {
                                                                            handleQuickQuantityChange(effProd, parsed, item.size);
                                                                        }
                                                                    }}
                                                                    className="w-12 h-7 p-0 text-center text-xs font-black bg-white border-none rounded-md"
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 rounded-lg"
                                                                    disabled={editPermission.isStockCommitted && item.quantity >= resolvedMax}
                                                                    onClick={() =>
                                                                        handleQuickQuantityChange(effProd, item.quantity + 1, item.size)
                                                                    }
                                                                >
                                                                    <Plus className="h-3 w-3" />
                                                                </Button>
                                                            </div>

                                                            <div className="flex items-center gap-2">
                                                                {canManage ? (
                                                                    <div className="flex items-center gap-1">
                                                                        <span className="text-[10px] font-bold text-slate-400">$</span>
                                                                        <Input
                                                                            type="number"
                                                                            step="0.01"
                                                                            min="0"
                                                                            value={item.unitPrice}
                                                                            onChange={(e) =>
                                                                                handleUnitPriceChange(item.productId, item.size, e.target.value)
                                                                            }
                                                                            className="w-16 h-7 px-1.5 text-right text-xs font-black bg-slate-50 border-slate-200 rounded-md"
                                                                        />
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-[10px] font-bold text-slate-500">
                                                                        ${item.unitPrice.toFixed(2)} c/u
                                                                    </span>
                                                                )}
                                                                <span className="text-xs font-black text-slate-900 font-mono">
                                                                    ${(item.quantity * item.unitPrice).toFixed(2)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </Card>

                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="BUSCAR PRODUCTO POR NOMBRE, SKU O MARCA PARA AGREGAR O AJUSTAR..."
                        className="pl-12 h-14 rounded-[1.5rem] bg-white border-none shadow-sm font-bold uppercase text-[11px] ring-1 ring-slate-100"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="px-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {filteredInventory.map((product) => (
                        <ProductCard
                            key={product.id}
                            product={product}
                            onSelect={setProductForDetails}
                            bcvDiscount={bcvDiscount}
                            quantityInCart={orderItems
                                .filter((i) => i.productId === product.id)
                                .reduce((s, i) => s + i.quantity, 0)}
                            onQuantityChange={handleQuickQuantityChange}
                        />
                    ))}
                </div>
            </div>

            <ProductDetailsSheet
                product={productForDetails}
                allOffers={allOffers || []}
                isOpen={!!productForDetails}
                onOpenChange={(open) => !open && setProductForDetails(null)}
                canManageInventory={canManage}
                canDelete={false}
                onDelete={() => {}}
            />

            {/* MODAL SELECTOR DE TALLAS CON STOCK EFECTIVO */}
            <Dialog open={!!productForSizes} onOpenChange={(open) => !open && setProductForSizes(null)}>
                <DialogContent className="sm:max-w-xl rounded-[2.5rem] p-0 overflow-hidden text-left border-none shadow-2xl">
                    <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white text-left relative">
                        <div className="flex items-center gap-4">
                            <Avatar className="h-14 w-14 rounded-2xl border-2 border-primary/40 shadow-md shrink-0">
                                <AvatarImage src={productForSizes?.imageUrl} className="object-cover" />
                                <AvatarFallback className="bg-primary/20 text-primary font-black">
                                    <Box className="h-6 w-6" />
                                </AvatarFallback>
                            </Avatar>
                            <div className="space-y-1 min-w-0 flex-1">
                                <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white leading-none truncate">
                                    {productForSizes?.name}
                                </DialogTitle>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                    SKU: {productForSizes?.sku} | Selección por Tallas
                                </p>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="p-6 sm:p-8 max-h-[60vh] overflow-y-auto bg-slate-50/50 space-y-6">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {productForSizes?.sizes &&
                                Object.entries(productForSizes.sizes).map(([size, stock]) => {
                                    const currentQty =
                                        orderItems.find((i) => lineKey(i.productId, i.size) === lineKey(productForSizes.id || '', size))
                                            ?.quantity || 0;
                                    const isOutOfStock = stock <= 0 && currentQty === 0;
                                    const isLowStock = stock <= 5 && stock > 0;

                                    return (
                                        <div
                                            key={size}
                                            className={cn(
                                                "p-3 rounded-2xl border transition-all space-y-2 relative",
                                                isOutOfStock
                                                    ? "bg-slate-100 opacity-60 border-slate-200"
                                                    : "bg-white border-slate-200 hover:border-primary shadow-sm"
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-black uppercase text-slate-900">Talla {size}</span>
                                                <Badge
                                                    variant={isOutOfStock ? "outline" : isLowStock ? "destructive" : "secondary"}
                                                    className="text-[8px] font-black uppercase px-1.5 h-4"
                                                >
                                                    {isOutOfStock ? "Agotado" : `${stock} disp.`}
                                                </Badge>
                                            </div>
                                            <Input
                                                type="number"
                                                min="0"
                                                max={stock}
                                                disabled={isOutOfStock}
                                                value={isNaN(currentQty) ? '' : currentQty || 0}
                                                onChange={(e) =>
                                                    handleQuickQuantityChange(
                                                        productForSizes,
                                                        e.target.value === '' ? 0 : Number(e.target.value),
                                                        size
                                                    )
                                                }
                                                className="h-11 text-center font-black text-lg rounded-xl bg-slate-50 border-none shadow-inner"
                                            />
                                        </div>
                                    );
                                })}
                        </div>
                    </div>

                    <DialogFooter className="p-6 sm:p-8 bg-white border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Total en Pedido</p>
                            <p className="text-lg font-black text-slate-900 tracking-tighter">
                                {orderItems
                                    .filter((i) => i.productId === productForSizes?.id)
                                    .reduce((s, i) => s + i.quantity, 0)}{' '}
                                Unidades
                            </p>
                        </div>
                        <Button
                            className="w-full sm:w-auto h-12 px-8 bg-primary hover:bg-primary/90 text-white font-black uppercase text-[10px] tracking-widest rounded-xl shadow-lg"
                            onClick={() => setProductForSizes(null)}
                        >
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar Tallas
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* DIÁLOGO DE CONFIRMACIÓN ANTES VS DESPUÉS + MOTIVO OBLIGATORIO */}
            <Dialog open={isConfirmOpen} onOpenChange={(open) => !isSubmitting && setIsConfirmOpen(open)}>
                <DialogContent className="sm:max-w-xl rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
                    <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white">
                        <DialogTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2.5">
                            <Pencil className="h-5 w-5 text-indigo-400" /> Confirmar Edición de Pedido #{orderData.id.substring(0, 8)}
                        </DialogTitle>
                        <DialogDescription className="text-xs font-semibold text-slate-300">
                            Revisa el comparativo Antes vs. Después e indica el motivo para el registro de auditoría.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="p-6 sm:p-8 space-y-5 max-h-[65vh] overflow-y-auto bg-white">
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                <p className="text-[9px] font-black uppercase text-slate-400">Total Anterior</p>
                                <p className="text-lg font-black text-slate-700 font-mono">
                                    ${Number(orderData.totalAmount || 0).toFixed(2)}
                                </p>
                            </div>
                            <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200">
                                <p className="text-[9px] font-black uppercase text-indigo-600">Nuevo Total</p>
                                <p className="text-lg font-black text-indigo-900 font-mono">${totalAmount.toFixed(2)}</p>
                            </div>
                            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                <p className="text-[9px] font-black uppercase text-slate-400">Diferencia</p>
                                <p
                                    className={cn(
                                        "text-lg font-black font-mono",
                                        totalDelta > 0 ? "text-emerald-600" : totalDelta < 0 ? "text-amber-600" : "text-slate-600"
                                    )}
                                >
                                    {totalDelta > 0 ? '+' : ''}${totalDelta.toFixed(2)}
                                </p>
                            </div>
                        </div>

                        {editPermission.isStockCommitted && (
                            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900">
                                Al guardar se ajustará automáticamente el inventario por talla, el crédito utilizado del cliente y se notificará a Almacén.
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Resumen de Modificaciones ({editSummary.lines.length})
                            </Label>
                            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 max-h-40 overflow-y-auto space-y-1.5 text-xs font-bold text-slate-700">
                                {editSummary.lines.map((line, i) => (
                                    <p key={i} className="leading-snug">
                                        {line}
                                    </p>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                Motivo de la Edición (Obligatorio para Auditoría)
                            </Label>
                            <Textarea
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                placeholder="Ej. Cliente cambió 2 balones #4 por #5 antes del despacho..."
                                className="rounded-2xl bg-slate-50 border border-slate-200 min-h-[88px] text-xs font-semibold p-3.5"
                            />
                            <p className="text-[10px] font-semibold text-slate-400">
                                Quedará registrado a nombre de <strong>{currentUser?.name || currentUser?.email}</strong> ({currentUser?.role}). Mínimo 5 caracteres.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="p-6 bg-slate-50 border-t flex flex-col sm:flex-row gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isSubmitting}
                            onClick={() => setIsConfirmOpen(false)}
                            className="rounded-xl font-black uppercase text-xs flex-1 h-11"
                        >
                            Seguir Editando
                        </Button>
                        <Button
                            type="button"
                            disabled={isSubmitting || editReason.trim().length < 5}
                            onClick={handleConfirmUpdate}
                            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs flex-[1.4] h-11 shadow-lg"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando y Auditando...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar Edición Oficial
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function EditOrderPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-screen items-center justify-center">
                    <Loader2 className="animate-spin text-primary h-10 w-10" />
                </div>
            }
        >
            <EditOrderForm />
        </Suspense>
    );
}
