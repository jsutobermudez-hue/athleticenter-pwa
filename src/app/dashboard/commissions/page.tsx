
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
    Briefcase
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

function WalletCard({ title, value, subtitle, icon: Icon, colorClass }: { title: string; value: number; subtitle: string; icon: any; colorClass: string }) {
    return (
        <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden group relative">
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{title}</p>
                    <div className={cn("p-2.5 rounded-xl transition-transform group-hover:rotate-12", colorClass)}>
                        <Icon className="h-4 w-4" />
                    </div>
                </div>
                <h3 className="text-3xl font-black tracking-tighter text-slate-900">${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
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
    const [statusFilter, setStatusFilter] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
    const [typeFilter, setTypeFilter] = useState<'todos' | 'vendedor' | 'gerencia'>('todos');
    const [beneficiaryFilter, setBeneficiaryFilter] = useState<string>('todos');
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    // Settings editing state
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

    // Helper: date filtering
    const isCommissionInDateRange = (c: Commission) => {
        if (!dateRange?.from) return true;
        const start = startOfDay(dateRange.from).getTime();
        const end = (dateRange.to || dateRange.from).getTime() + 86400000;
        const d = c.commissionDate instanceof Timestamp ? c.commissionDate.toMillis() : (c.createdAt ? new Date(c.createdAt as any).getTime() : 0);
        return d >= start && d <= end;
    };

    // My Personal Wallet Stats
    const personalStats = useMemo(() => {
        if (!allOrders || !rawCommissions || !currentUser) return { available: 0, managerAccumulated: 0, pipeline: 0, totalPaid: 0 };
        
        let available = 0;
        let managerAccumulated = 0;
        let pipeline = 0;
        let totalPaid = 0;

        rawCommissions.forEach(c => {
            const isMine = c.salespersonId === currentUser.id || (isExecutive && c.commissionType === 'gerencia');
            if (!isMine) return;
            if (!isCommissionInDateRange(c)) return;

            const commAmount = c.salespersonCommissionAmount || 0;

            if (c.commissionType === 'gerencia') {
                managerAccumulated += commAmount;
            }

            if (c.status === 'pagado') {
                totalPaid += commAmount;
            } else {
                available += commAmount;
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

        return { available, managerAccumulated, pipeline, totalPaid };
    }, [allOrders, rawCommissions, currentUser, isExecutive, dateRange]);

    // Global Sales Team Performance Stats
    const teamStats = useMemo(() => {
        if (!rawCommissions) return { totalSalesVolume: 0, totalCommissions: 0, totalPaid: 0, totalPending: 0, bySalesperson: new Map<string, { id: string; name: string; salesVolume: number; totalComm: number; pendingComm: number; paidComm: number; count: number; role?: string }>() };

        let totalSalesVolume = 0;
        let totalCommissions = 0;
        let totalPaid = 0;
        let totalPending = 0;
        const bySalesperson = new Map<string, { id: string; name: string; salesVolume: number; totalComm: number; pendingComm: number; paidComm: number; count: number; role?: string }>();

        rawCommissions.forEach(c => {
            if (!isCommissionInDateRange(c)) return;

            const spId = c.salespersonId || 'GERENCIA_SALES_MANAGER';
            const spName = c.salespersonName || (c.commissionType === 'gerencia' ? 'Gerencia de Ventas (Override 5%)' : 'Asesor Desconocido');
            const invoiceAmt = c.invoiceAmount || 0;
            const commAmt = c.salespersonCommissionAmount || 0;

            totalSalesVolume += invoiceAmt;
            totalCommissions += commAmt;

            if (c.status === 'pagado') {
                totalPaid += commAmt;
            } else {
                totalPending += commAmt;
            }

            const current = bySalesperson.get(spId) || { id: spId, name: spName, salesVolume: 0, totalComm: 0, pendingComm: 0, paidComm: 0, count: 0 };
            current.salesVolume += invoiceAmt;
            current.totalComm += commAmt;
            current.count += 1;

            if (c.status === 'pagado') {
                current.paidComm += commAmt;
            } else {
                current.pendingComm += commAmt;
            }

            bySalesperson.set(spId, current);
        });

        return { totalSalesVolume, totalCommissions, totalPaid, totalPending, bySalesperson };
    }, [rawCommissions, dateRange]);

    // Filtered commissions for Tab 1 (My Wallet)
    const myFilteredCommissions = useMemo(() => {
        if (!rawCommissions || !currentUser) return [];
        let items = rawCommissions.filter(c => c.salespersonId === currentUser.id || (isExecutive && c.commissionType === 'gerencia'));

        if (statusFilter !== 'todos') items = items.filter(c => (c.status || 'pendiente') === statusFilter);
        if (typeFilter !== 'todos') items = items.filter(c => (c.commissionType || 'vendedor') === typeFilter);
        if (dateRange?.from) {
            items = items.filter(isCommissionInDateRange);
        }

        return items.sort((a, b) => {
            const timeA = a.commissionDate instanceof Timestamp ? a.commissionDate.toMillis() : 0;
            const timeB = b.commissionDate instanceof Timestamp ? b.commissionDate.toMillis() : 0;
            return timeB - timeA;
        });
    }, [rawCommissions, currentUser, isExecutive, statusFilter, typeFilter, dateRange]);

    // Filtered commissions for Tab 3 (Liquidación Hub)
    const adminLiquidationCommissions = useMemo(() => {
        if (!rawCommissions) return [];
        let items = [...rawCommissions];

        if (statusFilter !== 'todos') items = items.filter(c => (c.status || 'pendiente') === statusFilter);
        if (typeFilter !== 'todos') items = items.filter(c => (c.commissionType || 'vendedor') === typeFilter);
        if (beneficiaryFilter !== 'todos') items = items.filter(c => c.salespersonId === beneficiaryFilter);
        if (dateRange?.from) {
            items = items.filter(isCommissionInDateRange);
        }

        return items.sort((a, b) => {
            const timeA = a.commissionDate instanceof Timestamp ? a.commissionDate.toMillis() : 0;
            const timeB = b.commissionDate instanceof Timestamp ? b.commissionDate.toMillis() : 0;
            return timeB - timeA;
        });
    }, [rawCommissions, statusFilter, typeFilter, beneficiaryFilter, dateRange]);

    // Batch liquidation handler
    const handleBatchPayCommissions = async () => {
        if (!firestore || selectedCommissions.size === 0) return;
        setIsLiquidating(true);
        try {
            const batch = writeBatch(firestore);
            const selectedList = rawCommissions?.filter(c => selectedCommissions.has(c.id)) || [];
            
            selectedList.forEach(c => {
                const cRef = doc(firestore, 'commissions', c.id);
                batch.update(cRef, { 
                    status: 'pagado', 
                    paidAt: serverTimestamp(), 
                    paymentReference: paymentReference || `LIQ-${Date.now().toString().slice(-6)}` 
                });
            });

            await batch.commit();

            toast({ title: "¡Comisiones Liquidadas Exitosamente!", description: `${selectedList.length} comisiones marcadas como pagadas.` });

            // Group by salesperson/beneficiary to generate receipts and send WhatsApp
            const spGroups = new Map<string, Commission[]>();
            selectedList.forEach(c => {
                const spKey = c.salespersonId || 'GERENCIA_SALES_MANAGER';
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
                            beneficiaryUser = { id: spId, name: comms[0]?.salespersonName || 'Asesor Comercial', role: 'ventas', email: '' } as User;
                        }
                    }

                    if (beneficiaryUser) {
                        const pdfBase64 = await generateCommissionReceiptPDF(
                            beneficiaryUser,
                            comms,
                            paymentReference || `LIQ-${Date.now().toString().slice(-6)}`,
                            companyProfile || undefined,
                            false
                        );

                        const totalAmount = comms.reduce((s, c) => s + (c.salespersonCommissionAmount || 0), 0);
                        const msg = `¡Hola, ${beneficiaryUser.name}! 💵\n\n` +
                          `Se ha procesado la liquidación de tus comisiones por un total de *$${totalAmount.toFixed(2)} USD*.\n\n` +
                          `• Operaciones Liquidadas: ${comms.length}\n` +
                          `• Referencia de Pago: ${paymentReference || 'PROCESADO'}\n\n` +
                          `Adjuntamos tu Recibo Oficial de Comisiones en PDF. ¡Excelente trabajo!`;

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
        return sum + (c?.salespersonCommissionAmount || 0);
    }, 0);

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-6 sm:gap-8 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none italic flex items-center gap-3">
                        <Award className="h-8 w-8 text-primary" />
                        Módulo de Comisiones
                    </h1>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground font-black italic uppercase tracking-[0.3em] opacity-70 mt-1">
                        Gestión multitarea de incentivos sobre recaudo efectivo (CASH).
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="h-10 font-black text-[10px] uppercase border-slate-200 bg-white shadow-sm px-4 rounded-xl">
                                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                                {dateRange?.from ? `${format(dateRange.from, 'dd/MM/yy')} - ${format(dateRange.to || dateRange.from, 'dd/MM/yy')}` : "FILTRAR FECHA"}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden shadow-2xl border-none" align="end">
                            <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                        </PopoverContent>
                    </Popover>
                    {dateRange?.from && (
                        <Button variant="ghost" onClick={() => setDateRange(undefined)} className="h-10 w-10 p-0 rounded-xl text-slate-400 hover:text-slate-900">
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </header>

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
                        <TabsTrigger value="reglas" className="rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-md transition-all flex items-center gap-2">
                            <Settings className="h-4 w-4 text-amber-600" />
                            Reglas y Tasas
                        </TabsTrigger>
                    )}
                </TabsList>

                {/* TAB 1: MI BILLETERA (PERSONAL / GERENCIA) */}
                <TabsContent value="billetera" className="space-y-6 mt-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <WalletCard title="Balance Disponible" value={personalStats.available} subtitle="Verificado pendiente cobro" icon={Wallet} colorClass="bg-blue-50 text-blue-600" />
                        
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
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest">Método</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Base (CASH)</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase tracking-widest">Tasa</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión ($)</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-8">Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {myFilteredCommissions.length > 0 ? myFilteredCommissions.map(c => (
                                        <TableRow key={c.id} className="hover:bg-slate-50/80 transition-colors border-b last:border-none">
                                            <TableCell className="py-4 text-[11px] font-bold text-slate-500 pl-8">
                                                {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yyyy') : '---'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={cn("text-[9px] font-black uppercase tracking-wider rounded-lg px-2 py-0.5 border-none", 
                                                    c.commissionType === 'gerencia' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>
                                                    {c.commissionType === 'gerencia' ? '👔 Gerencia 5%' : '💼 Directa'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-mono text-xs font-black text-primary">{c.orderNumber || `#${c.orderId?.substring(0, 8)}`}</div>
                                                <div className="text-[10px] font-bold text-slate-600 truncate max-w-[180px]">{c.customerName || 'Cliente B2B'}</div>
                                            </TableCell>
                                            <TableCell className="text-xs font-bold text-slate-600 uppercase">{c.paymentMethod || 'CASH'}</TableCell>
                                            <TableCell className="text-right font-black text-slate-900">${(c.invoiceAmount || 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-center font-bold text-slate-500 text-xs">{c.rateApplied ? `${c.rateApplied}%` : '5%'}</TableCell>
                                            <TableCell className="text-right font-black text-emerald-600 text-sm">${(c.salespersonCommissionAmount || 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-center pr-8">
                                                <Badge className={cn("text-[9px] font-black uppercase rounded-lg px-2.5 py-0.5 border-none", 
                                                    c.status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                                    {c.status === 'pagado' ? 'LIQUIDADO' : 'PENDIENTE'}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    )) : (
                                        <TableRow><TableCell colSpan={8} className="h-40 text-center text-slate-400 font-bold italic text-xs uppercase">Sin comisiones registradas en este período.</TableCell></TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* TAB 2: FUERZA DE VENTAS (TEAM PERFORMANCE) */}
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
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-8">Liquidado</TableHead>
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
                                                    <TableCell className="text-right font-black text-emerald-600 pr-8">${sp.paidComm.toFixed(2)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow><TableCell colSpan={6} className="h-32 text-center text-slate-400 font-bold italic text-xs uppercase">Sin actividad registrada en la fuerza de ventas.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* TAB 3: LIQUIDACIÓN DE ADMINISTRACIÓN (PAYOUT HUB) */}
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

                        {/* Batch Liquidation Floating Notification */}
                        {selectedCommissions.size > 0 && (
                            <div className="bg-slate-900 text-white p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xl border border-emerald-500/40 animate-in slide-in-from-top-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl">
                                        <CheckSquare className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black uppercase tracking-wider text-emerald-400">{selectedCommissions.size} Comisiones Seleccionadas</p>
                                        <p className="text-xl font-black tracking-tighter text-white">${selectedTotalAmount.toFixed(2)} USD A LIQUIDAR</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <Input
                                        placeholder="Ref. Banco / Transf N°..."
                                        value={paymentReference}
                                        onChange={(e) => setPaymentReference(e.target.value)}
                                        className="h-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 text-xs font-bold rounded-xl w-full sm:w-64"
                                    />
                                    <Button
                                        onClick={handleBatchPayCommissions}
                                        disabled={isLiquidating}
                                        className="h-10 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider shrink-0 shadow-lg"
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
                                                    checked={selectedCommissions.size > 0 && selectedCommissions.size === adminLiquidationCommissions.filter(c => c.status !== 'pagado').length}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setSelectedCommissions(new Set(adminLiquidationCommissions.filter(c => c.status !== 'pagado').map(c => c.id)));
                                                        } else {
                                                            setSelectedCommissions(new Set());
                                                        }
                                                    }}
                                                />
                                            </TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest py-4">Fecha</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Beneficiario</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase tracking-widest">Pedido / Cliente</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Base CASH</TableHead>
                                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión</TableHead>
                                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest pr-6">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {adminLiquidationCommissions.length > 0 ? adminLiquidationCommissions.map(c => (
                                            <TableRow key={c.id} className="hover:bg-slate-50 transition-colors border-b last:border-none">
                                                <TableCell className="pl-6">
                                                    <Checkbox 
                                                        checked={selectedCommissions.has(c.id)} 
                                                        onCheckedChange={() => {
                                                            const next = new Set(selectedCommissions);
                                                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                                            setSelectedCommissions(next);
                                                        }}
                                                        disabled={c.status === 'pagado'}
                                                    />
                                                </TableCell>
                                                <TableCell className="py-4 text-[11px] font-bold text-slate-500">
                                                    {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yyyy') : '---'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-bold text-xs text-slate-900">{c.salespersonName || 'Asesor Comercial'}</div>
                                                    <Badge className={cn("text-[8px] font-black uppercase px-1.5 py-0 border-none",
                                                        c.commissionType === 'gerencia' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')}>
                                                        {c.commissionType === 'gerencia' ? 'Gerencia Override' : 'Vendedor Directo'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-mono text-xs font-black text-primary">{c.orderNumber || `#${c.orderId?.substring(0, 8)}`}</div>
                                                    <div className="text-[10px] font-bold text-slate-500 truncate max-w-[160px]">{c.customerName || 'Cliente B2B'}</div>
                                                </TableCell>
                                                <TableCell className="text-right font-black text-slate-900">${(c.invoiceAmount || 0).toFixed(2)}</TableCell>
                                                <TableCell className="text-right font-black text-emerald-600 text-sm">${(c.salespersonCommissionAmount || 0).toFixed(2)}</TableCell>
                                                <TableCell className="text-center pr-6">
                                                    <Badge className={cn("text-[9px] font-black uppercase rounded-lg px-2 py-0.5 border-none", 
                                                        c.status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                                                        {c.status === 'pagado' ? 'LIQUIDADO' : 'PENDIENTE'}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={7} className="h-40 text-center text-slate-400 font-bold italic text-xs uppercase">No hay registros de comisión pendientes para auditar.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* TAB 4: REGLAS Y TASAS (FINANCIAL SETTINGS EDITOR) */}
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

