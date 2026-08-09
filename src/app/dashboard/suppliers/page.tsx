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
    Save,
    MessageCircle,
    Package,
    X,
    Filter,
    UserCheck
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

function DashboardMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor,
  onClick,
  isActive
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <Card 
      onClick={onClick}
      className={cn(
        "border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5",
        isActive && "ring-2 ring-primary bg-primary/5"
      )}
    >
      <div className="space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">{value}</h3>
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{subtitle}</p>
      </div>
      <div className={cn("p-3 rounded-2xl shrink-0 shadow-sm", iconBg, iconColor)}>
        <Icon className="h-6 w-6" />
      </div>
    </Card>
  );
}

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
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Razón Social</Label><Input name="name" defaultValue={initialData?.name} required className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">RIF / Tax ID</Label><Input name="rif" defaultValue={initialData?.rif} required className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-mono font-bold text-xs" /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Email Corporativo</Label><Input name="email" type="email" defaultValue={initialData?.email} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Teléfono / WhatsApp</Label><Input name="phone" defaultValue={initialData?.phone} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Representante de Cuenta</Label><Input name="contactName" defaultValue={initialData?.contactName} placeholder="Nombre del asesor comercial" className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
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
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">País de Origen</Label><Input name="country" defaultValue={initialData?.country} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Ciudad / Puerto</Label><Input name="city" defaultValue={initialData?.city} className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
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
                            <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Lead Time (Días)</Label><Input name="leadTimeDays" type="number" defaultValue={initialData?.leadTimeDays} placeholder="Ej. 45" className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
                        </div>
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Dirección Física Almacén</Label><Textarea name="address" defaultValue={initialData?.address} className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[100px] text-xs font-medium" /></div>
                    </TabsContent>

                    <TabsContent value="finance" className="space-y-6 mt-0">
                        <div className="space-y-1.5"><Label className="text-[10px] font-bold uppercase">Términos de Pago (Crédito)</Label><Input name="paymentTerms" defaultValue={initialData?.paymentTerms} placeholder="Ej. 50/50, Crédito 30 días, Prepago..." className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs" /></div>
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
    const [rubroFilter, setRubroFilter] = useState('todos');

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

    // MÉTRICAS EJECUTIVAS
    const metrics = useMemo(() => {
        if (!suppliers) return { totalSuppliers: 0, countriesCount: 0, categoriesCount: 0, avgLeadTime: 0 };

        const countries = new Set<string>();
        const categories = new Set<string>();
        let totalLeadTime = 0;
        let leadTimeCount = 0;

        suppliers.forEach(s => {
            if (s.country) countries.add(s.country.trim().toUpperCase());
            if (s.categories) s.categories.forEach(c => categories.add(c));
            if (s.leadTimeDays) {
                totalLeadTime += Number(s.leadTimeDays);
                leadTimeCount++;
            }
        });

        const avgLeadTime = leadTimeCount > 0 ? Math.round(totalLeadTime / leadTimeCount) : 0;
        return { totalSuppliers: suppliers.length, countriesCount: countries.size, categoriesCount: categories.size, avgLeadTime };
    }, [suppliers]);

    const filteredSuppliers = useMemo(() => {
        if (!suppliers) return [];
        let items = [...suppliers];

        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(s => 
                s.name.toLowerCase().includes(term) || 
                s.rif.toLowerCase().includes(term) ||
                (s.contactName || '').toLowerCase().includes(term) ||
                (s.country || '').toLowerCase().includes(term) ||
                (s.city || '').toLowerCase().includes(term)
            );
        }

        if (rubroFilter !== 'todos') {
            items = items.filter(s => s.categories && s.categories.includes(rubroFilter));
        }

        return items;
    }, [suppliers, searchTerm, rubroFilter]);

    const handleWhatsAppSupplier = (supplier: Supplier, e: React.MouseEvent) => {
        e.stopPropagation();
        const rawPhone = (supplier.phone || '').replace(/\D/g, '');
        const text = `Hola ${supplier.contactName || supplier.name}, nos comunicamos desde *ATHLETICENTER C.A.* para consultar disponibilidad de catálogo y tiempos de entrega.`;
        const url = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

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
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-2 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3">
                        <Contact className="h-8 w-8 text-primary" /> Directorio de Proveedores
                    </h1>
                    <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Gestión de Socios Comerciales, Lead Time y Condiciones Financieras</p>
                </div>
                
                <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="h-12 px-8 rounded-2xl font-black uppercase tracking-wider text-[10px] shadow-xl bg-slate-900 hover:bg-primary">
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

            {/* MÉTRICAS EJECUTIVAS DE PROVEEDORES */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-1">
                <DashboardMetricCard 
                    title="Socios Comerciales" 
                    value={metrics.totalSuppliers} 
                    subtitle="Fábricas & Marcas" 
                    icon={Building2} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-600" 
                    onClick={() => setRubroFilter('todos')}
                    isActive={rubroFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="Orígenes Globales" 
                    value={metrics.countriesCount} 
                    subtitle="Países de Abastecimiento" 
                    icon={Globe} 
                    iconBg="bg-indigo-50" 
                    iconColor="text-indigo-600" 
                />
                <DashboardMetricCard 
                    title="Rubros Cubiertos" 
                    value={metrics.categoriesCount} 
                    subtitle="Categorías de Producto" 
                    icon={Package} 
                    iconBg="bg-sky-50" 
                    iconColor="text-sky-600" 
                />
                <DashboardMetricCard 
                    title="Lead Time Promedio" 
                    value={`${metrics.avgLeadTime} Días`} 
                    subtitle="Respuesta Logística" 
                    icon={Clock} 
                    iconBg="bg-amber-50" 
                    iconColor="text-amber-600" 
                />
            </div>

            {/* FILTROS DE BÚSQUEDA MULTIDIMENSIONAL */}
            <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden mx-1">
                <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Directa</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input 
                                placeholder="NOMBRE / RIF / ASESOR / PAÍS..." 
                                className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Rubro de Suministro</Label>
                        <Select value={rubroFilter} onValueChange={setRubroFilter}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Todos los Rubros" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[10px] font-bold uppercase">TODOS LOS RUBROS</SelectItem>
                                {SUPPLIER_RUBROS.map(r => (
                                    <SelectItem key={r} value={r} className="text-[10px] font-bold uppercase">{r.toUpperCase()}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {(searchTerm || rubroFilter !== 'todos') && (
                        <div className="flex justify-end">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => { setSearchTerm(''); setRubroFilter('todos'); }}
                                className="h-10 text-[9px] font-black uppercase text-primary px-3 rounded-xl hover:bg-primary/5"
                            >
                                Limpiar Filtros <X className="ml-1 h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 px-1">
                {filteredSuppliers.length > 0 ? filteredSuppliers.map(s => (
                    <Card key={s.id} className="border-none shadow-sm rounded-[2rem] overflow-hidden bg-white group hover:shadow-xl transition-all relative flex flex-col justify-between">
                        <div className="absolute top-4 right-4 z-10">
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-slate-100 hover:bg-primary hover:text-white" onClick={() => setEditingSupplier(s)}>
                                <Edit className="h-4 w-4" />
                            </Button>
                        </div>

                        <div>
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

                              {s.contactName && (
                                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 bg-slate-50 p-2.5 rounded-xl">
                                  <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <span className="truncate">{s.contactName}</span>
                                </div>
                              )}

                              <div className="space-y-2 border-t border-dashed pt-4">
                                  <div className="flex items-center justify-between text-slate-600">
                                      <div className="flex items-center gap-2 truncate text-[10px] font-bold">
                                        <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                                        <span>{s.phone || '---'}</span>
                                      </div>
                                      {s.phone && (
                                        <Button size="sm" variant="ghost" onClick={(e) => handleWhatsAppSupplier(s, e)} className="h-7 px-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-[8px] font-black uppercase rounded-lg">
                                          <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
                                        </Button>
                                      )}
                                  </div>

                                  {s.email && (
                                    <div className="flex items-center gap-2 text-slate-500 truncate text-[10px] font-bold">
                                        <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                                        <a href={`mailto:${s.email}`} className="hover:underline truncate">{s.email}</a>
                                    </div>
                                  )}
                              </div>
                          </CardContent>
                        </div>

                        <CardFooter className="p-4 border-t bg-slate-50/50 flex justify-between">
                            <Button variant="ghost" className="h-8 text-[8px] font-black uppercase tracking-widest text-primary hover:bg-white" asChild>
                                <Link href={`/dashboard/purchase-orders?supplierId=${s.id}`}>Ver Importaciones</Link>
                            </Button>
                            {s.website && (
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary" asChild>
                                    <a href={s.website} target="_blank" rel="noreferrer"><Globe className="h-4 w-4" /></a>
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                )) : (
                    <div className="md:col-span-2 lg:col-span-3 xl:col-span-4 p-16 text-center border-2 border-dashed rounded-[2.5rem] bg-white flex flex-col items-center justify-center gap-3 opacity-40">
                        <Building2 className="h-10 w-10 text-slate-400" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sin proveedores registrados con los filtros seleccionados</p>
                    </div>
                )}
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
