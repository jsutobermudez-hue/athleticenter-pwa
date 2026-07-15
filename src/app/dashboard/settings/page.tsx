'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ImageUploader } from '@/components/ui/image-uploader';
import { useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { 
    Loader2, 
    Smartphone, 
    CheckCircle2, 
    Landmark,
    Palette,
    Building2,
    Save,
    Radio,
    RefreshCw,
    Send,
    Download,
    Zap,
    AlertTriangle,
    Info,
    Activity,
    BellOff,
    ShieldCheck,
    Bug,
    Copy,
    Fingerprint,
    Settings2
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import type { CompanyProfile as CompanyProfileType, FinancialSettings } from '@/lib/definitions';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { generateSystemManualPDF } from '@/lib/pdf-generator';
import { initializePushNotifications, checkServiceWorkerStatus, getCurrentPushSubscription } from '@/lib/push-notifications';
import { logActivity } from '@/lib/audit';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDataSaving } from '@/hooks/use-data-saving';
import { ScrollArea } from '@/components/ui/scroll-area';

export const dynamic = 'force-dynamic';

const companyProfileSchema = z.object({
  companyName: z.string().min(1, 'La razón social es requerida.'),
  companyRif: z.string().min(1, 'El RIF es requerido.'),
  companyAddress: z.string().min(5, 'La dirección fiscal es obligatoria.'),
  logoUrl: z.string().optional().default(''),
});

const financialSchema = z.object({
  ivaPercent: z.coerce.number().min(0).max(100),
  defaultBcvDiscount: z.coerce.number().min(0).max(100),
  defaultCommission: z.coerce.number().min(0).max(100),
  earlyPayment7Days: z.coerce.number().min(0).max(100),
  earlyPayment15Days: z.coerce.number().min(0).max(100),
});

const visualSchema = z.object({
  logoFit: z.enum(['contain', 'cover']),
  headerShowLogo: z.boolean(),
  loginBackgroundType: z.enum(['color', 'image']),
  loginBackgroundValue: z.string().min(1, 'Valor requerido'),
  loginOverlayEnabled: z.boolean(),
  loginOverlayColor: z.string(),
  loginOverlayOpacity: z.coerce.number().min(0).max(1),
  loginShowBranding: z.boolean(),
});

function SettingsContent() {
  const { profile } = useUser();
  const isAdmin = profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role);

  return (
    <div className="flex flex-col gap-10 max-w-6xl mx-auto pb-32 animate-in fade-in-50 duration-500 px-4">
      <header className="space-y-1">
        <h1 className="terminal-header">Centro de Configuración</h1>
        <p className="tech-label opacity-60">Control Maestro de la Terminal y Parametrización de Red.</p>
      </header>

      <div className="grid gap-8 grid-cols-1 lg:grid-cols-2 items-start">
         <PerformanceWidget />
         <DeviceLinkingWidget />
         {isAdmin && <CompanyProfileWidget />}
         {isAdmin && <VisualAccessWidget />}
         <NotificationTestWidget />
         {isAdmin && <GlobalFinanceWidget />}
         <ManualDownloadWidget />
         
         <Card className="terminal-card p-8 space-y-6 lg:col-span-2">
            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Diagnóstico del Sistema</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Button variant="outline" className="h-12 rounded-xl font-black uppercase text-[10px]" onClick={() => window.location.reload()}><RefreshCw className="mr-2 h-4 w-4" /> REINICIAR TERMINAL</Button>
            </div>
         </Card>
      </div>
    </div>
  );
}

function PerformanceWidget() {
    const { isDataSaving, toggleDataSaving } = useDataSaving();
    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary"><Activity className="h-4 w-4" /> Rendimiento</CardTitle></CardHeader>
            <CardContent className="p-8 space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border">
                    <Label className="text-sm font-black uppercase tracking-tighter">Modo Ahorro de Datos</Label>
                    <Switch checked={isDataSaving} onCheckedChange={toggleDataSaving} />
                </div>
            </CardContent>
        </Card>
    );
}

function DeviceLinkingWidget() {
    const firestore = useFirestore();
    const { user } = useUser();
    const { toast } = useToast();
    const [isSyncing, setIsSyncing] = useState(false);

    const handleSync = async () => {
        if (!firestore || !user) return;
        setIsSyncing(true);
        try {
            await initializePushNotifications(user.uid, firestore);
            toast({ title: "Terminal Sincronizada" });
        } catch (e) { toast({ variant: 'destructive', title: "Fallo de Vínculo" }); }
        finally { setIsSyncing(false); }
    };

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary"><Smartphone className="h-4 w-4" /> Enlace PWA</CardTitle></CardHeader>
            <CardContent className="p-8"><Button onClick={handleSync} disabled={isSyncing} className="w-full h-14 bg-slate-900 text-white rounded-2xl shadow-xl">{isSyncing ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : "VINCULAR ESTE DISPOSITIVO"}</Button></CardContent>
        </Card>
    );
}

