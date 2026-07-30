
'use client';

import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Invoice, Order, OrderStatus, CompanyProfile, Payment, OrderItemClient, OrderItem, Product, Customer } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, Timestamp, query, where, doc, getDocs, limit, getDoc, collectionGroup } from 'firebase/firestore';
import { 
    Loader2, 
    FileWarning, 
    Clock, 
    Download, 
    Receipt, 
    History, 
    Printer, 
    Zap, 
    Info, 
    Wallet,
    Box
} from 'lucide-react';
import { ReportPaymentDialog } from './report-payment-dialog';
import { getInvoiceFromOrder } from '@/lib/billing';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { generateAccountStatementPDF, generateOrderPDF } from '@/lib/pdf-generator';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

function ReprintButton({ order, companyProfile, customer }: { order: Order, companyProfile?: CompanyProfile, customer?: Customer | null }) {
    const firestore = useFirestore();
    const [isPrinting, setIsPrinting] = useState(false);

    const handleReprint = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!firestore) return;
        setIsPrinting(true);
        try {
            const itemsSnap = await getDocs(collection(firestore, `orders/${order.id}/orderItems`));
            const itemDocs = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem));
            
            const fullItems = await Promise.all(itemDocs.map(async (item) => {
                const pSnap = await getDoc(doc(firestore, 'products', item.productId));
                const pData = pSnap.exists() ? pSnap.data() as Product : { name: 'Producto No Encontrado', sku: 'N/A', price: 0 } as any;
                return { ...item, product: pData } as OrderItemClient;
            }));

            generateOrderPDF({
                customerName: order.customerName,
                customerRif: order.customerRif || customer?.rif,
                customerAddress: customer?.address || '',
                orderItems: fullItems,
                salespersonName: order.salespersonName,
                orderId: order.id,
                createdAt: order.orderDate,
                companyProfile: companyProfile || undefined,
                documentType: 'nota'
            });
        } catch (err) {
            console.error("[Reprint] Error:", err);
        } finally {
            setIsPrinting(false);
        }
    };

    return (
        <Button 
            variant="outline" 
            size="sm" 
            onClick={handleReprint} 
            disabled={isPrinting}
            className="h-8 rounded-lg font-black uppercase text-[8px] tracking-widest border-slate-200 hover:bg-slate-50"
        >
            {isPrinting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Printer className="h-3 w-3 mr-1 text-primary" />}
            Reimprimir
        </Button>
    );
}

