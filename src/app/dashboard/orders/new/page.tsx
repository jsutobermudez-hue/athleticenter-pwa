
'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc, errorEmitter, FirestorePermissionError } from '@/firebase';
import { useCatalog } from '@/firebase/catalog-context';
import { collection, query, where, doc, serverTimestamp, runTransaction, limit, getDocs, getDoc, Timestamp } from 'firebase/firestore';
import type { Product, Customer, OrderItemClient, Order, Offer, FinancialSettings } from '@/lib/definitions';

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2, Search, Trash2, ArrowLeft, ShoppingCart, Check, ChevronsUpDown, Plus, X, Boxes, ShieldAlert, User as UserIcon, Info, ChevronDown, ChevronUp, Save, AlertTriangle, ShieldCheck, Wallet, RefreshCw, Lock, Box } from 'lucide-react';
import { ProductDetailsSheet } from '../../inventory/product-details-sheet';
import { ProductCard } from '@/components/dashboard/ProductCard';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandGroup } from "@/components/ui/command";
import { calculateOfferPrice } from '@/lib/offers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { createAppNotifications } from '@/lib/notifications';
import { getInvoiceFromOrder } from '@/lib/billing';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const dynamic = 'force-dynamic';

function NewOrderForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const firestore = useFirestore();
    const { profile: currentUser, customerProfile, isUserLoading } = useUser();

    const [orderItems, setOrderItems] = useState<OrderItemClient[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [shouldShake, setShouldShake] = useState(false);
    const [productForDetails, setProductForDetails] = useState<Product | null>(null);
    const [productForSizes, setProductForSizes] = useState<Product | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isMoroso, setIsMoroso] = useState(false);

    const { products: inventory, isLoading: isLoadingInventory } = useCatalog();

    const offersCollection = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
    const { data: allOffers } = useCollection<Offer>(offersCollection);

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvDiscount = globalSettings?.defaultBcvDiscount || 30;
    
    const isClient = currentUser?.role === 'cliente';
    const isSalesperson = currentUser?.role === 'ventas';
    const isAdmin = ['admin', 'gerencia', 'superadmin'].includes(currentUser?.role || '');

    const customersQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const customersRef = collection(firestore, 'customers');
        if (isSalesperson) return query(customersRef, where('assignedSalespersonId', '==', currentUser.id), limit(100));
        if (isAdmin || currentUser?.role === 'deposito') return query(customersRef, limit(100));
        return null;
    }, [firestore, currentUser, isSalesperson, isAdmin, isUserLoading, isClient]);

    const { data: customers } = useCollection<Customer>(customersQuery);

    const DRAFT_KEY = useMemo(() => currentUser ? `order_draft_${currentUser.id}` : null, [currentUser]);

    useEffect(() => {
        if (!isUserLoading && currentUser && DRAFT_KEY) {
            const saved = localStorage.getItem(DRAFT_KEY);
            if (saved) {
                try {
                    const { items, customerId } = JSON.parse(saved);
                    if (items.length > 0) {
                        setOrderItems(items);
                        if (customerId) setSelectedCustomerId(customerId);
                    }
                } catch (e) {}
            }
        }
    }, [isUserLoading, currentUser, DRAFT_KEY]);

    useEffect(() => {
        if (DRAFT_KEY && (orderItems.length > 0 || selectedCustomerId)) {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({
                items: orderItems,
                customerId: selectedCustomerId,
                updatedAt: new Date().toISOString()
            }));
        } else if (DRAFT_KEY) {
            localStorage.removeItem(DRAFT_KEY);
        }
    }, [orderItems, selectedCustomerId, DRAFT_KEY]);

    useEffect(() => {
        if (isClient && currentUser) {
            setSelectedCustomerId(currentUser.associatedCustomerId || currentUser.id);
        }
    }, [isClient, currentUser]);

    useEffect(() => {
        if (firestore && selectedCustomerId && globalSettings) {
            const q = query(
                collection(firestore, 'orders'), 
                where('customerId', '==', selectedCustomerId), 
                where('status', 'in', ['Entregado', 'En Verificación'])
            );
            getDocs(q).then(snap => {
                let moroso = false;
                const blockDays = globalSettings.overdueBlockDays || 35;

                snap.docs.forEach(d => {
                    const order = d.data() as Order;
                    const balance = (order.totalAmount || 0) - (order.amountPaid || 0);
                    if (balance > 0.05) {
                        const invoice = getInvoiceFromOrder(order);
                        if (invoice && invoice.remainingCreditDays < -blockDays) {
                            moroso = true;
                        }
                    }
                });
                setIsMoroso(moroso);
            }).catch(() => {});
        }
    }, [firestore, selectedCustomerId, globalSettings]);

    const handleQuickQuantityChange = (product: Product, newQuantity: number, size?: string) => {
        const targetSize = size || null;

        if (product.hasSizes && !size) {
            setProductForSizes(product);
            return;
        }

        const offer = calculateOfferPrice(product, allOffers);
        setOrderItems(prev => {
            const existingIdx = prev.findIndex(i => i.productId === product.id && i.size === targetSize);
            
            if (newQuantity <= 0) {
                if (existingIdx === -1) return prev;
                const newItems = [...prev];
                newItems.splice(existingIdx, 1);
                return newItems;
            }

            if (existingIdx !== -1) {
                const newItems = [...prev];
                newItems[existingIdx] = { ...newItems[existingIdx], quantity: newQuantity };
                return newItems;
            }

            return [...prev, { 
                productId: product.id!, 
                quantity: newQuantity, 
                unitPrice: offer.finalPrice, 
                product: product, 
                customerId: selectedCustomerId, 
                salespersonId: '',
                size: targetSize as any
            }];
        });
    };

    const processOrder = (isDraft: boolean) => {
        if (!firestore || !currentUser) return;

        if (!selectedCustomerId) {
            toast({ variant: 'destructive', title: 'Identidad Requerida', description: 'Por favor, selecciona un cliente para este pedido.' });
            setShouldShake(true);
            setTimeout(() => setShouldShake(false), 500);
            return;
        }

        if (orderItems.length === 0) {
            toast({ variant: 'destructive', title: 'Carrito Vacío', description: 'Debes añadir al menos un equipo al pedido.' });
            return;
        }
        
        if (!isDraft && isMoroso && !isAdmin) {
            toast({ 
                variant: 'destructive', 
                title: 'OPERACIÓN BLOQUEADA', 
                description: `Cliente en mora crítica (+${globalSettings?.overdueBlockDays || 35} días). Contacte a Gerencia.` 
            });
            return;
        }

        if (isDraft) setIsSavingDraft(true); else setIsSubmitting(true);
        const selectedCustomer = isClient ? customerProfile : customers?.find(c => c.id === selectedCustomerId);
        const rawName = selectedCustomer?.razonSocial || (selectedCustomer as any)?.name || 'Cliente';
        const acronym = rawName.substring(0,3).toUpperCase().replace(/[^A-Z]/g, 'X');
        const prefix = isDraft ? 'BORR' : 'P';
        const finalOrderId = `${prefix}-${acronym}-${Date.now().toString().slice(-4)}`;
        
        const safeTotalAmount = isNaN(totalAmount) ? 0 : totalAmount;
        const spId = isSalesperson ? currentUser.id : (selectedCustomer?.assignedSalespersonId || currentUser.id);
        const spName = isSalesperson ? currentUser.name : (selectedCustomer?.assignedSalespersonName || currentUser.name || 'Sistema');

        runTransaction(firestore, async (transaction) => {
            const orderRef = doc(firestore, 'orders', finalOrderId);
            const orderData = {
                id: finalOrderId, 
                customerId: selectedCustomerId, 
                customerName: rawName, 
                customerRif: selectedCustomer?.rif || '',
                salespersonId: spId, 
                salespersonName: spName,
                salespersonCommissionRate: currentUser.commissionRate || 0.05,
                orderDate: serverTimestamp(), 
                createdAt: serverTimestamp(), 
                totalAmount: safeTotalAmount, 
                amountPaid: 0, 
                status: isDraft ? 'Borrador' : 'Pendiente',
                updatedAt: serverTimestamp()
            };

            transaction.set(orderRef, orderData);

            for (const item of orderItems) {
                const itemRef = doc(collection(firestore, `orders/${finalOrderId}/orderItems`));
                transaction.set(itemRef, { 
                    productId: item.productId, 
                    quantity: item.quantity, 
                    unitPrice: item.unitPrice, 
                    size: item.size || null, 
                    customerId: selectedCustomerId, 
                    salespersonId: spId,
                    createdAt: serverTimestamp()
                });
            }
        }).then(async () => {
            if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY);
            
            if (!isDraft) {
                try {
                    const clientUserIds: string[] = [selectedCustomerId];
                    try {
                        const usersRef = collection(firestore, 'users');
                        const q = query(usersRef, where('associatedCustomerId', '==', selectedCustomerId));
                        const snap = await getDocs(q);
                        snap.forEach(doc => {
                            clientUserIds.push(doc.id);
                        });
                    } catch (e) {
                        console.warn("[Notifications] Error al buscar usuarios asociados al cliente:", e);
                    }

                    await createAppNotifications(firestore, {
                        category: 'Pedidos',
                        title: '🛍️ Nuevo Pedido Registrado',
                        message: `El vendedor ${spName} ha registrado el pedido #${finalOrderId} para ${rawName} por un total de $${safeTotalAmount.toFixed(2)}.`,
                        link: `/dashboard/dispatch?orderId=${finalOrderId}`,
                        initiatorId: currentUser.id,
                        roles: ['admin', 'gerencia', 'deposito'],
                        userIds: clientUserIds
                    });
                } catch (e) {
                    console.warn("[Notifications] Error al enviar notificación de nuevo pedido:", e);
                }
            }

            toast({ title: isDraft ? 'Borrador Guardado' : '¡Pedido Procesado!' });
            router.push('/dashboard/orders');
        }).catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: `orders/${finalOrderId}`,
                operation: 'create',
                requestResourceData: { totalAmount: safeTotalAmount, customerId: selectedCustomerId }
            });
            errorEmitter.emit('permission-error', permissionError);
            toast({ variant: 'destructive', title: 'Fallo de Red', description: 'No se pudo sincronizar el pedido. Verifica tu conexión o permisos.' });
        }).finally(() => {
            setIsSavingDraft(false);
            setIsSubmitting(false);
        });
    };
    
    const selectedCustomerData = isClient ? customerProfile : customers?.find(c => c.id === selectedCustomerId);
    const totalAmount = useMemo(() => orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [orderItems]);
    const filteredInventory = useMemo(() => inventory?.filter(p => {
        const term = searchTerm.toLowerCase().trim();
        return p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term);
    }) || [], [inventory, searchTerm]);

    const creditRadar = useMemo(() => {
        if (!selectedCustomerData?.creditLimit) return null;
        const remaining = selectedCustomerData.creditLimit - (selectedCustomerData.creditUsed || 0) - totalAmount;
        return { remaining, exceeded: remaining < -0.05 };
    }, [selectedCustomerData, totalAmount]);

    return (
        <div className={cn("flex flex-col gap-4 w-full animate-in fade-in-50 duration-500 overflow-hidden relative", shouldShake && "animate-shake")}>
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 rounded-full"><ArrowLeft className="h-4 w-4" /></Button>
                    <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900">Nueva Solicitud</h1>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" disabled={isSavingDraft || isSubmitting || orderItems.length === 0} onClick={() => processOrder(true)} className="h-11 px-4 rounded-xl border-slate-200 font-black uppercase text-[10px] tracking-widest bg-white">
                        {isSavingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />} Borrador
                    </Button>

                    {!isClient && (
                        <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("h-11 px-4 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest", selectedCustomerId ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-primary/20 bg-white")}>
                                    <UserIcon className="mr-2 h-4 w-4" /> {selectedCustomerId ? (selectedCustomerData?.razonSocial || 'Cuenta Seleccionada') : "ELEGIR CLIENTE..."}
                                    <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[320px] p-0 rounded-2xl shadow-2xl border-none overflow-hidden" align="end" style={{ zIndex: 100 }}>
                                <Command>
                                    <CommandInput placeholder="RIF o Razón Social..." className="h-12 text-xs font-bold uppercase" />
                                    <CommandList>
                                        <CommandEmpty className="p-6 text-center text-[10px] font-black uppercase text-slate-400">Sin resultados.</CommandEmpty>
                                        <CommandGroup className="p-2">
                                            {customers?.map(c => (
                                                <CommandItem key={c.id} value={c.razonSocial + " " + c.rif} onSelect={() => { setSelectedCustomerId(c.id!); setIsCustomerPopoverOpen(false); }} className="rounded-xl p-3 cursor-pointer">
                                                    <div className="flex flex-col"><span className="font-black uppercase text-[11px] text-slate-900">{c.razonSocial}</span><span className="text-[9px] font-mono font-bold mt-1 text-slate-400">RIF: {c.rif}</span></div>
                                                    <Check className={cn("ml-auto h-4 w-4 text-emerald-500", selectedCustomerId === c.id ? "opacity-100" : "opacity-0")} />
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
            </header>

            <div className="sticky top-0 z-30 px-2 space-y-4 bg-background/95 backdrop-blur-md pb-4 pt-2 shadow-sm">
                {isMoroso && (
                    <div className="p-4 bg-rose-600 text-white rounded-2xl flex items-center gap-3 animate-pulse shadow-xl shadow-rose-200">
                        <Lock className="h-5 w-5" />
                        <p className="text-[10px] font-black uppercase tracking-[0.2em]">Facturación Bloqueada: Cliente en mora crítica ({globalSettings?.overdueBlockDays || 35} días).</p>
                    </div>
                )}

                <Card className="border-none shadow-2xl rounded-[2rem] overflow-hidden ring-1 ring-primary/10">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="cart-details" className="border-none">
                            <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-6 gap-4">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="p-3 rounded-2xl bg-primary text-white shadow-xl">
                                        <ShoppingCart className="h-5 w-5" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter">${totalAmount.toFixed(2)}</span>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Base Imponible</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black text-[9px] px-2 h-5 rounded-lg border-none">{orderItems.length} ÍTEMS</Badge>
                                            <AccordionTrigger className="p-0 hover:no-underline font-black text-[9px] uppercase tracking-widest text-primary">Detalles</AccordionTrigger>
                                        </div>
                                    </div>
                                </div>

                                {creditRadar && (
                                    <div className={cn(
                                        "hidden md:flex flex-col items-center p-3 rounded-xl border-2 transition-all",
                                        creditRadar.exceeded ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-emerald-50 border-emerald-100 text-emerald-600"
                                    )}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <Wallet className="h-3 w-3" />
                                            <span className="text-[8px] font-black uppercase tracking-widest text-center">Crédito Libre</span>
                                        </div>
                                        <p className="text-sm font-black tracking-tighter">${creditRadar.remaining.toLocaleString()}</p>
                                    </div>
                                )}

                                <Button 
                                    className="w-full sm:w-auto h-12 px-10 font-black uppercase tracking-[0.25em] shadow-xl rounded-xl bg-slate-900 hover:bg-primary transition-all text-white text-[10px]" 
                                    disabled={isSubmitting || isSavingDraft || orderItems.length === 0 || (isMoroso && !isAdmin)} 
                                    onClick={() => processOrder(false)}
                                >
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar Solicitud"}
                                </Button>
                            </div>

                            <AccordionContent className="bg-slate-50/50 border-t border-slate-100">
                                <ScrollArea className="max-h-[250px]">
                                    {orderItems.length > 0 ? (
                                        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {orderItems.map((item, idx) => (
                                                <div key={`${item.productId}-${idx}`} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm animate-in fade-in group">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <Avatar className="h-10 w-10 rounded-lg border shadow-sm shrink-0">
                                                            <AvatarImage src={item.product.imageUrl} className="object-cover" />
                                                            <AvatarFallback className="bg-slate-50 text-slate-300">
                                                                <Box className="h-5 w-5" />
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[10px] font-black uppercase truncate text-slate-800 leading-none">{item.product.name}</p>
                                                            <p className="text-[8px] font-bold text-primary uppercase tracking-widest mt-1">
                                                                {item.quantity} un. {item.size && `[Talla: ${item.size}]`} x ${item.unitPrice.toFixed(2)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <Button 
                                                        type="button"
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-10 w-10 text-rose-500 hover:bg-rose-50 rounded-lg ml-2 transition-all active:scale-90" 
                                                        onClick={() => handleQuickQuantityChange(item.product, 0, item.size)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-10 text-center flex flex-col items-center gap-3 opacity-30">
                                            <ShoppingCart className="h-8 w-8" />
                                            <p className="text-[10px] font-black uppercase tracking-widest">Presupuesto vacío</p>
                                        </div>
                                    )}
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </Card>

                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                    <Input placeholder="AÑADIR EQUIPOS AL PEDIDO..." className="pl-12 h-14 rounded-[1.5rem] bg-white border-none shadow-sm font-bold uppercase text-[11px] tracking-widest ring-1 ring-slate-100" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
            </div>

            <ScrollArea className="flex-1 px-2 pb-20">
                {(selectedCustomerId || isClient) ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                        {filteredInventory.map(product => (
                            <ProductCard 
                                key={product.id} 
                                product={product} 
                                onSelect={setProductForDetails} 
                                bcvDiscount={bcvDiscount}
                                quantityInCart={orderItems.filter(i => i.productId === product.id).reduce((s, i) => s + i.quantity, 0)}
                                onQuantityChange={handleQuickQuantityChange}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="h-60 flex flex-col items-center justify-center opacity-20 p-12 text-center">
                        <UserIcon className="h-16 w-16 mb-4" />
                        <p className="font-black uppercase tracking-[0.3em] text-xs">Selecciona un cliente para habilitar el motor comercial</p>
                    </div>
                )}
            </ScrollArea>
            
            <ProductDetailsSheet product={productForDetails} allOffers={allOffers || []} isOpen={!!productForDetails} onOpenChange={(open) => !open && setProductForDetails(null)} canManageInventory={isAdmin} canDelete={false} onDelete={() => {}} />

            <Dialog open={!!productForSizes} onOpenChange={(open) => !open && setProductForSizes(null)}>
                <DialogContent className="sm:max-w-md rounded-[2.5rem] p-0 overflow-hidden text-left">
                    <DialogHeader className="p-8 bg-slate-900 text-white text-left">
                        <DialogTitle className="text-2xl font-black uppercase text-left">Variantes por Talla</DialogTitle>
                    </DialogHeader>
                    <div className="p-8 max-h-[60vh] overflow-y-auto bg-white">
                        <div className="grid grid-cols-2 gap-4">
                            {productForSizes?.sizes && Object.entries(productForSizes.sizes).map(([size, stock]) => {
                                const currentQty = orderItems.find(i => i.productId === productForSizes.id && i.size === size)?.quantity || 0;
                                return (
                                    <div key={size} className="p-4 rounded-2xl bg-slate-50 border flex flex-col gap-2">
                                        <div className="flex justify-between">
                                            <span className="text-[11px] font-black uppercase">Talla: {size}</span>
                                            <span className="text-[9px] text-slate-400 font-bold uppercase">Disp: {stock}</span>
                                        </div>
                                        <Input type="number" min="0" max={stock} value={isNaN(currentQty) ? "" : (currentQty || 0)} onChange={(e) => handleQuickQuantityChange(productForSizes!, e.target.value === "" ? 0 : Number(e.target.value), size)} className="h-10 text-center font-black rounded-xl" />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <DialogFooter className="p-8 bg-slate-50 border-t"><Button className="w-full h-12 bg-primary font-black uppercase rounded-xl" onClick={() => setProductForSizes(null)}>Confirmar Selección</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function NewOrderPage() { 
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <NewOrderForm />
        </Suspense>
    ); 
}
