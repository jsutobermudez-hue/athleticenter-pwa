
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit, serverTimestamp, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { Supplier } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
    Contact, 
    Search, 
    Plus, 
    ExternalLink, 
    Phone, 
    Mail, 
    Globe, 
    Building2,
    Loader2,
    Truck,
    MapPin,
    Clock,
    DollarSign,
    ShieldCheck,
    Star,
    Sparkles,
    Landmark,
    Trash2,
    Edit,
    Save
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const SUPPLIER_RUBROS = [
    'Balones y Pelotas',
    'Calzado Deportivo',
    'Textil y Uniformes',
    'Equipamiento de Entrenamiento',
    'Electrónica Deportiva',
    'Nutrición y Salud',
    'Accesorios Pro'
];

function SupplierForm({ initialData, onSubmit, isSubmitting }: { initialData?: Partial<Supplier>, onSubmit: (data: any) => void, isSubmitting: boolean }) {
    const [selectedRubros, setSelectedRubros] = useState<string[]>(initialData?.categories || []);

    const toggleRubro = (rubro: string) => {
        setSelectedRubros(prev => 
            prev.includes(rubro) ? prev.filter(r => r !== rubro) : [...prev, rubro]
        );
    };

    const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data = Object.fromEntries(formData.entries());
        onSubmit({ ...data, categories: selectedRubros });
    };

    return (
        <form onSubmit={handleFormSubmit} className="flex flex-col h-full">
            <Tabs defaultValue="identity" className="flex-1">
                <TabsList className="grid w-full grid-cols-3 h-11 bg-muted/20 p-1 rounded-xl mb-6">
                    <TabsTrigger value="identity" className="rounded-lg font-black uppercase text-[9px] tracking-widest">Identidad</TabsTrigger>
                    <TabsTrigger value="logistics" className="rounded-lg font-black uppercase text-[9px] tracking-widest">Logística</TabsTrigger>
                    <TabsTrigger value="finance" className="rounded-lg font-black uppercase text-[9px] tracking-widest">Finanzas</TabsTrigger>
                </TabsList>

                <ScrollArea className="h-[450px] pr-4">
                    <TabsContent value="identity" className="space-y-6 mt-0">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Razón Social</Label><Input name="name" defaultValue={initialData?.name} required className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">RIF / Tax ID</Label><Input name="rif" defaultValue={initialData?.rif} required className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-mono" /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Email Corporativo</Label><Input name="email" type="email" defaultValue={initialData?.email} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Teléfono Máster</Label><Input name="phone" defaultValue={initialData?.phone} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Representante de Cuenta</Label><Input name="contactName" defaultValue={initialData?.contactName} placeholder="Nombre del asesor comercial" className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase text-primary">Rubros de Suministro</Label>
                            <div className="flex flex-wrap gap-2">
                                {SUPPLIER_RUBROS.map(r => (
                                    <Badge 
                                        key={r} 
                                        variant={selectedRubros.includes(r) ? 'default' : 'outline'}
                                        className={cn("cursor-pointer h-7 px-3 text-[9px] font-black uppercase rounded-lg border-primary/20", selectedRubros.includes(r) ? "bg-primary text-white" : "text-slate-400")}
                                        onClick={() => toggleRubro(r)}
                                    >
                                        {r}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="logistics" className="space-y-6 mt-0">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">País de Origen</Label><Input name="country" defaultValue={initialData?.country} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Ciudad / Puerto</Label><Input name="city" defaultValue={initialData?.city} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Vía Preferida</Label>
                                <Select name="preferredTransport" defaultValue={initialData?.preferredTransport || 'Marítimo'}>
                                    <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold uppercase text-[10px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Marítimo" className="font-bold text-[10px] uppercase">🚢 MARÍTIMO</SelectItem>
                                        <SelectItem value="Aéreo" className="font-bold text-[10px] uppercase">✈️ AÉREO</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Lead Time (Días)</Label><Input name="leadTimeDays" type="number" defaultValue={initialData?.leadTimeDays} placeholder="Ej. 45" className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Dirección Física Almacén</Label><Textarea name="address" defaultValue={initialData?.address} className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[100px]" /></div>
                    </TabsContent>

                    <TabsContent value="finance" className="space-y-6 mt-0">
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Términos de Pago (Crédito)</Label><Input name="paymentTerms" defaultValue={initialData?.paymentTerms} placeholder="Ej. 50/50, Crédito 30 días, Prepago..." className="h-11 rounded-xl bg-slate-50 border-none shadow-inner" /></div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Datos Bancarios (Swift / ABA / Account)</Label><Textarea name="bankInfo" defaultValue={initialData?.bankInfo} placeholder="Información para transferencias internacionales..." className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[150px] font-mono text-xs" /></div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Nivel de Confianza (1-5)</Label><Input name="rating" type="number" min="1" max="5" defaultValue={initialData?.rating || 5} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner text-xl font-black text-center" /></div>
                    </TabsContent>
                </ScrollArea>
            </Tabs>

            <DialogFooter className="pt-6 border-t bg-slate-50 px-8 pb-8 -mx-8 -mb-8">
                <Button type="submit" disabled={isSubmitting} className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl text-xs">
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="mr-2 h-4 w-4" />} Sincronizar Expediente
                </Button>
            </DialogFooter>
        </form>
    );
}

export default function SuppliersPage() {
    const router = useRouter();
    const firestore = useFirestore();
    const { toast } = useToast();
    const { profile, isUserLoading } = useUser();
    const [searchTerm, setSearchTerm] = useState('');
    const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isUserLoading && profile && !['superadmin', 'gerencia'].includes(profile.role)) {
            router.replace('/dashboard');
        }
    }, [profile, isUserLoading, router]);

    const suppliersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'suppliers'), limit(100)) : null), [firestore]);
    const { data: suppliers, isLoading: isLoadingSuppliers } = useCollection<Supplier>(suppliersQuery);

    const filteredSuppliers = useMemo(() => {
        if (!suppliers) return [];
        const term = searchTerm.toLowerCase();
        return suppliers.filter(s => s.name.toLowerCase().includes(term) || s.rif.toLowerCase().includes(term));
    }, [suppliers, searchTerm]);

    const handleCreateSupplier = async (formData: any) => {
        if (!firestore || !profile) return;
        setIsSubmitting(true);
        try {
            await addDoc(collection(firestore, 'suppliers'), {
                ...formData,
                status: 'Activo',
                createdAt: serverTimestamp(),
                createdBy: profile.id
            });
            toast({ title: "Proveedor Vinculado", description: "Socio comercial registrado en la red global." });
            setIsNewDialogOpen(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error de Registro", description: error.message || "Fallo al conectar con la nube." });
        } finally { setIsSubmitting(false); }
    };

    const handleUpdateSupplier = async (formData: any) => {
        if (!firestore || !editingSupplier || !profile) return;
        setIsSubmitting(true);
        try {
            await updateDoc(doc(firestore, 'suppliers', editingSupplier.id!), {
                ...formData,
                updatedAt: serverTimestamp(),
                updatedBy: profile.id
            });
            toast({ title: "Expediente Actualizado" });
            setEditingSupplier(null);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Fallo al Guardar", description: error.message });
        } finally { setIsSubmitting(false); }
    };

    const isLoading = isLoadingSuppliers || isUserLoading;

    if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-10 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3">
                        <Contact className="h-8 w-8 text-primary" /> Directorio de Proveedores
                    </h1>
                    <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Gestión de Socios Comerciales y Catálogos Externos</p>
                </div>
                
                <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="h-12 px-8 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-xl bg-slate-900 hover:bg-primary">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl">
                        <DialogHeader className="p-8 bg-slate-50 border-b">
                            <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Vincular Socio Comercial</DialogTitle>
                            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest">Expediente maestro de abastecimiento.</DialogDescription>
                        </DialogHeader>
                        <div className="p-8">
                            <SupplierForm onSubmit={handleCreateSupplier} isSubmitting={isSubmitting} />
                        </div>
                    </DialogContent>
                </Dialog>
            </header>

            <div className="relative max-w-xl px-2">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                <Input 
                    placeholder="BUSCAR POR NOMBRE O RIF..." 
                    className="h-14 pl-14 rounded-[1.5rem] bg-white border-none shadow-sm font-bold uppercase text-[11px] tracking-widest"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 px-2">
                {filteredSuppliers.map(s => (
                    <Card key={s.id} className="border-none shadow-sm rounded-[2rem] overflow-hidden bg-white group hover:shadow-xl transition-all relative">
                        <div className="absolute top-4 right-4 z-10">
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-slate-100 hover:bg-primary hover:text-white" onClick={() => setEditingSupplier(s)}>
                                <Edit className="h-4 w-4" />
                            </Button>
                        </div>
                        <CardHeader className="p-6 pb-2">
                            <div className="flex justify-between items-start">
                                <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                                    <Building2 className="h-6 w-6" />
                                </div>
                                <div className="flex gap-1">
                                    {Array.from({ length: s.rating || 5 }).map((_, i) => <Star key={i} className="h-2 w-2 fill-amber-400 text-amber-400" />)}
                                </div>
                            </div>
                            <CardTitle className="text-lg font-black uppercase tracking-tighter mt-4 text-slate-900 group-hover:text-primary transition-colors leading-tight">{s.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <MapPin className="h-2.5 w-2.5 text-slate-400" />
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{s.city || '---'}, {s.country || '---'}</span>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                    <p className="text-[7px] font-black text-slate-400 uppercase">Vía Principal</p>
                                    <p className="text-[10px] font-bold text-slate-700 flex items-center gap-1.5">
                                        {s.preferredTransport === 'Aéreo' ? <Sparkles className="h-3 w-3 text-sky-500" /> : <Truck className="h-3 w-3 text-blue-500" />}
                                        {s.preferredTransport || 'Marítimo'}
                                    </p>
                                </div>
                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                                    <p className="text-[7px] font-black text-slate-400 uppercase">Lead Time</p>
                                    <p className="text-[10px] font-bold text-slate-700 flex items-center gap-1.5">
                                        <Clock className="h-3 w-3 text-amber-500" />
                                        {s.leadTimeDays || '--'} Días
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2 border-t border-dashed pt-4">
                                <div className="flex items-center gap-2.5 text-slate-500">
                                    <Phone className="h-3 w-3" />
                                    <span className="text-[10px] font-bold">{s.phone || '---'}</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-slate-500 truncate">
                                    <Mail className="h-3 w-3" />
                                    <span className="text-[10px] font-bold truncate">{s.email || '---'}</span>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="p-4 border-t bg-slate-50/50 flex justify-between">
                            <Button variant="ghost" className="h-8 text-[8px] font-black uppercase tracking-widest text-primary hover:bg-white" asChild>
                                <Link href={`/dashboard/purchase-orders?supplierId=${s.id}`}>Órdenes Activas</Link>
                            </Button>
                            {s.website && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary" asChild>
                                    <a href={s.website} target="_blank" rel="noreferrer"><Globe className="h-4 w-4" /></a>
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                ))}
            </div>

            {/* DIALOGO DE EDICIÓN */}
            <Dialog open={!!editingSupplier} onOpenChange={(open) => !open && setEditingSupplier(null)}>
                <DialogContent className="sm:max-w-2xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl">
                    <DialogHeader className="p-8 bg-slate-900 text-white">
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Modificar Expediente</DialogTitle>
                        <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Actualización de parámetros operativos y financieros.</DialogDescription>
                    </DialogHeader>
                    <div className="p-8">
                        <SupplierForm initialData={editingSupplier || {}} onSubmit={handleUpdateSupplier} isSubmitting={isSubmitting} />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
