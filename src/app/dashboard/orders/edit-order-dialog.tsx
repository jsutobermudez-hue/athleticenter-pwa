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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Trash2, Edit, Search, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, Customer, Order, OrderItem, OrderItemClient } from '@/lib/definitions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, serverTimestamp, query, where, getDocs, runTransaction, limit } from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * COMPONENTE LEGACY - REEMPLAZADO POR LA PÁGINA DE EDICIÓN PRO
 * Se mantiene por compatibilidad y se corrige el error de referencia de 'limit'.
 */
type EditOrderDialogProps = {
    order: Order;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function EditOrderDialog({ order, isOpen, onOpenChange, onSuccess }: EditOrderDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser, customerProfile } = useUser();

  const [orderItems, setOrderItems] = useState<OrderItemClient[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState(order.customerId);
  const [initialOrderItemsLoaded, setInitialOrderItemsLoaded] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const isSalesperson = currentUser?.role === 'ventas';
  const isClient = currentUser?.role === 'cliente';
  const canManage = currentUser && ['admin', 'gerencia', 'superadmin'].includes(currentUser.role);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || isClient) return null;
    const customersCollection = collection(firestore, 'customers');
    if (isSalesperson) return query(customersCollection, where('assignedSalespersonId', '==', currentUser.id), limit(100));
    if (canManage) return query(customersCollection, limit(100));
    return null;
  }, [firestore, currentUser, isSalesperson, isClient, canManage]);

  const { data: customers, isLoading: isLoadingCustomers } = useCollection<Customer>(customersQuery);

  const productsCollection = useMemoFirebase(() => (firestore) ? query(collection(firestore, 'products'), limit(300)) : null, [firestore]);
  const { data: inventory, isLoading: isLoadingProducts } = useCollection<Product>(productsCollection);

  const orderItemsQuery = useMemoFirebase(() => (firestore && isOpen) ? collection(firestore, `orders/${order.id}/orderItems`) : null, [firestore, order.id, isOpen]);
  const { data: initialOrderItems, isLoading: isLoadingOrderItems } = useCollection<OrderItem>(orderItemsQuery);
  
  const totalAmount = useMemo(() => {
    return orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }, [orderItems]);

  const resetState = () => {
    setIsPending(false);
    setOrderItems([]);
    setSelectedProductId('');
    setProductSearch('');
    setQuantity(1);
    setInitialOrderItemsLoaded(false);
  };
  
  useEffect(() => {
    if (isOpen && initialOrderItems && inventory && !initialOrderItemsLoaded) {
      const items = initialOrderItems.map(item => {
        const product = inventory.find(p => p.id === item.productId);
        return product ? ({ ...item, product: product } as OrderItemClient) : null;
      }).filter((i): i is OrderItemClient => i !== null);
      
      setOrderItems(items);
      setInitialOrderItemsLoaded(true);
    }
    if (!isOpen) {
        resetState();
    }
  }, [initialOrderItems, inventory, initialOrderItemsLoaded, isOpen]);

  const availableProducts = useMemo(() => {
    if (!inventory) return [];
    const addedProductIds = new Set(orderItems.map(item => item.productId));
    let filtered = inventory.filter(p => p.id && !addedProductIds.has(p.id) && (p.stockLevel ?? (p as any).stock ?? 0) > 0);

    if (productSearch) {
        const term = productSearch.toLowerCase();
        filtered = filtered.filter(p => 
            p.name.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term) ||
            p.brand?.toLowerCase().includes(term)
        );
    }
    return filtered;
  }, [orderItems, inventory, productSearch]);
  
  const selectedProduct = useMemo(() => {
      return inventory?.find(p => p.id === selectedProductId) || null;
  }, [inventory, selectedProductId]);
  
  const handleAddProduct = () => {
    if (selectedProduct && quantity > 0) {
      setOrderItems([...orderItems, { 
        productId: selectedProduct.id, 
        quantity, 
        unitPrice: selectedProduct.price,
        product: selectedProduct,
        customerId: selectedCustomerId,
        salespersonId: '',
      }]);
      setSelectedProductId('');
      setProductSearch('');
      setQuantity(1);
    }
  };

  const handleRemoveProduct = (productId: string) => {
    setOrderItems(orderItems.filter(item => item.productId !== productId));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !currentUser) return;
    
    if (orderItems.length === 0) {
      toast({ variant: 'destructive', title: 'Pedido vacío', description: 'Debe añadir al menos un producto.' });
      return;
    }

    setIsPending(true);
    
    try {
        await runTransaction(firestore, async (transaction) => {
            const orderRef = doc(firestore, 'orders', order.id);
            const orderSnap = await transaction.get(orderRef);
            
            if (!orderSnap.exists()) throw new Error("El pedido ya no existe.");
            
            const currentDbOrder = orderSnap.data() as Order;
            
            if (currentDbOrder.status !== order.status) {
                throw new Error(`El pedido ha sido actualizado a "${currentDbOrder.status}" por otro departamento.`);
            }

            const isAdvancedPhase = ['Aprobado', 'En Preparación', 'Completado', 'Despachado'].includes(currentDbOrder.status);

            if (isAdvancedPhase) {
                const originalItemsSnapshot = await getDocs(query(collection(firestore, `orders/${order.id}/orderItems`)));
                const originalItems = originalItemsSnapshot.docs.map(doc => doc.data() as OrderItem);

                const stockChanges = new Map<string, number>();
                originalItems.forEach(item => {
                    stockChanges.set(item.productId, (stockChanges.get(item.productId) || 0) + item.quantity);
                });
                orderItems.forEach(item => {
                    stockChanges.set(item.productId, (stockChanges.get(item.productId) || 0) - item.quantity);
                });

                for (const [productId, change] of stockChanges.entries()) {
                    if (change !== 0) {
                        const pRef = doc(firestore, 'products', productId);
                        const pSnap = await transaction.get(pRef);
                        if (!pSnap.exists()) throw new Error(`Producto ${productId} no encontrado.`);
                        const oldStock = pSnap.data().stockLevel ?? pSnap.data().stock ?? 0;
                        const newStock = oldStock + change;
                        if (newStock < 0) throw new Error(`Stock insuficiente para ${pSnap.data().name}.`);
                        transaction.update(pRef, { stockLevel: newStock, stock: newStock });
                    }
                }
            }

            transaction.update(orderRef, {
                totalAmount,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.id
            });

            const originalItemsSnapshot = await getDocs(query(collection(firestore, `orders/${order.id}/orderItems`)));
            originalItemsSnapshot.docs.forEach(doc => transaction.delete(doc.ref));

            orderItems.forEach(item => {
                const newItemRef = doc(collection(firestore, `orders/${order.id}/orderItems`));
                transaction.set(newItemRef, {
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    size: item.size || null, // SANEAMIENTO: Evitar undefined
                    customerId: item.customerId,
                    salespersonId: item.salespersonId || '',
                    updatedAt: serverTimestamp()
                });
            });
        });

        toast({ title: '¡Pedido Actualizado!' });
        onSuccess?.();
        onOpenChange(false);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error al Modificar', description: error.message });
        setIsPending(false);
    }
  };

  const isLoading = (isClient ? false : isLoadingCustomers) || isLoadingProducts || isLoadingOrderItems;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-[2rem] overflow-hidden p-0 border-none shadow-2xl">
        <DialogHeader className="p-8 bg-slate-900 text-white">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">Ajustar Pedido</DialogTitle>
          <DialogDescription className="text-slate-400 font-medium uppercase text-[10px] tracking-widest mt-1">Ref: #{order.id.substring(0,8)}</DialogDescription>
        </DialogHeader>
        { isLoading ? (
             <div className="p-20 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col h-full bg-white">
            <ScrollArea className="max-h-[60vh]">
                <div className="p-8 space-y-8">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Entidad Comercial</Label>
                        <div className="p-4 bg-slate-50 border rounded-xl font-black uppercase text-xs text-slate-900 shadow-inner">
                            {order.customerName}
                        </div>
                    </div>

                    <div className="p-6 rounded-[2rem] bg-slate-50 border-2 border-dashed border-slate-200 space-y-6">
                        <Label className="text-xs font-black uppercase tracking-widest flex items-center gap-2"><Plus className="h-4 w-4" /> Configurar Carrito</Label>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                            <div className="md:col-span-8 space-y-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input placeholder="Buscar por nombre o SKU..." className="pl-10 h-11 bg-white border-none shadow-sm text-xs font-bold rounded-xl" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                                </div>
                                <Select onValueChange={setSelectedProductId} value={selectedProductId}>
                                    <SelectTrigger className="h-11 rounded-xl bg-white border-none shadow-sm font-bold uppercase text-[10px]"><SelectValue placeholder="ELEGIR PRODUCTO..." /></SelectTrigger>
                                    <SelectContent>
                                    {availableProducts.length > 0 ? availableProducts.map(p => (
                                            <SelectItem key={p.id} value={p.id!} className="text-[10px] font-bold uppercase">
                                                {p.name} (Stock: {p.stockLevel ?? (p as any).stock ?? 0})
                                            </SelectItem>
                                    )) : <p className="p-4 text-center italic text-xs">Sin coincidencias.</p>}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="md:col-span-2 space-y-1.5">
                                <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="h-11 text-center font-black rounded-xl border-none shadow-sm" />
                            </div>
                            <div className="md:col-span-2">
                                <Button type="button" onClick={handleAddProduct} disabled={!selectedProduct} className="h-11 w-full rounded-xl bg-primary">Añadir</Button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {orderItems.map((item, idx) => (
                                <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center group shadow-sm">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-black uppercase truncate text-slate-900">{item.product.name}</p>
                                        <p className="text-[9px] font-bold text-primary uppercase mt-1">Cant: {item.quantity} x ${item.unitPrice.toFixed(2)}</p>
                                    </div>
                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-rose-500 hover:bg-rose-50 rounded-xl" onClick={() => handleRemoveProduct(item.productId)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </ScrollArea>

            <DialogFooter className="p-8 border-t bg-slate-50 flex items-center justify-between">
                <div className="text-left">
                    <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Inversión Final</p>
                    <p className="text-3xl font-black text-slate-900 tracking-tighter">${totalAmount.toFixed(2)}</p>
                </div>
                <div className="flex gap-3">
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="font-black uppercase text-[10px] h-12 px-6">Cancelar</Button>
                    <Button type="submit" disabled={isPending} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-primary hover:bg-primary/90 text-[10px]">
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit className="mr-2 h-4 w-4" />} Sincronizar Cambios
                    </Button>
                </div>
            </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
