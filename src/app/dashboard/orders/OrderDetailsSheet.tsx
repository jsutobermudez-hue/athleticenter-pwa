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
  Package,
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateOrderPDF, generatePickingListPDF, generatePackageLabelsPDF, generatePaymentReceiptPDF } from '@/lib/pdf-generator';
import { statusConfig } from '@/lib/status-config';
import { getOrderCommercialDiscountPercent } from '@/lib/billing';
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
    onDeleteOrder?: () => void;
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
    onDeleteOrder,
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
  const discountPercent = getOrderCommercialDiscountPercent(order);
  const discountAmount = (totalAmount * discountPercent) / 100;
  const netPayableTotal = Math.max(0, totalAmount - discountAmount);
  const isPaidExplicit = order.status === 'Pagado';
  const pendingDebt = isPaidExplicit ? 0 : Math.max(0, netPayableTotal - paidAmount);
  const paymentPct = netPayableTotal > 0 ? Math.min(100, (paidAmount / netPayableTotal) * 100) : (isPaidExplicit ? 100 : 0);

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
    onOpenChange(false);
    setTimeout(() => {
      router.push(`/dashboard/billing?orderId=${order.id}`);
    }, 100);
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
      <DialogContent className="max-w-[98vw] w-[98vw] p-0 flex flex-col h-[94vh] max-h-[94vh] border-none rounded-3xl shadow-2xl overflow-hidden z-[100]">
        
        {/* HEADER DE EXPEDIENTE */}
        <DialogHeader className="p-5 sm:p-6 pb-3 bg-slate-900 text-white shrink-0 relative">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left flex-1 min-w-0 pr-8">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-white leading-none truncate">EXPEDIENTE #{order.id.substring(0,8)}</DialogTitle>
                  {finalCustomerRif && (
                    <Badge variant="outline" className="font-mono text-[9px] font-bold uppercase px-2 h-5 bg-white/10 border-white/20 text-slate-300">
                      RIF: {finalCustomerRif}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="font-black text-[10px] sm:text-[12px] uppercase tracking-[0.2em] text-primary-foreground/90 truncate mt-0.5">{order.customerName}</DialogDescription>
            </div>
            <div className="flex items-center gap-3 shrink-0 mr-8">
                <Badge className={cn(statusConfig[order.status]?.color, "font-black uppercase text-[10px] sm:text-[11px] px-3.5 h-7 border-none shadow-md")}>{order.status}</Badge>
                {isCancellationPending && <Badge variant="destructive" className="animate-pulse text-[8px] font-black uppercase h-5 px-2">Anulación Pendiente</Badge>}
            </div>
          </div>

          {/* LÍNEA DE TIEMPO STEPPER EN CABECERA */}
          {order.status !== 'Cancelado' && (
            <div className="mt-4 pt-3 border-t border-white/10">
              <div className="grid grid-cols-5 gap-1 sm:gap-2">
                {ORDER_STAGES.map((stage, idx) => {
                  const isPassed = idx <= currentStageIndex;
                  const isCurrent = idx === currentStageIndex;
                  const StageIcon = stage.icon;

                  return (
                    <div key={stage.id} className="flex flex-col items-center gap-1 text-center">
                      <div className={cn(
                        "h-7 w-7 sm:h-8 sm:w-8 rounded-xl flex items-center justify-center transition-all shadow-sm",
                        isCurrent ? "bg-primary text-white ring-4 ring-primary/30 scale-105" :
                        isPassed ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-400"
                      )}>
                        <StageIcon className="h-3.5 w-3.5" />
                      </div>
                      <span className={cn(
                        "text-[7px] sm:text-[8px] font-black uppercase tracking-wider truncate max-w-full",
                        isCurrent ? "text-primary font-extrabold" : isPassed ? "text-white" : "text-slate-400"
                      )}>
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button onClick={() => onOpenChange(false)} className="absolute top-5 right-5 text-white/50 hover:text-white transition-colors">
            <X className="h-6 w-6" />
          </button>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/50 min-h-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 min-h-full">
                {/* COLUMNA IZQUIERDA: CONTENIDO Y PICKING (7 COLS) */}
                <div className="lg:col-span-7 p-5 sm:p-7 space-y-6 bg-white border-r border-slate-100">
                    {(order.dispatchImageUrl || order.deliveryImageUrl) && (
                        <div className="space-y-3">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1">
                                <Camera className="h-4 w-4 text-primary" /> CUSTODIA DIGITAL
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                {order.dispatchImageUrl && (
                                    <div 
                                        className="relative aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in group shadow-md"
                                        onClick={() => setZoomImage(order.dispatchImageUrl!)}
                                    >
                                        <img src={order.dispatchImageUrl} alt="Salida" className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-110" />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Maximize2 className="text-white h-6 w-6" />
                                        </div>
                                        <Badge className="absolute top-2 left-2 bg-slate-900 text-white border-none text-[8px] font-black uppercase px-2 h-5">SALIDA CERTIFICADA</Badge>
                                    </div>
                                )}
                                {order.deliveryImageUrl && (
                                    <div 
                                        className="relative aspect-video rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 cursor-zoom-in group shadow-md"
                                        onClick={() => setZoomImage(order.deliveryImageUrl!)}
                                    >
                                        <img src={order.deliveryImageUrl} alt="Recepción" className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-110" />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Maximize2 className="text-white h-6 w-6" />
                                        </div>
                                        <Badge className="absolute top-2 left-2 bg-emerald-600 text-white border-none text-[8px] font-black uppercase px-2 h-5">RECEPCIÓN CLIENTE</Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2"><Box className="h-4 w-4 text-primary" /> MANIFIESTO DE CARGA</h3>
                            <span className="text-[10px] font-black text-slate-500 uppercase">{itemsWithProductData.length} Productos</span>
                        </div>
                        <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
                            <div className="divide-y divide-slate-100">
                                {isLoadingItems ? (
                                    Array.from({ length: 3 }).map((_, i) => <div key={i} className="p-6"><Skeleton className="h-10 w-full rounded-xl" /></div>)
                                ) : sortedItemsForPicking.map((item) => (
                                    <div key={item.id} className={cn("p-4 sm:p-5 flex items-center gap-4 transition-all", item.picked && "bg-emerald-50/40")}>
                                        <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-slate-50 border border-slate-200 shadow-inner">
                                            <Avatar className="h-full w-full rounded-none">
                                                <AvatarImage src={item.product?.imageUrl} className="object-cover" />
                                                <AvatarFallback className="rounded-none bg-slate-100">
                                                    <Box className="h-6 w-6 text-slate-300" />
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 min-w-0 flex-wrap">
                                                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[8px] font-black h-4 uppercase px-1.5 shrink-0">
                                                    {item.product?.warehouseLocation || 'S/U'}
                                                </Badge>
                                                <p className="text-xs sm:text-sm font-black uppercase truncate text-slate-900 leading-tight">{item.product?.name || '---'}</p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-tighter bg-slate-50 px-1.5 py-0.5 rounded">{item.product?.sku}</span>
                                                <span className="text-[10px] font-black text-primary uppercase">CANT: {item.quantity}</span>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center">
                                            {pickingMode ? (
                                                <Button 
                                                    variant={item.picked ? "default" : "outline"} 
                                                    size="icon" 
                                                    className={cn("h-10 w-10 rounded-xl shadow-md transition-all active:scale-90", item.picked ? "bg-emerald-500" : "border-slate-200 text-slate-300")}
                                                    onClick={() => handleTogglePicked(item)}
                                                >
                                                    {item.picked ? <Check className="h-5 w-5 text-white" /> : <Box className="h-5 w-5" />}
                                                </Button>
                                            ) : <p className="font-black text-base sm:text-xl text-slate-900 tracking-tighter">${(item.quantity * item.unitPrice).toFixed(2)}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* COLUMNA DERECHA: AUDITORÍA FINANCIERA Y ACCIONES ORGANIZADAS (5 COLS) */}
                <div className="lg:col-span-5 bg-slate-50 p-5 sm:p-7 space-y-6">
                    {/* ACCIONES PRINCIPALES DE OPERACIÓN */}
                    {(isAdmin || isStaff) && (
                      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Acciones de Operación</p>
                          <div className="space-y-2">
                              {(order.status === 'Pendiente' || order.status === 'Borrador') && isAdmin && (
                                  <Button 
                                      onClick={() => onActionTrigger('approve')} 
                                      className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase text-[10px] tracking-[0.2em] shadow-lg rounded-xl transition-all"
                                  >
                                      <ShieldCheck className="mr-2 h-5 w-5" /> APROBAR PEDIDO
                                  </Button>
                              )}

                              {['Aprobado', 'En Preparación'].includes(order.status) && isStaff && (
                                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white">
                                      <div className="flex items-center gap-2">
                                          <ClipboardList className="h-4 w-4 text-primary" />
                                          <span className="text-[10px] font-black uppercase">MODO PICKING</span>
                                      </div>
                                      <Switch checked={pickingMode} onCheckedChange={setPickingMode} />
                                  </div>
                              )}
                          </div>
                      </div>
                    )}

                    {/* MODO PICKING AVANCE */}
                    {pickingMode && (
                        <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-lg space-y-3">
                            <div className="flex justify-between items-center">
                                <p className="text-[10px] font-black uppercase text-primary tracking-widest">Avance Recolección</p>
                                <p className="text-lg font-black tracking-tighter text-white">{pickedCount} <span className="text-xs text-slate-400">/ {totalItems}</span></p>
                            </div>
                            <Progress value={pickingPercentage} className="h-2 bg-white/10" />
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <Button 
                                    className="bg-white/10 hover:bg-white/20 text-white h-9 rounded-xl font-black uppercase text-[9px]"
                                    onClick={() => setShowScanner(true)}
                                >
                                    <QrCode className="mr-1.5 h-3.5 w-3.5" /> Escanear QR
                                </Button>
                                <Button 
                                    variant="outline"
                                    className="border-white/20 bg-transparent text-white hover:bg-white/10 h-9 rounded-xl font-black uppercase text-[9px]"
                                    onClick={() => generatePickingListPDF({ orderId: order.id, customerName: order.customerName, orderItems: sortedItemsForPicking, companyProfile: companyProfile || undefined })}
                                >
                                    <MapPin className="mr-1.5 h-3.5 w-3.5 text-primary" /> Picking PDF
                                </Button>
                            </div>
                            {isFullyPicked && (
                                <Button 
                                    onClick={handleCompletePicking} 
                                    disabled={isCompleting}
                                    className="w-full h-10 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase text-[10px] tracking-[0.2em] rounded-xl shadow-xl animate-pulse"
                                >
                                    {isCompleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />} FINALIZAR PICKING
                                </Button>
                            )}
                        </div>
                    )}

                    {/* TARJETA DE AUDITORÍA FINANCIERA DESTACADA Y AMPLIA */}
                    <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-md space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                            <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary">Auditoría Financiera</p>
                                <h4 className="text-xs font-black uppercase text-slate-900">Estado de Abonos ({orderPayments?.length || 0})</h4>
                                {discountPercent > 0 && (
                                    <p className="text-[9px] font-bold text-slate-500 mt-1">
                                        Subtotal Bruto: <span className="line-through text-slate-400">${totalAmount.toFixed(2)}</span> • Desc. {discountPercent}% (<strong className="text-emerald-600">-${discountAmount.toFixed(2)}</strong>)
                                    </p>
                                )}
                            </div>
                            <div className="text-left sm:text-right">
                                <p className="text-base font-black text-slate-900 tracking-tight">${paidAmount.toFixed(2)} / ${netPayableTotal.toFixed(2)}</p>
                                <p className="text-[8px] font-bold text-slate-400 uppercase">{discountPercent > 0 ? 'Monto Neto Facturado' : 'Monto Total Expediente'}</p>
                            </div>
                        </div>

                        {/* BARRA DE PROGRESO DE AMORTIZACIÓN */}
                        <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <div className="flex justify-between text-[9px] font-black uppercase">
                                <span className="text-slate-500">Amortizado: {paymentPct.toFixed(0)}%</span>
                                <span className={pendingDebt > 0.05 ? "text-rose-600 font-extrabold" : "text-emerald-600 font-extrabold"}>
                                    {pendingDebt > 0.05 ? `Adeudado: $${pendingDebt.toFixed(2)}` : '🎉 100% SOLVENTE'}
                                </span>
                            </div>
                            <Progress value={paymentPct} className="h-2 bg-slate-200" />
                        </div>

                        {isLoadingPayments ? (
                            <div className="flex justify-center p-4"><Loader2 className="animate-spin h-5 w-5 text-slate-400" /></div>
                        ) : orderPayments && orderPayments.length > 0 ? (
                            <div className="space-y-3">
                                {orderPayments.map((p, idx) => {
                                    const voucherImg = p.imageUrl || (p as any).paymentReceiptUrl || (p as any).comprobanteUrl || (p as any).receiptUrl || (p as any).retentionImageUrl || (p as any).voucherUrl || '';
                                    return (
                                    <div key={idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                                                    {p.method} (Abono #{idx + 1})
                                                </p>
                                                <p className="text-[9px] font-mono text-slate-500">Ref: {p.referenceNumber || 'N/A'}</p>
                                                {(p as any).registeredByName && (
                                                    <p className="text-[8px] font-bold text-slate-400 uppercase">Reg: {(p as any).registeredByName}</p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-black text-emerald-600">${p.amount?.toFixed(2)}</p>
                                                <Badge variant="outline" className={cn(
                                                    "text-[8px] font-black uppercase border-none px-2 py-0.5",
                                                    p.status === 'verified' ? "bg-emerald-100 text-emerald-800" :
                                                    p.status === 'pending_verification' ? "bg-amber-100 text-amber-800" :
                                                    "bg-rose-100 text-rose-800"
                                                )}>
                                                    {p.status === 'verified' ? 'Verificado' : p.status === 'pending_verification' ? 'Pendiente' : 'Rechazado'}
                                                </Badge>
                                            </div>
                                        </div>

                                        {voucherImg && (
                                            <div className="flex items-center gap-2 pt-1">
                                                <div 
                                                    onClick={() => setZoomImage(voucherImg)} 
                                                    className="relative group h-12 w-16 rounded-lg overflow-hidden border border-emerald-300 cursor-pointer shadow-sm shrink-0 bg-slate-900"
                                                >
                                                    <img src={voucherImg} alt="Comprobante" className="h-full w-full object-cover" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                                                        <Maximize2 className="h-3.5 w-3.5" />
                                                    </div>
                                                </div>
                                                <span className="text-[8px] font-bold text-slate-400 uppercase">Ver voucher ampliado</span>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60">
                                            <Button
                                                type="button"
                                                onClick={() => generatePaymentReceiptPDF({
                                                    payment: p,
                                                    allPayments: orderPayments || [],
                                                    order,
                                                    companyProfile: companyProfile || undefined,
                                                    bcvRate: globalSettings?.bcvRate || 65.50,
                                                    paymentIndex: idx + 1
                                                })}
                                                className="h-7 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[8px] font-black uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm"
                                            >
                                                <Printer className="h-3 w-3 text-emerald-400" /> Recibo PDF
                                            </Button>

                                            <Button
                                                type="button"
                                                onClick={() => {
                                                    const cleanPhone = (order.customerPhone || customerData?.phone || '').replace(/[^0-9]/g, '');
                                                    const receiptCode = `#REC-${(order.id || '').replace('#','').substring(0,8)}-${idx+1}`;
                                                    const statusStr = pendingDebt <= 0.05 ? 'SOLVENTE (100% Pagado)' : `Saldo pendiente adeudado: $${pendingDebt.toFixed(2)} USD`;
                                                    const text = `Hola *${order.customerName}*! 👋 Se ha generado tu *Recibo Oficial de Pago N° ${receiptCode}* por *$${p.amount?.toFixed(2)} USD* (${p.method}, Ref: ${p.referenceNumber || 'N/A'}) correspondiente al pedido #${order.id}.\n\n📌 Estado de Cuenta: *${statusStr}*.\n\n¡Gracias por tu confianza y preferir Athleticenter Pro! 📦⚽`;
                                                    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
                                                }}
                                                className="h-7 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[8px] font-black uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm"
                                            >
                                                <Send className="h-3 w-3" /> WhatsApp
                                            </Button>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-[10px] font-bold text-slate-400 uppercase text-center py-2 italic">Sin abonos o comprobantes adjuntos.</p>
                        )}
                    </div>

                    {/* BLOQUE DE DOCUMENTOS Y COMUNICACIÓN ORGANIZADO */}
                    <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Documentación y Reportes</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Button 
                                variant="outline" 
                                disabled={isLoadingItems || itemsWithProductData.length === 0 || isExporting} 
                                className="h-10 font-black uppercase tracking-widest text-[9px] border-slate-200 bg-white shadow-sm rounded-xl" 
                                onClick={handleExportNote}
                            >
                                {isExporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Printer className="mr-1 h-4 w-4 text-primary" />} NOTA PDF
                            </Button>

                            <Button 
                                variant="outline" 
                                disabled={isLoadingItems || itemsWithProductData.length === 0} 
                                className="h-10 font-black uppercase tracking-widest text-[9px] border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shadow-sm rounded-xl" 
                                onClick={handleShareWhatsApp}
                            >
                                <MessageSquare className="mr-1 h-4 w-4 text-emerald-600" /> WHATSAPP
                            </Button>
                        </div>

                        {isAdmin && (
                            <Button 
                                variant="outline"
                                onClick={handleGoToBilling} 
                                className="w-full h-9 border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-black uppercase text-[9px] tracking-widest rounded-xl shadow-sm"
                            >
                                <FileText className="mr-1.5 h-3.5 w-3.5 text-blue-600" /> GESTIONAR EN FACTURACIÓN (1-CLIC)
                            </Button>
                        )}
                    </div>

                    {/* ACCIONES ADMINISTRATIVAS Y CRÍTICAS */}
                    {(canCancelDirectly || canRequestCancellation || (isAdmin && onDeleteOrder)) && (
                        <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-2">
                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-rose-500">Gestión de Anulación</p>
                            {(canCancelDirectly || canRequestCancellation) && (
                                <Button 
                                    variant="outline" 
                                    onClick={(e) => { e.preventDefault(); canCancelDirectly ? onCancelOrder() : onRequestCancellation(); }} 
                                    disabled={isCanceling || isRequestingCancellation || isCancellationPending} 
                                    className={cn(
                                        "w-full h-10 border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[9px] tracking-widest rounded-xl shadow-sm",
                                        isCancellationPending && "bg-amber-50 text-amber-600 border-amber-200"
                                    )}
                                >
                                    {isCanceling || isRequestingCancellation ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : isCancellationPending ? <Clock className="mr-1.5 h-4 w-4" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                                    {isCancellationPending ? "ANULACIÓN EN TRÁMITE" : "ANULAR ESTE PEDIDO"}
                                </Button>
                            )}

                            {isAdmin && onDeleteOrder && (
                                <Button 
                                    variant="destructive" 
                                    onClick={(e) => { e.preventDefault(); onDeleteOrder(); }} 
                                    className="w-full h-9 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-[9px] tracking-widest rounded-xl shadow-md flex items-center justify-center gap-1.5"
                                >
                                    <Trash2 className="h-3.5 w-3.5" /> ELIMINAR REGISTRO BD
                                </Button>
                            )}
                        </div>
                    )}
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
