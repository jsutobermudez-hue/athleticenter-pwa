'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useUser, useStorage } from '@/firebase';
import { uploadLargeFileToStorage } from '@/lib/large-file-upload';
import type { Customer, Product } from '@/lib/definitions';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import {
    Megaphone,
    Users,
    Send,
    Loader2,
    Image as ImageIcon,
    Video,
    Sparkles,
    ShieldCheck,
    Clock,
    Percent,
    Phone,
    Upload,
    CheckSquare,
    Search,
    AlertTriangle,
    CheckCircle2,
    FileSpreadsheet,
    Play,
    Tag,
    DollarSign,
    UserCheck,
    FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { InventoryProductPicker } from '@/components/dashboard/InventoryProductPicker';

export type ExtendedAudienceType = 
    | 'all' 
    | 'vips' 
    | 'debtors' 
    | 'mora_critica' 
    | 'dormant' 
    | 'new' 
    | 'by_salesperson' 
    | 'by_discipline' 
    | 'manual';

interface BroadcastModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    customers: Customer[];
    products: Product[];
    paretoCustomers?: Customer[];
    initialAudienceType?: ExtendedAudienceType;
    onCampaignCreated?: () => void;
}

export function BroadcastCampaignModal({
    isOpen,
    onOpenChange,
    customers = [],
    products = [],
    paretoCustomers = [],
    initialAudienceType = 'all',
    onCampaignCreated
}: BroadcastModalProps) {
    const { profile } = useUser();
    const storage = useStorage();
    const { toast } = useToast();

    // ESTADOS PRINCIPALES
    const [audienceType, setAudienceType] = useState<ExtendedAudienceType>(initialAudienceType || 'all');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaType, setMediaType] = useState<'none' | 'image' | 'video' | 'pdf'>('none');
    const [mediaFileName, setMediaFileName] = useState('');
    const [mediaFileSize, setMediaFileSize] = useState('');
    const [isUploadingMedia, setIsUploadingMedia] = useState(false);
    const [mediaUploadProgress, setMediaUploadProgress] = useState(0);
    const [selectedProductSku, setSelectedProductSku] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // FILTROS AVANZADOS
    const [selectedSalesperson, setSelectedSalesperson] = useState<string>('all');
    const [selectedDiscipline, setSelectedDiscipline] = useState<string>('all');
    const [manualSearch, setManualSearch] = useState('');
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());

    // MODO PRUEBA
    const [testPhone, setTestPhone] = useState('');
    const [isSendingTest, setIsSendingTest] = useState(false);

    // REFERENCIA ARCHIVO
    const fileInputRef = useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (initialAudienceType) {
            setAudienceType(initialAudienceType);
        }
    }, [initialAudienceType]);

    // Lista de vendedores únicos
    const availableSalespeople = useMemo(() => {
        const set = new Set<string>();
        customers.forEach(c => {
            const sp = (c as any).salesperson || (c as any).vendedor || (c as any).salespersonName;
            if (sp) set.add(String(sp).trim());
        });
        return Array.from(set).sort();
    }, [customers]);

    // Lista de disciplinas deportivas únicas
    const availableDisciplines = useMemo(() => {
        const set = new Set<string>();
        products.forEach(p => {
            const d = p.discipline || p.category;
            if (d) set.add(String(d).trim());
        });
        return Array.from(set).sort();
    }, [products]);

    // Helper para verificar si tiene teléfono
    const hasPhone = (c: any) => Boolean(c.phone || c.whatsappPhone || c.telefono);

    // FILTRADO DINÁMICO DE AUDIENCIA
    const targetCustomers = useMemo(() => {
        if (!customers || customers.length === 0) return [];
        const now = Date.now();

        switch (audienceType) {
            case 'all':
                return customers.filter(hasPhone);

            case 'vips':
                if (paretoCustomers && paretoCustomers.length > 0) {
                    return paretoCustomers.filter(hasPhone);
                }
                return customers.slice(0, Math.ceil(customers.length * 0.2)).filter(hasPhone);

            case 'debtors':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    const balance = Number((c as any).balanceUSD || (c as any).currentBalanceUSD || (c as any).saldoPendienteUSD || 0);
                    return balance > 0;
                });

            case 'mora_critica':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    const daysOverdue = Number((c as any).daysOverdue || (c as any).diasMora || 0);
                    const balance = Number((c as any).balanceUSD || (c as any).currentBalanceUSD || (c as any).saldoPendienteUSD || 0);
                    return balance > 0 && daysOverdue > 15;
                });

            case 'dormant':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    let lastMillis = 0;
                    if (c.lastOrderDate) {
                        if (typeof (c.lastOrderDate as any).toMillis === 'function') {
                            lastMillis = (c.lastOrderDate as any).toMillis();
                        } else if (c.lastOrderDate instanceof Date) {
                            lastMillis = c.lastOrderDate.getTime();
                        }
                    }
                    const daysSince = lastMillis > 0 ? (now - lastMillis) / 86_400_000 : 999;
                    return daysSince > 30;
                });

            case 'new':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    let createdMillis = 0;
                    if ((c as any).createdAt) {
                        if (typeof (c as any).createdAt.toMillis === 'function') {
                            createdMillis = (c as any).createdAt.toMillis();
                        } else if ((c as any).createdAt instanceof Date) {
                            createdMillis = (c as any).createdAt.getTime();
                        }
                    }
                    const days = createdMillis > 0 ? (now - createdMillis) / 86_400_000 : 999;
                    return days <= 30;
                });

            case 'by_salesperson':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    if (selectedSalesperson === 'all') return true;
                    const sp = (c as any).salesperson || (c as any).vendedor || (c as any).salespersonName;
                    return String(sp).trim().toLowerCase() === selectedSalesperson.toLowerCase();
                });

            case 'by_discipline':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    if (selectedDiscipline === 'all') return true;
                    const disc = (c as any).preferredDiscipline || (c as any).discipline;
                    return disc && String(disc).toLowerCase().includes(selectedDiscipline.toLowerCase());
                });

            case 'manual':
                return customers.filter(c => hasPhone(c) && Boolean(c.id && selectedCustomerIds.has(c.id)));

            default:
                return customers.filter(hasPhone);
        }
    }, [customers, audienceType, paretoCustomers, selectedSalesperson, selectedDiscipline, selectedCustomerIds]);

    // MANEJO DE SELECCIÓN MANUAL DE CLIENTES
    const filteredManualCustomers = useMemo(() => {
        if (!manualSearch.trim()) return customers.filter(hasPhone);
        const q = manualSearch.toLowerCase();
        return customers.filter(c => {
            if (!hasPhone(c)) return false;
            const name = (c.razonSocial || (c as any).nombre || '').toLowerCase();
            const rif = (c.rif || '').toLowerCase();
            const phone = (c.phone || (c as any).whatsappPhone || '').toLowerCase();
            return name.includes(q) || rif.includes(q) || phone.includes(q);
        });
    }, [customers, manualSearch]);

    const toggleSelectCustomer = (id: string) => {
        setSelectedCustomerIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllManual = () => {
        if (selectedCustomerIds.size === filteredManualCustomers.length) {
            setSelectedCustomerIds(new Set());
        } else {
            setSelectedCustomerIds(new Set(filteredManualCustomers.map(c => c.id).filter(Boolean) as string[]));
        }
    };

    // PLANTILLAS RÁPIDAS
    const handleApplyTemplate = (type: 'divisas' | 'reactivacion' | 'stock' | 'cobranza' | 'mora_critica') => {
        if (type === 'divisas') {
            setTitle('Aprovecha la Política Comercial Oficial');
            setMessage(
                `Estimado(a) {{nombre}},\n\n` +
                `Te recordamos las condiciones preferenciales para pedidos mayoristas en Athleticenter:\n\n` +
                `💵 *25% de descuento* cancelando en divisas / efectivo sobre precio de lista.\n` +
                `✅ *10% adicional* por pago de contado dentro del plazo pactado.\n\n` +
                `¿Deseas cotizar algún pedido para despacho esta semana? Estamos a tu orden.`
            );
        } else if (type === 'reactivacion') {
            setTitle('Te extrañamos en la cancha');
            setMessage(
                `Hola {{nombre}}, un saludo cordial del equipo de Athleticenter.\n\n` +
                `Queremos ponernos a tu disposición con nuestra nueva línea de balones y artículos deportivos disponibles para entrega inmediata con precios mayoristas.\n\n` +
                `¿Te gustaría recibir nuestro catálogo actualizado? Responde a este mensaje y con gusto te lo enviamos.`
            );
        } else if (type === 'stock') {
            setTitle('Nuevos Ingresos en Almacén');
            setMessage(
                `¡Hola {{nombre}}! Acaba de ingresar nuevo lote de mercancía deportiva a nuestro centro de distribución.\n\n` +
                `📦 Stock disponible para entrega inmediata a nivel nacional.\n` +
                `🚚 Fletes coordinados con las principales agencias del país.\n\n` +
                `Comunícate con nosotros para apartar tus unidades antes de que se agoten.`
            );
        } else if (type === 'cobranza') {
            setTitle('Recordatorio de Vencimiento de Factura');
            setMessage(
                `Estimado(a) {{nombre}}, un cordial saludo de Athleticenter.\n\n` +
                `Le contactamos cordialmente para coordinar la conciliación de su saldo pendiente en cuenta por un monto de *${'{{saldo_usd}}'} USD* (o al cambio oficial BCV).\n\n` +
                `Agradecemos remitir el comprobante de transferencia o programar el pago en divisas para mantener su línea de crédito activa y sin interrupciones en sus despachos.`
            );
        } else if (type === 'mora_critica') {
            setTitle('Atención Urgente: Estado de Cuenta en Mora');
            setMessage(
                `Estimado(a) {{nombre}},\n\n` +
                `Nos comunicamos formalmente del departamento de Administración de Athleticenter.\n\n` +
                `Registramos facturas vencidas en su expediente con más de 15 días de vencimiento. Le solicitamos ponerse en contacto a la brevedad posible para conciliar el pago y evitar la suspensión temporal de nuevos despachos.\n\n` +
                `Agradecemos su pronta atención para regularizar su estatus comercial.`
            );
        }
    };

    // SELECCIONAR PRODUCTO PARA AUTORELLENAR
    const handleProductSelect = (prod: Product | null) => {
        if (!prod) {
            setSelectedProductSku('');
            return;
        }
        setSelectedProductSku(prod.sku);
        const rawPrice = Number(prod.price || prod.priceCashUSD || 0);
        const priceDivisas = (rawPrice * 0.75).toFixed(2);
        setTitle(`🔥 ¡Nuevo Ingreso: ${prod.name}!`);
        setMessage(
            `Estimado(a) {{nombre}},\n\n` +
            `Te presentamos el producto *${prod.name}* (Ref: ${prod.sku}).\n\n` +
            `🏆 *Precio Lista:* ${rawPrice.toFixed(2)}\n` +
            `💵 *Precio en Divisas (25% desc.):* ${priceDivisas}\n` +
            `📦 Stock disponible para despacho inmediato a nivel nacional.\n\n` +
            `¿Deseas apartar tus unidades para entrega esta semana?`
        );
        if (prod.imageUrl) {
            setMediaUrl(prod.imageUrl);
            setMediaType('image');
        }
    };

    // CARGA DE ARCHIVO LOCAL DE GRAN CAPACIDAD HASTA 250 MB (PDF, VIDEO O IMAGEN VÍA CLOUD STORAGE)
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

        if (!isVideo && !isImage && !isPdf) {
            toast({
                variant: 'destructive',
                title: 'Formato no soportado',
                description: 'Por favor selecciona un catálogo en formato PDF, video (MP4) o imagen (JPG/PNG).'
            });
            return;
        }

        const maxSize = 250 * 1024 * 1024;
        if (file.size > maxSize) {
            toast({
                variant: 'destructive',
                title: 'Archivo excede 250 MB',
                description: 'El tamaño máximo soportado por catálogo PDF o video HD es de 250 MB.'
            });
            return;
        }

        if (!storage) return;

        setIsUploadingMedia(true);
        setMediaUploadProgress(0);
        try {
            const uploaded = await uploadLargeFileToStorage({
                storage,
                folder: 'broadcast-media',
                file,
                onProgress: (pct) => setMediaUploadProgress(pct),
            });

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            setMediaUrl(uploaded.downloadUrl);
            setMediaType(isPdf ? 'pdf' : isVideo ? 'video' : 'image');
            setMediaFileName(file.name);
            setMediaFileSize(`${sizeMb} MB`);
            toast({
                title: isPdf ? '📄 Catálogo PDF de Alta Capacidad listo' : isVideo ? '🎥 Video cargado con éxito' : '🖼️ Imagen cargada con éxito',
                description: `${file.name} (${sizeMb} MB) sincronizado en la nube.`
            });
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error subiendo archivo',
                description: err?.message || 'No se pudo subir el catálogo a Cloud Storage.'
            });
        } finally {
            setIsUploadingMedia(false);
            setMediaUploadProgress(0);
            e.target.value = '';
        }
    };

    // INSERCIÓN DE VARIABLES DINÁMICAS
    const insertVariable = (variable: string) => {
        setMessage(prev => `${prev} ${variable} `);
    };

    // ENVÍO DE PRUEBA PREVIA A UN NÚMERO INDIVIDUAL
    const handleSendTest = async () => {
        if (!testPhone.trim() || testPhone.length < 10) {
            toast({
                variant: 'destructive',
                title: 'Número inválido',
                description: 'Ingresa un número telefónico válido (ej. 04122683183 o +584122683183).'
            });
            return;
        }

        if (!title.trim() || !message.trim()) {
            toast({
                variant: 'destructive',
                title: 'Mensaje vacío',
                description: 'Escribe un título y mensaje antes de enviar la prueba.'
            });
            return;
        }

        setIsSendingTest(true);
        try {
            const res = await authFetch('/api/marketing/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    isTest: true,
                    testNumber: testPhone.trim(),
                    title: title.trim(),
                    message: message.trim(),
                    mediaUrl: mediaType !== 'none' ? mediaUrl.trim() : null,
                    mediaType,
                    mediaFileName: mediaType === 'pdf' ? mediaFileName : undefined,
                })
            });

            const data = await res.json();
            if (data.success) {
                toast({
                    title: '✅ Prueba enviada exitosamente',
                    description: `Revisa tu WhatsApp en ${testPhone} para verificar el formato y video.`
                });
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Fallo al enviar prueba',
                    description: data.error || 'No se pudo conectar con el gateway de WhatsApp.'
                });
            }
        } catch (e: any) {
            toast({
                variant: 'destructive',
                title: 'Error de conexión',
                description: e.message || 'No se pudo contactar el servidor.'
            });
        } finally {
            setIsSendingTest(false);
        }
    };

    // LANZAMIENTO OFICIAL DE LA CAMPAÑA
    const handleLaunchBroadcast = async () => {
        if (!title.trim() || !message.trim()) {
            toast({
                variant: 'destructive',
                title: 'Faltan datos obligatorios',
                description: 'Por favor ingresa el título y el mensaje de la campaña.'
            });
            return;
        }

        if (targetCustomers.length === 0) {
            toast({
                variant: 'destructive',
                title: 'Audiencia sin teléfonos válidos',
                description: 'No hay clientes con teléfono en el segmento seleccionado.'
            });
            return;
        }

        setIsSubmitting(true);

        try {
            const recipientsPayload = targetCustomers.map(c => ({
                id: c.id,
                name: c.razonSocial || (c as any).nombre || 'Cliente',
                phone: c.phone || (c as any).whatsappPhone || (c as any).telefono || ''
            }));

            const res = await authFetch('/api/marketing/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    message: message.trim(),
                    mediaUrl: mediaType !== 'none' ? mediaUrl.trim() : null,
                    mediaType,
                    mediaFileName: mediaType === 'pdf' ? mediaFileName : undefined,
                    audienceType,
                    recipients: recipientsPayload,
                    userId: profile?.id || 'admin',
                    userName: profile?.name || 'Administrador'
                })
            });

            const data = await res.json();

            if (data.success) {
                toast({
                    title: '🚀 Difusión encolada exitosamente',
                    description: `Se enviará a ${data.totalTarget} clientes con protección anti-bloqueo (jitter 8-14s y pausas por lotes). Puedes cerrar esta pantalla.`
                });
                onOpenChange(false);
                if (onCampaignCreated) onCampaignCreated();
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Error iniciando campaña',
                    description: data.error || 'No se pudo iniciar el proceso de difusión.'
                });
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Fallo de conexión',
                description: err.message || 'Error de red con el servidor de difusión.'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={isSubmitting ? undefined : onOpenChange}>
            <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col max-h-[94vh]">
                <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white shrink-0 relative">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3.5 rounded-2xl bg-primary/20 text-primary shadow-xl shrink-0">
                                <Megaphone className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                                    Difusión Masiva & Campañas Multimedia
                                    <Badge className="bg-emerald-500/20 text-emerald-400 border-none text-[8px] font-black uppercase">
                                        Gateway São Paulo 24/7
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription className="text-slate-400 font-medium text-xs mt-1">
                                    Envía videos, ofertas, catálogos y avisos de cobranza con segmentación inteligente y protección anti-bloqueo.
                                </DialogDescription>
                            </div>
                        </div>
                    </div>
                </DialogHeader>

                <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden">
                    {/* COLUMNA IZQUIERDA: CONFIGURADOR CON TABS */}
                    <div className="lg:col-span-7 p-6 overflow-y-auto space-y-6 border-r border-slate-100 max-h-[calc(94vh-170px)]">
                        <Tabs defaultValue="content" className="w-full">
                            <TabsList className="grid grid-cols-3 bg-slate-100 p-1 rounded-2xl mb-4">
                                <TabsTrigger value="content" className="rounded-xl text-[10px] font-black uppercase">
                                    1. Contenido
                                </TabsTrigger>
                                <TabsTrigger value="audience" className="rounded-xl text-[10px] font-black uppercase">
                                    2. Audiencia ({targetCustomers.length})
                                </TabsTrigger>
                                <TabsTrigger value="preview" className="rounded-xl text-[10px] font-black uppercase">
                                    3. Prueba Previa
                                </TabsTrigger>
                            </TabsList>

                            {/* TAB 1: CONTENIDO Y MULTIMEDIA */}
                            <TabsContent value="content" className="space-y-4">
                                {/* Plantillas Rápidas */}
                                <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                        <Sparkles className="h-3.5 w-3.5 text-primary" /> Plantillas Comerciales Predefinidas
                                    </label>
                                    <div className="flex flex-wrap gap-1.5">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-[8px] font-black uppercase rounded-lg"
                                            onClick={() => handleApplyTemplate('divisas')}
                                        >
                                            <Percent className="h-2.5 w-2.5 mr-1 text-primary" /> 25% + 10% Divisas
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-[8px] font-black uppercase rounded-lg"
                                            onClick={() => handleApplyTemplate('stock')}
                                        >
                                            <Megaphone className="h-2.5 w-2.5 mr-1 text-emerald-500" /> Ingreso de Mercancía
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-[8px] font-black uppercase rounded-lg"
                                            onClick={() => handleApplyTemplate('cobranza')}
                                        >
                                            <Clock className="h-2.5 w-2.5 mr-1 text-amber-500" /> Cobranza Preventiva
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 text-[8px] font-black uppercase rounded-lg"
                                            onClick={() => handleApplyTemplate('mora_critica')}
                                        >
                                            <AlertTriangle className="h-2.5 w-2.5 mr-1 text-rose-500" /> Mora Crítica
                                        </Button>
                                    </div>
                                </div>

                                {/* Autocompletar con Producto */}
                                {products && products.length > 0 && (
        <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-primary" /> Vincular Producto del Inventario (Filtro por Nombre, Marca, Disciplina, Stock)
            </label>
            <InventoryProductPicker
                products={products}
                selectedProductSku={selectedProductSku}
                onSelectProduct={handleProductSelect}
            />
        </div>
    )}

                                {/* Título de la Campaña */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                        Título del Mensaje
                                    </label>
                                    <Input
                                        placeholder="Ej: 🔥 Promoción Especial de Balones Profesionales"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        className="h-10 rounded-xl font-bold text-xs"
                                    />
                                </div>

                                {/* Variables dinámicas */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] font-black uppercase text-slate-400">Insertar variable:</span>
                                    <button
                                        type="button"
                                        onClick={() => insertVariable('{{nombre}}')}
                                        className="text-[9px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded hover:bg-primary/20"
                                    >
                                        {'{{nombre}}'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertVariable('{{empresa}}')}
                                        className="text-[9px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded hover:bg-slate-200"
                                    >
                                        {'{{empresa}}'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertVariable('{{saldo_usd}}')}
                                        className="text-[9px] font-mono font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded hover:bg-rose-100"
                                    >
                                        {'{{saldo_usd}}'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertVariable('{{tasa_bcv}}')}
                                        className="text-[9px] font-mono font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded hover:bg-amber-100"
                                    >
                                        {'{{tasa_bcv}}'}
                                    </button>
                                </div>

                                {/* Cuerpo del Mensaje */}
                                <div className="space-y-1.5">
                                    <Textarea
                                        rows={4}
                                        placeholder="Escribe el mensaje publicitario o aviso..."
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        className="rounded-xl font-medium text-xs leading-relaxed"
                                    />
                                </div>

                                {/* Adjunto Multimedia (PDF, Video o Imagen) */}
                                <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                                            {mediaType === 'pdf' ? <FileText className="h-3.5 w-3.5 text-red-600" /> : mediaType === 'video' ? <Video className="h-3.5 w-3.5 text-purple-600" /> : <ImageIcon className="h-3.5 w-3.5 text-primary" />}
                                            Adjunto (PDF, Video MP4 o Foto)
                                        </label>
                                        {mediaUrl && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => { setMediaUrl(''); setMediaType('none'); setMediaFileName(''); setMediaFileSize(''); }}
                                                className="h-6 text-[8px] text-rose-500 font-bold uppercase p-0"
                                            >
                                                Quitar archivo
                                            </Button>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="application/pdf,video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                                            className="hidden"
                                            onChange={handleFileUpload}
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={isUploadingMedia}
                                            className="h-8 text-[9px] font-black uppercase rounded-xl flex items-center gap-1"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            {isUploadingMedia ? (
                                                <>
                                                    <Loader2 className="h-3 w-3 animate-spin" /> Subiendo {mediaUploadProgress}%...
                                                </>
                                            ) : (
                                                <>
                                                    <Upload className="h-3 w-3" /> Subir Catálogo PDF (Hasta 250 MB), Video o Foto
                                                </>
                                            )}
                                        </Button>
                                    </div>

                                    {mediaUrl && (
                                        <div className="mt-2 p-2 bg-white rounded-xl border border-slate-200">
                                            {mediaType === 'pdf' ? (
                                                <div className="flex items-center gap-2.5 p-2 bg-red-50/60 rounded-lg border border-red-200">
                                                    <div className="h-8 w-8 rounded bg-red-600 text-white flex items-center justify-center font-black text-[10px] shrink-0">
                                                        PDF
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[11px] font-bold text-slate-800 truncate">{mediaFileName || 'Catalogo_Athleticenter.pdf'}</p>
                                                        <p className="text-[9px] text-slate-500 font-mono">{mediaFileSize || 'Documento adjunto'}</p>
                                                    </div>
                                                </div>
                                            ) : mediaType === 'video' ? (
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-1.5 text-purple-700 text-[10px] font-black">
                                                        <Video className="h-3.5 w-3.5" /> Video MP4 adjunto
                                                    </div>
                                                    <video
                                                        src={mediaUrl}
                                                        controls
                                                        className="w-full max-h-36 rounded-lg bg-black object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-1.5 text-blue-700 text-[10px] font-black">
                                                        <ImageIcon className="h-3.5 w-3.5" /> Imagen adjunta
                                                    </div>
                                                    <img
                                                        src={mediaUrl}
                                                        alt="Preview"
                                                        className="w-full max-h-36 rounded-lg object-contain bg-slate-100"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            {/* TAB 2: AUDIENCIA Y SEGMENTACIÓN */}
                            <TabsContent value="audience" className="space-y-4">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                    <Users className="h-3.5 w-3.5" /> Selecciona el Criterio de Segmentación
                                </label>

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {[
                                        { id: 'all', label: 'Todos los Clientes', desc: 'Cartera Total' },
                                        { id: 'vips', label: 'Clientes VIP (80/20)', desc: 'Mayor Facturación' },
                                        { id: 'debtors', label: 'Con Deuda Pendiente', desc: 'Facturas por Cobrar' },
                                        { id: 'mora_critica', label: 'Mora Crítica (>15d)', desc: 'Facturas Vencidas' },
                                        { id: 'dormant', label: 'Inactivos (+30 Días)', desc: 'Cuentas por Reactivar' },
                                        { id: 'new', label: 'Nuevos Registrados', desc: 'Últimos 30 días' },
                                        { id: 'by_salesperson', label: 'Por Vendedor', desc: 'Cartera de Asesor' },
                                        { id: 'by_discipline', label: 'Por Disciplina', desc: 'Interés Deportivo' },
                                        { id: 'manual', label: 'Selección Manual', desc: 'Elegir uno a uno' },
                                    ].map(item => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => setAudienceType(item.id as any)}
                                            className={`p-3 rounded-2xl border text-left transition-all ${
                                                audienceType === item.id
                                                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                            }`}
                                        >
                                            <p className="text-[10px] font-black uppercase text-slate-900 leading-tight">{item.label}</p>
                                            <p className="text-[8px] text-slate-400 font-bold uppercase mt-0.5">{item.desc}</p>
                                        </button>
                                    ))}
                                </div>

                                {/* Filtro adicional por vendedor */}
                                {audienceType === 'by_salesperson' && (
                                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                                        <label className="text-[10px] font-black uppercase text-slate-600">Filtrar por Vendedor Asignado:</label>
                                        <select
                                            className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase"
                                            value={selectedSalesperson}
                                            onChange={(e) => setSelectedSalesperson(e.target.value)}
                                        >
                                            <option value="all">-- Todos los Vendedores --</option>
                                            {availableSalespeople.map(sp => (
                                                <option key={sp} value={sp}>{sp}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Filtro adicional por disciplina */}
                                {audienceType === 'by_discipline' && (
                                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                                        <label className="text-[10px] font-black uppercase text-slate-600">Filtrar por Disciplina Deportiva:</label>
                                        <select
                                            className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase"
                                            value={selectedDiscipline}
                                            onChange={(e) => setSelectedDiscipline(e.target.value)}
                                        >
                                            <option value="all">-- Todas las Disciplinas --</option>
                                            {availableDisciplines.map(d => (
                                                <option key={d} value={d}>{d}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Selector manual con buscador y checkboxes */}
                                {audienceType === 'manual' && (
                                    <div className="space-y-2 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                                <Input
                                                    placeholder="Buscar cliente por nombre o RIF..."
                                                    value={manualSearch}
                                                    onChange={(e) => setManualSearch(e.target.value)}
                                                    className="h-8 pl-8 rounded-xl text-xs bg-white"
                                                />
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={toggleSelectAllManual}
                                                className="h-8 text-[9px] font-black uppercase rounded-xl shrink-0"
                                            >
                                                {selectedCustomerIds.size === filteredManualCustomers.length ? 'Deseleccionar Todos' : 'Marcar Todos'}
                                            </Button>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-100">
                                            {filteredManualCustomers.map(c => {
                                                const isChecked = Boolean(c.id && selectedCustomerIds.has(c.id));
                                                return (
                                                    <div
                                                        key={c.id}
                                                        onClick={() => { if (c.id) toggleSelectCustomer(c.id); }}
                                                        className={cn(
                                                            "p-2 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-xs",
                                                            isChecked ? "bg-primary/10 text-primary font-bold" : "hover:bg-white text-slate-700"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={() => {}}
                                                                className="rounded border-slate-300 text-primary"
                                                            />
                                                            <span className="uppercase text-[11px] font-bold">{c.razonSocial || (c as any).nombre}</span>
                                                        </div>
                                                        <span className="font-mono text-[10px] text-slate-500">{c.phone || (c as any).whatsappPhone}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20 flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-700">Total Destinatarios con Teléfono Válido:</span>
                                    <Badge className="bg-primary text-white text-xs font-mono font-black">
                                        {targetCustomers.length} Clientes
                                    </Badge>
                                </div>
                            </TabsContent>

                            {/* TAB 3: PRUEBA PREVIA Y SIMULADOR */}
                            <TabsContent value="preview" className="space-y-4">
                                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/80 space-y-3">
                                    <div className="flex items-center gap-2 text-amber-900 font-black text-xs uppercase">
                                        <Phone className="h-4 w-4 text-amber-600" />
                                        Enviar Prueba Previa a mi WhatsApp
                                    </div>
                                    <p className="text-[10px] text-amber-800">
                                        Valida cómo se visualiza el video o foto y el mensaje en tu teléfono real antes de lanzarlo a toda la base.
                                    </p>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="Ej: 04122683183"
                                            value={testPhone}
                                            onChange={(e) => setTestPhone(e.target.value)}
                                            className="h-10 rounded-xl bg-white font-mono text-xs"
                                        />
                                        <Button
                                            type="button"
                                            disabled={isSendingTest || !testPhone.trim()}
                                            onClick={handleSendTest}
                                            className="h-10 px-4 rounded-xl bg-amber-600 text-white font-black uppercase text-[10px] hover:bg-amber-700 shrink-0"
                                        >
                                            {isSendingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Disparar Prueba'}
                                        </Button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/60 flex items-start gap-3">
                                    <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-black uppercase text-emerald-900 tracking-wide">
                                            Protección Anti-Bloqueo de 3 Niveles
                                        </p>
                                        <p className="text-[9px] text-emerald-700 font-medium leading-relaxed">
                                            1) Jitter humano aleatorio (8-14s entre mensajes).<br/>
                                            2) Pausa de enfriamiento (60s cada 20 envíos).<br/>
                                            3) Horario comercial estricto de Venezuela (8:00 AM - 7:00 PM).
                                        </p>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>

                    {/* COLUMNA DERECHA: SIMULADOR DE WHATSAPP EN VIVO */}
                    <div className="lg:col-span-5 bg-slate-100 p-6 flex flex-col items-center justify-center border-t lg:border-t-0 border-slate-200">
                        <div className="w-full max-w-[320px] rounded-[2rem] border-4 border-slate-800 bg-[#ECE5DD] shadow-2xl overflow-hidden flex flex-col h-[480px]">
                            {/* Cabecera WhatsApp */}
                            <div className="bg-[#075E54] text-white px-3 py-2.5 flex items-center justify-between shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="h-7 w-7 rounded-full bg-emerald-700 flex items-center justify-center font-black text-[10px]">
                                        A
                                    </div>
                                    <div>
                                        <p className="font-bold text-[11px] leading-tight">Athleticenter Pro</p>
                                        <p className="text-[8px] text-emerald-200">en línea</p>
                                    </div>
                                </div>
                            </div>

                            {/* Área de Mensajes */}
                            <div className="flex-1 p-3 overflow-y-auto space-y-2">
                                <div className="bg-white rounded-2xl rounded-tl-none p-3 shadow-sm border border-slate-200/60 max-w-[90%] space-y-2">
                                    {/* Previsualización de Multimedia o Documento PDF */}
                                    {mediaType === 'pdf' && (
                                        <div className="rounded-xl overflow-hidden bg-[#005c4b]/10 border border-[#005c4b]/20 p-2.5 flex items-center gap-2.5 shadow-sm">
                                            <div className="h-8 w-8 rounded bg-red-600 text-white flex items-center justify-center font-black text-[10px] shrink-0">
                                                PDF
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-bold text-slate-900 truncate">
                                                    {mediaFileName || 'Catalogo_Athleticenter.pdf'}
                                                </p>
                                                <p className="text-[9px] text-slate-500 font-mono">
                                                    {mediaFileSize || 'Documento PDF'} · Catálogo Oficial
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {mediaType === 'video' && mediaUrl && (
                                        <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center h-28 relative">
                                            <video src={mediaUrl} className="h-full w-full object-contain" />
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                <Play className="h-8 w-8 text-white/90 drop-shadow" />
                                            </div>
                                        </div>
                                    )}

                                    {mediaType === 'image' && mediaUrl && (
                                        <div className="rounded-xl overflow-hidden bg-slate-100 h-28">
                                            <img src={mediaUrl} alt="Adjunto" className="h-full w-full object-cover" />
                                        </div>
                                    )}

                                    {/* Cabecera del Mensaje */}
                                    <p className="font-bold text-[10px] text-slate-500 uppercase tracking-wider">*ATHLETICENTER*</p>
                                    {title && (
                                        <p className="font-black text-xs text-slate-900 leading-tight">*{title}*</p>
                                    )}

                                    {/* Cuerpo del Mensaje con renderizado simulado */}
                                    <p className="text-[10px] text-slate-800 whitespace-pre-wrap leading-relaxed">
                                        {message 
                                            ? message.replace(/{{nombre}}/gi, 'Deportes Caracas C.A.')
                                                     .replace(/{{empresa}}/gi, 'Deportes Caracas C.A.')
                                                     .replace(/{{saldo_usd}}/gi, '$450.00')
                                                     .replace(/{{tasa_bcv}}/gi, 'Bs. 36.50')
                                            : 'Escribe tu mensaje en la pestaña de Contenido para previsualizarlo aquí...'
                                        }
                                    </p>

                                    {/* Firma Institucional */}
                                    <div className="pt-1 border-t border-slate-100 text-[9px] text-slate-500">
                                        <span>Atentamente,<br/><b>El equipo de Athleticenter</b></span>
                                    </div>

                                    {/* Hora simulada */}
                                    <div className="text-right">
                                        <span className="text-[8px] text-slate-400">10:45 AM ✓✓</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={isSubmitting}
                        onClick={() => onOpenChange(false)}
                        className="rounded-xl font-black uppercase text-[10px]"
                    >
                        Cerrar
                    </Button>
                    <Button
                        type="button"
                        disabled={isSubmitting || targetCustomers.length === 0}
                        onClick={handleLaunchBroadcast}
                        className="h-12 px-6 sm:px-8 rounded-xl bg-slate-900 text-white hover:bg-primary font-black uppercase text-xs tracking-wider shadow-xl active:scale-95 transition-all flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Encolando Campaña...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4" /> Lanzar Difusión ({targetCustomers.length} Clientes)
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
