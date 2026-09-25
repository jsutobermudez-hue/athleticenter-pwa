'use client';

import React, { useMemo, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, limit, Timestamp, doc, writeBatch, serverTimestamp, getDoc, setDoc } from 'firebase/firestore';
import type { Commission, User, Order, CompanyProfile, FinancialSettings } from '@/lib/definitions';
import { 
    CalendarIcon, 
    Loader2, 
    DollarSign, 
    Filter, 
    Wallet, 
    TrendingUp, 
    CheckCircle2, 
    X,
    ChevronRight,
    ArrowUpRight,
    Sparkles,
    Landmark,
    Download,
    Receipt,
    FileText,
    Users,
    Settings,
    Award,
    CheckSquare,
    Percent,
    Save,
    UserCheck,
    ShieldCheck,
    Briefcase,
    Search,
    CreditCard,
    Send,
    RefreshCw
} from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { format, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { generateCommissionReceiptPDF } from '@/lib/pdf-generator';
import { createAppNotifications } from '@/lib/notifications';
import { dispatchUniversalWhatsApp } from '@/lib/whatsapp-universal';

export const dynamic = 'force-dynamic';

// --- HELPER NORMALIZADORES DE ESQUEMA DUAL (Schema A & B) ---
function getCommissionAmountUSD(c: Commission): number {
  return c.salespersonCommissionAmount ?? (c as any).commissionAmountUSD ?? 0;
}

function getCommissionAmountBS(c: Commission): number {
  if (typeof (c as any).commissionAmountBS === 'number' && (c as any).commissionAmountBS > 0) {
    return (c as any).commissionAmountBS;
  }
  const amt = getCommissionAmountUSD(c);
  const bcv = (c as any).bcvRate || 36.5;
  return amt * bcv;
}

function getInvoiceAmountUSD(c: Commission): number {
  return c.invoiceAmount ?? (c as any).paymentAmountUSD ?? 0;
}

function getCommissionStatus(c: Commission): 'pendiente' | 'pagado' {
  const st = String(c.status || '').toLowerCase();
  if (st === 'pagado' || st === 'paid') return 'pagado';
  return 'pendiente';
}

function getCommissionType(c: Commission): 'vendedor' | 'gerencia' | 'admin' {
  if (c.commissionType) return c.commissionType;
  const role = (c as any).recipientRole;
  if (role === 'SALES_MANAGER') return 'gerencia';
  if (role === 'ADMIN') return 'admin';
  return 'vendedor';
}

function getPaymentMethod(c: Commission): string {
  return c.paymentMethod || (c as any).method || 'CASH';
}

function getCustomerName(c: Commission): string {
  return c.customerName || (c as any).clientName || 'Cliente B2B';
}

function getSalespersonName(c: Commission): string {
  return c.salespersonName || (c as any).recipientName || 'Asesor Comercial';
}

// Badge estilizado por método de pago
function PaymentMethodBadge({ method }: { method: string }) {
  const m = (method || '').toLowerCase();
  if (m.includes('zelle')) {
    return <Badge className="bg-purple-100 text-purple-900 border-none font-black text-[9px] uppercase px-2 py-0.5">⚡ ZELLE</Badge>;
  }
  if (m.includes('pago móvil') || m.includes('pago movil') || m.includes('bs')) {
    return <Badge className="bg-blue-100 text-blue-900 border-none font-black text-[9px] uppercase px-2 py-0.5">🏦 PAGO MÓVIL (BS)</Badge>;
  }
  if (m.includes('binance') || m.includes('usdt')) {
    return <Badge className="bg-amber-100 text-amber-900 border-none font-black text-[9px] uppercase px-2 py-0.5">🟡 BINANCE (USDT)</Badge>;
  }
  if (m.includes('efectivo') || m.includes('cash')) {
    return <Badge className="bg-emerald-100 text-emerald-900 border-none font-black text-[9px] uppercase px-2 py-0.5">💵 EFECTIVO ($)</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-800 border-none font-black text-[9px] uppercase px-2 py-0.5">💳 {method.toUpperCase()}</Badge>;
}

function WalletCard({ title, value, valueBs, subtitle, icon: Icon, colorClass }: { title: string; value: number; valueBs?: number; subtitle: string; icon: any; colorClass: string }) {
    return (
        <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden group relative">
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-3">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{title}</p>
                    <div className={cn("p-2.5 rounded-xl transition-transform group-hover:rotate-12", colorClass)}>
                        <Icon className="h-4 w-4" />
                    </div>
                </div>
                <h3 className="text-3xl font-black tracking-tighter text-slate-900">${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                {valueBs !== undefined && (
                    <p className="text-[11px] font-black text-blue-600 font-mono mt-0.5">Bs. {(valueBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                )}
                <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">{subtitle}</p>
            </CardContent>
        </Card>
    );
}

function CommissionsContent() {
    const { profile: currentUser, isUserLoading } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState<string>('billetera');
    const [selectedCommissions, setSelectedCommissions] = useState<Set<string>>(new Set());
    const [isLiquidating, setIsLiquidating] = useState(false);
    const [paymentReference, setPaymentReference] = useState('');
    const [treasuryAccount, setTreasuryAccount] = useState<string>('Banesco Panamá / Zelle');
    
    // --- FILTROS DE BÚSQUEDA Y NAVEGACIÓN ---
    const [statusFilter, setStatusFilter] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
    const [typeFilter, setTypeFilter] = useState<'todos' | 'vendedor' | 'gerencia' | 'admin'>('todos');
    const [beneficiaryFilter, setBeneficiaryFilter] = useState<string>('todos');
    const [salespersonFilter, setSalespersonFilter] = useState<string>('todos');
    const [customerSearchInput, setCustomerSearchInput] = useState<string>('');
    const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('todos');
    const [dateQuickFilter, setDateQuickFilter] = useState<'todos' | 'hoy' | 'esta_semana' | 'semana_anterior' | 'este_mes'>('todos');
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    // Configuración global de la empresa
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [salespersonRateInput, setSalespersonRateInput] = useState<string>('5');
    const [managerRateInput, setManagerRateInput] = useState<string>('5');
    const [adminRateInput, setAdminRateInput] = useState<string>('1');

    const isAdminView = useMemo(() => currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role), [currentUser]);
    const isExecutive = useMemo(() => currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role), [currentUser]);
    const isSuperAdminOrAdmin = useMemo(() => currentUser && ['superadmin', 'admin'].includes(currentUser.role), [currentUser]);

    // Financial settings doc query
    const financialRef = useMemoFirebase(() => (firestore ? doc(firestore, 'system', 'financials') : null), [firestore]);
    const { data: globalFinancials } = useDoc<FinancialSettings>(financialRef);

    // Sync state when financials load
    React.useEffect(() => {
        if (globalFinancials) {
            setSalespersonRateInput((globalFinancials.defaultCommission ?? 5).toString());
            setManagerRateInput((globalFinancials.salesManagerCommission ?? 5).toString());
            setAdminRateInput((globalFinancials.adminCommission ?? 1).toString());
        }
    }, [globalFinancials]);

    const ordersQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const base = collection(firestore, 'orders');
        if (!isAdminView) return query(base, where('salespersonId', '==', currentUser.id), limit(1000));
        return query(base, limit(1000));
    }, [firestore, isUserLoading, currentUser, isAdminView]);

    const commissionsQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const base = collection(firestore, 'commissions');
        if (!isAdminView) return query(base, where('salespersonId', '==', currentUser.id), limit(1000));
        return query(base, limit(1000));
    }, [firestore, isUserLoading, currentUser, isAdminView]);

    const usersQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser || !isAdminView) return null;
        return query(collection(firestore, 'users'), limit(500));
    }, [firestore, isUserLoading, currentUser, isAdminView]);

    const { data: rawCommissions, isLoading: isLoadingComms } = useCollection<Commission>(commissionsQuery);
    const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);
    const { data: allUsers } = useCollection<User>(usersQuery);
    const { data: companyProfile } = useDoc<CompanyProfile>(useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]));

    // --- EVALUADOR MULTI-FILTRO INTEGRAL ---
    const matchesAllFilters = (c: Commission) => {
        // 1. Filtro de Fecha (Rápido o Rango)
        const time = c.commissionDate instanceof Timestamp 
            ? c.commissionDate.toMillis() 
            : ((c as any).collectionDate instanceof Timestamp 
                ? (c as any).collectionDate.toMillis() 
                : (c.createdAt ? new Date(c.createdAt as any).getTime() : 0));

        if (dateQuickFilter === 'hoy') {
            const start = startOfDay(new Date()).getTime();
            const end = start + 86400000;
            if (time < start || time > end) return false;
        } else if (dateQuickFilter === 'esta_semana') {
            const now = new Date();
            const dayOfWeek = now.getDay() || 7;
            const startWeek = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1)).getTime();
            if (time < startWeek) return false;
        } else if (dateQuickFilter === 'semana_anterior') {
            const now = new Date();
            const dayOfWeek = now.getDay() || 7;
            const startPrevWeek = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 6)).getTime();
            const endPrevWeek = startPrevWeek + (7 * 86400000);
            if (time < startPrevWeek || time > endPrevWeek) return false;
        } else if (dateQuickFilter === 'este_mes') {
            const now = new Date();
            const startMonth = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).getTime();
            if (time < startMonth) return false;
        } else if (dateRange?.from) {
            const start = startOfDay(dateRange.from).getTime();
            const end = (dateRange.to || dateRange.from).getTime() + 86400000;
            if (time < start || time > end) return false;
        }

        // 2. Filtro por Vendedor
        if (salespersonFilter !== 'todos') {
            const spId = c.salespersonId || (c as any).recipientUserId;
            if (spId !== salespersonFilter) return false;
        }

        // 3. Filtro por Cliente / Pedido
        if (customerSearchInput.trim() !== '') {
            const term = customerSearchInput.toLowerCase().trim();
            const clientName = getCustomerName(c).toLowerCase();
            const orderNum = (c.orderNumber || c.orderId || '').toLowerCase();
            if (!clientName.includes(term) && !orderNum.includes(term)) return false;
        }

        // 4. Filtro por Método de Pago
        if (paymentMethodFilter !== 'todos') {
            const m = getPaymentMethod(c).toLowerCase();
            if (paymentMethodFilter === 'zelle' && !m.includes('zelle')) return false;
            if (paymentMethodFilter === 'pago_movil' && !m.includes('pago') && !m.includes('bs')) return false;
            if (paymentMethodFilter === 'efectivo' && !m.includes('efectivo') && !m.includes('cash')) return false;
            if (paymentMethodFilter === 'binance' && !m.includes('binance') && !m.includes('usdt')) return false;
        }

        return true;
    };

    // My Personal Wallet Stats
    const personalStats = useMemo(() => {
        if (!allOrders || !rawCommissions || !currentUser) return { available: 0, availableBs: 0, managerAccumulated: 0, pipeline: 0, totalPaid: 0 };
        
        let available = 0;
        let availableBs = 0;
        let managerAccumulated = 0;
        let pipeline = 0;
        let totalPaid = 0;

        rawCommissions.forEach(c => {
            const isMine = c.salespersonId === currentUser.id || (c as any).recipientUserId === currentUser.id || (isExecutive && getCommissionType(c) === 'gerencia');
            if (!isMine) return;
            if (!matchesAllFilters(c)) return;

            const commAmount = getCommissionAmountUSD(c);
            const commAmountBs = getCommissionAmountBS(c);
            const st = getCommissionStatus(c);
            const type = getCommissionType(c);

            if (type === 'gerencia') {
                managerAccumulated += commAmount;
            }

            if (st === 'pagado') {
                totalPaid += commAmount;
            } else {
                available += commAmount;
                availableBs += commAmountBs;
            }
        });

        allOrders.forEach(o => {
            const isMine = o.salespersonId === currentUser.id;
            if (!isMine) return;
            const rate = o.salespersonCommissionRate || 0.05;
            if (['Entregado', 'En Verificación', 'Despachado', 'Completado'].includes(o.status)) {
                const pendingBase = (o.totalAmount || 0) - (o.amountPaid || 0);
                if (pendingBase > 0) {
                    pipeline += (pendingBase * 0.65 * rate);
                }
            }
        });

        return { available, availableBs, managerAccumulated, pipeline, totalPaid };
    }, [allOrders, rawCommissions, currentUser, isExecutive, dateRange, dateQuickFilter, salespersonFilter, customerSearchInput, paymentMethodFilter]);

    // Global Sales Team Performance Stats
    const teamStats = useMemo(() => {
        if (!rawCommissions) return { totalSalesVolume: 0, totalCommissions: 0, totalPaid: 0, totalPending: 0, totalPendingBs: 0, bySalesperson: new Map<string, { id: string; name: string; salesVolume: number; totalComm: number; pendingComm: number; paidComm: number; count: number; role?: string }>() };

        let totalSalesVolume = 0;
        let totalCommissions = 0;
        let totalPaid = 0;
        let totalPending = 0;
        let totalPendingBs = 0;
        const bySalesperson = new Map<string, { id: string; name: string; salesVolume: number; totalComm: number; pendingComm: number; paidComm: number; count: number; role?: string }>();

        rawCommissions.forEach(c => {
            if (!matchesAllFilters(c)) return;

            const spId = c.salespersonId || (c as any).recipientUserId || 'GERENCIA_SALES_MANAGER';
            const spName = getSalespersonName(c);
            const invoiceAmt = getInvoiceAmountUSD(c);
            const commAmt = getCommissionAmountUSD(c);
            const commBs = getCommissionAmountBS(c);
            const st = getCommissionStatus(c);

            totalSalesVolume += invoiceAmt;
            totalCommissions += commAmt;

            if (st === 'pagado') {
                totalPaid += commAmt;
            } else {
                totalPending += commAmt;
                totalPendingBs += commBs;
            }

            const current = bySalesperson.get(spId) || { id: spId, name: spName, salesVolume: 0, totalComm: 0, pendingComm: 0, paidComm: 0, count: 0 };
            current.salesVolume += invoiceAmt;
            current.totalComm += commAmt;
            current.count += 1;

            if (st === 'pagado') {
                current.paidComm += commAmt;
            } else {
                current.pendingComm += commAmt;
            }

            bySalesperson.set(spId, current);
        });

        return { totalSalesVolume, totalCommissions, totalPaid, totalPending, totalPendingBs, bySalesperson };
    }, [rawCommissions, dateRange, dateQuickFilter, salespersonFilter, customerSearchInput, paymentMethodFilter]);

    // Filtered commissions for Tab 1 (My Wallet)
    const myFilteredCommissions = useMemo(() => {
        if (!rawCommissions || !currentUser) return [];
        let items = rawCommissions.filter(c => c.salespersonId === currentUser.id || (c as any).recipientUserId === currentUser.id || (isExecutive && getCommissionType(c) === 'gerencia'));

        if (statusFilter !== 'todos') items = items.filter(c => getCommissionStatus(c) === statusFilter);
        if (typeFilter !== 'todos') items = items.filter(c => getCommissionType(c) === typeFilter);
        items = items.filter(matchesAllFilters);

        return items.sort((a, b) => {
            const timeA = a.commissionDate instanceof Timestamp ? a.commissionDate.toMillis() : 0;
            const timeB = b.commissionDate instanceof Timestamp ? b.commissionDate.toMillis() : 0;
            return timeB - timeA;
        });
    }, [rawCommissions, currentUser, isExecutive, statusFilter, typeFilter, dateRange, dateQuickFilter, salespersonFilter, customerSearchInput, paymentMethodFilter]);

    // Filtered commissions for Tab 3 (Liquidación Hub)
    const adminLiquidationCommissions = useMemo(() => {
        if (!rawCommissions) return [];
        let items = [...rawCommissions];

        if (statusFilter !== 'todos') items = items.filter(c => getCommissionStatus(c) === statusFilter);
        if (typeFilter !== 'todos') items = items.filter(c => getCommissionType(c) === typeFilter);
        if (beneficiaryFilter !== 'todos') items = items.filter(c => (c.salespersonId === beneficiaryFilter || (c as any).recipientUserId === beneficiaryFilter));
        items = items.filter(matchesAllFilters);

        return items.sort((a, b) => {
            const timeA = a.commissionDate instanceof Timestamp ? a.commissionDate.toMillis() : 0;
            const timeB = b.commissionDate instanceof Timestamp ? b.commissionDate.toMillis() : 0;
            return timeB - timeA;
        });
    }, [rawCommissions, statusFilter, typeFilter, beneficiaryFilter, dateRange, dateQuickFilter, salespersonFilter, customerSearchInput, paymentMethodFilter]);

    // Filtered commissions for Tab 4 (Fondo Administración)
    const adminPoolCommissions = useMemo(() => {
        if (!rawCommissions) return [];
        return rawCommissions.filter(c => getCommissionType(c) === 'admin' && matchesAllFilters(c));
    }, [rawCommissions, dateRange, dateQuickFilter, salespersonFilter, customerSearchInput, paymentMethodFilter]);

    // Batch liquidation handler
    const handleBatchPayCommissions = async () => {
        if (!firestore || selectedCommissions.size === 0) return;
        setIsLiquidating(true);
        try {
            const batch = writeBatch(firestore);
            const selectedList = rawCommissions?.filter(c => selectedCommissions.has(c.id)) || [];
            const refStr = paymentReference || `LIQ-${Date.now().toString().slice(-6)}`;
            
            selectedList.forEach(c => {
                const cRef = doc(firestore, 'commissions', c.id);
                batch.update(cRef, { 
                    status: 'pagado', 
                    paidAt: serverTimestamp(), 
                    paymentReference: refStr 
                });
            });

            // INTEGRACIÓN AUTOMÁTICA CON TESORERÍA (Registro de Egreso Financiero)
            const totalUSDToPay = selectedList.reduce((s, c) => s + getCommissionAmountUSD(c), 0);
            if (totalUSDToPay > 0) {
                const treasuryRef = doc(collection(firestore, 'treasuryTransactions'));
                batch.set(treasuryRef, {
                    id: treasuryRef.id,
                    type: 'Expense',
                    category: 'Comisiones de Ventas',
                    amountUSD: totalUSDToPay,
                    description: `Pago de Comisiones a Fuerza de Ventas (${selectedList.length} operaciones) - Ref: ${refStr}`,
                    account: treasuryAccount || 'Banesco Panamá / Zelle',
                    referenceNumber: refStr,
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    createdBy: currentUser?.name || 'Administración'
                });
            }

            await batch.commit();

            toast({ title: "¡Comisiones Liquidadas Exitosamente!", description: `${selectedList.length} comisiones pagadas y egreso registrado en Tesorería.` });

            // Group by salesperson/beneficiary to generate receipts and send WhatsApp
            const spGroups = new Map<string, Commission[]>();
            selectedList.forEach(c => {
                const spKey = c.salespersonId || (c as any).recipientUserId || 'GERENCIA_SALES_MANAGER';
                const list = spGroups.get(spKey) || [];
                list.push(c);
                spGroups.set(spKey, list);
            });

            for (const [spId, comms] of spGroups.entries()) {
                try {
                    let beneficiaryUser: User | null = null;
                    if (spId === 'GERENCIA_SALES_MANAGER') {
                        beneficiaryUser = currentUser || { id: 'GERENCIA', name: 'Gerencia de Ventas', role: 'gerencia', email: 'gerencia@athleticenter.com' } as User;
                    } else {
                        const spDoc = await getDoc(doc(firestore, 'users', spId));
                        if (spDoc.exists()) {
                            beneficiaryUser = spDoc.data() as User;
                        } else {
                            beneficiaryUser = { id: spId, name: getSalespersonName(comms[0]), role: 'ventas', email: '' } as User;
                        }
                    }

                    if (beneficiaryUser) {
                        const pdfBase64 = await generateCommissionReceiptPDF(
                            beneficiaryUser,
                            comms,
                            refStr,
                            companyProfile || undefined,
                            false
                        );

                        const totalAmount = comms.reduce((s, c) => s + getCommissionAmountUSD(c), 0);
                        const avgBcv = (comms[0] as any)?.bcvRate || 36.5;
                        const totalBs = totalAmount * avgBcv;

                        const msg = `¡Hola, ${beneficiaryUser.name}! 💵\n\n` +
                          `Se ha procesado exitosamente la liquidación de tus comisiones por un total de *$${totalAmount.toFixed(2)} USD* (Equivalente BCV: *Bs. ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}*).\n\n` +
                          `• Operaciones Liquidadas: ${comms.length}\n` +
                          `• Cuenta Origen: ${treasuryAccount}\n` +
                          `• Referencia de Pago: ${refStr}\n\n` +
                          `Adjuntamos tu Recibo Oficial de Comisiones en PDF. ¡Excelente gestión comercial!`;

                        const targetPhone = beneficiaryUser.phone || currentUser?.phone;
                        if (targetPhone) {
                            dispatchUniversalWhatsApp({
                                phone: targetPhone,
                                message: msg,
                                pdfBase64,
                                fileName: `Recibo_Comisiones_${beneficiaryUser.name.split(' ')[0]}.pdf`,
                                module: 'treasury'
                            }).catch(e => console.warn('[Commission WA] Error:', e));
                        }
                    }
                } catch (err) {
                    console.warn('[Commission WhatsApp Error]', err);
                }
            }

            setSelectedCommissions(new Set());
            setPaymentReference('');
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error en Liquidación', description: e?.message || 'Ocurrió un fallo.' });
        } finally {
            setIsLiquidating(false);
        }
    };

    // Notification broadcast handler via WhatsApp to Salesperson
    const handleSendWhatsAppBalanceAlert = (spId: string, spName: string, amount: number) => {
        const targetUser = allUsers?.find(u => u.id === spId);
        const phone = targetUser?.phone || currentUser?.phone;

        if (!phone) {
            toast({ variant: 'destructive', title: 'Teléfono no configurado', description: `No se encontró número de WhatsApp para ${spName}.` });
            return;
        }

        const msg = `¡Hola, ${spName}! 📈\n\n` +
          `Te informamos que tienes acumulado un balance disponible de comisiones pendientes por cobrar por *$${amount.toFixed(2)} USD*.\n\n` +
          `Puedes consultar el desglose detallado en tu Módulo de Comisiones Athleticenter PRO.`;

        dispatchUniversalWhatsApp({
            phone,
            message: msg,
            module: 'billing'
        });

        toast({ title: "WhatsApp Enviado", description: `Notificación enviada a ${spName}.` });
    };

    // Save rules to system/financials
    const handleSaveFinancialRules = async () => {
        if (!firestore) return;
        setIsSavingSettings(true);
        try {
            const spRate = parseFloat(salespersonRateInput) || 5;
            const mgrRate = parseFloat(managerRateInput) || 5;
            const admRate = parseFloat(adminRateInput) || 1;

            await setDoc(doc(firestore, 'system', 'financials'), {
                defaultCommission: spRate,
                salesManagerCommission: mgrRate,
                adminCommission: admRate,
                updatedAt: serverTimestamp()
            }, { merge: true });

            toast({ title: '¡Reglas Actualizadas!', description: `Tasas guardadas: Vendedores ${spRate}%, Gerencia ${mgrRate}%, Admin ${admRate}%.` });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error al guardar', description: err?.message || 'Error de Firestore' });
        } finally {
            setIsSavingSettings(false);
        }
    };

    if (isUserLoading || isLoadingComms || isLoadingOrders) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;
    }

    const selectedTotalAmount = Array.from(selectedCommissions).reduce((sum, id) => {
        const c = rawCommissions?.find(comm => comm.id === id);
        return sum + (c ? getCommissionAmountUSD(c) : 0);
    }, 0);

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-6 sm:gap-8 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none italic flex items-center gap-3">
                        <Award className="h-8 w-8 text-primary" />
                        Módulo de Comisiones y Liquidaciones
                    </h1>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground font-black italic uppercase tracking-[0.3em] opacity-70 mt-1">
                        Gestión multitarea de incentivos sobre recaudo efectivo (CASH) con discriminación de moneda y método de pago.
                    </p>
                </div>
            </header>

            {/* BARRA DE SUPER-FILTROS DE BÚSQUEDA AVANZADA */}
            <Card className="border-none shadow-sm bg-slate-900 text-white rounded-2xl p-4 sm:p-5">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 flex-1">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Buscar por Cliente o N° Pedido..."
                                value={customerSearchInput}
                                onChange={(e) => setCustomerSearchInput(e.target.value)}
                                className="h-10 pl-9 bg-white/10 border-white/20 text-white placeholder:text-slate-400 text-xs font-bold rounded-xl w-full"
                            />
                        </div>
                        {customerSearchInput && (
                            <Button variant="ghost" onClick={() => setCustomerSearchInput('')} className="h-10 w-10 p-0 text-slate-400 hover:text-white">
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Selector de Fecha Rápida */}
                        <Select value={dateQuickFilter} onValueChange={(v: any) => setDateQuickFilter(v)}>
                            <SelectTrigger className="h-10 w-36 sm:w-44 bg-white/10 border-white/20 text-white text-xs font-bold uppercase rounded-xl">
                                <CalendarIcon className="mr-2 h-3.5 w-3.5 text-amber-400" />
                                <SelectValue placeholder="Período" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos">TODAS LAS FECHAS</SelectItem>
                                <SelectItem value="hoy">📅 HOY</SelectItem>
                                <SelectItem value="esta_semana">📆 ESTA SEMANA</SelectItem>
                                <SelectItem value="semana_anterior">⏳ SEMANA ANTERIOR</SelectItem>
                                <SelectItem value="este_mes">📊 ESTE MES</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Selector de Vendedor */}
                        {isAdminView && (
                            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                                <SelectTrigger className="h-10 w-40 sm:w-48 bg-white/10 border-white/20 text-white text-xs font-bold uppercase rounded-xl">
                                    <Users className="mr-2 h-3.5 w-3.5 text-indigo-400" />
                                    <SelectValue placeholder="Vendedor" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">TODOS LOS VENDEDORES</SelectItem>
                                    {allUsers?.filter(u => ['ventas', 'gerencia', 'admin', 'superadmin'].includes(u.role)).map(u => (
                                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}

                        {/* Selector por Método de Pago */}
                        <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                            <SelectTrigger className="h-10 w-36 sm:w-44 bg-white/10 border-white/20 text-white text-xs font-bold uppercase rounded-xl">
                                <CreditCard className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                                <SelectValue placeholder="Método Pago" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos">TODOS LOS MÉTODOS</SelectItem>
                                <SelectItem value="zelle">⚡ ZELLE</SelectItem>
                                <SelectItem value="pago_movil">🏦 PAGO MÓVIL (BS)</SelectItem>
                                <SelectItem value="efectivo">💵 EFECTIVO ($)</SelectItem>
                                <SelectItem value="binance">🟡 BINANCE (USDT)</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Rango de Fechas Calendario */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="h-10 font-bold text-xs uppercase border-white/20 bg-white/10 text-white hover:bg-white/20 rounded-xl">
                                    <CalendarIcon className="mr-2 h-4 w-4 text-emerald-400" />
                                    {dateRange?.from ? `${format(dateRange.from, 'dd/MM')} - ${format(dateRange.to || dateRange.from, 'dd/MM')}` : "Rango Fecha"}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden shadow-2xl border-none" align="end">
                                <Calendar mode="range" selected={dateRange} onSelect={(r) => { setDateRange(r); setDateQuickFilter('todos'); }} locale={es} />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </Card>

            {/* MAIN NAVIGATION TABS */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-100/80 p-1.5 rounded-2xl gap-1.5 h-auto flex flex-wrap border border-slate-200/60 shadow-inner">
                    <TabsTrigger value="billetera" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-blue-600" />
                        Mi Billetera Personal
                    </TabsTrigger>
                    
                    {isAdminView && (
                        <TabsTrigger value="fuerza_ventas" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                            <Users className="h-4 w-4 text-indigo-600" />
                            Fuerza de Ventas
                        </TabsTrigger>
                    )}

                    {isAdminView && (
                        <TabsTrigger value="liquidacion" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                            <Landmark className="h-4 w-4 text-emerald-600" />
                            Liquidación Administración
                        </TabsTrigger>
                    )}

                    {isSuperAdminOrAdmin && (
                        <TabsTrigger value="fondo_admin" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-purple-600" />
                            Fondo Administración (1%)
                        </TabsTrigger>
                    )}

                    {isSuperAdminOrAdmin && (
                        <TabsTrigger value="reglas" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                            <Settings className="h-4 w-4 text-amber-600" />
                            Reglas y Tasas
                        </TabsTrigger>
                    )}
                </TabsList>

                {/* TAB 1: MI BILLETERA (PERSONAL / GERENCIA) */}
                <TabsContent value="billetera" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <WalletCard title="Balance Disponible ($)" value={personalStats.available} valueBs={personalStats.availableBs} subtitle="Verificado pendiente cobro" icon={Wallet} colorClass="bg-blue-50 text-blue-600" />
                        
                        {isExecutive && (
                            <WalletCard title="Gerencia Acumulado (5%)" value={personalStats.managerAccumulated} subtitle="Override 100% ventas" icon={Briefcase} colorClass="bg-amber-50 text-amber-600" />
                        )}

                        <WalletCard title="Pipeline (En Tránsito)" value={personalStats.pipeline} subtitle="Potencial por cobrar" icon={TrendingUp} colorClass="bg-indigo-50 text-indigo-600" />
                        <WalletCard title="Total Liquidado" value={personalStats.totalPaid} subtitle="Recibido en cuenta" icon={CheckCircle2} colorClass="bg-emerald-50 text-emerald-600" />
                    </div>

                    <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                        <CardHeader className="bg-slate-50/60 border-b py-4 px-6 sm:px-8">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                                        <Receipt className="h-4 w-4 text-primary" />
                                        Mis Comisiones Devengadas
                                    </CardTitle>
                                    <CardDescription className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                        {myFilteredCommissions.length} registros encontrados
                                    </CardDescription>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                    <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                                        <SelectTrigger className="h-9 w-36 sm:w-44 rounded-xl bg-white border-slate-200 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="todos">TODOS LOS ESTADOS</SelectItem>
                                            <SelectItem value="pendiente">PENDIENTES</SelectItem>
                                            <SelectItem value="pagado">LIQUIDADOS</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    {isExecutive && (
                                        <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                                            <SelectTrigger className="h-9 w-36 sm:w-44 rounded-xl bg-white border-slate-200 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="todos">TODOS LOS TIPOS</SelectItem>
                                                <SelectItem value="vendedor">DIRECTA (ASESOR)</SelectItem>
                                                <SelectItem value="gerencia">GERENCIA OVERRIDE</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader className="bg-slate-50">
                                    <TableRow>
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8 py-4">Fecha</TableHead>
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Tipo</TableHead>
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Pedido / Cliente</TableHead>
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Método Cobro</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Base Recaudada</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase tracking-widest">Tasa</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión ($ USD)</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Equiv. (Bs BCV)</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-8">Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {myFilteredCommissions.length > 0 ? myFilteredCommissions.map(c => {
                                        const commUSD = getCommissionAmountUSD(c);
                                        const commBS = getCommissionAmountBS(c);
                                        const baseUSD = getInvoiceAmountUSD(c);
                                        const method = getPaymentMethod(c);
                                        const status = getCommissionStatus(c);
                                        const type = getCommissionType(c);

                                        return (
                                            <TableRow key={c.id} className="hover:bg-slate-50/80 transition-colors border-b last:border-none">
                                                <TableCell className="py-4 text-[11px] font-bold text-slate-500 pl-8">
                                                    {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yyyy') : '---'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={cn("text-[9px] font-black uppercase tracking-wider rounded-lg px-2 py-0.5 border-none", 
                                                        type === 'gerencia' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>
                                                        {type === 'gerencia' ? '👔 Gerencia 5%' : '💼 Directa'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-mono text-xs font-black text-primary">{c.orderNumber || `#${c.orderId?.substring(0, 8)}`}</div>
                                                    <div className="text-[10px] font-bold text-slate-600 truncate max-w-[180px]">{getCustomerName(c)}</div>
                                                </TableCell>
                                                <TableCell><PaymentMethodBadge method={method} /></TableCell>
                                                <TableCell className="text-right font-black text-slate-900">${baseUSD.toFixed(2)}</TableCell>
                                                <TableCell className="text-center font-bold text-slate-500 text-xs">{c.rateApplied || (c as any).commissionPercent || 5}%</TableCell>
                                                <TableCell className="text-right font-black text-emerald-600 text-sm">${commUSD.toFixed(2)}</TableCell>
                                                <TableCell className="text-right font-mono font-bold text-blue-600 text-xs">Bs. {commBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                <TableCell className="text-center pr-8">
                                                    <Badge className={cn("text-[9px] font-black uppercase rounded-lg px-2.5 py-0.5 border-none", 
                                                        status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                                        {status === 'pagado' ? 'LIQUIDADO' : 'PENDIENTE'}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    }) : (
                                        <TableRow><TableCell colSpan={9} className="h-40 text-center text-slate-400 font-bold italic text-xs uppercase">Sin comisiones registradas en este período.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* TAB 2: FUERZA DE VENTAS (TEAM PERFORMANCE & NOTIFICACIONES WHATSAPP) */}
                {isAdminView && (
                    <TabsContent value="fuerza_ventas" className="space-y-6 mt-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Card className="border-none shadow-sm rounded-2xl bg-white p-6">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Recaudo Global (CASH)</p>
                                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-slate-900 mt-2">${teamStats.totalSalesVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">Total abonado por clientes</p>
                            </Card>
                            <Card className="border-none shadow-sm rounded-2xl bg-white p-6">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Comisiones Generadas</p>
                                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-indigo-600 mt-2">${teamStats.totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">Vendedores + Gerencia</p>
                            </Card>
                            <Card className="border-none shadow-sm rounded-2xl bg-white p-6">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Comisiones Liquidadas</p>
                                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-emerald-600 mt-2">${teamStats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">Transferidas en cuenta</p>
                            </Card>
                            <Card className="border-none shadow-sm rounded-2xl bg-slate-900 text-white p-6">
                                <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">Pendiente por Pagar</p>
                                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-white mt-2">${teamStats.totalPending.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                                <p className="text-[11px] font-black text-blue-400 font-mono mt-0.5">Bs. {teamStats.totalPendingBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Por procesar en Tesorería</p>
                            </Card>
                        </div>

                        <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                            <CardHeader className="bg-slate-50/60 border-b py-4 px-6 sm:px-8">
                                <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                                    <Users className="h-4 w-4 text-indigo-600" />
                                    Rendimiento y Contribución por Beneficiario
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0 overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-slate-50">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8 py-4">Beneficiario / Asesor</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest">Operaciones</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Volumen Recaudado</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Total Comisiones</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Pendiente Payout</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Liquidado</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-8">Notificación</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {Array.from(teamStats.bySalesperson.values()).length > 0 ? (
                                            Array.from(teamStats.bySalesperson.values()).map(sp => (
                                                <TableRow key={sp.id} className="hover:bg-slate-50 transition-colors border-b last:border-none">
                                                    <TableCell className="pl-8 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center font-black text-xs shadow-sm", 
                                                                sp.id === 'GERENCIA_SALES_MANAGER' ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-white')}>
                                                                {sp.name.slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <p className="font-black text-xs text-slate-900">{sp.name}</p>
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase">
                                                                    {sp.id === 'GERENCIA_SALES_MANAGER' ? 'Gerencia General & Ventas' : 'Asesor Comercial B2B'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center font-black text-slate-700">{sp.count}</TableCell>
                                                    <TableCell className="text-right font-black text-slate-900">${sp.salesVolume.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-black text-indigo-600">${sp.totalComm.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-black text-amber-600">${sp.pendingComm.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-black text-emerald-600">${sp.paidComm.toFixed(2)}</TableCell>
                                                    <TableCell className="text-center pr-8">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleSendWhatsAppBalanceAlert(sp.id, sp.name, sp.pendingComm)}
                                                            className="h-8 rounded-xl font-bold text-[10px] uppercase border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 flex items-center gap-1.5 mx-auto"
                                                        >
                                                            <Send className="h-3 w-3 text-emerald-600" />
                                                            WhatsApp
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow><TableCell colSpan={7} className="h-32 text-center text-slate-400 font-bold italic text-xs uppercase">Sin actividad registrada en la fuerza de ventas.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* TAB 3: LIQUIDACIÓN DE ADMINISTRACIÓN (PAYOUT HUB & TESORERÍA) */}
                {isAdminView && (
                    <TabsContent value="liquidacion" className="space-y-6 mt-6">
                        {/* Beneficiary Quick Select Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {Array.from(teamStats.bySalesperson.values()).map(sp => (
                                <Card 
                                    key={sp.id}
                                    onClick={() => setBeneficiaryFilter(beneficiaryFilter === sp.id ? 'todos' : sp.id)}
                                    className={cn("border-2 cursor-pointer transition-all rounded-2xl p-5 shadow-sm hover:shadow-md",
                                        beneficiaryFilter === sp.id ? 'border-primary bg-primary/5' : 'border-slate-100 bg-white')}
                                >
                                    <div className="flex justify-between items-start">
                                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider truncate max-w-[140px]">{sp.name}</p>
                                        <Badge className="text-[8px] font-black bg-amber-100 text-amber-800 border-none">PENDIENTE</Badge>
                                    </div>
                                    <h4 className="text-2xl font-black tracking-tighter text-amber-600 mt-2">${sp.pendingComm.toFixed(2)}</h4>
                                    <p className="text-[9px] font-bold text-slate-500 uppercase mt-1">{sp.count} operaciones • Liquidado: ${sp.paidComm.toFixed(2)}</p>
                                </Card>
                            ))}
                        </div>

                        {/* Batch Liquidation Floating Notification Bar with Treasury Integration */}
                        {selectedCommissions.size > 0 && (
                            <div className="bg-slate-900 text-white p-5 rounded-2xl flex flex-col lg:flex-row items-center justify-between gap-4 shadow-2xl border border-emerald-500/40 animate-in slide-in-from-top-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                                        <CheckSquare className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-wider text-emerald-400">{selectedCommissions.size} Comisiones Seleccionadas</p>
                                        <p className="text-xl font-black tracking-tighter text-white">${selectedTotalAmount.toFixed(2)} USD A LIQUIDAR</p>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row items-center gap-2 w-full lg:w-auto">
                                    <Select value={treasuryAccount} onValueChange={setTreasuryAccount}>
                                        <SelectTrigger className="h-10 bg-white/10 border-white/20 text-white text-xs font-bold rounded-xl w-full sm:w-56">
                                            <Landmark className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                                            <SelectValue placeholder="Cuenta Origen" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Banesco Panamá / Zelle">Banesco Panamá / Zelle</SelectItem>
                                            <SelectItem value="Banesco Venezuela (BS)">Banesco Venezuela (Bs.)</SelectItem>
                                            <SelectItem value="Caja Principal USD">Caja Principal USD</SelectItem>
                                            <SelectItem value="Binance Pay USDT">Binance Pay USDT</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <Input
                                        placeholder="Ref. Banco / Transf N°..."
                                        value={paymentReference}
                                        onChange={(e) => setPaymentReference(e.target.value)}
                                        className="h-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 text-xs font-bold rounded-xl w-full sm:w-52"
                                    />
                                    <Button
                                        onClick={handleBatchPayCommissions}
                                        disabled={isLiquidating}
                                        className="h-10 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider shrink-0 shadow-lg w-full sm:w-auto"
                                    >
                                        {isLiquidating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Liquidar & Enviar WhatsApp (PDF)'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                            <CardHeader className="bg-slate-50/60 border-b py-4 px-6 sm:px-8">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div>
                                        <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                                            <Landmark className="h-4 w-4 text-emerald-600" />
                                            Centro de Liquidación Tesorería
                                        </CardTitle>
                                        <CardDescription className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                            Seleccione las comisiones a transferir
                                        </CardDescription>
                                    </div>

                                    <div className="flex gap-2 flex-wrap">
                                        <Select value={beneficiaryFilter} onValueChange={setBeneficiaryFilter}>
                                            <SelectTrigger className="h-9 w-44 rounded-xl bg-white border-slate-200 text-xs font-bold uppercase"><SelectValue placeholder="Beneficiario" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="todos">TODOS LOS BENEFICIARIOS</SelectItem>
                                                {Array.from(teamStats.bySalesperson.values()).map(sp => (
                                                    <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                                            <SelectTrigger className="h-9 w-36 rounded-xl bg-white border-slate-200 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="todos">TODOS LOS ESTADOS</SelectItem>
                                                <SelectItem value="pendiente">SOLO PENDIENTES</SelectItem>
                                                <SelectItem value="pagado">SOLO LIQUIDADOS</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 overflow-x-auto">
                                <Table>
                                    <TableHeader className="bg-slate-50">
                                        <TableRow>
                                            <TableHead className="w-12 pl-6 py-4">
                                                <Checkbox 
                                                    checked={selectedCommissions.size > 0 && selectedCommissions.size === adminLiquidationCommissions.filter(c => getCommissionStatus(c) !== 'pagado').length}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setSelectedCommissions(new Set(adminLiquidationCommissions.filter(c => getCommissionStatus(c) !== 'pagado').map(c => c.id)));
                                                        } else {
                                                            setSelectedCommissions(new Set());
                                                        }
                                                    }}
                                                />
                                            </TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest py-4">Fecha</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Beneficiario</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Pedido / Cliente</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Método Cobro</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Base CASH</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión ($ USD)</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Equiv. (Bs BCV)</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-6">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {adminLiquidationCommissions.length > 0 ? adminLiquidationCommissions.map(c => {
                                            const commUSD = getCommissionAmountUSD(c);
                                            const commBS = getCommissionAmountBS(c);
                                            const baseUSD = getInvoiceAmountUSD(c);
                                            const method = getPaymentMethod(c);
                                            const status = getCommissionStatus(c);
                                            const type = getCommissionType(c);

                                            return (
                                                <TableRow key={c.id} className="hover:bg-slate-50 transition-colors border-b last:border-none">
                                                    <TableCell className="pl-6">
                                                        <Checkbox 
                                                            checked={selectedCommissions.has(c.id)} 
                                                            onCheckedChange={() => {
                                                                const next = new Set(selectedCommissions);
                                                                if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                                                setSelectedCommissions(next);
                                                            }}
                                                            disabled={status === 'pagado'}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="py-4 text-[11px] font-bold text-slate-500">
                                                        {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yyyy') : '---'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-bold text-xs text-slate-900">{getSalespersonName(c)}</div>
                                                        <Badge className={cn("text-[8px] font-black uppercase px-1.5 py-0 border-none",
                                                            type === 'gerencia' ? 'bg-amber-100 text-amber-800' : (type === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700'))}>
                                                            {type === 'gerencia' ? 'Gerencia Override' : (type === 'admin' ? 'Administración' : 'Vendedor Directo')}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-mono text-xs font-black text-primary">{c.orderNumber || `#${c.orderId?.substring(0, 8)}`}</div>
                                                        <div className="text-[10px] font-bold text-slate-500 truncate max-w-[160px]">{getCustomerName(c)}</div>
                                                    </TableCell>
                                                    <TableCell><PaymentMethodBadge method={method} /></TableCell>
                                                    <TableCell className="text-right font-black text-slate-900">${baseUSD.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-black text-emerald-600 text-sm">${commUSD.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-blue-600 text-xs">Bs. {commBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="text-center pr-6">
                                                        <Badge className={cn("text-[9px] font-black uppercase rounded-lg px-2 py-0.5 border-none", 
                                                            status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                                            {status === 'pagado' ? 'LIQUIDADO' : 'PENDIENTE'}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        }) : (
                                            <TableRow><TableCell colSpan={9} className="h-40 text-center text-slate-400 font-bold italic text-xs uppercase">No hay registros de comisión pendientes para auditar.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* TAB 4: FONDO ADMINISTRACIÓN (1%) */}
                {isSuperAdminOrAdmin && (
                    <TabsContent value="fondo_admin" className="space-y-6 mt-6">
                        <Card className="border-none shadow-sm rounded-3xl bg-white p-6 sm:p-8">
                            <CardHeader className="p-0 pb-6 border-b mb-6">
                                <CardTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-3">
                                    <ShieldCheck className="h-6 w-6 text-purple-600" />
                                    Fondo de Administración & Gestión de Cobranza (1%)
                                </CardTitle>
                                <CardDescription className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    Auditoría de reservas destinadas a la gestión administrativa de cobranza sobre la facturación cobrada.
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader className="bg-slate-50">
                                        <TableRow>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest pl-6 py-4">Fecha</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Pedido / Cliente</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Método Cobro</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Base Recaudada</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión Admin (1%)</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Equiv. (Bs BCV)</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-6">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {adminPoolCommissions.length > 0 ? adminPoolCommissions.map(c => {
                                            const commUSD = getCommissionAmountUSD(c);
                                            const commBS = getCommissionAmountBS(c);
                                            const baseUSD = getInvoiceAmountUSD(c);
                                            const method = getPaymentMethod(c);
                                            const status = getCommissionStatus(c);

                                            return (
                                                <TableRow key={c.id} className="hover:bg-slate-50 transition-colors border-b last:border-none">
                                                    <TableCell className="pl-6 py-4 text-[11px] font-bold text-slate-500">
                                                        {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yyyy') : '---'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-mono text-xs font-black text-primary">{c.orderNumber || `#${c.orderId?.substring(0, 8)}`}</div>
                                                        <div className="text-[10px] font-bold text-slate-600 truncate max-w-[180px]">{getCustomerName(c)}</div>
                                                    </TableCell>
                                                    <TableCell><PaymentMethodBadge method={method} /></TableCell>
                                                    <TableCell className="text-right font-black text-slate-900">${baseUSD.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-black text-purple-600 text-sm">${commUSD.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-blue-600 text-xs">Bs. {commBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="text-center pr-6">
                                                        <Badge className={cn("text-[9px] font-black uppercase rounded-lg px-2.5 py-0.5 border-none", 
                                                            status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700')}>
                                                            {status === 'pagado' ? 'ACUMULADO' : 'PENDIENTE'}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        }) : (
                                            <TableRow><TableCell colSpan={7} className="h-32 text-center text-slate-400 font-bold italic text-xs uppercase">Sin comisiones de administración registradas.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* TAB 5: REGLAS Y TASAS (FINANCIAL SETTINGS EDITOR) */}
                {isSuperAdminOrAdmin && (
                    <TabsContent value="reglas" className="space-y-6 mt-6">
                        <Card className="border-none shadow-sm rounded-3xl bg-white p-6 sm:p-8 max-w-3xl mx-auto">
                            <CardHeader className="p-0 pb-6 border-b mb-6">
                                <CardTitle className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-3">
                                    <Settings className="h-6 w-6 text-amber-600" />
                                    Configuración Global de Comisiones
                                </CardTitle>
                                <CardDescription className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    Ajuste las tasas porcentuales calculadas sobre la cobranza de recaudo efectivo (CASH).
                                </CardDescription>
                            </CardHeader>

                            <CardContent className="p-0 space-y-6">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-xs font-black uppercase tracking-wider text-slate-700">Tasa Vendedores (%)</Label>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                step="0.1"
                                                value={salespersonRateInput}
                                                onChange={(e) => setSalespersonRateInput(e.target.value)}
                                                className="h-12 rounded-xl font-black text-lg pr-8"
                                            />
                                            <Percent className="absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold">Comisión sobre venta directa asignada.</p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-xs font-black uppercase tracking-wider text-slate-700">Tasa Gerente Ventas (%)</Label>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                step="0.1"
                                                value={managerRateInput}
                                                onChange={(e) => setManagerRateInput(e.target.value)}
                                                className="h-12 rounded-xl font-black text-lg pr-8"
                                            />
                                            <Percent className="absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold">Override automático sobre el 100% de cobranza global.</p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-xs font-black uppercase tracking-wider text-slate-700">Tasa Administración (%)</Label>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                step="0.1"
                                                value={adminRateInput}
                                                onChange={(e) => setAdminRateInput(e.target.value)}
                                                className="h-12 rounded-xl font-black text-lg pr-8"
                                            />
                                            <Percent className="absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-bold">Fondo de reserva administrativa.</p>
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="p-0 pt-8 border-t mt-8 flex justify-end">
                                <Button
                                    onClick={handleSaveFinancialRules}
                                    disabled={isSavingSettings}
                                    className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-2"
                                >
                                    {isSavingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 text-emerald-400" />}
                                    Guardar Configuración
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}

export default function CommissionsPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <CommissionsContent />
        </Suspense>
    );
}
