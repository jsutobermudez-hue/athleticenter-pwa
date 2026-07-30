'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, doc, serverTimestamp, runTransaction, limit, getDocs, getDoc } from 'firebase/firestore';
import type { Product, Customer, OrderItemClient, Order, Offer, FinancialSettings, OrderItem } from '@/lib/definitions';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, Search, Trash2, ArrowLeft, ShoppingCart, Check, ChevronsUpDown, Save, User as UserIcon, Box } from 'lucide-react';
import { ProductDetailsSheet } from '../../inventory/product-details-sheet';
import { ProductCard } from '@/components/dashboard/ProductCard';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandGroup } from "@/components/ui/command";
import { calculateOfferPrice } from '@/lib/offers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const dynamic = 'force-dynamic';

function EditOrderForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const firestore = useFirestore();
    const { profile: currentUser, isUserLoading, customerProfile } = useUser();

    const orderId = searchParams.get('orderId');
    const [orderItems, setOrderItems] = useState<OrderItemClient[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [productForDetails, setProductForDetails] = useState<Product | null>(null);
    const [productForSizes, setProductForSizes] = useState<Product | null>(null);
    const [initialDataLoaded, setInitialOrderLoaded] = useState(false);

    const isClient = currentUser?.role === 'cliente';
    const isSalesperson = currentUser?.role === 'ventas';
    const canManage = ['admin', 'gerencia', 'superadmin'].includes(currentUser?.role || '');

    const orderRef = useMemoFirebase(() => (firestore && orderId) ? doc(firestore, 'orders', orderId) : null, [firestore, orderId]);
    const { data: orderData, isLoading: isLoadingOrder } = useDoc<Order>(orderRef);

    const orderItemsRef = useMemoFirebase(() => (firestore && orderId) ? collection(firestore, 'orders', orderId, 'orderItems') : null, [firestore, orderId]);
    const { data: dbItems, isLoading: isLoadingItems } = useCollection<OrderItem>(orderItemsRef);

    const productsCollection = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(300)) : null), [firestore]);
    const { data: inventory, isLoading: isLoadingInventory } = useCollection<Product>(productsCollection);

    const offersCollection = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
    const { data: allOffers } = useCollection<Offer>(offersCollection);

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvDiscount = globalSettings?.defaultBcvDiscount || 30;

    const customersQuery = useMemoFirebase(() => {
        if (!firestore || isClient) return null;
        const customersRef = collection(firestore, 'customers');
        if (isSalesperson) return query(customersRef, where('assignedSalespersonId', '==', currentUser?.id), limit(100));
        if (canManage) return query(customersRef, limit(100));
        return null;
    }, [firestore, isClient, isSalesperson, canManage, currentUser?.id]);
    const { data: customers } = useCollection<Customer>(customersQuery);

    useEffect(() => {
        if (orderData && dbItems && inventory && !initialDataLoaded) {
            setSelectedCustomerId(orderData.customerId);
            const enrichedItems = dbItems.map(item => {
                const product = inventory.find(p => p.id === item.productId);
                return product ? ({ ...item, product: product } as OrderItemClient) : null;
            }).filter((i): i is OrderItemClient => i !== null);
            setOrderItems(enrichedItems);
            setInitialOrderLoaded(true);
        }
    }, [orderData, dbItems, inventory, initialDataLoaded]);

    const totalAmount = useMemo(() => orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [orderItems]);

    const handleUpdateOrder = async () => {
        if (!firestore || !currentUser || !orderData || orderItems.length === 0) return;
        setIsSubmitting(true);

        try {
            // PROTOCOLO: Lectura de items originales FUERA de la transacción
            const originalItemsSnap = await getDocs(collection(firestore, `orders/${orderData.id}/orderItems`));
            const originalItems = originalItemsSnap.docs.map(d => d.data() as OrderItem);

            await runTransaction(firestore, async (transaction) => {
                const currentOrderRef = doc(firestore, 'orders', orderData.id);
                const orderSnap = await transaction.get(currentOrderRef);
                if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");

                const dbOrder = orderSnap.data() as Order;
                const isAdvanced = ['Aprobado', 'En Preparación', 'Completado', 'Despachado'].includes(dbOrder.status);

                if (isAdvanced) {
                    const stockDiff = new Map<string, number>();
                    originalItems.forEach(i => stockDiff.set(i.productId, (stockDiff.get(i.productId) || 0) + i.quantity));
                    orderItems.forEach(i => stockDiff.set(i.productId, (stockDiff.get(i.productId) || 0) - i.quantity));

                    for (const [pId, diff] of stockDiff.entries()) {
                        if (diff !== 0) {
                            const pRef = doc(firestore, 'products', pId);
                            const pSnap = await transaction.get(pRef);
                            if (!pSnap.exists()) throw new Error(`Producto ${pId} no encontrado.`);
                            const newStock = (pSnap.data().stockLevel || 0) + diff;
                            if (newStock < 0) throw new Error(`Stock insuficiente para ${pSnap.data().name}.`);
                            transaction.update(pRef, { stockLevel: newStock, stock: newStock, updatedAt: serverTimestamp() });
                        }
                    }
                }

                transaction.update(currentOrderRef, { totalAmount, updatedAt: serverTimestamp(), updatedBy: currentUser.id });
                originalItemsSnap.docs.forEach(d => transaction.delete(d.ref));
                orderItems.forEach(item => {
                    const newItemRef = doc(collection(firestore, `orders/${orderData.id}/orderItems`));
                    transaction.set(newItemRef, { 
                        productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice,
                        size: item.size || null, customerId: item.customerId, salespersonId: item.salespersonId,
                        updatedAt: serverTimestamp() 
                    });
                });
            });

            toast({ title: '¡Pedido Actualizado!' });
            router.push('/dashboard/orders');
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Fallo Crítico', description: e.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isUserLoading || isLoadingOrder || isLoadingItems || isLoadingInventory || !orderData) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;
    }

    const filteredInventory = inventory ? inventory.filter(p => {
        const term = searchTerm.toLowerCase().trim();
        return p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term);
    }) : [];

    return (
        <div className="flex flex-col gap-4 w-full animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 rounded-full"><ArrowLeft className="h-4 w-4" /></Button>
                    <div>
                        <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">Editor de Pedido</h1>
                        <p className="text-[10px] font-bold text-primary mt-1 uppercase tracking-widest">EXPEDIENTE: #{orderData.id.substring(0,8)}</p>
                    </div>
                </div>
            </header>

            <div className="sticky top-0 z-30 px-2 space-y-4 bg-background/95 backdrop-blur-md pb-4 pt-2 shadow-sm">
                <Card className="border-none shadow-2xl rounded-[2rem] overflow-hidden ring-1 ring-primary/10">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="cart-details" className="border-none">
                            <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-6 gap-4">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="p-3 rounded-2xl bg-primary text-white shadow-xl"><ShoppingCart className="h-5 w-5" /></div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter">${totalAmount.toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black text-[9px] px-2 h-5 rounded-lg">{orderItems.length} ÍTEMS</Badge>
                                            <AccordionTrigger className="p-0 hover:no-underline font-black text-[9px] uppercase text-primary">Detalles</AccordionTrigger>
                                        </div>
                                    </div>
                                </div>
                                <Button className="w-full sm:w-auto h-12 px-10 font-black uppercase shadow-xl rounded-xl bg-slate-900 hover:bg-primary transition-all text-white text-[10px]" disabled={isSubmitting || orderItems.length === 0} onClick={handleUpdateOrder}>
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar Cambios"}
                                </Button>
                            </div>
                            <AccordionContent className="bg-slate-50/50 border-t">
                                <ScrollArea className="max-h-[250px] p-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {orderItems.map((item, idx) => (
                                            <div key={`${item.productId}-${idx}`} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm group">
                                                <div className="min-w-0 flex-1 flex items-center gap-3">
                                                    <Avatar className="h-10 w-10 rounded-lg"><AvatarImage src={item.product.imageUrl} /><AvatarFallback><Box /></AvatarFallback></Avatar>
                                                    <div className="min-w-0"><p className="text-[10px] font-black uppercase truncate">{item.product.name}</p><p className="text-[8px] font-bold text-primary uppercase mt-1">{item.quantity} un. x ${item.unitPrice.toFixed(2)}</p></div>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-10 w-10 text-rose-500" onClick={() => handleUpdateOrder()}><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </Card>
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <Input placeholder="FILTRAR CATÁLOGO..." className="pl-12 h-14 rounded-[1.5rem] bg-white border-none shadow-sm font-bold uppercase text-[11px] ring-1 ring-slate-100" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
            </div>

            <ScrollArea className="flex-1 px-2 pb-20">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {filteredInventory.map(product => (
                        <ProductCard key={product.id} product={product} onSelect={setProductForDetails} bcvDiscount={bcvDiscount} quantityInCart={orderItems.filter(i => i.productId === product.id).reduce((s, i) => s + i.quantity, 0)} onQuantityChange={(p, q, s) => {}} />
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}

export default function EditOrderPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <EditOrderForm />
        </Suspense>
    );
}