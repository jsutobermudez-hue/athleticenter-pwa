'use client';

import React, { useState, useMemo } from 'react';
import { 
    Dialog, 
    DialogContent, 
    DialogDescription, 
    DialogHeader, 
    DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useFirestore,
  useMemoFirebase,
  useDoc,
  useCollection
} from '@/firebase';
import { doc, updateDoc, serverTimestamp, query, collection, where, limit } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import type { User, Order, OrderItemClient, CompanyProfile, FinancialSettings, Customer, Payment } from '@/lib/definitions';
import {
  Loader2,
  Printer,
  Zap,
  Box,
  Check,
  ShieldCheck,
  MapPin,
  Maximize2,
  X,
  Truck,
  ClipboardList,
  XCircle,
  Clock,
  Camera,
  QrCode,
  CheckCircle2,
  MessageSquare,
  FileText,
  DollarSign,
  Send,
  AlertTriangle,
  Package
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateOrderPDF, generatePickingListPDF, generatePackageLabelsPDF } from '@/lib/pdf-generator';
import { statusConfig } from '@/lib/status-config';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { QRScanner } from '@/components/ui/qr-scanner';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { createAppNotifications } from '@/lib/notifications';

interface OrderDetailsSheetProps {
    order: Order; 
    currentUser: User | undefined;
    customerRif?: string;
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    onActionTrigger: (action: 'edit' | 'status' | 'approve') => void;
    onCancelOrder: () => void;
    onRequestCancellation: () => void;
    onCertifyStockRestoration: () => void;
    isRestoringStock?: boolean;
    isCanceling: boolean;
    isRequestingCancellation: boolean;
    items: OrderItemClient[];
    isLoadingItems: boolean;
}

const ORDER_STAGES = [
  { id: 'Pendiente', label: 'Emitido', icon: Clock },
  { id: 'Aprobado', label: 'Aprobado', icon: ShieldCheck },
  { id: 'En Preparación', label: 'En Almacén', icon: Package },
  { id: 'Despachado', label: 'En Ruta', icon: Truck },
  { id: 'Entregado', label: 'Entregado', icon: CheckCircle2 }
];