function CompanyProfileWidget() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const { profile: currentUser } = useUser();
    const profileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
    const { data: profile, isLoading } = useDoc<CompanyProfileType>(profileRef);
    const { control, handleSubmit, reset } = useForm({ defaultValues: { companyName: '', companyRif: '', companyAddress: '', logoUrl: '' } });

    useEffect(() => { if (profile) reset(profile); }, [profile, reset]);

    const onSubmit = async (data: any) => {
        if (!firestore || !currentUser) return;
        await setDoc(doc(firestore, 'companyProfile', 'main'), { ...data, updatedAt: serverTimestamp(), updatedBy: currentUser.id }, { merge: true });
        toast({ title: "Perfil Guardado" });
    };

    if (isLoading) return <Skeleton className="h-64 w-full" />;

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary"><Building2 className="h-4 w-4" /> Datos Fiscales</CardTitle></CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="p-8 space-y-4">
                    <Controller name="companyName" control={control} render={({ field }) => <Input {...field} placeholder="Razón Social" />} />
                    <Controller name="companyRif" control={control} render={({ field }) => <Input {...field} placeholder="RIF" />} />
                    <Controller name="companyAddress" control={control} render={({ field }) => <Textarea {...field} placeholder="Dirección Fiscal" />} />
                    <Button type="submit" className="w-full h-12 rounded-xl">Guardar Cambios</Button>
                </CardContent>
            </form>
        </Card>
    );
}

function VisualAccessWidget() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const profileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
    const { data: profile, isLoading } = useDoc<CompanyProfileType>(profileRef);
    const { control, handleSubmit, reset } = useForm({ defaultValues: { logoFit: 'contain', headerShowLogo: true } });

    useEffect(() => { if (profile) reset(profile as any); }, [profile, reset]);

    const onSubmit = async (data: any) => {
        if (!firestore) return;
        await setDoc(doc(firestore, 'companyProfile', 'main'), data, { merge: true });
        toast({ title: "Ajustes Visuales Guardados" });
    };

    if (isLoading) return <Skeleton className="h-64 w-full" />;

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 bg-slate-900 text-white"><CardTitle className="text-xs font-black uppercase tracking-widest text-primary">Identidad Visual</CardTitle></CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}><CardContent className="p-8 space-y-4"><div className="flex items-center justify-between"><Label>Mostrar Logo</Label><Controller name="headerShowLogo" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} /></div><Button type="submit" className="w-full">Sincronizar</Button></CardContent></form>
        </Card>
    );
}

function GlobalFinanceWidget() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: settings, isLoading } = useDoc<FinancialSettings>(settingsRef);
    const { control, handleSubmit, reset } = useForm({ defaultValues: { ivaPercent: 16, defaultCommission: 5 } });

    useEffect(() => { if (settings) reset(settings as any); }, [settings, reset]);

    const onSubmit = async (data: any) => {
        if (!firestore) return;
        await setDoc(doc(firestore, 'system', 'financials'), data, { merge: true });
        toast({ title: "Tesorería Sincronizada" });
    };

    if (isLoading) return <Skeleton className="h-64 w-full" />;

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-widest text-primary">Tesorería</CardTitle></CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}><CardContent className="p-8 space-y-4"><div className="grid grid-cols-2 gap-4"><div><Label>IVA (%)</Label><Controller name="ivaPercent" control={control} render={({ field }) => <Input type="number" {...field} />} /></div><div><Label>Comisión (%)</Label><Controller name="defaultCommission" control={control} render={({ field }) => <Input type="number" {...field} />} /></div></div><Button type="submit" className="w-full">Guardar</Button></CardContent></form>
        </Card>
    );
}

function NotificationTestWidget() {
    const firestore = useFirestore();
    const { profile } = useUser();
    const { toast } = useToast();
    const [isTesting, setIsTesting] = useState(false);

    const handleTest = async () => {
        if (!firestore || !profile) return;
        setIsTesting(true);
        try {
            const { createAppNotifications } = await import('@/lib/notifications');
            await createAppNotifications(firestore, {
                category: 'Usuarios',
                title: '🎯 Prueba de Conectividad',
                message: 'Si recibes este aviso push, tu terminal está correctamente enlazada.',
                link: '/dashboard/notifications',
                initiatorId: 'system',
                userIds: [profile.id]
            });
            toast({ title: "Prueba Emitida" });
        } catch (e) { toast({ variant: 'destructive', title: "Fallo" }); }
        finally { setIsTesting(false); }
    };

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-widest text-primary">Diagnóstico</CardTitle></CardHeader>
            <CardContent className="p-8"><Button onClick={handleTest} disabled={isTesting} className="w-full h-14 bg-emerald-600 text-white rounded-2xl">{isTesting ? <Loader2 className="animate-spin" /> : "DISPARAR PRUEBA"}</Button></CardContent>
        </Card>
    );
}

function ManualDownloadWidget() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isGenerating, setIsGenerating] = useState(false);
    const profileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
    const { data: profile } = useDoc<CompanyProfileType>(profileRef);

    const handleDownload = async () => {
        setIsGenerating(true);
        try {
            await generateSystemManualPDF(profile || undefined);
            toast({ title: "Guía Descargada" });
        } catch (e) { toast({ variant: 'destructive', title: "Error" }); }
        finally { setIsGenerating(false); }
    };

    return (
        <Card className="terminal-card bg-slate-900 text-white">
            <CardHeader className="py-6 px-8 border-b border-white/5"><CardTitle className="text-xs font-black uppercase text-primary">Documentación</CardTitle></CardHeader>
            <CardContent className="p-8"><Button onClick={handleDownload} disabled={isGenerating} className="w-full h-14 bg-white text-slate-900 rounded-2xl">{isGenerating ? <Loader2 className="animate-spin" /> : "DESCARGAR MANUAL PDF"}</Button></CardContent>
        </Card>
    );
}

export default function SettingsPage() {
    return <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>}><SettingsContent /></Suspense>;
}