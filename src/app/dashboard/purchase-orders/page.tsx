'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit, serverTimestamp, addDoc, Timestamp, orderBy, updateDoc, doc } from 'firebase/firestore';
import type { PurchaseOrder, Supplier, SupplierPayment, Product } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
    Globe, 
    Plus, 
    Ship, 
    Plane, 
    Loader2, 
    MapPin, 
    ArrowRight, 
    ShieldCheck, 
    AlertCircle, 
    Package,
    DollarSign,
    Search,
    Filter,
    Calendar,
    Clock,
    X,
    CheckCircle2,
    UploadCloud,
    FileSpreadsheet,
    Zap,
    Scale,
    TrendingUp,
    Building2,
    Sparkles,
    Trash2,
    RefreshCw,
    Send
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PurchaseOrderDetailSheet } from './PurchaseOrderDetailSheet';
import { compareSupplierQuotes, type SupplierQuoteItem } from '@/lib/supplierComparisonEngine';
import { analyzeStaleQuotes, type AlibabaQuote } from '@/lib/alibabaRadarEngine';

export const dynamic = 'force-dynamic';

function parseSafeDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val?.toDate === 'function') {
        try { return val.toDate(); } catch (e) { return null; }
    }
    if (typeof val?.seconds === 'number') {
        return new Date(val.seconds * 1000);
    }
    if (typeof val === 'string' || typeof val === 'number') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function PurchaseOrdersContent() {
    const router = useRouter();
    const firestore = useFirestore();
    const { toast } = useToast();
    const { user, isUserLoading } = useUser();
    const userRole = (user as any)?.role || 'invitado';
    const canManage = true; // Permiso otorgado a la vista de gestión

    const [activeTab, setActiveTab] = useState<'kanban' | 'comparison' | 'radar' | 'scanner'>('kanban');

    // CONSULTAS FIRESTORE
    const poQuery = useMemoFirebase(
      () => (firestore && canManage ? query(collection(firestore, 'purchaseOrders'), limit(100)) : null),
      [firestore, canManage]
    );
    const { data: purchaseOrders, isLoading: isLoadingPO } = useCollection<PurchaseOrder>(poQuery);

    const suppliersQuery = useMemoFirebase(
      () => (firestore && canManage ? query(collection(firestore, 'suppliers'), limit(100)) : null),
      [firestore, canManage]
    );
    const { data: suppliers } = useCollection<Supplier>(suppliersQuery);

    const productsQuery = useMemoFirebase(
      () => (firestore && canManage ? query(collection(firestore, 'products'), limit(1000)) : null),
      [firestore, canManage]
    );
    const { data: catalogProducts } = useCollection<Product>(productsQuery);

    // ESTADO MODAL DETALLE DE ORDEN
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // ESTADO NAVEGACIÓN Y BÚSQUEDA
    const [searchTerm, setSearchTerm] = useState('');

    // ESTADO ESCÁNER AI DE INVOICES
    const [isProcessingInvoice, setIsProcessingInvoice] = useState(false);
    const [scannedInvoiceData, setScannedInvoiceData] = useState<any>(null);

    // ESTADO REGISTRO DE PAGO / ABONO PARCIAL LIBRE
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentPoId, setPaymentPoId] = useState<string>('');
    const [paymentAmountUSD, setPaymentAmountUSD] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'Transferencia SWIFT' | 'Zelle' | 'Binance' | 'Efectivo' | 'Otro'>('Transferencia SWIFT');
    const [paymentNotes, setPaymentNotes] = useState('');

    // ESTADO MATRIZ COMPARATIVA DE PROVEEDORES
    const [comparisonQuotes, setComparisonQuotes] = useState<SupplierQuoteItem[]>([
      {
        id: '1',
        supplierName: 'Guangzhou Sport Goods Co., Ltd.',
        supplierCountry: 'China 🇨🇳',
        supplierRating: 'Gold Supplier 7Y',
        productSku: 'B-M01-FIBA01',
        productName: 'Balón de Baloncesto Molten GL7',
        unitPriceFOB: 14.50,
        moq: 500,
        cbmPerUnit: 0.045,
        estimatedFreightUSD: 1200,
        estimatedCustomsUSD: 450,
        leadTimeDays: 20,
        paymentTerms: '30% T/T, 70% BL',
        quoteDate: '2026-08-10',
        notes: 'Calidad Premium Certificada FIBA.'
      },
      {
        id: '2',
        supplierName: 'Yiwu Athletic Trading Ltd.',
        supplierCountry: 'China 🇨🇳',
        supplierRating: 'Verified Supplier 3Y',
        productSku: 'B-M01-FIBA01',
        productName: 'Balón de Baloncesto Molten GL7',
        unitPriceFOB: 13.80,
        moq: 1000,
        cbmPerUnit: 0.048,
        estimatedFreightUSD: 1400,
        estimatedCustomsUSD: 500,
        leadTimeDays: 30,
        paymentTerms: '100% Contado',
        quoteDate: '2026-08-12',
        notes: 'Requiere pedido mínimo mayor pero FOB más bajo.'
      }
    ]);

    // ESTADO RADAR ALIBABA DE COTIZACIONES
    const [alibabaQuotes, setAlibabaQuotes] = useState<AlibabaQuote[]>([
      {
        id: 'q1',
        supplierName: 'Ningbo Sport Equipment Co.',
        productName: 'Balón de Fútbol Penalty Campo Talla 5',
        quotedUnitPriceUSD: 11.20,
        moq: 300,
        quoteDate: '2026-08-11',
        status: 'Inquiry',
        notes: 'Esperando confirmación de empaque por caja.'
      },
      {
        id: 'q2',
        supplierName: 'Shenzhen Fitness Tech',
        productName: 'Guantes de Portero Profesional Penalty',
        quotedUnitPriceUSD: 9.50,
        moq: 200,
        quoteDate: '2026-08-08',
        status: 'Sample_Ordered',
        notes: 'Muestra enviada por DHL, pendiente tracking.'
      }
    ]);

    // CÁLCULOS DEL MOTOR DE COMPARACIÓN AI
    const comparisonReport = useMemo(() => {
      return compareSupplierQuotes(comparisonQuotes, 500, 36.5);
    }, [comparisonQuotes]);

    // CÁLCULOS DEL RADAR DE COTIZACIONES OLVIDADAS
    const staleQuoteAlerts = useMemo(() => {
      return analyzeStaleQuotes(alibabaQuotes, 3, 5);
    }, [alibabaQuotes]);

    // FILTRADO DE ÓRDENES
    const filteredOrders = useMemo(() => {
      if (!purchaseOrders) return [];
      const term = searchTerm.toLowerCase().trim();
      if (!term) return purchaseOrders;
      return purchaseOrders.filter(po =>
        po.supplierName.toLowerCase().includes(term) ||
        (po.trackingNumber || '').toLowerCase().includes(term) ||
        (po.blNumber || '').toLowerCase().includes(term)
      );
    }, [purchaseOrders, searchTerm]);

    // CÁLCULO DE CAMBIO DE ETAPA EN EL KANBAN
    const handleUpdateStage = async (poId: string, newStage: PurchaseOrder['status']) => {
      if (!firestore) return;
      try {
        const docRef = doc(firestore, 'purchaseOrders', poId);
        await updateDoc(docRef, { status: newStage });
        toast({ title: 'Etapa Logística Actualizada', description: `La importación avanzó a: ${newStage}` });
      } catch (err) {
        console.error('Error actualizando etapa:', err);
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudo actualizar la etapa.' });
      }
    };

    // PROCESAMIENTO MULTIMODAL DE INVOICES AI
    const handleFileUploadInvoice = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsProcessingInvoice(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/process-import-invoice', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          setScannedInvoiceData(data.data);
          toast({ title: 'Invoice Procesada por Gemini AI 🤖', description: `Se extrajeron ${data.data.items?.length || 0} ítems de ${data.data.supplierName || 'Proveedor'}.` });
        } else {
          toast({ variant: 'destructive', title: 'Error en Análisis', description: data.error });
        }
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Error', description: err.message || 'Error analizando Invoice.' });
      } finally {
        setIsProcessingInvoice(false);
      }
    };

    // REGISTRO DE ABONO LIBRE A PROVEEDOR
    const handleAddPayment = async (e: React.FormEvent) => {
      e.preventDefault();
      const amount = parseFloat(paymentAmountUSD);
      if (!paymentPoId || isNaN(amount) || amount <= 0) {
        toast({ variant: 'destructive', title: 'Datos Inválidos', description: 'Ingresa un monto válido.' });
        return;
      }
      if (!firestore) return;

      const po = purchaseOrders?.find(p => p.id === paymentPoId);
      if (!po) return;

      const newPayment: SupplierPayment = {
        id: `pay-${Date.now()}`,
        amountUSD: amount,
        date: new Date().toISOString().split('T')[0],
        paymentMethod,
        notes: paymentNotes
      };

      const updatedPayments = [...(po.paymentsList || []), newPayment];
      const newTotalPaid = (po.totalPaidUSD || 0) + amount;
      const newPendingBalance = Math.max(0, po.totalCost - newTotalPaid);

      try {
        const docRef = doc(firestore, 'purchaseOrders', paymentPoId);
        await updateDoc(docRef, {
          paymentsList: updatedPayments,
          totalPaidUSD: newTotalPaid,
          pendingBalanceUSD: newPendingBalance
        });
        setIsPaymentModalOpen(false);
        setPaymentAmountUSD('');
        setPaymentNotes('');
        toast({ title: 'Abono Registrado', description: `Se registró abono de $${amount.toFixed(2)} USD a ${po.supplierName}.` });
      } catch (err) {
        console.error('Error guardando abono:', err);
      }
    };

    if (isUserLoading || isLoadingPO) {
      return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;
    }

    if (!canManage) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center bg-slate-900 text-white rounded-[2.5rem] my-10 mx-4">
          <ShieldCheck className="h-16 w-16 text-rose-500" />
          <h1 className="text-2xl font-black uppercase tracking-tight">Acceso Exclusivo a Importaciones & Procura</h1>
          <p className="text-slate-400 text-xs max-w-md">El módulo de importaciones está resguardado para la Alta Gerencia y Administración Logística.</p>
          <Button onClick={() => router.push('/dashboard')} className="h-12 px-8 rounded-xl bg-white text-slate-900 font-black uppercase text-[10px]">Volver al Inicio</Button>
        </div>
      );
    }

    return (
      <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
        {/* CABECERA CORPORATIVA */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3">
              <Globe className="h-8 w-8 text-primary" /> Suite de Importaciones & Procura Internacional PRO
            </h1>
            <p className="text-muted-foreground text-[10px] sm:text-xs font-black italic uppercase tracking-[0.3em] opacity-60 mt-1">
              Kanban Logístico, Ingesta Multimodal AI de Invoices, Radar de Cotizaciones y Matriz de Decisión.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setIsPaymentModalOpen(true)} className="h-11 px-5 rounded-xl border-slate-200 font-black text-xs uppercase shadow-sm">
              <DollarSign className="h-4 w-4 mr-2 text-emerald-600" /> Registrar Abono
            </Button>
            <Button onClick={() => router.push('/dashboard/suppliers')} className="h-11 px-6 rounded-xl bg-slate-900 text-white font-black text-xs uppercase shadow-md">
              <Building2 className="h-4 w-4 mr-2" /> Proveedores
            </Button>
          </div>
        </header>

        {/* PESTAÑAS PRINCIPALES DE LA SUITE */}
        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full space-y-6">
          <TabsList className="bg-slate-200/60 p-1.5 rounded-2xl grid grid-cols-2 md:grid-cols-4 gap-2 h-auto">
            <TabsTrigger value="kanban" className="rounded-xl text-[10px] font-black uppercase py-3 data-[state=active]:bg-slate-900 data-[state=active]:text-white shadow-sm">
              <Ship className="h-4 w-4 mr-2 text-primary" /> Pipeline Logístico (Kanban)
            </TabsTrigger>
            <TabsTrigger value="comparison" className="rounded-xl text-[10px] font-black uppercase py-3 data-[state=active]:bg-slate-900 data-[state=active]:text-white shadow-sm">
              <Scale className="h-4 w-4 mr-2 text-amber-400" /> Matriz Comparativa (AI Copilot)
            </TabsTrigger>
            <TabsTrigger value="radar" className="rounded-xl text-[10px] font-black uppercase py-3 data-[state=active]:bg-slate-900 data-[state=active]:text-white shadow-sm relative">
              <Sparkles className="h-4 w-4 mr-2 text-purple-400" /> Radar Alibaba
              {staleQuoteAlerts.length > 0 && (
                <Badge className="ml-2 bg-rose-500 text-white text-[8px] font-mono px-1.5 py-0">{staleQuoteAlerts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="scanner" className="rounded-xl text-[10px] font-black uppercase py-3 data-[state=active]:bg-slate-900 data-[state=active]:text-white shadow-sm">
              <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-400" /> Escáner AI de Invoices
            </TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------------------------------------- */}
          {/* PESTAÑA 1: KANBAN LOGÍSTICO Y PIPELINE DE IMPORTACIONES */}
          {/* -------------------------------------------------------------------------------- */}
          <TabsContent value="kanban" className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {[
                { stage: 'Cotizando/Alibaba', label: '💬 Cotizando / Alibaba', color: 'border-purple-200 bg-purple-50/20' },
                { stage: 'En Fabricación', label: '⚙️ En Fabricación', color: 'border-blue-200 bg-blue-50/20' },
                { stage: 'En Tránsito', label: '🚢 Zarpó / En Tránsito', color: 'border-amber-200 bg-amber-50/20' },
                { stage: 'Aduana', label: '🛃 En Aduana / Puerto', color: 'border-orange-200 bg-orange-50/20' },
                { stage: 'Recibido', label: '📦 Recibido en Almacén', color: 'border-emerald-200 bg-emerald-50/20' },
              ].map(col => {
                const stageOrders = filteredOrders.filter(po => po.status === col.stage || (col.stage === 'En Tránsito' && po.status === 'Pendiente'));

                return (
                  <Card key={col.stage} className={cn("border-2 shadow-lg rounded-[2rem] overflow-hidden flex flex-col min-h-[500px]", col.color)}>
                    <CardHeader className="py-4 px-5 border-b bg-white/60 flex flex-row items-center justify-between">
                      <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-900">{col.label}</CardTitle>
                      <Badge className="bg-slate-900 text-white font-mono text-[9px] px-2 py-0.5">{stageOrders.length}</Badge>
                    </CardHeader>
                    <CardContent className="p-3 space-y-3 flex-1 overflow-y-auto">
                      {stageOrders.map(po => {
                        const totalPaid = po.totalPaidUSD || 0;
                        const progressPct = po.totalCost > 0 ? Math.min(100, Math.round((totalPaid / po.totalCost) * 100)) : 0;

                        return (
                          <Card key={po.id} className="border-none shadow-md rounded-2xl bg-white p-4 space-y-3 hover:shadow-xl transition-all">
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="font-black text-xs uppercase text-slate-900">{po.supplierName}</h4>
                                <p className="text-[8px] font-mono text-slate-400">Origen: {po.originCountry || 'China'}</p>
                              </div>
                              <Badge variant="outline" className="text-[7px] font-mono border-slate-200 text-slate-600">{po.transportMode || 'Marítimo'}</Badge>
                            </div>

                            <div className="space-y-1">
                              <div className="flex justify-between text-[9px] font-black font-mono">
                                <span>Inversión Total:</span>
                                <span className="text-emerald-700">${po.totalCost?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="flex justify-between text-[8px] font-mono text-slate-500">
                                <span>Pagado: ${totalPaid.toFixed(2)}</span>
                                <span>Saldo: ${po.pendingBalanceUSD?.toFixed(2) || (po.totalCost - totalPaid).toFixed(2)}</span>
                              </div>
                              <Progress value={progressPct} className="h-1.5 bg-slate-100" />
                            </div>

                            {/* SELECTOR DE AVANCE RÁPIDO DE ETAPA */}
                            <div className="pt-2 border-t flex items-center justify-between">
                              <span className="text-[8px] font-black uppercase text-slate-400">Avanzar a:</span>
                              <Select value={po.status} onValueChange={(val: any) => handleUpdateStage(po.id!, val)}>
                                <SelectTrigger className="h-7 text-[8px] font-bold uppercase rounded-xl border-slate-200 w-28"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Cotizando/Alibaba" className="text-[9px] font-bold">💬 Cotizando</SelectItem>
                                  <SelectItem value="En Fabricación" className="text-[9px] font-bold">⚙️ Fabricación</SelectItem>
                                  <SelectItem value="En Tránsito" className="text-[9px] font-bold">🚢 Zarpó</SelectItem>
                                  <SelectItem value="Aduana" className="text-[9px] font-bold">🛃 Aduana</SelectItem>
                                  <SelectItem value="Recibido" className="text-[9px] font-bold">📦 Recibido</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </Card>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* -------------------------------------------------------------------------------- */}
          {/* PESTAÑA 2: MATRIZ COMPARATIVA DE PROVEEDORES & AI DECISION COPILOT */}
          {/* -------------------------------------------------------------------------------- */}
          <TabsContent value="comparison" className="space-y-6">
            {/* TARJETA DE RECOMENDACIÓN DE LA IA (AI DECISION COPILOT) */}
            <Card className="border-none shadow-2xl rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-8 overflow-hidden relative">
              <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 h-64 w-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
              <div className="space-y-4 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-400"><Sparkles className="h-6 w-6" /></div>
                  <div>
                    <Badge className="bg-amber-400 text-slate-950 font-black text-[8px] uppercase tracking-widest px-2.5 py-0.5">Veredicto de Compra AI</Badge>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white mt-0.5">Recomendación Estratégica de Adjudicación</h2>
                  </div>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed max-w-3xl font-medium">
                  {comparisonReport.recommendationReason}
                </p>
                {comparisonReport.savingsVsHighestUSD > 0 && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-black font-mono">
                    <TrendingUp className="h-4 w-4" /> Ahorro Estimado: +${comparisonReport.savingsVsHighestUSD.toFixed(2)} USD frente a la cotización más costosa.
                  </div>
                )}
              </div>
            </Card>

            {/* TABLA COMPARATIVA LADO A LADO */}
            <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
                  <Scale className="h-5 w-5 text-amber-500" /> Matriz Comparativa de Proveedores (Alibaba / Global)
                </CardTitle>
                <Badge variant="outline" className="border-slate-200 text-[8px] font-mono text-slate-500 uppercase">{comparisonQuotes.length} Cotizaciones Evaluadas</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                      <th className="p-4 pl-8">Proveedor / Origen</th>
                      <th className="p-4 text-right">Precio FOB Unit.</th>
                      <th className="p-4 text-center">MoQ (Ped. Mínimo)</th>
                      <th className="p-4 text-right">Flete & Aduana Estim.</th>
                      <th className="p-4 text-right font-bold text-amber-300">Costo Landed Unit ($)</th>
                      <th className="p-4 text-right">Costo Landed (Bs. BCV)</th>
                      <th className="p-4 text-center">Lead Time (Días)</th>
                      <th className="p-4 text-center">Términos Pago</th>
                      <th className="p-4 pr-8 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                    {comparisonReport.results.map((r, idx) => (
                      <tr key={r.quote.id || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 pl-8">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="font-black text-slate-900 uppercase">{r.quote.supplierName}</p>
                              {r.isBestPrice && <Badge className="bg-emerald-500 text-white text-[7px] font-black">🥇 MEJOR PRECIO</Badge>}
                              {r.isFastest && <Badge className="bg-blue-500 text-white text-[7px] font-black">⚡ MÁS RÁPIDO</Badge>}
                            </div>
                            <p className="text-[8px] font-mono text-slate-400">{r.quote.supplierCountry} | {r.quote.supplierRating}</p>
                          </div>
                        </td>

                        <td className="p-4 text-right font-mono font-black text-slate-900">${r.quote.unitPriceFOB.toFixed(2)}</td>
                        <td className="p-4 text-center font-mono">{r.quote.moq} unids</td>
                        <td className="p-4 text-right font-mono text-slate-600">${(r.totalFreight + r.totalCustoms).toFixed(2)}</td>

                        <td className="p-4 text-right font-mono font-black text-amber-700 bg-amber-50/50 text-sm">
                          ${r.unitLandedCostUSD.toFixed(2)}
                        </td>

                        <td className="p-4 text-right font-mono text-slate-600">
                          Bs. {r.unitLandedCostVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                        </td>

                        <td className="p-4 text-center font-mono">{r.quote.leadTimeDays} días</td>
                        <td className="p-4 text-center font-mono text-[9px]">{r.quote.paymentTerms}</td>

                        <td className="p-4 pr-8 text-right">
                          <Button size="sm" className="h-8 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-[8px] uppercase">
                            🏆 Adjudicar Orden
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------------------------- */}
          {/* PESTAÑA 3: RADAR ALIBABA DE COTIZACIONES OLVIDADAS */}
          {/* -------------------------------------------------------------------------------- */}
          <TabsContent value="radar" className="space-y-6">
            <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" /> Radar de Cotizaciones y Muestras de Alibaba
                  </CardTitle>
                  <p className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">Alertas automáticas de cotizaciones o desarrollo de productos sin seguimiento en más de 3 días.</p>
                </div>
                <Badge className="bg-rose-500 text-white font-mono text-[9px]">{staleQuoteAlerts.length} Cotizaciones Estancadas</Badge>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                      <th className="p-4 pl-8">Proveedor / Producto Cotizado</th>
                      <th className="p-4 text-right">Precio Unit. Cotizado</th>
                      <th className="p-4 text-center">Fecha Cotización</th>
                      <th className="p-4 text-center">Días Sin Avance</th>
                      <th className="p-4 text-left">Acción Recomendada AI</th>
                      <th className="p-4 pr-8 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                    {staleQuoteAlerts.map((alt, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 pl-8">
                          <div className="space-y-0.5">
                            <p className="font-black text-slate-900 uppercase">{alt.quote.productName}</p>
                            <p className="text-[8px] font-mono text-slate-400">Proveedor: {alt.quote.supplierName}</p>
                          </div>
                        </td>

                        <td className="p-4 text-right font-mono font-black text-emerald-700">${alt.quote.quotedUnitPriceUSD.toFixed(2)}</td>
                        <td className="p-4 text-center font-mono">{alt.quote.quoteDate}</td>

                        <td className="p-4 text-center">
                          <Badge className={cn("font-mono text-[9px] px-2 py-0.5", alt.severity === 'CRITICAL' ? "bg-rose-500 text-white" : "bg-amber-500 text-white")}>
                            ⚠️ {alt.daysStagnant} días
                          </Badge>
                        </td>

                        <td className="p-4 text-left text-[9px] font-medium text-slate-600 max-w-xs">{alt.recommendedAction}</td>

                        <td className="p-4 pr-8 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-8 px-3 rounded-xl text-[8px] font-black uppercase border-slate-200">
                              <Send className="h-3 w-3 mr-1" /> Contactar
                            </Button>
                            <Button size="sm" className="h-8 px-3 rounded-xl bg-slate-900 text-white text-[8px] font-black uppercase">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Convertir a Orden
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------------------------------------------- */}
          {/* PESTAÑA 4: ESCÁNER AI MULTIMODAL DE INVOICES (EXCEL / PDF / IMAGEN) */}
          {/* -------------------------------------------------------------------------------- */}
          <TabsContent value="scanner" className="space-y-6">
            <Card className="border-none shadow-2xl rounded-[2.5rem] bg-white overflow-hidden p-8">
              <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-[2rem] p-12 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors relative">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileUploadInvoice}
                  disabled={isProcessingInvoice}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20"
                />
                {isProcessingInvoice ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <h3 className="text-base font-black uppercase tracking-tight text-slate-900">Analizando Invoice con Gemini 2.5 Flash...</h3>
                    <p className="text-slate-400 text-xs">Extrayendo Proveedor, Incoterm, Fletes y Matriz de Productos.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-600 shadow-sm"><UploadCloud className="h-10 w-10" /></div>
                    <h3 className="text-base font-black uppercase tracking-tight text-slate-900">Cargar Invoice de Importación (Cualquier Formato)</h3>
                    <p className="text-slate-400 text-xs max-w-md">Arrastra tu factura comercial o lista de empaque en <b>Excel (.xlsx), PDF, Imagen o CSV</b> para emparejamiento automático con el inventario.</p>
                  </div>
                )}
              </div>

              {/* RESULTADOS EXTRAÍDOS DE LA INVOICE */}
              {scannedInvoiceData && (
                <div className="mt-8 space-y-6 animate-in fade-in duration-300">
                  <div className="p-6 rounded-2xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <Badge className="bg-emerald-400 text-slate-950 font-black text-[8px] uppercase">Invoice Analizada con Éxito</Badge>
                      <h3 className="text-xl font-black uppercase tracking-tight mt-1">{scannedInvoiceData.supplierName || 'Proveedor Internacional'}</h3>
                      <p className="text-slate-400 text-xs font-mono">Invoice #: {scannedInvoiceData.invoiceNumber || 'N/A'} | Fecha: {scannedInvoiceData.invoiceDate || 'N/A'} | Incoterm: {scannedInvoiceData.incoterm || 'FOB'}</p>
                    </div>
                    <div className="text-right font-mono">
                      <p className="text-[10px] text-slate-400 uppercase font-black">Flete & Gastos Extra</p>
                      <p className="text-lg font-black text-emerald-400">${((scannedInvoiceData.shippingFreightUSD || 0) + (scannedInvoiceData.customsCostsUSD || 0)).toFixed(2)} USD</p>
                    </div>
                  </div>

                  <table className="w-full text-left border-collapse border rounded-2xl overflow-hidden">
                    <thead>
                      <tr className="bg-slate-100 text-slate-900 text-[9px] font-black uppercase tracking-widest">
                        <th className="p-4 pl-6">SKU / Producto</th>
                        <th className="p-4 text-center">Cantidad</th>
                        <th className="p-4 text-right">Precio Unit. FOB</th>
                        <th className="p-4 text-right font-bold text-emerald-700">Costo Landed Prorrateado</th>
                        <th className="p-4 pr-6 text-right">Acción Inventario</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                      {scannedInvoiceData.items?.map((item: any, idx: number) => {
                        const existingProd = catalogProducts?.find(p => p.sku === item.sku);

                        return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-4 pl-6">
                              <p className="font-black text-slate-900 uppercase">{item.name}</p>
                              <p className="text-[8px] font-mono text-slate-400">SKU: {item.sku}</p>
                            </td>
                            <td className="p-4 text-center font-mono">{item.quantity} unids</td>
                            <td className="p-4 text-right font-mono font-black">${item.unitPriceFOB?.toFixed(2)}</td>
                            <td className="p-4 text-right font-mono font-black text-emerald-700 bg-emerald-50/50">${(item.unitPriceFOB * 1.25).toFixed(2)}</td>
                            <td className="p-4 pr-6 text-right">
                              {existingProd ? (
                                <Badge className="bg-blue-100 text-blue-700 text-[8px] font-black border-none">✅ EXISTENTE EN INVENTARIO</Badge>
                              ) : (
                                <Button size="sm" className="h-8 px-3 rounded-xl bg-primary text-white text-[8px] font-black uppercase">
                                  <Sparkles className="h-3 w-3 mr-1" /> Crear Producto Nuevo
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        {/* MODAL REGISTRO DE ABONO PARCIAL LIBRE */}
        <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
          <DialogContent className="sm:max-w-md rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8">
            <DialogHeader>
              <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" /> Registrar Abono Libre a Proveedor
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Ingresa el pago realizado con su método y comprobante.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAddPayment} className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500">Seleccionar Importación</Label>
                <Select value={paymentPoId} onValueChange={setPaymentPoId}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200 text-xs font-bold uppercase"><SelectValue placeholder="SELECCIONAR ORDEN..." /></SelectTrigger>
                  <SelectContent>
                    {filteredOrders.map(po => (
                      <SelectItem key={po.id} value={po.id!} className="text-xs font-bold uppercase">
                        {po.supplierName} - Total: ${po.totalCost?.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Monto Abonato ($ USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={paymentAmountUSD}
                    onChange={(e) => setPaymentAmountUSD(e.target.value)}
                    className="h-11 rounded-xl text-xs font-bold font-mono border-slate-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-black uppercase text-slate-500">Método de Pago</Label>
                  <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Transferencia SWIFT" className="text-xs font-bold">Transferencia SWIFT</SelectItem>
                      <SelectItem value="Zelle" className="text-xs font-bold">Zelle</SelectItem>
                      <SelectItem value="Binance" className="text-xs font-bold">Binance</SelectItem>
                      <SelectItem value="Efectivo" className="text-xs font-bold">Efectivo</SelectItem>
                      <SelectItem value="Otro" className="text-xs font-bold">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500">Notas / Referencia de Pago</Label>
                <Input
                  placeholder="Eje: Ref SWIFT #98218171"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="h-11 rounded-xl text-xs font-bold border-slate-200"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="submit" className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase shadow-lg">
                  Guardar Abono en Expediente
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
}

export default function PurchaseOrdersPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <PurchaseOrdersContent />
        </Suspense>
    );
}