export function OrderDetailsSheet({ 
    order, 
    currentUser, 
    customerRif,
    isOpen, 
    onOpenChange, 
    onActionTrigger,
    onCancelOrder,
    onRequestCancellation,
    onCertifyStockRestoration,
    isRestoringStock = false,
    isCanceling,
    isRequestingCancellation,
    items: itemsWithProductData,
    isLoadingItems
}: OrderDetailsSheetProps) {
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  const [pickingMode, setPickingMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPrintingLabels, setIsPrintingLabels] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const customerRef = useMemoFirebase(() => (firestore && order) ? doc(firestore, 'customers', order.customerId) : null, [firestore, order?.customerId]);
  const { data: customerData } = useDoc<Customer>(customerRef);

  const fallbackCustomerQuery = useMemoFirebase(() => {
    if (!firestore || !order?.customerName) return null;
    return query(collection(firestore, 'customers'), where('razonSocial', '==', order.customerName), limit(1));
  }, [firestore, order?.customerName]);
  const { data: fallbackCustomers } = useCollection<Customer>(fallbackCustomerQuery);
  const fallbackCustomer = fallbackCustomers && fallbackCustomers.length > 0 ? fallbackCustomers[0] : null;

  const paymentsQuery = useMemoFirebase(() => {
    if (!firestore || !order?.id) return null;
    return query(collection(firestore, `orders/${order.id}/payments`), limit(20));
  }, [firestore, order?.id]);
  const { data: orderPayments, isLoading: isLoadingPayments } = useCollection<Payment>(paymentsQuery);

  const finalCustomerRif = order.customerRif || customerData?.rif || fallbackCustomer?.rif || customerRif || '';
  const finalCustomerAddress = customerData?.address || fallbackCustomer?.address || '';

  const paidAmount = order.amountPaid || 0;
  const totalAmount = order.totalAmount || 0;
  const pendingDebt = Math.max(0, totalAmount - paidAmount);
  const paymentPct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;

  // CÁLCULO DE ETAPA EN STEPPER
  const currentStageIndex = useMemo(() => {
    switch (order.status) {
      case 'Borrador':
      case 'Pendiente': return 0;
      case 'Aprobado': return 1;
      case 'En Preparación':
      case 'Completado': return 2;
      case 'Despachado': return 3;
      case 'Entregado':
      case 'En Verificación':
      case 'Pagado': return 4;
      default: return 0;
    }
  }, [order.status]);

  const sortedItemsForPicking = useMemo(() => {
    return [...itemsWithProductData].sort((a, b) => {
        const locA = a.product?.warehouseLocation || 'Z-ZZZ';
        const locB = b.product?.warehouseLocation || 'Z-ZZZ';
        return locA.localeCompare(locB);
    });
  }, [itemsWithProductData]);

  const handleTogglePicked = async (item: OrderItemClient) => {
    if (!firestore || !item.id) return;
    const itemRef = doc(firestore, `orders/${order.id}/orderItems`, item.id);
    await updateDoc(itemRef, { picked: !item.picked });
  };

  const handleQRScan = async (sku: string) => {
      const itemToPick = itemsWithProductData.find(i => i.product?.sku === sku && !i.picked);
      if (itemToPick) {
          await handleTogglePicked(itemToPick);
          toast({ title: "Confirmado vía QR", description: `Artículo ${sku} marcado como recolectado.` });
      } else {
          toast({ variant: 'destructive', title: "Error de Escaneo", description: "El SKU no pertenece a este pedido o ya fue recolectado." });
      }
  };

  const pickedCount = useMemo(() => itemsWithProductData.filter(i => i.picked).length, [itemsWithProductData]);
  const totalItems = itemsWithProductData.length;
  const pickingPercentage = totalItems > 0 ? (pickedCount / totalItems) * 100 : 0;
  const isFullyPicked = totalItems > 0 && pickedCount === totalItems;

  const handleCompletePicking = async () => {
    if (!firestore || !currentUser || !isFullyPicked) return;
    setIsCompleting(true);
    try {
        const orderRef = doc(firestore, 'orders', order.id);
        await updateDoc(orderRef, { 
            status: 'Completado',
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.id
        });

        await createAppNotifications(firestore, {
            category: 'Despacho',
            title: `Picking Certificado #${order.id.substring(0, 6)}`,
            message: `El operario ${currentUser.name} ha culminado la recolección. Listo para embalaje y salida.`,
            link: `/dashboard/dispatch?orderId=${order.id}`,
            initiatorId: currentUser.id,
            roles: ['admin', 'gerencia', 'deposito'],
        });

        toast({ title: "Picking Finalizado", description: "Pedido completado exitosamente." });
        setPickingMode(false);
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error de Red', description: 'No se pudo sincronizar el cierre de picking.' });
    } finally {
        setIsCompleting(false);
    }
  };

  const handleShareWhatsApp = () => {
    const rawPhone = (customerData?.phone || fallbackCustomer?.phone || order.customerPhone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
    
    const itemsSummary = itemsWithProductData
      .slice(0, 5)
      .map(i => `• ${i.product.name} ${i.size ? `[Talla ${i.size}]` : ''} x${i.quantity} ($${(i.unitPrice * i.quantity).toFixed(2)})`)
      .join('\n');
    
    const text = `*ATHLETICENTER C.A. - ESTATUS DE EXPEDIENTE N° #${order.id.substring(0, 8).toUpperCase()}*\n\n` +
      `👤 *Cliente:* ${order.customerName}\n` +
      `📍 *RIF / Identificación:* ${finalCustomerRif || 'S/D'}\n` +
      `📦 *Estatus Logístico:* ${order.status.toUpperCase()}\n` +
      (order.trackingNumber ? `🚚 *Guía / Tracking:* ${order.trackingNumber}\n` : '') +
      `💰 *Total Facturado:* $${totalAmount.toFixed(2)} USD\n` +
      (pendingDebt > 0.05 ? `⚠️ *Saldo Pendiente:* $${pendingDebt.toFixed(2)} USD\n` : `✅ *Estado Financiero:* Totalmente Solvente\n`) +
      `📍 *Asesor Asignado:* ${order.salespersonName || 'Atención General'}\n\n` +
      `*Resumen de Productos:*\n${itemsSummary}` +
      (itemsWithProductData.length > 5 ? `\n...y ${itemsWithProductData.length - 5} más.` : '') +
      `\n\nQuedamos atentos a cualquier solicitud. ¡Gracias por confiar en Athleticenter!`;

    const url = cleanPhone 
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` 
      : `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, '_blank');
  };

  const handleGoToBilling = () => {
    router.push(`/dashboard/billing?orderId=${order.id}`);
  };

  const handleExportNote = async () => {
    if (isLoadingItems || itemsWithProductData.length === 0) {
        toast({ variant: 'destructive', title: 'Datos no listos' });
        return;
    }
    
    setIsExporting(true);
    try {
        await generateOrderPDF({ 
            customerName: order.customerName, 
            customerRif: finalCustomerRif,
            customerAddress: finalCustomerAddress,
            orderItems: itemsWithProductData, 
            salespersonName: order.salespersonName, 
            orderId: order.id, 
            createdAt: order.orderDate, 
            companyProfile: companyProfile || undefined,
            documentType: 'nota',
            globalSettings: globalSettings || undefined,
            bcvRate: globalSettings?.bcvRate || 65.50
        });
        toast({ title: "Nota Generada con Éxito" });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Fallo al Exportar' });
    } finally {
        setIsExporting(false);
    }
  };

  const handlePrintLabels = async () => {
    if (isLoadingItems || itemsWithProductData.length === 0) return;
    setIsPrintingLabels(true);
    try {
        await generatePackageLabelsPDF(order, itemsWithProductData, companyProfile || undefined, finalCustomerAddress);
        toast({ title: "Etiquetas Generadas" });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error de Impresión' });
    } finally {
        setIsPrintingLabels(false);
    }
  };

  const isStaff = currentUser && ['admin', 'superadmin', 'gerencia', 'ventas', 'deposito'].includes(currentUser.role);
  const isAdmin = currentUser && ['admin', 'superadmin', 'gerencia'].includes(currentUser.role);
  const isClient = currentUser?.role === 'cliente';
  
  const canCancelDirectly = isAdmin || (isStaff && order.status === 'Pendiente');
  const canRequestCancellation = isClient && order.status !== 'Despachado' && order.status !== 'Pagado' && order.status !== 'Cancelado';
  
  const isCancellationPending = order.cancellationRequested === true && order.status !== 'Cancelado';

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl p-0 flex flex-col h-[90vh] border-none rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl overflow-hidden z-[100]">
        
        {/* HEADER DE EXPEDIENTE */}
        <DialogHeader className="p-6 sm:p-8 pb-4 bg-slate-50 border-b shrink-0 relative">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate">EXPEDIENTE #{order.id.substring(0,8)}</DialogTitle>
                  {finalCustomerRif && (
                    <Badge variant="outline" className="font-mono text-[9px] font-bold uppercase px-2 h-5 bg-white border-slate-200 text-slate-600">
                      RIF: {finalCustomerRif}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="font-black text-[10px] sm:text-[12px] uppercase tracking-[0.2em] text-primary truncate mt-1">{order.customerName}</DialogDescription>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0 mr-8">
                <Badge className={cn(statusConfig[order.status]?.color, "font-black uppercase text-[9px] sm:text-[11px] px-3 sm:px-4 h-6 sm:h-8 border-none shadow-md")}>{order.status}</Badge>
                {isCancellationPending && <Badge variant="destructive" className="animate-pulse text-[8px] font-black uppercase h-5 px-2">Anulación Pendiente</Badge>}
            </div>
          </div>

          {/* LÍNEA DE TIEMPO STEPPER EN CABECERA */}
          {order.status !== 'Cancelado' && (
            <div className="mt-6 pt-4 border-t border-slate-200/60">
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {ORDER_STAGES.map((stage, idx) => {
                  const isPassed = idx <= currentStageIndex;
                  const isCurrent = idx === currentStageIndex;
                  const StageIcon = stage.icon;

                  return (
                    <div key={stage.id} className="flex flex-col items-center gap-1.5 text-center">
                      <div className={cn(
                        "h-8 w-8 sm:h-9 sm:w-9 rounded-xl flex items-center justify-center transition-all shadow-sm",
                        isCurrent ? "bg-primary text-white ring-4 ring-primary/20 scale-105" :
                        isPassed ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400"
                      )}>
                        <StageIcon className="h-4 w-4" />
                      </div>
                      <span className={cn(
                        "text-[7px] sm:text-[8px] font-black uppercase tracking-wider truncate max-w-full",
                        isCurrent ? "text-primary font-extrabold" : isPassed ? "text-slate-900" : "text-slate-400"
                      )}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={() => onOpenChange(false)} className="absolute top-6 right-6 text-slate-300 hover:text-slate-900 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white min-h-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                <div className="lg:col-span-8 p-6 sm:p-10 space-y-10">
                    {(order.dispatchImageUrl || order.deliveryImageUrl) && (
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1">
                                <Camera className="h-4 w-4 text-primary" /> CUSTODIA DIGITAL
                            </h3>
                            <div className="grid grid-cols-2 gap-6">
                                {order.dispatchImageUrl && (
                                    <div 
                                        className="relative aspect-video sm:aspect-square rounded-[2rem] overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in group shadow-xl"
                                        onClick={() => setZoomImage(order.dispatchImageUrl!)}
                                    >
                                        <img src={order.dispatchImageUrl} alt="Salida" className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-110" />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Maximize2 className="text-white h-8 w-8" />
                                        </div>
                                        <Badge className="absolute top-4 left-4 bg-slate-900 text-white border-none text-[8px] font-black uppercase px-2 h-5">SALIDA CERTIFICADA</Badge>
                                    </div>
                                )}
                                {order.deliveryImageUrl && (
                                    <div 
                                        className="relative aspect-video sm:aspect-square rounded-[2rem] overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in group shadow-xl"
                                        onClick={() => setZoomImage(order.deliveryImageUrl!)}
                                    >
                                        <img src={order.deliveryImageUrl} alt="Recepción" className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-110" />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Maximize2 className="text-white h-8 w-8" />
                                        </div>
                                        <Badge className="absolute top-4 left-4 bg-emerald-600 text-white border-none text-[8px] font-black uppercase px-2 h-5">RECEPCIÓN CLIENTE</Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-6">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1"><Box className="h-4 w-4 text-primary" /> MANIFIESTO DE CARGA</h3>
                        <div className="rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-2xl bg-white">
                            <div className="divide-y divide-slate-50">
                                {isLoadingItems ? (
                                    Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-8"><Skeleton className="h-12 w-full rounded-2xl" /></div>)
                                ) : sortedItemsForPicking.map((item) => (
                                    <div key={item.id} className={cn("p-6 sm:p-8 flex items-center gap-6 transition-all", item.picked && "bg-emerald-50/30")}>
                                        <div className="relative h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-[1.5rem] overflow-hidden bg-slate-50 border border-slate-100 shadow-inner">
                                            <Avatar className="h-full w-full rounded-none">
                                                <AvatarImage src={item.product?.imageUrl} className="object-cover" />
                                                <AvatarFallback className="rounded-none bg-slate-100">
                                                    <Box className="h-8 w-8 text-slate-300" />
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-2 min-w-0">
                                                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[8px] font-black h-5 uppercase px-2 shrink-0">
                                                    UBICACIÓN: {item.product?.warehouseLocation || 'S/U'}
                                                </Badge>
                                                <p className="text-sm sm:text-base font-black uppercase truncate text-slate-900 leading-tight">{item.product?.name || '---'}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-tighter bg-slate-50 px-2 py-1 rounded-md">{item.product?.sku}</span>
                                                <span className="text-[10px] font-black text-primary uppercase">CANT: {item.quantity}</span>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center">
                                            {pickingMode ? (
                                                <Button 
                                                    variant={item.picked ? "default" : "outline"} 
                                                    size="icon" 
                                                    className={cn("h-12 w-12 sm:h-14 sm:w-14 rounded-[1.2rem] sm:rounded-[1.5rem] shadow-xl transition-all active:scale-90", item.picked ? "bg-emerald-500" : "border-slate-200 text-slate-300")}
                                                    onClick={() => handleTogglePicked(item)}
                                                >
                                                    {item.picked ? <Check className="h-6 w-6 text-white" /> : <Box className="h-6 w-6" />}
                                                </Button>
                                            ) : <p className="font-black text-lg sm:text-2xl text-slate-900 tracking-tighter">${(item.quantity * item.unitPrice).toFixed(2)}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4 bg-slate-50/50 border-l border-slate-100 p-6 sm:p-10 space-y-10">
                    {isStaff && order.status !== 'Borrador' && order.status !== 'Cancelado' && (
                        <div className="p-8 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl space-y-8 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:rotate-12 transition-transform duration-1000"><Truck className="h-32 w-32" /></div>
                            <div className="flex items-center justify-between relative z-10">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-2xl bg-primary/20 text-primary"><ClipboardList className="h-6 w-6" /></div>
                                    <Label className="text-xs font-black uppercase tracking-[0.2em] text-primary">Logística Pro</Label>
                                </div>
                                {['Aprobado', 'En Preparación'].includes(order.status) && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black uppercase text-white/40">MODO PICKING</span>
                                        <Switch checked={pickingMode} onCheckedChange={setPickingMode} />
                                    </div>
                                )}
                            </div>

                            <div className="space-y-4 relative z-10">
                                <Button 
                                    variant="outline" 
                                    className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 h-12 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                    onClick={() => generatePickingListPDF({ orderId: order.id, customerName: order.customerName, orderItems: sortedItemsForPicking, companyProfile: companyProfile || undefined })}
                                >
                                    <MapPin className="mr-2 h-4 w-4 text-primary" /> Exportar Picking List
                                </Button>
                                
                                {pickingMode ? (
                                    <div className="space-y-4 animate-in slide-in-from-top-4">
                                        <Button 
                                            className="w-full bg-primary hover:bg-primary/90 text-white h-12 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl"
                                            onClick={() => setShowScanner(true)}
                                        >
                                            <QrCode className="mr-2 h-4 w-4" /> Escanear Código QR
                                        </Button>
                                        
                                        <div className="p-5 bg-white/5 rounded-2xl border border-white/10 space-y-4">
                                            <div className="flex justify-between items-end">
                                                <p className="text-[9px] font-black uppercase text-slate-400">Avance de Recolección</p>
                                                <p className="text-2xl font-black tracking-tighter text-white">{pickedCount} <span className="text-xs text-slate-500">/ {totalItems}</span></p>
                                            </div>
                                            <Progress value={pickingPercentage} className="h-2 bg-white/10" />
                                            
                                            {isFullyPicked && (
                                                <Button 
                                                    onClick={handleCompletePicking} 
                                                    disabled={isCompleting}
                                                    className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase text-[10px] tracking-[0.2em] rounded-xl shadow-2xl animate-pulse"
                                                >
                                                    {isCompleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} FINALIZAR PICKING
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    ['Completado', 'Despachado', 'Entregado'].includes(order.status) && (
                                        <Button 
                                            variant="outline" 
                                            className="w-full bg-white/5 border-white/10 text-white hover:bg-white/10 h-12 rounded-xl font-black uppercase text-[10px] tracking-widest"
                                            onClick={handlePrintLabels}
                                            disabled={isPrintingLabels || isLoadingItems}
                                        >
                                            {isPrintingLabels ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4 text-primary" />} Generar Etiquetas QR
                                        </Button>
                                    )
                                )}
                            </div>
                        </div>
                    )}

                    {/* TARJETA DE COMPROBANTES Y RECIBOS DE PAGO */}
                    <div className="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-xl space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Auditoría Financiera</p>
                                    <h4 className="text-sm font-black uppercase text-slate-900">Estado de Abonos ({orderPayments?.length || 0})</h4>
                                </div>
                                <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 font-black text-[9px] px-2 py-0.5">
                                    ${paidAmount.toFixed(2)} / ${totalAmount.toFixed(2)}
                                </Badge>
                            </div>

                            {/* BARRA DE PROGRESO DE PAGO */}
                            <div className="space-y-1.5">
                              <Progress value={paymentPct} className="h-2 bg-slate-100" />
                              <div className="flex justify-between text-[8px] font-black uppercase text-slate-400">
                                <span>Abonado ({paymentPct.toFixed(0)}%)</span>
                                <span className={pendingDebt > 0.05 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>
                                  {pendingDebt > 0.05 ? `Saldo: $${pendingDebt.toFixed(2)}` : 'Solvente'}
                                </span>
                              </div>
                            </div>
                        </div>

                        {isLoadingPayments ? (
                            <div className="flex justify-center p-4"><Loader2 className="animate-spin h-5 w-5 text-slate-400" /></div>
                        ) : orderPayments && orderPayments.length > 0 ? (
                            <div className="space-y-4">
                                {orderPayments.map((p, idx) => (
                                    <div key={idx} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <p className="text-xs font-black uppercase text-slate-900">{p.method}</p>
                                                <p className="text-[9px] font-mono text-slate-500">Ref: {p.referenceNumber || 'N/A'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-black text-emerald-600">${p.amount?.toFixed(2)}</p>
                                                <Badge variant="outline" className={cn(
                                                    "text-[8px] font-black uppercase border-none px-2 py-0",
                                                    p.status === 'verified' ? "bg-emerald-100 text-emerald-800" :
                                                    p.status === 'pending_verification' ? "bg-amber-100 text-amber-800" :
                                                    "bg-rose-100 text-rose-800"
                                                )}>
                                                    {p.status === 'verified' ? 'Verificado' : p.status === 'pending_verification' ? 'Pendiente' : 'Rechazado'}
                                                </Badge>
                                            </div>
                                        </div>

                                        {p.notes && (
                                            <p className="text-[9px] text-slate-600 bg-white p-2 rounded-xl border border-slate-100 italic">{p.notes}</p>
                                        )}

                                        {(p.imageUrl || p.retentionImageUrl) && (
                                            <div className="flex items-center gap-3 pt-1">
                                                {p.imageUrl && (
                                                    <div 
                                                        onClick={() => setZoomImage(p.imageUrl!)} 
                                                        className="relative group h-14 w-20 rounded-xl overflow-hidden border-2 border-emerald-200 cursor-pointer shadow-sm hover:opacity-90 transition-opacity shrink-0 bg-slate-900"
                                                    >
                                                        <img src={p.imageUrl} alt="Comprobante" className="h-full w-full object-cover" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                                                            <Maximize2 className="h-4 w-4" />
                                                        </div>
                                                    </div>
                                                )}

                                                {p.retentionImageUrl && (
                                                    <div 
                                                        onClick={() => setZoomImage(p.retentionImageUrl!)} 
                                                        className="relative group h-14 w-20 rounded-xl overflow-hidden border-2 border-indigo-200 cursor-pointer shadow-sm hover:opacity-90 transition-opacity shrink-0 bg-slate-900"
                                                    >
                                                        <img src={p.retentionImageUrl} alt="Retención" className="h-full w-full object-cover" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                                                            <Maximize2 className="h-4 w-4" />
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                <div className="text-[8px] font-bold text-slate-400 uppercase leading-relaxed">
                                                    Toca la foto para ampliar el comprobante bancario.
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[10px] font-bold text-slate-400 uppercase text-center py-2 italic">Sin abonos o comprobantes adjuntos.</p>
                        )}
                    </div>

                    <div className="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-xl space-y-6">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Inversión Final</p>
                            <p className="text-5xl font-black text-slate-900 tracking-tighter leading-none">${order.totalAmount.toLocaleString()}</p>
                        </div>
                        <Separator className="bg-slate-100" />
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Button 
                                    variant="outline" 
                                    disabled={isLoadingItems || itemsWithProductData.length === 0 || isExporting} 
                                    className="w-full h-14 font-black uppercase tracking-widest text-[10px] border-slate-200 bg-white shadow-xl rounded-2xl transition-all active:scale-95" 
                                    onClick={handleExportNote}
                                >
                                    {isExporting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Printer className="mr-2 h-5 w-5 text-primary" />} NOTA PDF
                                </Button>

                                <Button 
                                    variant="outline" 
                                    disabled={isLoadingItems || itemsWithProductData.length === 0} 
                                    className="w-full h-14 font-black uppercase tracking-widest text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shadow-xl rounded-2xl transition-all active:scale-95" 
                                    onClick={handleShareWhatsApp}
                                >
                                    <MessageSquare className="mr-2 h-5 w-5 text-emerald-600" /> WHATSAPP
                                </Button>
                            </div>

                            {/* BOTÓN ATAJO A FACTURACIÓN EN 1 CLIC PARA GERENCIA */}
                            {isAdmin && (
                              <Button 
                                  variant="outline"
                                  onClick={handleGoToBilling} 
                                  className="w-full h-12 border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-sm"
                              >
                                  <FileText className="mr-2 h-4 w-4 text-blue-600" /> GESTIONAR EN FACTURACIÓN (1-CLIC)
                              </Button>
                            )}

                            {(order.status === 'Pendiente' || order.status === 'Borrador') && isAdmin && (
                                <Button 
                                    onClick={() => onActionTrigger('approve')} 
                                    className="w-full h-14 bg-primary hover:bg-primary/90 text-white font-black uppercase text-xs tracking-[0.3em] shadow-2xl rounded-2xl transition-all active:scale-95"
                                >
                                    <ShieldCheck className="mr-3 h-6 w-6" /> APROBAR PEDIDO
                                </Button>
                            )}

                            {(canCancelDirectly || canRequestCancellation) && (
                                <Button 
                                    variant="outline" 
                                    onClick={(e) => { e.preventDefault(); canCancelDirectly ? onCancelOrder() : onRequestCancellation(); }} 
                                    disabled={isCanceling || isRequestingCancellation || isCancellationPending} 
                                    className={cn(
                                        "w-full h-14 border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-md",
                                        isCancellationPending && "bg-amber-50 text-amber-600 border-amber-200"
                                    )}
                                >
                                    {isCanceling || isRequestingCancellation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : isCancellationPending ? <Clock className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
                                    {isCancellationPending ? "ANULACIÓN EN TRÁMITE" : "ANULAR ESTE PEDIDO"}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-4 text-slate-300 pt-4">
                        <ShieldCheck className="h-6 w-6" />
                        <p className="text-[9px] font-black uppercase tracking-[0.4em] text-center leading-relaxed">
                            Athleticenter Pro Control Center<br/>Protocolo de Auditoría v6.0
                        </p>
                    </div>
                </div>
            </div>
        </div>
      </DialogContent>
    </Dialog>

    {showScanner && (
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
    )}

    <Dialog open={!!zoomImage} onOpenChange={() => setZoomImage(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl p-0 border-none bg-black/95 flex items-center justify-center rounded-[2rem] overflow-hidden shadow-2xl">
            {zoomImage && <img src={zoomImage} alt="Evidencia Full" className="max-w-full max-h-[85vh] object-contain" />}
        </DialogContent>
    </Dialog>
    </>
  );
}
