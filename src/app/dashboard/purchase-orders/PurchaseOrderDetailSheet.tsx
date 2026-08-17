'use client';

import React, { useState, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
  useDoc,
} from '@/firebase';
import { collection, query, limit, doc, runTransaction, serverTimestamp, updateDoc, getDoc } from 'firebase/firestore';
import type { PurchaseOrder, Product, PurchaseOrderItem, StockHistory, FinancialSettings, CompanyProfile } from '@/lib/definitions';
import {
  Loader2,
  Package,
  Plus,
  Trash2,
  CheckCircle2,
  Boxes,
  ShieldCheck,
  PlusCircle,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  Printer,
  FileText
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createAppNotifications } from '@/lib/notifications';
import { logActivity } from '@/lib/audit';
import { generatePurchaseOrderPDF } from '@/lib/pdf-generator';

interface PurchaseOrderDetailSheetProps {
  order: PurchaseOrder | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PurchaseOrderDetailSheet({ order, isOpen, onOpenChange }: PurchaseOrderDetailSheetProps) {
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const { toast } = useToast();
  const [isActionPending, setIsActionPending] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);

  const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(200)) : null), [firestore]);
  const { data: allProducts } = useCollection<Product>(productsQuery);

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const safeItems = useMemo(() => {
    return order?.items || [];
  }, [order?.items]);

  const handleExportPDF = async () => {
    if (!order || !firestore) return;
    setIsGeneratingPdf(true);
    try {
        const companyRef = doc(firestore, 'system', 'companyProfile');
        const companySnap = await getDoc(companyRef);
        const companyProfile = companySnap.exists() ? (companySnap.data() as CompanyProfile) : undefined;
        
        await generatePurchaseOrderPDF(order, companyProfile);
        toast({ title: "Manifiesto Exportado", description: "Documento PDF generado correctamente." });
    } catch (e: any) {
        toast({ variant: 'destructive', title: "Error de Exportación PDF", description: e.message });
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  const handleAddItem = async () => {
    if (!order || !selectedProductId || !firestore || !currentUser) return;
    const product = allProducts?.find(p => p.id === selectedProductId);
    if (!product) return;

    setIsActionPending(true);
    try {
        const orderRef = doc(firestore, 'purchaseOrders', order.id!);
        const newItem: PurchaseOrderItem = {
            productId: selectedProductId,
            sku: product.sku,
            name: product.name,
            quantity,
            unitCost
        };

        const updatedItems = [...safeItems, newItem];
        const newTotalCost = updatedItems.reduce((sum, i) => sum + (i.quantity * i.unitCost), 0);

        await updateDoc(orderRef, {
            items: updatedItems,
            totalCost: newTotalCost,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.id
        } as any);

        toast({ title: "Artículo Añadido", description: `${product.name} agregado al manifiesto.` });
        setSelectedProductId('');
        setQuantity(1);
        setUnitCost(0);
    } catch (e: any) {
        toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
        setIsActionPending(false);
    }
  };

  const handleRemoveItem = async (index: number) => {
    if (!order || !firestore || !currentUser) return;
    setIsActionPending(true);
    try {
        const orderRef = doc(firestore, 'purchaseOrders', order.id!);
        const updatedItems = [...safeItems];
        updatedItems.splice(index, 1);
        const newTotalCost = updatedItems.reduce((sum, i) => sum + (i.quantity * i.unitCost), 0);

        await updateDoc(orderRef, {
            items: updatedItems,
            totalCost: newTotalCost,
            updatedAt: serverTimestamp()
        } as any);
    } catch (e) {} finally { setIsActionPending(false); }
  };

  const handleReceiveOrder = async () => {
    if (!order || !firestore || !currentUser) return;
    if (safeItems.length === 0) {
        toast({ variant: 'destructive', title: "Manifiesto vacío", description: "Agrega al menos un artículo antes de certificar la recepción." });
        return;
    }

    setIsActionPending(true);
    const criticalErosions: string[] = [];
    const bcvDiscount = globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25;

    try {
        await runTransaction(firestore, async (transaction) => {
            const poRef = doc(firestore, 'purchaseOrders', order.id!);
            
            // --- 1. LECTURAS PREVIAS (READS FIRST) ---
            const uniqueProductIds = Array.from(new Set(safeItems.map(i => i.productId)));
            const productRefs = uniqueProductIds.map(id => doc(firestore, 'products', id));
            
            const [poSnap, ...productSnaps] = await Promise.all([
                transaction.get(poRef),
                ...productRefs.map(ref => transaction.get(ref))
            ]);

            const productDataMap = new Map<string, Product>();
            productSnaps.forEach(snap => {
                if (snap.exists()) productDataMap.set(snap.id, snap.data() as Product);
            });

            // --- 2. ESCRITURAS (WRITES) ---
            for (const item of safeItems) {
                const productData = productDataMap.get(item.productId);
                
                if (productData) {
                    const oldStock = productData.stockLevel ?? (productData as any).stock ?? 0;
                    const oldCost = productData.cost || 0;
                    const newQty = item.quantity;
                    const newCost = item.unitCost;

                    const totalStock = oldStock + newQty;
                    const weightedCost = oldStock > 0 
                        ? ((oldStock * oldCost) + (newQty * newCost)) / totalStock
                        : newCost;

                    const pvpCash = productData.priceCashUSD || (productData.price * (1 - (bcvDiscount / 100)));
                    const netProfit = pvpCash - (pvpCash * 0.25) - weightedCost; 
                    const margin = pvpCash > 0 ? (netProfit / pvpCash) * 100 : 0;

                    if (margin < 15) {
                        criticalErosions.push(`${productData.name} (${margin.toFixed(1)}%)`);
                    }

                    transaction.update(doc(firestore, 'products', item.productId), {
                        stock: totalStock,
                        stockLevel: totalStock,
                        cost: weightedCost,
                        lastPurchaseRate: newCost,
                        lastPurchaseDate: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });

                    const logRef = doc(collection(firestore, `products/${item.productId}/stockHistory`));
                    transaction.set(logRef, {
                        productId: item.productId,
                        userId: currentUser.id,
                        userName: currentUser.name,
                        previousStock: oldStock,
                        newStock: totalStock,
                        change: newQty,
                        reason: `WAC: Importación #${order.id?.substring(0, 6)}`,
                        createdAt: serverTimestamp()
                    });
                }
            }

            transaction.update(poRef, {
                status: 'Recibido',
                receptionDate: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });

        if (criticalErosions.length > 0) {
            await createAppNotifications(firestore, {
                category: 'Inventario',
                title: '🚨 Alerta de Erosión de Margen',
                message: `La recepción #${order.id?.substring(0,6)} redujo márgenes críticos en: ${criticalErosions.join(', ')}.`,
                link: `/dashboard/intelligence`,
                initiatorId: 'system_wac_agent',
                roles: ['admin', 'gerencia']
            });
        }

        toast({ title: "¡Inventario Sincerado!", description: "Costo promedio ponderado y stock actualizados en catálogo." });
        onOpenChange(false);
    } catch (e: any) {
        toast({ variant: 'destructive', title: "Fallo en Recepción", description: e.message });
    } finally {
        setIsActionPending(false);
    }
  };

  if (!order) return null;

  const PO_STAGES = [
    { id: 'Pendiente', label: 'Emitido' },
    { id: 'En Tránsito', label: 'En Tránsito' },
    { id: 'En Aduana', label: 'En Aduana' },
    { id: 'Recibido', label: 'Recibido WAC' }
  ];

  const currentPOStageIndex = useMemo(() => {
    switch (order.status) {
      case 'Pendiente': return 0;
      case 'En Tránsito': return 1;
      case 'Aduana': return 2;
      case 'Recibido': return 3;
      default: return 0;
    }
  }, [order.status]);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col h-screen border-none rounded-l-[2.5rem] shadow-2xl">
        <SheetHeader className="p-8 pb-4 bg-slate-900 text-white shrink-0">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left">
                <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-white">Manifiesto de Importación</SheetTitle>
                <SheetDescription className="font-bold text-[10px] uppercase tracking-[0.2em] text-primary">{order.supplierName}</SheetDescription>
            </div>
            <div className="flex items-center gap-2">
                <Button 
                    type="button" 
                    size="sm" 
                    variant="outline"
                    onClick={handleExportPDF} 
                    disabled={isGeneratingPdf} 
                    className="h-8 px-3 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 font-black text-[9px] uppercase tracking-wider"
                >
                    {isGeneratingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Printer className="h-3.5 w-3.5 mr-1 text-primary" />} PDF MANIFIESTO
                </Button>
                <Badge className="bg-primary text-white font-black uppercase text-[9px] px-3 h-8 border-none shadow-lg">{order.status}</Badge>
            </div>
          </div>

          {/* STEPPER DE IMPORTACIÓN EN CABECERA */}
          {order.status !== 'Cancelado' && (
            <div className="mt-6 pt-4 border-t border-slate-800">
              <div className="grid grid-cols-4 gap-2">
                {PO_STAGES.map((stage, idx) => {
                  const isPassed = idx <= currentPOStageIndex;
                  const isCurrent = idx === currentPOStageIndex;
                  return (
                    <div key={stage.id} className="flex flex-col items-center gap-1.5 text-center">
                      <div className={cn(
                        "h-7 w-7 rounded-xl flex items-center justify-center font-black text-[9px] transition-all shadow-sm",
                        isCurrent ? "bg-primary text-white ring-4 ring-primary/20 scale-105" :
                        isPassed ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-500"
                      )}>
                        #{idx + 1}
                      </div>
                      <span className={cn(
                        "text-[8px] font-black uppercase tracking-wider truncate max-w-full",
                        isCurrent ? "text-primary font-extrabold" : isPassed ? "text-white" : "text-slate-500"
                      )}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1">
            <div className="p-8 space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">ORIGEN</p>
                        <p className="text-11px font-black uppercase truncate text-slate-700">{order.originCity}, {order.originCountry}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1 text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">TRANSPORTE</p>
                        <p className="text-11px font-black uppercase text-slate-700">{order.transportMode === 'Marítimo' ? '🚢 MARÍTIMO' : '✈️ AÉREO'}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 space-y-1 text-right">
                        <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest">INVERSIÓN LOTE</p>
                        <p className="text-lg font-black text-blue-700 tracking-tighter">${(order.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>

                {order.status === 'Pendiente' && (
                    <div className="p-6 rounded-[2rem] bg-slate-50 border-2 border-dashed border-slate-200 space-y-6">
                        <div className="flex items-center gap-2 text-primary">
                            <PlusCircle className="h-4 w-4" />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em]">Configurar Manifiesto de Carga</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                            <div className="md:col-span-6 space-y-1.5">
                                <Label className="text-[9px] font-black uppercase px-1">Equipo a Importar</Label>
                                <Select onValueChange={setSelectedProductId} value={selectedProductId}>
                                    <SelectTrigger className="h-11 rounded-xl bg-white border-none shadow-sm font-bold uppercase text-[10px]">
                                        <SelectValue placeholder="ELEGIR PRODUCTO..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allProducts?.map(p => <SelectItem key={p.id} value={p.id!} className="font-bold text-[10px] uppercase">{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="md:col-span-2 space-y-1.5">
                                <Label className="text-[9px] font-black uppercase px-1">Cant.</Label>
                                <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="h-11 text-center font-black rounded-xl border-none shadow-sm" />
                            </div>
                            <div className="md:col-span-3 space-y-1.5">
                                <Label className="text-[9px] font-black uppercase px-1">Costo Landed (USD)</Label>
                                <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} className="h-11 font-black rounded-xl border-none shadow-sm" />
                            </div>
                            <div className="md:col-span-1">
                                <Button onClick={handleAddItem} disabled={isActionPending || !selectedProductId} className="h-11 w-full rounded-xl bg-primary shadow-lg">
                                    <CheckCircle2 className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1"><Boxes className="h-4 w-4" /> ARTÍCULOS EN MANIFIESTO ({safeItems.length})</h3>
                    <div className="rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                        <div className="divide-y divide-slate-50 bg-white">
                            {safeItems.length > 0 ? safeItems.map((item, idx) => (
                                <div key={idx} className="p-5 flex items-center justify-between group hover:bg-slate-50 transition-colors">
                                    <div className="flex-1 min-w-0 mr-4">
                                        <p className="text-sm font-black uppercase truncate text-slate-900 leading-tight">{item.name}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">SKU: {item.sku}</span>
                                            <span className="h-1 w-1 rounded-full bg-slate-200" />
                                            <span className="text-[9px] font-black text-primary uppercase">{item.quantity} UNIDADES</span>
                                        </div>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <div className="space-y-0.5">
                                            <p className="text-[8px] font-black text-slate-400 uppercase">Costo Landed</p>
                                            <p className="font-black text-lg text-slate-900 tracking-tighter">${item.unitCost.toFixed(2)}</p>
                                        </div>
                                        {order.status === 'Pendiente' && (
                                            <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(idx)} className="h-10 w-10 rounded-xl text-rose-500 opacity-0 group-hover:opacity-100">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )) : (
                                <div className="p-16 text-center flex flex-col items-center gap-3 opacity-20">
                                    <Package className="h-12 w-12" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em]">Manifiesto de carga vacío</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {order.status !== 'Recibido' && (
                    <div className="p-6 rounded-[2.5rem] bg-emerald-50 border-2 border-emerald-100 flex items-start gap-5 shadow-inner">
                        <div className="p-3 rounded-2xl bg-white shadow-md text-emerald-600">
                            <TrendingUp className="h-6 w-6" />
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-sm font-black uppercase text-emerald-900">Protocolo de Sinceración WAC</p>
                            <p className="text-[10px] font-medium text-emerald-700 leading-relaxed uppercase">
                                Al certificar, el sistema diluirá los costos de este lote con las existencias actuales. 
                                <span className="text-emerald-900 font-bold block mt-1">ESTA ACCIÓN ACTUALIZARÁ EL VALOR DE TUS ACTIVOS EN TIEMPO REAL.</span>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </ScrollArea>

        <SheetFooter className="p-8 border-t bg-slate-50 shrink-0">
            <div className="w-full flex flex-col sm:flex-row gap-3">
                <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleExportPDF} 
                    disabled={isGeneratingPdf} 
                    className="flex-1 h-14 border-slate-200 bg-white hover:bg-slate-100 font-black uppercase text-xs tracking-wider rounded-2xl"
                >
                    {isGeneratingPdf ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Printer className="mr-2 h-5 w-5 text-primary" />} EXPORTAR MANIFIESTO PDF
                </Button>

                {['En Tránsito', 'Aduana', 'Pendiente'].includes(order.status) && (
                    <Button 
                        onClick={handleReceiveOrder} 
                        disabled={isActionPending || safeItems.length === 0} 
                        className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-wider shadow-2xl rounded-2xl transition-all active:scale-95"
                    >
                        {isActionPending ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <ShieldCheck className="mr-2 h-5 w-5" />} CERTIFICAR RECEPCIÓN WAC
                    </Button>
                )}
            </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
