'use client';

import React, { useState } from 'react';
import { useUser } from '@/firebase';
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
    Percent
} from 'lucide-react';

interface BroadcastModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    customers: Customer[];
    products: Product[];
    paretoCustomers?: Customer[];
    onCampaignCreated?: () => void;
}

export function BroadcastCampaignModal({
    isOpen,
    onOpenChange,
    customers = [],
    products = [],
    paretoCustomers = [],
    onCampaignCreated
}: BroadcastModalProps) {
    const { profile } = useUser();
    const { toast } = useToast();

    const [audienceType, setAudienceType] = useState<'all' | 'vips' | 'dormant'>('all');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaType, setMediaType] = useState<'none' | 'image' | 'video'>('none');
    const [selectedProductSku, setSelectedProductSku] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filtrar audiencia seleccionada con cálculo riguroso de Pareto e Inactivos
    const targetCustomers = React.useMemo(() => {
        if (!customers || customers.length === 0) return [];

        const hasPhone = (c: any) => Boolean(c.phone || c.whatsappPhone || c.telefono);

        if (audienceType === 'all') {
            return customers.filter(hasPhone);
        }

        if (audienceType === 'vips') {
            if (paretoCustomers && paretoCustomers.length > 0) {
                return paretoCustomers.filter(hasPhone);
            }
            return customers.slice(0, Math.ceil(customers.length * 0.2)).filter(hasPhone);
        }

        if (audienceType === 'dormant') {
            const now = Date.now();
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
        }

        return customers.filter(hasPhone);
    }, [customers, audienceType, paretoCustomers]);

    // Plantillas oficiales predefinidas
    const handleApplyTemplate = (type: 'divisas' | 'reactivacion' | 'stock') => {
        if (type === 'divisas') {
            setTitle('Aprovecha la Política Comercial Oficial');
            setMessage(
                `Estimado(a) {{nombre}},\n\n` +
                `Te recordamos las condiciones preferenciales para pedidos mayoristas en Athleticenter:\n\n` +
                `💵 *25% de descuento* cancelando en divisas / efectivo sobre precio de lista.\n` +
                `✅ *10% adicional* por pago de la factura de contado dentro del plazo.\n\n` +
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
        }
    };

    const handleProductSelect = (sku: string) => {
        setSelectedProductSku(sku);
        const prod = products.find(p => p.sku === sku);
        if (prod) {
            setTitle(`🔥 ¡Nuevo Ingreso: ${prod.name}!`);
            setMessage(
                `Estimado(a) {{nombre}},\n\n` +
                `Te presentamos el producto *${prod.name}* (Ref: ${prod.sku}).\n\n` +
                `🏆 *Precio Lista:* $${prod.price || prod.priceCashUSD || '0.00'}\n` +
                `💵 *Precio en Divisas (25% desc.):* $${((Number(prod.price || prod.priceCashUSD || 0)) * 0.75).toFixed(2)}\n` +
                `📦 Stock disponible para despacho inmediato.\n\n` +
                `¿Te apartamos unidades para tu próximo pedido?`
            );
            if (prod.imageUrl) {
                setMediaUrl(prod.imageUrl);
                setMediaType('image');
            }
        }
    };

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
                    audienceType,
                    recipients: recipientsPayload,
                    userId: profile?.id || 'admin',
                    userName: profile?.name || 'Administrador'
                })
            });

            const data = await res.json();

            if (data.success) {
                toast({
                    title: '🚀 Difusión iniciada en segundo plano',
                    description: `Se están enviando los mensajes a ${data.totalTarget} clientes con protección anti-bloqueo (jitter 8-14s y pausas por lotes). Puedes cerrar esta pantalla.`
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
            <DialogContent className="max-w-[95vw] sm:max-w-3xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col max-h-[92vh]">
                <DialogHeader className="p-8 bg-slate-900 text-white shrink-0 relative">
                    <div className="flex items-center gap-4">
                        <div className="p-3.5 rounded-2xl bg-primary/20 text-primary shadow-xl shrink-0">
                            <Megaphone className="h-6 w-6" />
                        </div>
                        <div className="text-left">
                            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                                Difusión y Publicidad Masiva
                                <Badge className="bg-primary/20 text-primary border-none text-[8px] font-black uppercase">
                                    Anti-Bloqueo Activo
                                </Badge>
                            </DialogTitle>
                            <DialogDescription className="text-slate-400 font-medium text-xs mt-1">
                                Envía promociones oficiales, ofertas y catálogos en segundo plano a clientes segmentados.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="p-8 space-y-6 overflow-y-auto flex-1">
                    {/* 1. Audiencia */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <Users className="h-3.5 w-3.5" /> 1. Segmentar Audiencia
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                                { id: 'all', label: 'Todos los Clientes', desc: 'Cartera general' },
                                { id: 'vips', label: 'Clientes VIP (80/20)', desc: 'Mayor facturación real' },
                                { id: 'dormant', label: 'Inactivos (+30 Días)', desc: 'Cuentas por reactivar' }
                            ].map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setAudienceType(item.id as any)}
                                    className={`p-4 rounded-2xl border text-left transition-all ${
                                        audienceType === item.id
                                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                >
                                    <p className="text-[10px] font-black uppercase text-slate-900">{item.label}</p>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">{item.desc}</p>
                                    {audienceType === item.id && (
                                        <p className="text-xs font-black text-primary mt-2">
                                            {targetCustomers.length} con teléfono
                                        </p>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Atajos de Plantillas Oficiales */}
                    <div className="space-y-2 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Plantillas Comerciales Oficiales
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-xl text-[9px] font-black uppercase"
                                onClick={() => handleApplyTemplate('divisas')}
                            >
                                <Percent className="h-3 w-3 mr-1 text-primary" /> Política Divisas (25% + 10%)
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-xl text-[9px] font-black uppercase"
                                onClick={() => handleApplyTemplate('reactivacion')}
                            >
                                <Clock className="h-3 w-3 mr-1 text-amber-500" /> Reactivación de Inactivos
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-xl text-[9px] font-black uppercase"
                                onClick={() => handleApplyTemplate('stock')}
                            >
                                <Megaphone className="h-3 w-3 mr-1 text-emerald-500" /> Llegada de Mercancía
                            </Button>
                        </div>
                    </div>

                    {/* Autocompletar con Producto del Inventario */}
                    {products && products.length > 0 && (
                        <div className="space-y-2 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5 text-primary" /> Publicitar un Producto del Catálogo
                            </label>
                            <select
                                className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase text-slate-800"
                                value={selectedProductSku}
                                onChange={(e) => handleProductSelect(e.target.value)}
                            >
                                <option value="">-- Seleccionar producto para autorellenar texto y foto --</option>
                                {products.map(p => (
                                    <option key={p.id} value={p.sku}>
                                        {p.name} ({p.sku}) - Lista: ${p.price || p.priceCashUSD || 0}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Título y Mensaje */}
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Título del Mensaje
                            </label>
                            <Input
                                placeholder="Ej: 🔥 Promoción Especial de Balones Profesionales"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="h-11 rounded-xl font-bold text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    Cuerpo del Mensaje (Soporta variable {'{{nombre}}'})
                                </label>
                                <span className="text-[9px] text-slate-400 font-bold">Firma institucional automática</span>
                            </div>
                            <Textarea
                                rows={4}
                                placeholder="Escribe el mensaje publicitario..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                className="rounded-xl font-medium text-xs leading-relaxed"
                            />
                        </div>
                    </div>

                    {/* Multimedia */}
                    <div className="space-y-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <ImageIcon className="h-3.5 w-3.5" /> Adjuntar Fotografía (Se enviará con el texto)
                        </label>
                        <div className="flex gap-2 mb-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={mediaType === 'image' ? 'default' : 'outline'}
                                className="h-8 rounded-lg text-[9px] font-black uppercase"
                                onClick={() => setMediaType('image')}
                            >
                                <ImageIcon className="h-3 w-3 mr-1" /> Imagen (JPG/PNG)
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={mediaType === 'none' ? 'default' : 'outline'}
                                className="h-8 rounded-lg text-[9px] font-black uppercase"
                                onClick={() => { setMediaType('none'); setMediaUrl(''); }}
                            >
                                Solo Texto
                            </Button>
                        </div>
                        {mediaType === 'image' && (
                            <Input
                                placeholder="https://ejemplo.com/foto-producto.jpg (se autorrellena si eliges un producto)"
                                value={mediaUrl}
                                onChange={(e) => setMediaUrl(e.target.value)}
                                className="h-10 rounded-xl font-mono text-[11px] bg-white"
                            />
                        )}
                    </div>

                    {/* Aviso de Seguridad Anti-Bloqueo */}
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/60 flex items-start gap-3">
                        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                            <p className="text-[10px] font-black uppercase text-emerald-900 tracking-wide">
                                Protección Anti-Bloqueo Activada
                            </p>
                            <p className="text-[9px] text-emerald-700 font-medium leading-relaxed">
                                El despacho se procesará en segundo plano con intervalos orgánicos aleatorios (8 a 14 segundos) y pausas de enfriamiento cada 20 mensajes. Podrás cerrar el navegador sin interrumpir los envíos.
                            </p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={isSubmitting}
                        onClick={() => onOpenChange(false)}
                        className="rounded-xl font-black uppercase text-[10px]"
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        disabled={isSubmitting || targetCustomers.length === 0}
                        onClick={handleLaunchBroadcast}
                        className="h-12 px-8 rounded-xl bg-slate-900 text-white hover:bg-primary font-black uppercase text-xs tracking-wider shadow-xl active:scale-95 transition-all flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Programando despacho...
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
