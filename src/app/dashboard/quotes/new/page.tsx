
'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc, errorEmitter, FirestorePermissionError, useCatalog } from '@/firebase';
import { collection, query, where, doc, serverTimestamp, writeBatch, limit, Timestamp, getDocs } from 'firebase/firestore';
import type { Product, Customer, QuoteItemClient, Offer, FinancialSettings } from '@/lib/definitions';

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { 
    Loader2, 
    Search, 
    Trash2, 
    ArrowLeft, 
    Check,
    ChevronsUpDown,
    Plus,
    X,
    ShoppingCart,
    Sparkles,
    ChevronDown,
    ChevronUp,
    Save,
    User as UserIcon,
    ClipboardList
} from 'lucide-react';
import { addDays } from 'date-fns';
import { ProductCard } from '@/components/dashboard/ProductCard';
import { ProductDetailsSheet } from '../../inventory/product-details-sheet';
import { calculateOfferPrice } from '@/lib/offers';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandGroup } from "@/components/ui/command";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { createAppNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

function NewQuoteForm() {
    const router = useRouter();
    const { toast } = useToast();
    const firestore = useFirestore();
    const { profile: currentUser, customerProfile, isUserLoading } = useUser();

    const [quoteItems, setQuoteItems] = useState<QuoteItemClient[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [productForDetails, setProductForDetails] = useState<Product | null>(null);
    const [productForSizes, setProductForSizes] = useState<Product | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // --- GUARDIA DE NAVEGACIÓN ---
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (quoteItems.length > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [quoteItems]);

    const { products: inventory, isLoading: isLoadingInventory } = useCatalog();

    const offersCollection = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
    const { data: allOffers } = useCollection<Offer>(offersCollection);

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvDiscount = globalSettings?.defaultBcvDiscount || 30;
    
    const isClient = currentUser?.role === 'cliente';
    const isSalesperson = currentUser?.role === 'ventas';
    const canManage = ['admin', 'gerencia', 'superadmin'].includes(currentUser?.role || '');

    const customersQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const customersRef = collection(firestore, 'customers');
        if (isSalesperson) return query(customersRef, where('assignedSalespersonId', '==', currentUser.id), limit(100));
        if (canManage) return query(customersRef, limit(100));
        return null;
    }, [firestore, currentUser, isSalesperson, canManage, isUserLoading]);
    const { data: customers } = useCollection<Customer>(customersQuery);

    const DRAFT_KEY = useMemo(() => currentUser ? `quote_draft_${currentUser.id}` : null, [currentUser]);

    useEffect(() => {
        if (!isUserLoading && currentUser && DRAFT_KEY) {
            const saved = localStorage.getItem(DRAFT_KEY);
            if (saved) {
                try {
                    const { items, customerId } = JSON.parse(saved);
                    if (items.length > 0 && quoteItems.length === 0) {
                        setQuoteItems(items);
                        if (customerId) setSelectedCustomerId(customerId);
                    }
                } catch (e) {}
            }
        }
    }, [isUserLoading, currentUser, DRAFT_KEY]);

    useEffect(() => {
        if (DRAFT_KEY && (quoteItems.length > 0 || selectedCustomerId)) {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({
                items: quoteItems,
                customerId: selectedCustomerId,
                updatedAt: new Date().toISOString()
            }));
        } else if (DRAFT_KEY) {
            localStorage.removeItem(DRAFT_KEY);
        }
    }, [quoteItems, selectedCustomerId, DRAFT_KEY]);

    useEffect(() => {
        if (isClient && currentUser) {
            setSelectedCustomerId(currentUser.associatedCustomerId || currentUser.id);
        }
    }, [isClient, currentUser]);

    const filteredInventory = useMemo(() => {
        if (!inventory) return [];
        let items = inventory;
        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(p => 
                p.name.toLowerCase().includes(term) || 
                p.sku.toLowerCase().includes(term) || 
                p.brand?.toLowerCase().includes(term) ||
                p.discipline?.toLowerCase().includes(term)
            );
        }
        return items;
    }, [inventory, searchTerm]);

    const totalAmount = useMemo(() => quoteItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [quoteItems]);

    const handleQuickQuantityChange = (product: Product, newQuantity: number, size?: string) => {
        const targetSize = size || null;

        if (product.hasSizes && !size) {
            setProductForSizes(product);
            return;
        }

        const offer = calculateOfferPrice(product, allOffers);
        setQuoteItems(prev => {
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

    const processQuote = (isCloudDraft: boolean) => {
        if (!firestore || !currentUser) return;

        if (!selectedCustomerId) {
            toast({ variant: 'destructive', title: 'Identidad Requerida', description: 'Por favor, selecciona un cliente para esta cotización.' });
            return;
        }

        if (quoteItems.length === 0) {
            toast({ variant: 'destructive', title: 'Carrito Vacío', description: 'Añade equipos al presupuesto antes de generar el folio.' });
            return;
        }

        if (isCloudDraft) setIsSavingDraft(true); else setIsSubmitting(true);
        
        const selectedCustomer = isClient ? customerProfile : customers?.find(c => c.id === selectedCustomerId);
        const rawName = selectedCustomer?.razonSocial || (selectedCustomer as any)?.name || currentUser.name || 'N/A';
        const customerName = rawName.trim();
        const prefix = isCloudDraft ? 'BORR' : 'C';
        const customerAcronym = customerName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
        const finalQuoteId = `${prefix}-${customerAcronym}-${Date.now().toString().slice(-4)}`;
        
        const salespersonId = isSalesperson ? currentUser.id : (selectedCustomer?.assignedSalespersonId || currentUser.id);
        const salespersonName = isSalesperson ? currentUser.name : (selectedCustomer?.assignedSalespersonName || currentUser.name);

        const batch = writeBatch(firestore);
        const quoteRef = doc(firestore, 'quotes', finalQuoteId);

        const safeTotal = isNaN(totalAmount) ? 0 : totalAmount;

        const quoteData = {
            id: finalQuoteId,
            customerId: selectedCustomerId,
            customerName: customerName,
            customerPhone: selectedCustomer?.phone || '',
            salespersonId,
            salespersonName,
            quoteDate: serverTimestamp(),
            expiryDate: Timestamp.fromDate(addDays(new Date(), 15)),
            totalAmount: safeTotal,
            status: isCloudDraft ? 'Borrador' : 'Enviada',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        batch.set(quoteRef, quoteData);

        for(const item of quoteItems) {
            const itemRef = doc(collection(firestore, `quotes/${finalQuoteId}/quoteItems`));
            batch.set(itemRef, {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                size: item.size || null, 
                customerId: selectedCustomerId,
                salespersonId,
                createdAt: serverTimestamp()
            });
        }

        batch.commit()
            .then(async () => {
                if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY);
                
                if (!isCloudDraft) {
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
                            category: 'Cotizaciones',
                            title: '📝 Presupuesto Proforma Creado',
                            message: `El vendedor ${salespersonName} ha generado la cotización #${finalQuoteId} para ${selectedCustomer?.razonSocial || 'Cliente'} por un total de $${safeTotal.toFixed(2)}.`,
                            link: `/dashboard/quotes?quote=${finalQuoteId}`,
                            initiatorId: currentUser?.id || 'system',
                            roles: ['admin', 'gerencia'],
                            userIds: clientUserIds
                        });
                    } catch (e) {
                        console.warn("[Notifications] Error al enviar notificación de nueva cotización:", e);
                    }
                }

                toast({ title: isCloudDraft ? 'Borrador Guardado' : 'Presupuesto Creado' });
                router.push('/dashboard/quotes');
            })
            .catch(async (serverError) => {
                const permissionError = new FirestorePermissionError({ 
                    path: `quotes/${finalQuoteId}`, 
                    operation: 'create', 
                    requestResourceData: quoteData 
                });
                errorEmitter.emit('permission-error', permissionError);
                toast({ variant: 'destructive', title: 'Error de Sincronización', description: 'No se pudo guardar la cotización. Verifica tus permisos.' });
            })
            .finally(() => {
                setIsSavingDraft(false);
                setIsSubmitting(false);
            });
    };
    
    const selectedCustomerData = isClient ? customerProfile : customers?.find(c => c.id === selectedCustomerId);

    if (isUserLoading || isLoadingInventory) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

    return (
        <div className={cn("flex flex-col gap-4 w-full animate-in fade-in-50 duration-500 overflow-hidden relative")}>
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 rounded-full"><ArrowLeft className="h-4 w-4" /></Button>
                    <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-none">Nueva Cotización</h1>
                </div>

                <div className="flex items-center gap-2">
                    <Button 
                        variant="outline" 
                        disabled={isSavingDraft || isSubmitting || quoteItems.length === 0} 
                        onClick={() => processQuote(true)}
                        className="h-11 px-4 rounded-xl border-slate-200 font-black uppercase text-[10px] tracking-widest bg-white"
                    >
                        {isSavingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Save className="h-3.5 w-3.5 mr-2" />} Borrador
                    </Button>

                    {!isClient && (
                        <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    className={cn(
                                        "h-11 px-4 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest",
                                        selectedCustomerId ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-primary/20 bg-white"
                                    )}
                                >
                                    <ClipboardList className="mr-2 h-4 w-4" />
                                    {selectedCustomerId ? (selectedCustomerData?.razonSocial || 'Cargando...') : "ELEGIR CUENTA..."}
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
                                                <CommandItem 
                                                    key={c.id} 
                                                    value={c.razonSocial + " " + c.rif} 
                                                    onSelect={() => { setSelectedCustomerId(c.id!); setIsCustomerPopoverOpen(false); }} 
                                                    className="rounded-xl p-3 cursor-pointer"
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="font-black uppercase text-[11px] text-slate-900">{c.razonSocial}</span>
                                                        <span className="text-[9px] font-mono font-bold mt-1">RIF: {c.rif}</span>
                                                    </div>
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
                <Card className="border-none shadow-2xl rounded-[2rem] overflow-hidden ring-1 ring-primary/10">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="quote-items" className="border-none">
                            <div className="flex flex-col sm:flex-row items-center justify-between p-4 sm:p-6 gap-4">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="p-3 rounded-2xl bg-slate-900 text-white shadow-xl">
                                        <ClipboardList className="h-5 w-5" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-3xl sm:text-4xl font-black text-primary tracking-tighter">${totalAmount.toFixed(2)}</span>
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estimación</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black text-[9px] px-2 h-5 rounded-lg border-none">{quoteItems.length} MODELOS</Badge>
                                            <AccordionTrigger className="p-0 hover:no-underline font-black text-[9px] uppercase tracking-widest text-primary">Ver Detalles</AccordionTrigger>
                                        </div>
                                    </div>
                                </div>

                                <Button 
                                    type="button"
                                    className="w-full sm:w-auto h-12 px-10 font-black uppercase tracking-[0.25em] shadow-xl rounded-xl bg-slate-900 hover:bg-primary transition-all text-white active:scale-95 text-[10px]" 
                                    disabled={isSubmitting || isSavingDraft || quoteItems.length === 0 || !selectedCustomerId} 
                                    onClick={() => processQuote(false)}
                                >
                                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generar Cotización"}
                                </Button>
                            </div>

                            <AccordionContent className="bg-slate-50/50 border-t border-slate-100">
                                <ScrollArea className="max-h-[250px]">
                                    {quoteItems.length > 0 ? (
                                        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {quoteItems.map((item, idx) => (
                                                <div key={`${item.productId}-${idx}`} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm animate-in fade-in group">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[10px] font-black uppercase truncate text-slate-800 leading-none">{item.product.name}</p>
                                                        <p className="text-[8px] font-bold text-primary uppercase tracking-widest mt-1">
                                                            {item.quantity} un. {item.size && `[Talla: ${item.size}]`} x ${item.unitPrice.toFixed(2)}
                                                        </p>
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
                                            <ClipboardList className="h-8 w-8" />
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
                    <Input 
                        placeholder="BUSCAR EQUIPOS EN CATÁLOGO..." 
                        className="pl-12 h-14 rounded-[1.5rem] bg-white border-none shadow-sm font-bold uppercase text-[11px] tracking-widest ring-1 ring-slate-100" 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                    />
                </div>
            </div>

            <ScrollArea className="flex-1 px-2 pb-20">
                {(selectedCustomerId || isClient) ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                        {filteredInventory.map(product => (
                            <ProductCard 
                                key={product.id} product={product} onSelect={setProductForDetails} bcvDiscount={bcvDiscount}
                                quantityInCart={quoteItems.filter(i => i.productId === product.id).reduce((s, i) => s + i.quantity, 0)}
                                onQuantityChange={handleQuickQuantityChange}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="h-60 flex flex-col items-center justify-center opacity-20 p-12 text-center">
                        <ClipboardList className="h-16 w-16 mb-4" />
                        <p className="font-black uppercase tracking-[0.3em] text-xs">Seleccione una cuenta para iniciar la prospección</p>
                    </div>
                )}
            </ScrollArea>
            
            <ProductDetailsSheet product={productForDetails} allOffers={allOffers || []} isOpen={!!productForDetails} onOpenChange={(open) => !open && setProductForDetails(null)} canManageInventory={canManage} canDelete={false} onDelete={() => {}} />

            <Dialog open={!!productForSizes} onOpenChange={(open) => !open && setProductForSizes(null)}>
                <DialogContent className="sm:max-w-md rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-0 text-left">
                    <DialogHeader className="p-8 bg-slate-900 text-white text-left">
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter text-left">Variantes por Talla</DialogTitle>
                        <DialogDescription className="text-slate-400 font-medium uppercase text-[10px] tracking-widest mt-1">Configura cantidades para {productForSizes?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="p-8 max-h-[60vh] overflow-y-auto bg-white">
                        <div className="grid grid-cols-2 gap-3">
                            {productForSizes?.sizes && Object.entries(productForSizes.sizes).map(([size, stock]) => {
                                const currentQty = quoteItems.find(i => i.productId === productForSizes.id && i.size === size)?.quantity || 0;
                                return (
                                    <div key={size} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[11px] font-black text-slate-900">TALLA: {size}</span>
                                            <span className="text-[8px] font-bold text-slate-400">STOCK: {stock}</span>
                                        </div>
                                        <Input 
                                            type="number" 
                                            min="0" 
                                            max={stock} 
                                            value={currentQty || 0} 
                                            onChange={(e) => handleQuickQuantityChange(productForSizes!, Number(e.target.value), size)}
                                            className="h-10 text-center font-black text-lg bg-white border-none shadow-sm rounded-xl"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <DialogFooter className="p-8 bg-slate-50 border-t">
                        <Button type="button" className="w-full h-12 bg-primary font-black uppercase rounded-xl" onClick={() => setProductForSizes(null)}>Confirmar Selección</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function NewQuotePage() { 
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <NewQuoteForm />
        </Suspense>
    ); 
}
