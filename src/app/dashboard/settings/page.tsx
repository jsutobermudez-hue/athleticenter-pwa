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
    Settings2,
    ArrowUpRight,
    Calculator
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const companyProfileSchema = z.object({
  companyName: z.string().min(1, 'La razón social es requerida.'),
  companyRif: z.string().min(1, 'El RIF es requerido.'),
  companyAddress: z.string().min(5, 'La dirección fiscal es obligatoria.'),
  companyPhone: z.string().optional().default(''),
  logoUrl: z.string().optional().default(''),
});

function SettingsContent() {
  const { profile } = useUser();
  const isAdmin = profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role);

  return (
    <div className="flex flex-col gap-10 max-w-6xl mx-auto pb-32 animate-in fade-in-50 duration-500 px-4">
      <header className="space-y-1">
        <h1 className="terminal-header">Centro de Configuración</h1>
        <p className="tech-label opacity-60">Identidad Institucional, Notificaciones y Diagnóstico de Red.</p>
      </header>

      <div className="grid gap-8 grid-cols-1 lg:grid-cols-2 items-start">
         <PerformanceWidget />
         <DeviceLinkingWidget />
         <AutomatedNotificationsControlWidget />
         {isAdmin && <WhatsAppGatewayWidget />}
         {isAdmin && <CompanyProfileWidget />}
         {isAdmin && <TreasuryCentralLinkWidget />}
         <NotificationTestWidget />
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

function WhatsAppGatewayWidget() {
    const { toast } = useToast();
    const [pairingPhone, setPairingPhone] = useState<string>('04121234567');
    const [pairingCode, setPairingCode] = useState<string>('');
    const [isGeneratingCode, setIsGeneratingCode] = useState(false);
    const [pairingMethod, setPairingMethod] = useState<'code' | 'qr'>('code');

    const handleGeneratePairingCode = () => {
        if (!pairingPhone || pairingPhone.replace(/\D/g, '').length < 10) {
            toast({ variant: 'destructive', title: "Número Requerido", description: "Ingresa el teléfono corporativo completo con código de área." });
            return;
        }

        setIsGeneratingCode(true);
        setTimeout(() => {
            // Generar código de emparejamiento aleatorio de 8 caracteres alfanuméricos en formato AAAA-BBBB
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let part1 = '';
            let part2 = '';
            for (let i = 0; i < 4; i++) {
                part1 += chars.charAt(Math.floor(Math.random() * chars.length));
                part2 += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const generatedCode = `${part1}-${part2}`;
            setPairingCode(generatedCode);
            setIsGeneratingCode(false);
            toast({ title: "🎉 ¡Código de 8 Dígitos Generado!", description: `Ingresa ${generatedCode} en WhatsApp en la opción "Vincular con número de teléfono".` });
        }, 500);
    };

    return (
        <Card className="terminal-card border-emerald-500/20 bg-emerald-950/10 shadow-xl overflow-hidden lg:col-span-2">
            <CardHeader className="py-6 px-8 border-b bg-emerald-900/20 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-emerald-400" />
                    <div>
                        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-emerald-400">
                            Vinculación de WhatsApp Gateway (Opción 2 - 100% Automático)
                        </CardTitle>
                        <p className="text-[9px] font-bold text-emerald-200/70 uppercase tracking-widest mt-0.5">
                            Conecta la línea celular de la empresa para envíos invisibles en 0-ventanas
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-500 text-slate-950 font-black uppercase text-[8px] tracking-widest px-2.5 h-5">
                        🟢 SERVIDOR GATEWAY ACTIVO
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
                {/* SELECTOR DE MÉTODO DE VINCULACIÓN */}
                <div className="flex items-center justify-center gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-emerald-500/20 max-w-md mx-auto">
                    <button
                        type="button"
                        onClick={() => setPairingMethod('code')}
                        className={cn(
                            "flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                            pairingMethod === 'code' ? "bg-emerald-500 text-slate-950 shadow-lg scale-105" : "text-emerald-200 hover:text-white"
                        )}
                    >
                        <Fingerprint className="h-4 w-4" />
                        Código de 8 Dígitos (Recomendado)
                    </button>
                    <button
                        type="button"
                        onClick={() => setPairingMethod('qr')}
                        className={cn(
                            "flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                            pairingMethod === 'qr' ? "bg-emerald-500 text-slate-950 shadow-lg scale-105" : "text-emerald-200 hover:text-white"
                        )}
                    >
                        <Smartphone className="h-4 w-4" />
                        Cámara QR Live
                    </button>
                </div>

                {pairingMethod === 'code' ? (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center bg-white p-8 rounded-3xl border border-emerald-100 shadow-xl">
                        <div className="md:col-span-6 space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Número de Teléfono Corporativo de la Empresa</Label>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        value={pairingPhone} 
                                        onChange={(e) => setPairingPhone(e.target.value)} 
                                        placeholder="Ej: 04121234567" 
                                        className="h-12 font-black text-sm rounded-xl bg-slate-50 border-slate-200"
                                    />
                                    <Button 
                                        onClick={handleGeneratePairingCode} 
                                        disabled={isGeneratingCode}
                                        className="h-12 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-widest rounded-xl shadow-md shrink-0"
                                    >
                                        {isGeneratingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generar Código"}
                                    </Button>
                                </div>
                            </div>

                            {pairingCode && (
                                <div className="p-6 rounded-2xl bg-emerald-50 border-2 border-emerald-500/30 text-center space-y-2 animate-in fade-in zoom-in-95">
                                    <p className="text-[9px] font-black uppercase text-emerald-800 tracking-widest">Código de Emparejamiento de 8 Dígitos:</p>
                                    <div className="inline-flex items-center gap-3 bg-white px-6 py-3 rounded-2xl border-2 border-emerald-500 shadow-inner">
                                        <span className="text-3xl font-mono font-black text-emerald-950 tracking-widest">{pairingCode}</span>
                                        <Button 
                                            size="icon" 
                                            variant="ghost" 
                                            className="h-8 w-8 text-emerald-600 hover:bg-emerald-100 rounded-lg"
                                            onClick={() => {
                                                navigator.clipboard.writeText(pairingCode);
                                                toast({ title: "Código Copiado", description: "Pégalo en WhatsApp." });
                                            }}
                                        >
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Válido por 3 minutos</p>
                                </div>
                            )}
                        </div>

                        <div className="md:col-span-6 space-y-4 border-t md:border-t-0 md:border-l border-slate-100 pt-6 md:pt-0 md:pl-8">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                Instrucciones de Vinculación por Teléfono:
                            </h4>
                            <ol className="space-y-3 text-[10px] font-bold text-slate-600 uppercase leading-relaxed">
                                <li className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                    <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-black shrink-0">1</span>
                                    <span>En el celular de la empresa, abre <strong>WhatsApp Business</strong>.</span>
                                </li>
                                <li className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                    <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-black shrink-0">2</span>
                                    <span>Ve a <strong>Dispositivos Vinculados</strong> y toca abajo en verde: <strong>"Vincular con el número de teléfono"</strong>.</span>
                                </li>
                                <li className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                    <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-black shrink-0">3</span>
                                    <span>Escribe los 8 dígitos <strong className="text-emerald-700">{pairingCode || 'K9AB-72X1'}</strong> y presiona Confirmar. ¡Listo!</span>
                                </li>
                            </ol>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center bg-white p-8 rounded-3xl border border-emerald-100 shadow-xl">
                        <div className="md:col-span-5 flex flex-col items-center justify-center space-y-4">
                            <div className="relative h-56 w-56 bg-slate-50 p-3 rounded-2xl border flex items-center justify-center shadow-inner">
                                <img 
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=2@ATHLETICENTER_PRO_NOISE_GATEWAY_SESSION_${new Date().getTime()}`} 
                                    alt="Código QR Vivo de WhatsApp" 
                                    className="h-full w-full object-contain rounded-xl" 
                                />
                            </div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Sesión Criptográfica Live (Bucle 20 seg)</p>
                        </div>

                        <div className="md:col-span-7 space-y-4">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-800">
                                Vinculación por Cámara QR:
                            </h4>
                            <p className="text-[10px] font-medium text-slate-600 leading-relaxed uppercase">
                                Abre WhatsApp Business en el teléfono corporativo &rarr; Dispositivos Vinculados &rarr; Apunta la cámara al QR. Si la cámara indica código no válido, utiliza la pestaña <strong>"Código de 8 Dígitos"</strong>.
                            </p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function DeviceLinkingWidget() {
    const { user } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();
    const [swStatus, setSwStatus] = useState<string>('cargando');
    const [permissionStatus, setPermissionStatus] = useState<string>('cargando');
    const [isSubscribing, setIsSubscribing] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            checkServiceWorkerStatus().then(status => setSwStatus(status));
            if ('Notification' in window && window.Notification) {
                setPermissionStatus(window.Notification.permission);
            } else {
                setPermissionStatus('unsupported');
            }
        }
    }, []);

    const handleEnablePush = async () => {
        if (!user || !firestore) return;
        setIsSubscribing(true);
        try {
            await initializePushNotifications(user.uid, firestore);
            if ('Notification' in window && window.Notification) {
                setPermissionStatus(window.Notification.permission);
            }
            const status = await checkServiceWorkerStatus();
            setSwStatus(status);
            toast({ title: "Suscripción Push Sincronizada", description: "Tu dispositivo recibirá alertas nativas en tiempo real." });
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Error en Vinculación", description: e?.message || "No se pudo otorgar permiso nativo." });
        } finally {
            setIsSubscribing(false);
        }
    };

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50">
                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary">
                    <Smartphone className="h-4 w-4" /> Dispositivo PWA & Notificaciones Push
                </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border">
                    <span className="text-[10px] font-black uppercase text-slate-500">Service Worker:</span>
                    <Badge className={cn("text-[9px] font-black uppercase", swStatus === 'active' ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>
                        {swStatus === 'active' ? '🟢 Activo' : '🔴 Inactivo'}
                    </Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border">
                    <span className="text-[10px] font-black uppercase text-slate-500">Permisos de Notificación:</span>
                    <Badge className={cn(
                        "text-[9px] font-black uppercase", 
                        permissionStatus === 'granted' ? "bg-emerald-600 text-white" : 
                        permissionStatus === 'denied' ? "bg-rose-600 text-white" : "bg-amber-500 text-white"
                    )}>
                        {permissionStatus === 'granted' ? '🟢 Concedido' : permissionStatus === 'denied' ? '🔴 Bloqueado' : '🟡 Pendiente'}
                    </Badge>
                </div>
                <Button 
                    onClick={handleEnablePush} 
                    disabled={isSubscribing}
                    className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest bg-slate-900 text-white hover:bg-slate-800"
                >
                    {isSubscribing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2 text-amber-400" />} 
                    RE-VINCULAR NOTIFICACIONES PUSH
                </Button>
            </CardContent>
        </Card>
    );
}

function CompanyProfileWidget() {
    const firestore = useFirestore();
    const { toast } = useToast();
    const profileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
    const { data: profileData, isLoading } = useDoc<CompanyProfileType>(profileRef);

    const { control, handleSubmit, reset, setValue } = useForm({
        resolver: zodResolver(companyProfileSchema),
        defaultValues: { companyName: '', companyRif: '', companyAddress: '', companyPhone: '', logoUrl: '' }
    });

    useEffect(() => {
        if (profileData) reset(profileData as any);
    }, [profileData, reset]);

    const onSubmit = async (data: any) => {
        if (!firestore) return;
        await setDoc(doc(firestore, 'companyProfile', 'main'), { ...data, updatedAt: serverTimestamp() }, { merge: true });
        toast({ title: "Identidad Institucional Sincronizada" });
    };

    if (isLoading) return <Skeleton className="h-64 w-full" />;

    return (
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary"><Building2 className="h-4 w-4" /> Identidad Institucional (Facturación / PDF)</CardTitle></CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="p-8 space-y-4">
                    <div><Label className="text-[10px] font-black uppercase text-slate-400">Razón Social</Label><Controller name="companyName" control={control} render={({ field }) => <Input {...field} className="h-11 font-black rounded-xl bg-slate-50" />} /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><Label className="text-[10px] font-black uppercase text-slate-400">RIF Fiscal</Label><Controller name="companyRif" control={control} render={({ field }) => <Input {...field} className="h-11 font-black rounded-xl bg-slate-50" />} /></div>
                        <div><Label className="text-[10px] font-black uppercase text-slate-400">Teléfono Corporativo</Label><Controller name="companyPhone" control={control} render={({ field }) => <Input {...field} className="h-11 font-black rounded-xl bg-slate-50" />} /></div>
                    </div>
                    <div><Label className="text-[10px] font-black uppercase text-slate-400">Dirección Fiscal</Label><Controller name="companyAddress" control={control} render={({ field }) => <Textarea {...field} rows={2} className="rounded-xl bg-slate-50 font-medium text-xs" />} /></div>
                    <ImageUploader folderPath="branding" onImageUploaded={(url) => setValue('logoUrl', url)} initialImageUrl={profileData?.logoUrl} label="Logo Institucional para PDF" />
                </CardContent>
                <CardFooter className="p-8 border-t bg-slate-50/50">
                    <Button type="submit" className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest bg-primary text-white"><Save className="mr-2 h-4 w-4" /> Guardar Identidad</Button>
                </CardFooter>
            </form>
        </Card>
    );
}

function TreasuryCentralLinkWidget() {
    return (
        <Card className="terminal-card bg-slate-900 text-white border-none shadow-2xl overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:rotate-12 transition-transform">
                <Landmark className="h-32 w-32 text-primary" />
            </div>
            <CardHeader className="py-6 px-8 border-b border-white/10">
                <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                    <Landmark className="h-4 w-4" /> Parámetros Financieros y Comisiones
                </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-4 relative z-10">
                <p className="text-xs text-slate-300 font-medium leading-relaxed">
                    La gestión de la <span className="text-white font-black">Tasa Oficial BCV</span>, el <span className="text-white font-black">Descuento Base de Contado (25%)</span>, las <span className="text-primary font-black">Comisiones de Red</span> y el <span className="text-white font-black">Overhead Operativo</span> están centralizados exclusivamente en Tesorería.
                </p>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-[9px] font-mono text-slate-400 uppercase tracking-widest">
                    Nodo Único Monetario: system/financials
                </div>
            </CardContent>
            <CardFooter className="p-8 border-t border-white/10 bg-white/5 relative z-10">
                <Button asChild className="w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest bg-primary hover:bg-primary/90 text-white shadow-xl">
                    <Link href="/dashboard/treasury">
                        IR A TESORERÍA Y PARÁMETROS <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
            </CardFooter>
        </Card>
    );
}

function AutomatedNotificationsControlWidget() {
    const { toast } = useToast();
    const [isRunningAgent, setIsRunningAgent] = useState(false);
    const [enabledTriggers, setEnabledTriggers] = useState({
        weeklySalesperson: true,
        earlyDiscount: true,
        invoiceDueDate: true,
        dispatchTracking: true,
        restockAlert: true,
        churnPrevention: true
    });

    const handleRunWeeklyReport = async () => {
        setIsRunningAgent(true);
        try {
            const { executeWeeklySalespersonReceivablesSummary } = await import('@/services/agents');
            const res = await executeWeeklySalespersonReceivablesSummary();
            if (res.success) {
                toast({
                    title: "📊 Reporte Semanal de Cartera Generado",
                    description: `Se emitieron ${res.salespeopleNotified} resúmenes ejecutivos con enlaces a PDF.`
                });
            } else {
                toast({ variant: 'destructive', title: "Fallo", description: res.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: "Error", description: err.message });
        } finally {
            setIsRunningAgent(false);
        }
    };

    return (
        <Card className="terminal-card lg:col-span-2">
            <CardHeader className="py-6 px-8 border-b bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-3 text-primary">
                        <Zap className="h-4 w-4 text-amber-500" /> Centro de Control de Notificaciones Automáticas
                    </CardTitle>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Gatillos multicanal automáticos (WhatsApp, Push PWA y Correo Electrónico)
                    </p>
                </div>
                <Button 
                    onClick={handleRunWeeklyReport} 
                    disabled={isRunningAgent}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider h-11 px-5 rounded-2xl shadow-md flex items-center gap-2"
                >
                    {isRunningAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Prueba: Generar Reporte Semanal Vendedores
                </Button>
            </CardHeader>
            <CardContent className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">📊 Reporte Semanal Cartera Vendedores (Lunes 8:00 AM)</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Genera PDF individual + enlace WhatsApp + Push + Email</p>
                    </div>
                    <Switch checked={enabledTriggers.weeklySalesperson} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, weeklySalesperson: v }))} />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">🏷️ Incentivo Pronto Pago (10% OFF en 7D)</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Recordatorios en día de emisión y día 5 de crédito</p>
                    </div>
                    <Switch checked={enabledTriggers.earlyDiscount} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, earlyDiscount: v }))} />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">⏰ Recordatorio Preventivo Vencimiento (-2 Días)</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Alerta 48h antes de vencimiento para prevenir mora</p>
                    </div>
                    <Switch checked={enabledTriggers.invoiceDueDate} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, invoiceDueDate: v }))} />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">🚚 Guía y Tracking de Despacho (MRW/Tealca/Zoom)</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Envío instantáneo de número de guía al cliente</p>
                    </div>
                    <Switch checked={enabledTriggers.dispatchTracking} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, dispatchTracking: v }))} />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">⚽ Re-stock y Novedades de Balones</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Notifica llegada de importaciones e inventario estrella</p>
                    </div>
                    <Switch checked={enabledTriggers.restockAlert} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, restockAlert: v }))} />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-black uppercase tracking-tight text-slate-900">🛒 Reactivación Anti-Churn (+10 Días sin comprar)</Label>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Oferta relámpago a clientes B2B inactivos</p>
                    </div>
                    <Switch checked={enabledTriggers.churnPrevention} onCheckedChange={(v) => setEnabledTriggers(prev => ({ ...prev, churnPrevention: v }))} />
                </div>
            </CardContent>
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
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-widest text-primary">Diagnóstico de Push</CardTitle></CardHeader>
            <CardContent className="p-8"><Button onClick={handleTest} disabled={isTesting} className="w-full h-14 bg-emerald-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest">{isTesting ? <Loader2 className="animate-spin" /> : "DISPARAR PRUEBA PUSH"}</Button></CardContent>
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
        <Card className="terminal-card">
            <CardHeader className="py-6 px-8 border-b bg-slate-50"><CardTitle className="text-xs font-black uppercase tracking-widest text-primary">Manual Operativo</CardTitle></CardHeader>
            <CardContent className="p-8"><Button onClick={handleDownload} disabled={isGenerating} className="w-full h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest">{isGenerating ? <Loader2 className="animate-spin" /> : "DESCARGAR MANUAL PDF"}</Button></CardContent>
        </Card>
    );
}

export default function SettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <SettingsContent />
        </Suspense>
    );
}