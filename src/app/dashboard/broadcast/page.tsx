'use client';

import React, { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser, useCollection, useFirestore, useMemoFirebase, useStorage } from '@/firebase';
import { uploadLargeFileToStorage } from '@/lib/large-file-upload';
import { collection, query, limit, orderBy, Timestamp } from 'firebase/firestore';
import type { Customer, Product, Order } from '@/lib/definitions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
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
    ArrowLeft,
    Play,
    Tag,
    Trash2,
    Check,
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

function BroadcastStudioContent() {
    const { profile, isUserLoading } = useUser();
    const router = useRouter();
    const searchParams = useSearchParams();
    const firestore = useFirestore();
    const storage = useStorage();
    const { toast } = useToast();

    // ESTADOS PRINCIPALES DEL MENSAJE
    const [audienceType, setAudienceType] = useState<ExtendedAudienceType>('all');
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
    const [activeTab, setActiveTab] = useState('content');

    // FILTROS AVANZADOS DE AUDIENCIA
    const [selectedSalesperson, setSelectedSalesperson] = useState<string>('all');
    const [selectedDiscipline, setSelectedDiscipline] = useState<string>('all');
    const [manualSearch, setManualSearch] = useState('');
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());

    // MODO PRUEBA
    const [testPhone, setTestPhone] = useState('');
    const [isSendingTest, setIsSendingTest] = useState(false);

    // REFERENCIA ARCHIVO MULTIMEDIA
    const fileInputRef = useRef<HTMLInputElement>(null);

    // CARGA DE DATOS DESDE FIRESTORE
    const isAdmin = !profile || ['superadmin', 'admin', 'gerencia', 'ventas'].includes(profile.role);

    useEffect(() => {
        if (!isUserLoading && profile && !isAdmin) {
            router.replace('/dashboard');
        }
    }, [isAdmin, isUserLoading, profile, router]);

    const customersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'customers'), limit(500)) : null, [firestore, isAdmin]);
    const productsQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'products'), limit(500)) : null, [firestore, isAdmin]);
    const ordersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'orders'), orderBy('orderDate', 'desc'), limit(500)) : null, [firestore, isAdmin]);

    const { data: allCustomers, isLoading: loadingCustomers } = useCollection<Customer>(customersQuery);
    const { data: allProducts, isLoading: loadingProducts } = useCollection<Product>(productsQuery);
    const { data: allOrders } = useCollection<Order>(ordersQuery);

    const customers = allCustomers || [];
    const products = allProducts || [];

    // CÁLCULO DE CLIENTES PARETO (TOP 20% FACTURACIÓN)
    const paretoCustomers = useMemo(() => {
        if (!customers.length || !allOrders?.length) return [];
        const customerRevenue = customers.map(c => {
            const total = allOrders
                .filter(o => o.customerId === c.id && o.status === 'Pagado')
                .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            return { customer: c, total };
        }).sort((a, b) => b.total - a.total);

        const top20Count = Math.max(1, Math.ceil(customerRevenue.length * 0.2));
        return customerRevenue.slice(0, top20Count).map(cr => cr.customer);
    }, [customers, allOrders]);

    // OBTENER QUERY PARAMS INICIALES
    useEffect(() => {
        if (!searchParams) return;
        const aud = searchParams.get('audience');
        if (aud && ['all', 'vips', 'debtors', 'mora_critica', 'dormant', 'new'].includes(aud)) {
            setAudienceType(aud as ExtendedAudienceType);
        }
    }, [searchParams]);

    // LISTAS AUXILIARES PARA FILTROS
    const availableSalespeople = useMemo(() => {
        const set = new Set<string>();
        customers.forEach(c => {
            const sp = (c as any).assignedSalespersonName || (c as any).salesperson || (c as any).vendedor || (c as any).salespersonName;
            if (sp) set.add(String(sp).trim());
        });
        return Array.from(set).sort();
    }, [customers]);

    const availableDisciplines = useMemo(() => {
        const set = new Set<string>();
        products.forEach(p => {
            const d = p.discipline || p.category;
            if (d) set.add(String(d).trim());
        });
        return Array.from(set).sort();
    }, [products]);

    const hasPhone = (c: any) => Boolean(c.phone || c.whatsappPhone || c.telefono);

    // FILTRADO DINÁMICO DE AUDIENCIA SEGÚN CRITERIO
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
                    const balance = Number((c as any).creditUsed || (c as any).balanceUSD || (c as any).currentBalanceUSD || (c as any).saldoPendienteUSD || 0);
                    return balance > 0;
                });

            case 'mora_critica':
                return customers.filter(c => {
                    if (!hasPhone(c)) return false;
                    const daysOverdue = Number((c as any).daysOverdue || (c as any).diasMora || 0);
                    const balance = Number((c as any).creditUsed || (c as any).balanceUSD || (c as any).currentBalanceUSD || (c as any).saldoPendienteUSD || 0);
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
                    const sp = (c as any).assignedSalespersonName || (c as any).salesperson || (c as any).vendedor || (c as any).salespersonName;
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

    // BÚSQUEDA Y SELECCIÓN MANUAL
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

    // PLANTILLAS COMERCIALES
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
                `Le contactamos cordialmente para coordinar la conciliación de su saldo pendiente en cuenta por un monto de *{{saldo_usd}} USD* (o al cambio oficial BCV).\n\n` +
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
        toast({
            title: 'Plantilla cargada',
            description: 'El texto ha sido actualizado. Puedes personalizarlo a continuación.'
        });
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
            `🏆 *Precio Lista:* $${rawPrice.toFixed(2)}\n` +
            `💵 *Precio en Divisas (25% desc.):* $${priceDivisas}\n` +
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

        const maxSize = 250 * 1024 * 1024; // 250 MB máximo en Cloud Storage
        if (file.size > maxSize) {
            toast({
                variant: 'destructive',
                title: 'Archivo excede 250 MB',
                description: 'El tamaño máximo soportado por catálogo PDF o video HD es de 250 MB.'
            });
            return;
        }

        if (!storage) {
            toast({
                variant: 'destructive',
                title: 'Almacenamiento no disponible',
                description: 'Espera un segundo mientras se sincroniza la sesión e intenta nuevamente.'
            });
            return;
        }

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
                description: `${file.name} (${sizeMb} MB) sincronizado en la nube listo para difusión.`
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

    // INSERCIÓN DE VARIABLES EN EL TEXTO
    const insertVariable = (varName: string) => {
        setMessage(prev => prev + ' ' + varName);
    };

    // ENVÍO DE PRUEBA PREVIA A WHATSAPP
    const handleSendTest = async () => {
        if (!testPhone.trim()) {
            toast({
                variant: 'destructive',
                title: 'Ingresa un número',
                description: 'Escribe tu número de WhatsApp para recibir la prueba previa.'
            });
            return;
        }

        if (!title.trim() && !message.trim() && !mediaUrl) {
            toast({
                variant: 'destructive',
                title: 'Mensaje vacío',
                description: 'Ingresa al menos un título o mensaje para enviar la prueba.'
            });
            return;
        }

        setIsSendingTest(true);
        try {
            const previewText = `*ATHLETICENTER*\n\n${title ? `*${title}*\n\n` : ''}${message}\n\nAtentamente,\n*El equipo de Athleticenter*`
                .replace(/{{nombre}}/gi, 'Cliente de Prueba')
                .replace(/{{empresa}}/gi, 'Empresa Demo')
                .replace(/{{saldo_usd}}/gi, '$450.00')
                .replace(/{{tasa_bcv}}/gi, 'Bs. 36.50');

            const res = await authFetch('/api/marketing/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `[TEST] ${title || 'Prueba de Campaña'}`,
                    message: previewText,
                    mediaUrl: mediaType !== 'none' ? mediaUrl : null,
                    mediaType,
                    mediaFileName: mediaType === 'pdf' ? mediaFileName : undefined,
                    audienceType: 'test',
                    isTest: true,
                    testNumber: testPhone.trim(),
                    testPhone: testPhone.trim(),
                    recipients: [{
                        id: 'test-recipient',
                        name: 'Destinatario de Prueba',
                        phone: testPhone.trim()
                    }],
                    userId: profile?.id || 'admin',
                    userName: profile?.name || 'Administrador'
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                toast({
                    title: '✅ Prueba enviada exitosamente',
                    description: `Revisa el WhatsApp del número ${testPhone} para comprobar video y texto.`
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
            if (res.ok && data.success) {
                toast({
                    title: '🚀 Campaña encolada con éxito',
                    description: `Se han programado ${data.enqueuedCount || targetCustomers.length} mensajes en São Paulo con cola de entrega segura.`
                });
                router.push('/dashboard/marketing?tab=campaigns');
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Error al lanzar campaña',
                    description: data.error || 'No se pudo registrar la campaña en el servidor.'
                });
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error inesperado',
                description: err.message || 'Error de red con el servidor de difusión.'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isUserLoading && !profile) {
        return (
            <div className="flex h-[75vh] flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Cargando Estudio de Difusión Masiva...
                </p>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col gap-6 pb-20 animate-in fade-in duration-500">
            {/* CONMUTADOR RÁPIDO DEL HUB COMERCIAL 360° */}
            <div className="flex flex-wrap items-center gap-2 bg-white/70 backdrop-blur-xl p-2.5 rounded-2xl ring-1 ring-black/5 shadow-sm">
                <Link
                    href="/dashboard/marketing?tab=arm"
                    className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-100 transition-all"
                >
                    🤖 Agente ARM (WhatsApp IA)
                </Link>
                <span className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest bg-emerald-600 text-white shadow-md">
                    📢 Estudio de Difusión
                </span>
                <Link
                    href="/dashboard/marketing?tab=pulse"
                    className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-100 transition-all"
                >
                    💓 Radar de Pulso
                </Link>
                <Link
                    href="/dashboard/marketing?tab=pareto"
                    className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-100 transition-all"
                >
                    🏆 Club Pareto (80/20)
                </Link>
                <Link
                    href="/dashboard/marketing?tab=leakage"
                    className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-100 transition-all"
                >
                    🚨 Capital en Fuga
                </Link>
                <Link
                    href="/dashboard/marketing?tab=campaigns"
                    className="px-4 py-2 rounded-xl font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-100 transition-all"
                >
                    📜 Historial Difusiones
                </Link>
            </div>

            {/* BARRA SUPERIOR DE NAVEGACIÓN Y ACCIONES */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 text-white rounded-3xl shadow-xl">
                <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                        <Link 
                            href="/dashboard/marketing"
                            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title="Volver a Marketing y Métricas"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                            <Megaphone className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight flex items-center gap-2.5">
                                Estudio de Difusión Masiva WhatsApp
                                <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-black uppercase px-2.5 py-0.5">
                                    Gateway São Paulo 24/7 Conectado
                                </Badge>
                            </h1>
                            <p className="text-xs text-slate-300 font-medium mt-0.5">
                                Envía campañas multimedia, videos MP4, ofertas comerciales y avisos de cobranza con segmentación y protección anti-bloqueo.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <Button
                        variant="outline"
                        onClick={() => setActiveTab('preview')}
                        className="h-11 px-4 rounded-xl bg-white/5 border-white/20 text-white hover:bg-white/10 text-xs font-bold uppercase"
                    >
                        <Phone className="h-4 w-4 mr-1.5 text-amber-400" /> Probar en mi WhatsApp
                    </Button>
                    <Button
                        disabled={isSubmitting || targetCustomers.length === 0}
                        onClick={handleLaunchBroadcast}
                        className="h-11 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black uppercase text-xs tracking-wider shadow-lg shadow-emerald-500/30 flex items-center gap-2 active:scale-95 transition-all"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Encolando...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4" /> Lanzar Campaña ({targetCustomers.length} Clientes)
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* WORKSPACE PRINCIPAL: LAYOUT DE 2 COLUMNAS AMPLIAS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* COLUMNA IZQUIERDA: CONFIGURADOR DE CAMPAÑA (8 COLUMNAS) */}
                <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                    <Card className="rounded-3xl border-slate-200 shadow-sm overflow-hidden bg-white">
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <div className="border-b border-slate-100 p-4 sm:p-6 bg-slate-50/50">
                                <TabsList className="grid grid-cols-3 bg-slate-200/70 p-1.5 rounded-2xl h-auto">
                                    <TabsTrigger value="content" className="rounded-xl py-2.5 text-xs font-black uppercase data-[state=active]:bg-white data-[state=active]:text-slate-900 shadow-sm">
                                        1. Contenido & Multimedia
                                    </TabsTrigger>
                                    <TabsTrigger value="audience" className="rounded-xl py-2.5 text-xs font-black uppercase data-[state=active]:bg-white data-[state=active]:text-slate-900 shadow-sm">
                                        2. Audiencia ({targetCustomers.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="preview" className="rounded-xl py-2.5 text-xs font-black uppercase data-[state=active]:bg-white data-[state=active]:text-slate-900 shadow-sm">
                                        3. Prueba Previa & Blindaje
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            <CardContent className="p-6 sm:p-8 space-y-6">
                                {/* ================= TAB 1: CONTENIDO Y MULTIMEDIA ================= */}
                                <TabsContent value="content" className="space-y-6 mt-0">
                                    {/* Plantillas Rápidas Oficiales */}
                                    <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                                <Sparkles className="h-4 w-4 text-emerald-600" /> Plantillas Comerciales Predefinidas
                                            </label>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">1 Clic para rellenar</span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-10 text-[10px] font-black uppercase rounded-xl border-slate-300 hover:bg-white hover:border-emerald-500 hover:text-emerald-700 transition-all text-left justify-start"
                                                onClick={() => handleApplyTemplate('divisas')}
                                            >
                                                <Percent className="h-3.5 w-3.5 mr-1.5 text-emerald-600 shrink-0" /> 25% + 10% Divisas
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-10 text-[10px] font-black uppercase rounded-xl border-slate-300 hover:bg-white hover:border-emerald-500 hover:text-emerald-700 transition-all text-left justify-start"
                                                onClick={() => handleApplyTemplate('stock')}
                                            >
                                                <Megaphone className="h-3.5 w-3.5 mr-1.5 text-blue-600 shrink-0" /> Nuevos Ingresos
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-10 text-[10px] font-black uppercase rounded-xl border-slate-300 hover:bg-white hover:border-amber-500 hover:text-amber-700 transition-all text-left justify-start"
                                                onClick={() => handleApplyTemplate('cobranza')}
                                            >
                                                <Clock className="h-3.5 w-3.5 mr-1.5 text-amber-500 shrink-0" /> Cobranza Preventiva
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-10 text-[10px] font-black uppercase rounded-xl border-slate-300 hover:bg-white hover:border-rose-500 hover:text-rose-700 transition-all text-left justify-start"
                                                onClick={() => handleApplyTemplate('mora_critica')}
                                            >
                                                <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-rose-500 shrink-0" /> Mora Crítica (&gt;15d)
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Selector Avanzado de Producto con Filtros de Inventario Maestro */}
                                    {products.length > 0 && (
                                        <div className="space-y-2">
                                            <label className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                                <Tag className="h-4 w-4 text-emerald-600" /> Vincular Producto del Inventario Maestro (Búsqueda por Nombre, Marca, Disciplina, Stock)
                                            </label>
                                            <InventoryProductPicker
                                                products={products}
                                                selectedProductSku={selectedProductSku}
                                                onSelectProduct={handleProductSelect}
                                            />
                                        </div>
                                    )}

                                    {/* Título de la Campaña */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-black uppercase tracking-wider text-slate-700">
                                            Título del Mensaje
                                        </label>
                                        <Input
                                            placeholder="Ej: 🔥 Promoción Especial de Balones Profesionales y Accesorios"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                            className="h-11 rounded-xl font-bold text-sm bg-slate-50 border-slate-200 focus:bg-white"
                                        />
                                    </div>

                                    {/* Inserción de variables dinámicas */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                                                Cuerpo del Mensaje
                                            </span>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">Variables:</span>
                                                <button
                                                    type="button"
                                                    onClick={() => insertVariable('{{nombre}}')}
                                                    className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-lg hover:bg-primary/20 transition-colors"
                                                >
                                                    {'{{nombre}}'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => insertVariable('{{empresa}}')}
                                                    className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg hover:bg-slate-200 transition-colors"
                                                >
                                                    {'{{empresa}}'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => insertVariable('{{saldo_usd}}')}
                                                    className="text-[10px] font-mono font-bold bg-rose-50 text-rose-700 px-2.5 py-1 rounded-lg hover:bg-rose-100 transition-colors"
                                                >
                                                    {'{{saldo_usd}}'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => insertVariable('{{tasa_bcv}}')}
                                                    className="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors"
                                                >
                                                    {'{{tasa_bcv}}'}
                                                </button>
                                            </div>
                                        </div>

                                        <Textarea
                                            rows={6}
                                            placeholder="Escribe el mensaje publicitario o aviso. Puedes usar negritas de WhatsApp colocando asteriscos como *este texto*..."
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            className="rounded-xl font-medium text-sm leading-relaxed p-4 bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                                        />
                                        <p className="text-[11px] text-slate-400 font-medium">
                                            {message.length} caracteres redactados. La firma institucional (*El equipo de Athleticenter*) se agrega automáticamente.
                                        </p>
                                    </div>

                                    {/* Carga Multimedia: Video MP4 o Foto */}
                                    <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <label className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                                    {mediaType === 'video' ? <Video className="h-4 w-4 text-purple-600" /> : <ImageIcon className="h-4 w-4 text-emerald-600" />}
                                                    Adjunto Multimedia (Video MP4 o Imagen)
                                                </label>
                                                <p className="text-[11px] text-slate-500 font-medium">
                                                    Soporta videos MP4 hasta 16 MB o imágenes JPG/PNG hasta 5 MB.
                                                </p>
                                            </div>
                                            {mediaUrl && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => { setMediaUrl(''); setMediaType('none'); }}
                                                    className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-bold uppercase rounded-lg flex items-center gap-1"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" /> Quitar archivo
                                                </Button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="application/pdf,video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                                                className="hidden"
                                                onChange={handleFileUpload}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={isUploadingMedia}
                                                onClick={() => fileInputRef.current?.click()}
                                                className="h-11 px-5 text-xs font-black uppercase rounded-xl border-dashed border-2 border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/50 flex items-center gap-2"
                                            >
                                                {isUploadingMedia ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> Subiendo {mediaUploadProgress}%...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload className="h-4 w-4 text-emerald-600" /> Subir Catálogo PDF (Hasta 250 MB), Video o Foto
                                                    </>
                                                )}
                                            </Button>
                                            <span className="text-xs text-slate-400 font-medium">
                                                {mediaUrl ? 'Archivo listo para transmisión' : 'Ningún archivo adjunto'}
                                            </span>
                                        </div>

                                        {mediaUrl && (
                                            <div className="p-4 bg-white rounded-2xl border border-slate-200">
                                                {mediaType === 'pdf' ? (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between text-red-700 text-xs font-black uppercase">
                                                            <span className="flex items-center gap-2">
                                                                <FileText className="h-4 w-4" /> Catálogo / Documento PDF Preparado
                                                            </span>
                                                            <Badge className="bg-red-100 text-red-800 border-none font-bold">PDF Oficial</Badge>
                                                        </div>
                                                        <div className="flex items-center gap-4 p-4 rounded-xl bg-red-50/60 border border-red-200">
                                                            <div className="h-12 w-12 rounded-xl bg-red-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
                                                                PDF
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-sm font-bold text-slate-800 truncate">{mediaFileName || 'Catalogo_Athleticenter.pdf'}</p>
                                                                <p className="text-xs text-slate-500 font-medium">{mediaFileSize || 'Documento adjunto para WhatsApp'}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : mediaType === 'video' ? (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between text-purple-700 text-xs font-black uppercase">
                                                            <span className="flex items-center gap-2">
                                                                <Video className="h-4 w-4" /> Video MP4 Preparado
                                                            </span>
                                                            <Badge className="bg-purple-100 text-purple-800 border-none">Video Nativo</Badge>
                                                        </div>
                                                        <video
                                                            src={mediaUrl}
                                                            controls
                                                            className="w-full max-h-56 rounded-xl bg-black object-contain shadow-md"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between text-blue-700 text-xs font-black uppercase">
                                                            <span className="flex items-center gap-2">
                                                                <ImageIcon className="h-4 w-4" /> Imagen Preparada
                                                            </span>
                                                            <Badge className="bg-blue-100 text-blue-800 border-none">Foto HD</Badge>
                                                        </div>
                                                        <img
                                                            src={mediaUrl}
                                                            alt="Preview"
                                                            className="w-full max-h-56 rounded-xl object-contain bg-slate-100 shadow-md"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                {/* ================= TAB 2: AUDIENCIA Y SEGMENTACIÓN ================= */}
                                <TabsContent value="audience" className="space-y-6 mt-0">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider">
                                                Criterio de Segmentación Inteligente
                                            </h3>
                                            <p className="text-xs text-slate-500 font-medium">
                                                Elige a qué grupo de clientes llegará este mensaje.
                                            </p>
                                        </div>
                                        <Badge className="bg-emerald-600 text-white text-xs font-mono font-black px-3 py-1">
                                            {targetCustomers.length} Clientes Seleccionados
                                        </Badge>
                                    </div>

                                    {/* 9 Variables de Segmentación en Grid Amplio */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {[
                                            { id: 'all', label: 'Todos los Clientes', desc: 'Universo total de la cartera activa' },
                                            { id: 'vips', label: 'Clientes VIP (Pareto 80/20)', desc: 'Clientes con mayor volumen de facturación' },
                                            { id: 'debtors', label: 'Con Deuda Pendiente', desc: 'Clientes con saldo a favor por cobrar' },
                                            { id: 'mora_critica', label: 'Mora Crítica (>15 Días)', desc: 'Facturas vencidas prioritarias' },
                                            { id: 'dormant', label: 'Inactivos (+30 Días)', desc: 'Sin compras en el último mes' },
                                            { id: 'new', label: 'Nuevos Registrados', desc: 'Ingresados en los últimos 30 días' },
                                            { id: 'by_salesperson', label: 'Por Vendedor Asignado', desc: 'Filtrar por asesor comercial' },
                                            { id: 'by_discipline', label: 'Por Disciplina Deportiva', desc: 'Segmentar según deporte de interés' },
                                            { id: 'manual', label: 'Selección Manual Uno a Uno', desc: 'Escoger con buscador y casillas' },
                                        ].map(item => {
                                            const isSelected = audienceType === item.id;
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => setAudienceType(item.id as any)}
                                                    className={cn(
                                                        "p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between gap-2",
                                                        isSelected
                                                            ? "border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-600/30 shadow-sm"
                                                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                                                    )}
                                                >
                                                    <div>
                                                        <div className="flex items-center justify-between">
                                                            <p className={cn("text-xs font-black uppercase tracking-tight", isSelected ? "text-emerald-950" : "text-slate-900")}>
                                                                {item.label}
                                                            </p>
                                                            {isSelected && <Check className="h-4 w-4 text-emerald-600" />}
                                                        </div>
                                                        <p className="text-[11px] text-slate-500 font-medium mt-1">
                                                            {item.desc}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Selector Específico por Vendedor */}
                                    {audienceType === 'by_salesperson' && (
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                                            <label className="text-xs font-black uppercase text-slate-700">
                                                Seleccionar Vendedor Asignado:
                                            </label>
                                            <select
                                                className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase focus:ring-2 focus:ring-emerald-500"
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

                                    {/* Selector Específico por Disciplina */}
                                    {audienceType === 'by_discipline' && (
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                                            <label className="text-xs font-black uppercase text-slate-700">
                                                Seleccionar Disciplina Deportiva:
                                            </label>
                                            <select
                                                className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase focus:ring-2 focus:ring-emerald-500"
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

                                    {/* Selector Manual con Tabla y Buscador */}
                                    {audienceType === 'manual' && (
                                        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                                                <div className="relative w-full sm:w-80">
                                                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                                    <Input
                                                        placeholder="Buscar cliente por nombre o RIF..."
                                                        value={manualSearch}
                                                        onChange={(e) => setManualSearch(e.target.value)}
                                                        className="h-10 pl-9 rounded-xl text-xs bg-white border-slate-200"
                                                    />
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={toggleSelectAllManual}
                                                    className="h-10 px-4 text-xs font-black uppercase rounded-xl border-slate-300 shrink-0"
                                                >
                                                    {selectedCustomerIds.size === filteredManualCustomers.length ? 'Deseleccionar Todos' : `Marcar Todos (${filteredManualCustomers.length})`}
                                                </Button>
                                            </div>

                                            <div className="max-h-72 overflow-y-auto space-y-1 rounded-xl border border-slate-200 bg-white p-2">
                                                {filteredManualCustomers.map(c => {
                                                    const isChecked = Boolean(c.id && selectedCustomerIds.has(c.id));
                                                    return (
                                                        <div
                                                            key={c.id}
                                                            onClick={() => { if (c.id) toggleSelectCustomer(c.id); }}
                                                            className={cn(
                                                                "p-3 rounded-xl flex items-center justify-between cursor-pointer transition-colors text-xs border border-transparent",
                                                                isChecked ? "bg-emerald-50 text-emerald-950 font-bold border-emerald-200" : "hover:bg-slate-50 text-slate-700"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={() => {}}
                                                                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                                />
                                                                <div>
                                                                    <p className="uppercase text-xs font-bold leading-tight">
                                                                        {c.razonSocial || (c as any).nombre}
                                                                    </p>
                                                                    <p className="text-[10px] text-slate-400 font-mono">
                                                                        {c.rif || 'Sin RIF'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">
                                                                {c.phone || (c as any).whatsappPhone}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </TabsContent>

                                {/* ================= TAB 3: PRUEBA PREVIA Y BLINDAJE ================= */}
                                <TabsContent value="preview" className="space-y-6 mt-0">
                                    <div className="p-6 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-4">
                                        <div className="flex items-center gap-2.5 text-amber-900 font-black text-sm uppercase">
                                            <Phone className="h-5 w-5 text-amber-600" />
                                            Enviar Mensaje de Prueba a mi WhatsApp Personal
                                        </div>
                                        <p className="text-xs text-amber-800 leading-relaxed font-medium">
                                            Ingresa tu número para recibir exactamente el video o imagen con el texto formateado en tu teléfono antes de ejecutar el despacho a toda la lista.
                                        </p>
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <Input
                                                placeholder="Ej: 04122683183 o +584122683183"
                                                value={testPhone}
                                                onChange={(e) => setTestPhone(e.target.value)}
                                                className="h-11 rounded-xl bg-white font-mono text-sm border-amber-300 max-w-md"
                                            />
                                            <Button
                                                type="button"
                                                disabled={isSendingTest || !testPhone.trim()}
                                                onClick={handleSendTest}
                                                className="h-11 px-6 rounded-xl bg-amber-600 text-white font-black uppercase text-xs hover:bg-amber-700 shadow-md shadow-amber-600/20 shrink-0"
                                            >
                                                {isSendingTest ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Transmitiendo...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Send className="h-4 w-4 mr-1.5" /> Disparar Prueba Inmediata
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Protocolo Anti-Bloqueo de São Paulo */}
                                    <div className="p-6 rounded-2xl bg-slate-900 text-white space-y-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                                                <ShieldCheck className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black uppercase tracking-wider text-white">
                                                    Blindaje Operativo Anti-Bloqueo (Motor São Paulo)
                                                </h4>
                                                <p className="text-xs text-slate-400">
                                                    Parámetros activos para proteger la línea contra suspensiones de WhatsApp.
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-1">
                                                <p className="text-[10px] font-black uppercase text-emerald-400">1. Jitter Humano</p>
                                                <p className="text-xs font-bold text-white">8 a 14 Segundos</p>
                                                <p className="text-[10px] text-slate-400">Retardo aleatorio variable entre cada mensaje saliente.</p>
                                            </div>
                                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-1">
                                                <p className="text-[10px] font-black uppercase text-blue-400">2. Enfriamiento</p>
                                                <p className="text-xs font-bold text-white">Pausa de 60 Segundos</p>
                                                <p className="text-[10px] text-slate-400">Descanso automático de la línea cada 20 mensajes.</p>
                                            </div>
                                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-1">
                                                <p className="text-[10px] font-black uppercase text-amber-400">3. Ventana Comercial</p>
                                                <p className="text-xs font-bold text-white">8:00 AM - 7:00 PM</p>
                                                <p className="text-[10px] text-slate-400">Entrega programada dentro del horario comercial de Venezuela.</p>
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>
                            </CardContent>
                        </Tabs>
                    </Card>
                </div>

                {/* COLUMNA DERECHA: SIMULADOR DE WHATSAPP EN TAMAÑO COMPLETO (4-5 COLUMNAS STICKY) */}
                <div className="lg:col-span-5 xl:col-span-4 sticky top-6 space-y-6">
                    <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                                Vista Previa en Tiempo Real
                            </span>
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        </div>

                        {/* Smartphone Mockup */}
                        <div className="w-full rounded-[2.5rem] border-8 border-slate-800 bg-[#ECE5DD] shadow-2xl overflow-hidden flex flex-col min-h-[520px]">
                            {/* Cabecera WhatsApp */}
                            <div className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between shrink-0 shadow-md">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-emerald-700 flex items-center justify-center font-black text-xs text-white border border-emerald-500/50">
                                        A
                                    </div>
                                    <div>
                                        <p className="font-bold text-xs leading-tight">Athleticenter Pro</p>
                                        <p className="text-[9px] text-emerald-200">en línea</p>
                                    </div>
                                </div>
                            </div>

                            {/* Área de Conversación */}
                            <div className="flex-1 p-3.5 overflow-y-auto space-y-2 bg-[#EFEAE2]">
                                <div className="bg-white rounded-2xl rounded-tl-none p-3.5 shadow-sm border border-slate-200 max-w-[95%] space-y-2.5">
                                    
                                    {/* Documento PDF, Video en Vivo o Imagen */}
                                    {mediaType === 'pdf' && (
                                        <div className="rounded-xl overflow-hidden bg-[#005c4b]/10 border border-[#005c4b]/20 p-3 flex items-center gap-3 shadow-sm">
                                            <div className="h-10 w-10 rounded-lg bg-red-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow">
                                                PDF
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-slate-900 truncate">
                                                    {mediaFileName || 'Catalogo_Athleticenter.pdf'}
                                                </p>
                                                <p className="text-[10px] text-slate-500 font-medium font-mono">
                                                    {mediaFileSize || 'Documento PDF'} · Catálogo Oficial
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {mediaType === 'video' && mediaUrl && (
                                        <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center min-h-[140px] relative shadow-inner">
                                            <video src={mediaUrl} className="w-full max-h-44 object-contain" />
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                                                <Play className="h-10 w-10 text-white/95 drop-shadow-lg" />
                                            </div>
                                        </div>
                                    )}

                                    {mediaType === 'image' && mediaUrl && (
                                        <div className="rounded-xl overflow-hidden bg-slate-100 max-h-48 shadow-inner">
                                            <img src={mediaUrl} alt="Adjunto" className="w-full h-full object-cover" />
                                        </div>
                                    )}

                                    {/* Cabecera Institucional */}
                                    <p className="font-black text-[11px] text-slate-500 uppercase tracking-widest">*ATHLETICENTER*</p>
                                    
                                    {title && (
                                        <p className="font-black text-sm text-slate-900 leading-tight">*{title}*</p>
                                    )}

                                    {/* Mensaje con variables simuladas */}
                                    <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                                        {message 
                                            ? message.replace(/{{nombre}}/gi, 'Deportes Caracas C.A.')
                                                     .replace(/{{empresa}}/gi, 'Deportes Caracas C.A.')
                                                     .replace(/{{saldo_usd}}/gi, '$450.00')
                                                     .replace(/{{tasa_bcv}}/gi, 'Bs. 36.50')
                                            : 'Escribe tu mensaje en la pestaña de Contenido para previsualizarlo aquí...'
                                        }
                                    </p>

                                    {/* Firma Oficial */}
                                    <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-600">
                                        <span>Atentamente,<br/><b>El equipo de Athleticenter</b></span>
                                    </div>

                                    {/* Timestamp y Visto */}
                                    <div className="text-right">
                                        <span className="text-[9px] text-slate-400 font-mono">10:45 AM ✓✓</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Resumen de Ejecución */}
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400">Destinatarios Listos:</span>
                                <span className="font-mono font-black text-white">{targetCustomers.length} Clientes</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400">Adjunto Multimedia:</span>
                                <span className="font-bold text-white capitalize">
                                    {mediaType === 'pdf' ? '📄 Catálogo PDF' : mediaType === 'video' ? '🎥 Video MP4' : mediaType === 'image' ? '🖼️ Imagen' : 'Ninguno (Solo Texto)'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400">Tiempo de Despacho Estimado:</span>
                                <span className="font-mono font-bold text-emerald-400">
                                    ~{Math.ceil((targetCustomers.length * 11) / 60)} min
                                </span>
                            </div>

                            <Button
                                disabled={isSubmitting || targetCustomers.length === 0}
                                onClick={handleLaunchBroadcast}
                                className="w-full h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black uppercase text-xs tracking-wider shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 mt-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" /> Programando Envíos...
                                    </>
                                ) : (
                                    <>
                                        <Send className="h-4 w-4" /> Lanzar Difusión ({targetCustomers.length} Clientes)
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default function BroadcastStudioPage() {
    return (
        <Suspense fallback={
            <div className="flex h-[75vh] flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Cargando Estudio de Difusión Masiva...
                </p>
            </div>
        }>
            <BroadcastStudioContent />
        </Suspense>
    );
}