function LedgerView({ customerId }: { customerId: string }) {
    const firestore = useFirestore();
    
    const ordersQuery = useMemoFirebase(() => query(
        collection(firestore, 'orders'),
        where('customerId', '==', customerId),
        limit(50)
    ), [firestore, customerId]);
    
    const paymentsQuery = useMemoFirebase(() => query(
        collectionGroup(firestore, 'payments'),
        where('status', '==', 'verified'),
        where('registeredBy', '==', customerId), 
        limit(50)
    ), [firestore, customerId]);

    const { data: orders } = useCollection<Order>(ordersQuery);
    const { data: payments } = useCollection<Payment>(paymentsQuery);

    const timeline = useMemo(() => {
        const entries = [
            ...(orders?.map(o => ({ 
                id: o.id, 
                date: (o.orderDate as Timestamp).toDate(), 
                type: 'debit' as const, 
                title: `Cargo: Pedido #${o.id.substring(0,8)}`,
                amount: o.totalAmount,
                status: o.status
            })) || []),
            ...(payments?.map(p => ({ 
                id: p.id, 
                date: (p.paymentDate instanceof Timestamp ? p.paymentDate.toDate() : new Date(p.paymentDate)), 
                type: 'get' as const, 
                title: `Abono: ${p.method} Ref: ${p.referenceNumber}`,
                amount: p.amount,
                status: 'Verificado'
            })) || [])
        ];
        return (entries as any).sort((a: any, b: any) => b.date.getTime() - a.date.getTime());
    }, [orders, payments]);

    return (
        <div className="space-y-4">
            <ScrollArea className="w-full whitespace-nowrap rounded-[2.5rem] border border-slate-100 shadow-xl bg-white">
                <div className="min-w-[800px]">
                    <Table>
                        <TableHeader className="bg-slate-900">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="text-[9px] font-black uppercase py-5 pl-8 text-white">Fecha</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-white">Detalle</TableHead>
                                <TableHead className="text-right text-[9px] font-black uppercase text-white">Monto</TableHead>
                                <TableHead className="text-center text-[9px] font-black uppercase pr-8 text-white">Tipo</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {timeline.length > 0 ? timeline.map((entry: any, idx: number) => (
                                <TableRow key={`${entry.id}-${idx}`} className="hover:bg-slate-50 border-b last:border-none">
                                    <TableCell className="py-5 pl-8 text-[10px] font-bold text-slate-500">
                                        {format(entry.date, "dd/MM/yyyy")}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black uppercase text-slate-800 leading-none">{entry.title}</span>
                                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-1.5">{entry.status}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-black text-sm text-slate-900">
                                        ${entry.amount.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-center pr-8">
                                        <Badge className={cn(
                                            "text-[8px] font-black uppercase border-none px-2 h-5 shadow-none",
                                            entry.type === 'debit' ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                                        )}>
                                            {entry.type === 'debit' ? 'CARGO' : 'ABONO'}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow><TableCell colSpan={4} className="h-40 text-center opacity-30 italic text-[10px] font-black uppercase">Sin movimientos.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                <ScrollBar orientation="horizontal" className="bg-slate-50 h-3" />
            </ScrollArea>
        </div>
    );
}

export function ClientBillingView() {
  const firestore = useFirestore();
  const { user, profile, customerProfile, isUserLoading } = useUser();
  const { toast } = useToast();
  
  const ordersCollection = useMemoFirebase(() => {
    if (!user || !profile || !firestore) return null;
    const targetId = profile.associatedCustomerId || user.uid;
    return query(collection(firestore, 'orders'), where('customerId', '==', targetId));
  }, [firestore, user, profile]);

  const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersCollection);

  const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);
  
  const isLoading = isUserLoading || isLoadingOrders;

  const combinedInvoices = useMemo(() => {
    if (!allOrders) return [];
    
    const baseStatuses: OrderStatus[] = ['Entregado', 'En Verificación', 'Pagado'];
    return allOrders
        .filter(o => baseStatuses.includes(o.status))
        .map(getInvoiceFromOrder)
        .filter(Boolean) as Invoice[];
  }, [allOrders]);
  
  const stats = useMemo(() => {
    if (!combinedInvoices) return { porVencer: 0, vencido: 0, enVerificacion: 0, recaudado: 0 };
    return combinedInvoices.reduce((acc, invoice) => {
      if (invoice.status === 'Por Vencer') acc.porVencer += invoice.remainingBalance;
      if (invoice.status === 'Vencido') acc.vencido += invoice.remainingBalance;
      if (invoice.status === 'En Verificación') acc.enVerificacion += invoice.remainingBalance;
      if (invoice.status === 'Pagado') acc.recaudado += invoice.amountPaid;
      return acc;
    }, { porVencer: 0, vencido: 0, enVerificacion: 0, recaudado: 0 });
  }, [combinedInvoices]);

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-8 pb-32 px-2 animate-in fade-in-50 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-2">
        <div className="space-y-1">
            <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 italic leading-none">Cuentas por Cobrar</h1>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.4em]">Gestión de crédito corporativo y reporte de abonos.</p>
        </div>
        <div className="flex gap-3">
            <Button onClick={() => customerProfile && generateAccountStatementPDF(customerProfile, combinedInvoices, companyProfile || undefined)} variant="outline" className="h-11 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest bg-white shadow-sm border-slate-200">
                <Download className="mr-2 h-4 w-4" /> Exportar PDF
            </Button>
        </div>
      </header>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 px-2">
            <div className="p-6 rounded-2xl bg-rose-50 border border-rose-100 flex flex-col gap-1">
                <div className="flex justify-between items-center text-rose-400"><p className="text-[9px] font-black uppercase">Mora Crítica</p><FileWarning className="h-4 w-4" /></div>
                <p className="text-2xl font-black text-rose-600 tracking-tighter">${stats.vencido.toFixed(2)}</p>
            </div>
            <div className="p-6 rounded-2xl bg-amber-50 border border-amber-100 flex flex-col gap-1">
                <div className="flex justify-between items-center text-amber-400"><p className="text-[9px] font-black uppercase">Por Vencer</p><Clock className="h-4 w-4" /></div>
                <p className="text-2xl font-black text-amber-600 tracking-tighter">${stats.porVencer.toFixed(2)}</p>
            </div>
            <div className="p-6 rounded-2xl bg-blue-50 border border-blue-100 flex flex-col gap-1">
                <div className="flex justify-between items-center text-blue-400"><p className="text-[9px] font-black uppercase">En Auditoría</p><Zap className="h-4 w-4" /></div>
                <p className="text-2xl font-black text-blue-600 tracking-tighter">${stats.enVerificacion.toFixed(2)}</p>
            </div>
            <div className="p-6 rounded-2xl bg-slate-900 text-white flex flex-col gap-1">
                <div className="flex justify-between items-center text-primary"><p className="text-[9px] font-black uppercase">Crédito en Uso</p><Wallet className="h-4 w-4" /></div>
                <p className="text-2xl font-black tracking-tighter leading-none">${(customerProfile?.creditUsed || 0).toLocaleString()}</p>
            </div>
      </div>
      
      <Tabs defaultValue="invoices" className="w-full">
        <div className="flex items-center justify-between gap-4 mb-8 bg-white/50 p-2 rounded-2xl ring-1 ring-primary/5 mx-2 shadow-sm">
            <TabsList className="bg-slate-100 p-1 rounded-xl h-10 border shadow-inner">
                <TabsTrigger value="invoices" className="rounded-lg font-black uppercase text-[9px] px-8">Facturas</TabsTrigger>
                <TabsTrigger value="ledger" className="rounded-lg font-black uppercase text-[9px] px-8">Movimientos</TabsTrigger>
            </TabsList>
        </div>

        <TabsContent value="invoices" className="mt-0 space-y-6 outline-none">
            <div className="px-2">
                <ScrollArea className="w-full whitespace-nowrap rounded-[2.5rem] border border-slate-100 shadow-xl bg-white">
                    <div className="min-w-[800px]">
                        <Table>
                            <TableHeader className="bg-slate-900">
                                <TableRow className="hover:bg-transparent border-none">
                                    <TableHead className="text-[9px] font-black uppercase py-5 pl-8 text-white">Referencia</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase text-white">Vencimiento</TableHead>
                                    <TableHead className="text-right text-[9px] font-black uppercase text-white">Saldo Pendiente</TableHead>
                                    <TableHead className="text-center text-[9px] font-black uppercase text-white">Estado Cobro</TableHead>
                                    <TableHead className="text-right text-[9px] font-black uppercase pr-8 text-white">Reportar Abono</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {combinedInvoices.length > 0 ? combinedInvoices.map((invoice) => {
                                    const orderForInvoice = allOrders?.find(o => o.id === invoice.id);
                                    const isPaid = (invoice.status as string) === 'paid' || invoice.status === 'Pagado';
                                    
                                    return (
                                        <TableRow key={invoice.id} className="hover:bg-primary/5 transition-colors border-b last:border-none group">
                                            <TableCell className="py-5 pl-8">
                                                <span className="font-mono text-[11px] font-black text-primary">#{invoice.id.substring(0, 8)}</span>
                                            </TableCell>
                                            <TableCell className="text-[10px] font-bold text-slate-500">
                                                {invoice.dueDate instanceof Timestamp ? format(invoice.dueDate.toDate(), 'dd/MM/yyyy') : format(invoice.dueDate as any, 'dd/MM/yyyy')}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className="font-black text-base text-slate-900 tracking-tighter">${invoice.remainingBalance.toFixed(2)}</span>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge className={cn(
                                                    "text-[8px] font-black uppercase border-none px-2.5 h-5 shadow-none",
                                                    isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                                )}>{invoice.statusText}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right pr-8">
                                                <div className="flex items-center justify-end gap-3">
                                                    {isPaid && orderForInvoice ? (
                                                        <ReprintButton order={orderForInvoice} companyProfile={companyProfile || undefined} customer={customerProfile} />
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            <ReportPaymentDialog invoice={invoice} mode="partial" />
                                                            <ReportPaymentDialog invoice={invoice} mode="total" />
                                                        </div>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }) : (
                                    <TableRow><TableCell colSpan={5} className="h-40 text-center opacity-30 italic text-[10px] font-black uppercase">Sin facturas activas.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    <ScrollBar orientation="horizontal" className="bg-slate-50 h-3" />
                </ScrollArea>
            </div>
        </TabsContent>

        <TabsContent value="ledger" className="mt-0 outline-none px-2">
            <LedgerView customerId={profile?.associatedCustomerId || user?.uid || ''} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
