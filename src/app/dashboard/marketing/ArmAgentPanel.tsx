'use client';

import React, { useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import {
    Bot,
    Flame,
    MessageSquare,
    Send,
    Sparkles,
    CheckCircle2,
    UserCheck,
    Calculator,
    Database,
    PhoneCall,
    Loader2,
    MapPin,
    Store,
    ExternalLink
} from 'lucide-react';

export function ArmAgentPanel() {
    const firestore = useFirestore();
    const { toast } = useToast();

    const [simPhone, setSimPhone] = useState('04122683183');
    const [simMessage, setSimMessage] = useState('Hola, somos Tienda El Golazo en Valencia, ¿tienen catálogo disponible y precios de balones?');
    const [simSendWhatsapp, setSimSendWhatsapp] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);
    const [simResult, setSimResult] = useState<any | null>(null);

    const hotLeadsQuery = useMemoFirebase(
        () => (firestore ? query(collection(firestore, 'crm_hot_leads'), orderBy('createdAt', 'desc'), limit(20)) : null),
        [firestore]
    );
    const inboundLogsQuery = useMemoFirebase(
        () => (firestore ? query(collection(firestore, 'whatsapp_inbound_logs'), orderBy('processedAt', 'desc'), limit(25)) : null),
        [firestore]
    );
    const enrichmentsQuery = useMemoFirebase(
        () => (firestore ? query(collection(firestore, 'crm_lead_enrichments'), orderBy('updatedAt', 'desc'), limit(20)) : null),
        [firestore]
    );

    const { data: hotLeads } = useCollection<any>(hotLeadsQuery);
    const { data: inboundLogs } = useCollection<any>(inboundLogsQuery);
    const { data: enrichments } = useCollection<any>(enrichmentsQuery);

    const handleSimulate = async () => {
        if (!simMessage.trim()) return;
        setIsSimulating(true);
        try {
            const res = await authFetch('/api/arm-agent/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: simPhone,
                    message: simMessage,
                    sendToWhatsapp: simSendWhatsapp,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setSimResult(data);
                toast({
                    title: simSendWhatsapp ? 'Respuesta enviada por WhatsApp' : 'Simulación completada',
                    description: `Intención detectada: ${data.intent}${data.isHotLead ? ' 🔥 (Lead Caliente)' : ''}`,
                });
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Error en Agente ARM',
                    description: data.error || 'No se pudo procesar el mensaje.',
                });
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error de conexión',
                description: err?.message || 'Error al comunicar con el servidor.',
            });
        } finally {
            setIsSimulating(false);
        }
    };

    const formatDate = (ts: any) => {
        if (!ts) return 'Reciente';
        try {
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        } catch {
            return 'Reciente';
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in-50 duration-500">
            {/* Banner de los 4 Pilares ARM */}
            <Card className="border-none shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden">
                <CardContent className="p-8 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                                <Bot className="h-8 w-8" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2.5">
                                    <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight">
                                        Agente Comercial Autónomo ARM (WhatsApp 24/7)
                                    </h2>
                                    <Badge className="bg-emerald-500 text-slate-950 font-black text-[9px] uppercase px-2.5 py-0.5 border-none">
                                        Activo 24/7
                                    </Badge>
                                </div>
                                <p className="text-xs text-slate-400 font-medium mt-1">
                                    Observa mensajes entrantes, consulta inventario en tiempo real, aplica cascada 25% + 10% y transfiere cierres calientes al equipo.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                            <div className="flex items-center gap-2 text-emerald-400 font-black text-[10px] uppercase tracking-wider">
                                <UserCheck className="h-4 w-4" /> 1. Califica Leads 24/7
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                Identifica clientes registrados por teléfono o perfila prospectos nuevos al instante.
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                            <div className="flex items-center gap-2 text-amber-400 font-black text-[10px] uppercase tracking-wider">
                                <Calculator className="h-4 w-4" /> 2. Cotiza con Cascada
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                Calcula Precio Lista, <strong>25% Divisas</strong> y <strong>10% Pronto Pago</strong> con stock y BCV.
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                            <div className="flex items-center gap-2 text-sky-400 font-black text-[10px] uppercase tracking-wider">
                                <Database className="h-4 w-4" /> 3. Mantiene el CRM
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                Extrae ciudad, nombre de tienda y productos consultados sin intervención manual.
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                            <div className="flex items-center gap-2 text-rose-400 font-black text-[10px] uppercase tracking-wider">
                                <PhoneCall className="h-4 w-4" /> 4. Hand-Off al Asesor
                            </div>
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                                Detecta intención de compra en caliente y dispara alerta inmediata al vendedor.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Simulador Interactivo + Respuesta en Tiempo Real */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <Card className="lg:col-span-6 border-none shadow-xl rounded-[2.5rem] bg-white p-8 space-y-6">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 text-emerald-600 font-black text-[10px] uppercase tracking-widest">
                            <Sparkles className="h-4 w-4" /> Laboratorio de Prueba en Vivo
                        </div>
                        <h3 className="text-lg font-black uppercase text-slate-900">
                            Simular Consulta de Cliente al Agente ARM
                        </h3>
                        <p className="text-xs text-slate-500">
                            Prueba cómo responde el agente usando tu inventario real, tasa BCV y política comercial.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {[
                            'Hola, somos Tienda El Golazo en Valencia, ¿tienen catálogo disponible?',
                            '¿Qué precio tienen los balones y cuánto queda pagando en divisas?',
                            'Quiero comprar 20 unidades de contado hoy mismo, pásame cuenta para pagar'
                        ].map((preset, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setSimMessage(preset)}
                                className="text-left text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 transition-colors"
                            >
                                &ldquo;{preset.slice(0, 58)}...&rdquo;
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Teléfono del Cliente / Prueba (Para verificar CRM o enviar a WhatsApp)
                            </label>
                            <Input
                                value={simPhone}
                                onChange={(e) => setSimPhone(e.target.value)}
                                placeholder="Ej: 04122683183"
                                className="h-11 rounded-xl font-mono text-xs"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Mensaje Entrante del Cliente
                            </label>
                            <Textarea
                                value={simMessage}
                                onChange={(e) => setSimMessage(e.target.value)}
                                rows={3}
                                className="rounded-xl text-xs font-medium"
                                placeholder="Escribe el mensaje que enviaría el cliente por WhatsApp..."
                            />
                        </div>

                        <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={simSendWhatsapp}
                                onChange={(e) => setSimSendWhatsapp(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            Enviar también la respuesta real al WhatsApp del número indicado arriba
                        </label>

                        <Button
                            onClick={handleSimulate}
                            disabled={isSimulating}
                            className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-wider shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                        >
                            {isSimulating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" /> Procesando con Gemini 2.5 Flash + Inventario...
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4" /> Probar Agente ARM Ahora
                                </>
                            )}
                        </Button>
                    </div>
                </Card>

                {/* Vista previa tipo WhatsApp de la respuesta del Agente */}
                <Card className="lg:col-span-6 border-none shadow-xl rounded-[2.5rem] bg-[#0b141a] text-white p-8 flex flex-col justify-between">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-emerald-600 flex items-center justify-center font-black text-sm">
                                    A
                                </div>
                                <div>
                                    <p className="text-xs font-black uppercase tracking-wide text-white">
                                        Athleticenter Oficial (Agente ARM)
                                    </p>
                                    <p className="text-[10px] text-emerald-400 font-bold">
                                        En línea · Respuesta Automática Inteligente
                                    </p>
                                </div>
                            </div>
                            {simResult && (
                                <div className="flex items-center gap-2">
                                    <Badge className="bg-white/10 text-white border-none text-[9px] font-black uppercase">
                                        {simResult.intent}
                                    </Badge>
                                    {simResult.isHotLead && (
                                        <Badge className="bg-rose-500 text-white border-none text-[9px] font-black uppercase">
                                            🔥 Hot Lead
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </div>

                        {simResult ? (
                            <div className="space-y-4 max-h-[360px] overflow-y-auto pr-2">
                                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-none bg-[#005c4b] p-3.5 text-xs text-white">
                                    {simMessage}
                                </div>
                                <div className="mr-auto max-w-[90%] rounded-2xl rounded-tl-none bg-[#202c33] p-4 text-xs text-slate-100 whitespace-pre-wrap leading-relaxed border border-white/5">
                                    {simResult.replyText}
                                </div>
                            </div>
                        ) : (
                            <div className="h-[260px] flex flex-col items-center justify-center text-center text-slate-400 space-y-2">
                                <Bot className="h-10 w-10 text-emerald-500/50" />
                                <p className="text-xs font-bold uppercase tracking-wider">
                                    Haz clic en &ldquo;Probar Agente ARM Ahora&rdquo;
                                </p>
                                <p className="text-[11px] text-slate-500 max-w-xs">
                                    Verás aquí la respuesta exacta con la cascada comercial 25% + 10% y la firma del equipo de Athleticenter.
                                </p>
                            </div>
                        )}
                    </div>

                    {simResult && (
                        <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                            <span>
                                Productos encontrados en inventario: <strong className="text-white">{simResult.matchedProductsCount || 0}</strong>
                            </span>
                            {simResult.extractedLocation && (
                                <span>
                                    Ubicación CRM: <strong className="text-emerald-400">{simResult.extractedLocation}</strong>
                                </span>
                            )}
                            {simResult.extractedStoreName && (
                                <span>
                                    Tienda CRM: <strong className="text-amber-400">{simResult.extractedStoreName}</strong>
                                </span>
                            )}
                        </div>
                    )}
                </Card>
            </div>

            {/* Radar de Leads Calientes (Hand-off) & Bitácora de Conversaciones */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Columna Izquierda: Leads Calientes para Hand-Off Humano */}
                <Card className="lg:col-span-5 border-none shadow-xl rounded-[2.5rem] bg-white p-8 space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-rose-600 font-black text-[10px] uppercase tracking-widest">
                                <Flame className="h-4 w-4" /> Hand-Off a Asesor Humano
                            </div>
                            <h3 className="text-lg font-black uppercase text-slate-900">
                                Leads Calientes Detectados ({hotLeads?.length || 0})
                            </h3>
                        </div>
                    </div>

                    {(!hotLeads || hotLeads.length === 0) ? (
                        <div className="p-8 rounded-2xl bg-slate-50 text-center space-y-2">
                            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
                            <p className="text-xs font-black uppercase text-slate-700">Sin cierres pendientes de atención</p>
                            <p className="text-[11px] text-slate-500">
                                Cuando un cliente pida pagar, solicite cuenta bancaria o cotice volumen mayorista, aparecerá aquí con alerta prioritaria.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                            {hotLeads.map((lead: any) => (
                                <div
                                    key={lead.id}
                                    className="p-5 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-3"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <Badge className="bg-rose-600 text-white border-none text-[8px] font-black uppercase">
                                                    🔥 COMPRA CALIENTE
                                                </Badge>
                                                <span className="text-[10px] font-mono text-slate-500">
                                                    +{lead.phone}
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-black uppercase text-slate-900 mt-1">
                                                {lead.customerName || 'Prospecto Mayorista'}
                                            </h4>
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-medium">
                                            {formatDate(lead.createdAt)}
                                        </span>
                                    </div>

                                    <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-rose-100">
                                        &ldquo;{lead.lastMessage}&rdquo;
                                    </p>

                                    <div className="flex items-center justify-between pt-1">
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                            {lead.extractedLocation && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="h-3 w-3 text-rose-500" /> {lead.extractedLocation}
                                                </span>
                                            )}
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={() => window.open(`https://wa.me/${String(lead.phone).replace(/\D/g, '')}`, '_blank')}
                                            className="h-8 rounded-xl bg-slate-900 hover:bg-emerald-600 text-white font-black uppercase text-[9px] tracking-wider flex items-center gap-1.5"
                                        >
                                            <ExternalLink className="h-3 w-3" /> Tomar Chat en WhatsApp
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                {/* Columna Derecha: Bitácora de Mensajes Entrantes + Enriquecimiento CRM */}
                <Card className="lg:col-span-7 border-none shadow-xl rounded-[2.5rem] bg-white p-8 space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-emerald-600 font-black text-[10px] uppercase tracking-widest">
                                <MessageSquare className="h-4 w-4" /> Bitácora en Vivo & CRM Autónomo
                            </div>
                            <h3 className="text-lg font-black uppercase text-slate-900">
                                Últimas Conversaciones Atendidas por IA ({inboundLogs?.length || 0})
                            </h3>
                        </div>
                    </div>

                    {enrichments && enrichments.length > 0 && (
                        <div className="flex flex-wrap gap-2 pb-2">
                            {enrichments.slice(0, 6).map((enr: any) => (
                                <div
                                    key={enr.id}
                                    className="px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-100 flex items-center gap-2 text-[10px] font-bold text-sky-900"
                                >
                                    <Store className="h-3.5 w-3.5 text-sky-600" />
                                    <span>{enr.detectedStoreName || enr.customerName || `+${enr.phone}`}</span>
                                    {enr.detectedLocation && (
                                        <Badge className="bg-sky-600 text-white border-none text-[8px] px-1.5 py-0">
                                            {enr.detectedLocation}
                                        </Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {(!inboundLogs || inboundLogs.length === 0) ? (
                        <div className="p-8 rounded-2xl bg-slate-50 text-center space-y-2">
                            <MessageSquare className="h-8 w-8 text-slate-400 mx-auto" />
                            <p className="text-xs font-black uppercase text-slate-700">Esperando mensajes entrantes</p>
                            <p className="text-[11px] text-slate-500">
                                Todos los mensajes que entren al WhatsApp (+58 414 6719204) aparecerán registrados aquí en tiempo real.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                            {inboundLogs.map((logItem: any) => (
                                <div
                                    key={logItem.id}
                                    className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Badge className="bg-emerald-100 text-emerald-800 border-none text-[8px] font-black uppercase">
                                                {logItem.intent || 'ARM_AGENT'}
                                            </Badge>
                                            <span className="text-xs font-black text-slate-900">
                                                +{logItem.from}
                                            </span>
                                            {logItem.extractedStoreName && (
                                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg">
                                                    {logItem.extractedStoreName}
                                                </span>
                                            )}
                                            {logItem.extractedLocation && (
                                                <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-lg">
                                                    📍 {logItem.extractedLocation}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[10px] text-slate-400">
                                            {formatDate(logItem.processedAt)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-700 font-medium">
                                        <strong className="text-slate-900">Cliente:</strong> &ldquo;{logItem.message}&rdquo;
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
