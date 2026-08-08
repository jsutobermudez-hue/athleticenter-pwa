'use client';

import React, { useState, Suspense } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit, serverTimestamp, addDoc, Timestamp, orderBy } from 'firebase/firestore';
import type { PurchaseOrder, Supplier } from '@/lib/definitions';
import { Card, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
    DollarSign
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PurchaseOrderDetailSheet } from './PurchaseOrderDetailSheet';

export const dynamic = 'force-dynamic';

function PurchaseOrdersContent() {
    const router = useRouter();
    const firestore = useFirestore();
    const { toast } = useToast();
    const { profile, isUserLoading } = useUser();
    const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

    React.useEffect(() => {
        if (!isUserLoading && profile && !['superadmin', 'gerencia'].includes(profile.role)) {
            router.replace('/dashboard');
        }
    }, [profile, isUserLoading, router]);

    const posQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(100)) : null), [firestore]);
    const { data: orders, isLoading: isLoadingOrders } = useCollection<PurchaseOrder>(posQuery);

    const suppliersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'suppliers'), limit(50)) : null), [firestore]);
    const { data: suppliers } = useCollection<Supplier>(suppliersQuery);

    const handleCreatePO = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!firestore || !profile) return;
        const formData = new FormData(e.currentTarget);
        const supplierId = formData.get('supplierId') as string;
        if (!supplierId) { toast({ variant: 'destructive', title: "Proveedor requerido" }); return; }

        setIsSubmitting(true);
        try {
            const supplier = suppliers?.find(s => s.id === supplierId);
            const arrivalDate = formData.get('arrival') as string;
            await addDoc(collection(firestore, 'purchaseOrders'), {
                supplierId, supplierName: supplier?.name || 'N/A', 
                originCountry: formData.get('originCountry') as string, originCity: formData.get('originCity') as string,
                transportMode: formData.get('transportMode') as any, status: 'Pendiente', items: [], totalCost: 0,
                estimatedArrival: arrivalDate ? Timestamp.fromDate(new Date(arrivalDate)) : null,
                createdAt: serverTimestamp(), createdBy: profile.id
            });
            toast({ title: "Orden Iniciada" });
            setIsNewDialogOpen(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error de Creación" });
        } finally { setIsSubmitting(false); }
    };

    if (isUserLoading || isLoadingOrders) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-10 pb-32 px-4 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3"><Globe className="h-8 w-8 text-primary" /> Suministros Globales</h1>
                    <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Gestión de Importaciones y Auditoría de Costos.</p>
                </div>
                <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
                    <DialogTrigger asChild><Button className="h-12 px-8 rounded-xl font-black uppercase text-[10px] shadow-xl"><Plus className="mr-2 h-4 w-4" /> Nueva Importación</Button></DialogTrigger>
                    <DialogContent className="sm:max-w-xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden">
                        <DialogHeader className="p-8 bg-slate-50 border-b"><DialogTitle className="text-2xl font-black uppercase tracking-tighter">Plan de Suministro (PO)</DialogTitle></DialogHeader>
                        {!suppliers?.length ? <div className="p-10 text-center"><AlertCircle className="h-12 w-12 mx-auto mb-4" /><Button asChild><Link href="/dashboard/suppliers">Registrar Proveedor</Link></Button></div> : (
                            <form onSubmit={handleCreatePO} className="p-8 space-y-6">
                                <Select name="supplierId" required><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Seleccionar socio..." /></SelectTrigger><SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id!}>{s.name.toUpperCase()}</SelectItem>)}</SelectContent></Select>
                                <div className="grid grid-cols-2 gap-4"><Input name="originCountry" placeholder="País" required /><Input name="originCity" placeholder="Ciudad" required /></div>
                                <div className="grid grid-cols-2 gap-4"><Select name="transportMode" defaultValue="Marítimo"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Marítimo">🚢 MARÍTIMO</SelectItem><SelectItem value="Aéreo">✈️ AÉREO</SelectItem></SelectContent></Select><Input name="arrival" type="date" required /></div>
                                <Button type="submit" disabled={isSubmitting} className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em]">{isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : "Iniciar Suministro"}</Button>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {orders?.map(po => (
                    <Card key={po.id} onClick={() => setSelectedPO(po)} className="cursor-pointer border-none shadow-xl rounded-[2.5rem] overflow-hidden group flex flex-col sm:flex-row">
                        <div className={cn("w-full sm:w-48 p-8 flex flex-col items-center justify-center text-white", po.status === 'Recibido' ? "bg-emerald-600" : "bg-blue-600")}>
                            {po.status === 'Recibido' ? <ShieldCheck className="h-12 w-12" /> : <Ship className="h-12 w-12" />}
                            <p className="text-sm font-black uppercase mt-2">{po.status}</p>
                        </div>
                        <div className="flex-1 p-8 space-y-6">
                            <h3 className="text-xl font-black uppercase tracking-tighter">{po.supplierName}</h3>
                            <div className="grid grid-cols-2 gap-6"><div className="p-4 rounded-2xl bg-slate-50 space-y-1"><p className="text-[8px] font-black uppercase text-slate-400">Items</p><p className="text-sm font-black">{po.items?.length || 0} Modelos</p></div><div className="p-4 rounded-2xl bg-slate-50 space-y-1"><p className="text-[8px] font-black uppercase text-slate-400">Costo</p><p className="text-sm font-black">${(po.totalCost || 0).toLocaleString()}</p></div></div>
                            <Button variant="ghost" size="sm" className="w-full text-[9px] font-black uppercase">Abrir Manifiesto <ArrowRight className="ml-2 h-3.5 w-3.5" /></Button>
                        </div>
                    </Card>
                ))}
            </div>
            <PurchaseOrderDetailSheet order={selectedPO} isOpen={!!selectedPO} onOpenChange={(open) => !open && setSelectedPO(null)} />
        </div>
    );
}

export default function PurchaseOrdersPage() {
    return <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>}><PurchaseOrdersContent /></Suspense>;
}