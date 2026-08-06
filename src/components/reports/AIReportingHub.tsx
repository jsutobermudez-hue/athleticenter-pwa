
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    Sparkles, 
    Send, 
    Download, 
    Bot, 
    User as UserIcon, 
    Loader2, 
    Zap, 
    Trash2, 
    ShieldCheck, 
    Terminal,
    AlertTriangle,
    Database
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { useUser } from '@/firebase';
import { runAIAnalyst } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    data?: any[];
    isSimulated?: boolean;
    timestamp: Date;
}

export function AIReportingHub() {
    const { profile } = useUser();
    const { toast } = useToast();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (scrollContainer) {
                scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
            }
        }
    }, [messages, isProcessing]);

    const handleQuery = async () => {
        if (!input.trim() || isProcessing || !profile) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        const currentQuery = input;
        setInput('');
        setIsProcessing(true);

        try {
            const result = await runAIAnalyst({
                query: currentQuery,
                userId: profile.id
            });

            if (result.success && result.data) {
                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: result.data.answer,
                    data: result.data.tabularData,
                    isSimulated: result.data.isSimulated,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                // Si el server action devuelve success false pero no explota
                const errorMsg: Message = {
                    id: (Date.now() + 2).toString(),
                    role: 'system',
                    content: result.error || "Ocurrió un error inesperado en la red neuronal.",
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, errorMsg]);
            }
        } catch (e: any) {
            const errorMsg: Message = {
                id: (Date.now() + 3).toString(),
                role: 'system',
                content: e?.message ? `Sistemas de Red IA: ${e.message}` : "Fallo de conexión: No se pudo establecer enlace con el motor neuronal.",
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMsg]);
            
            toast({
                variant: 'destructive',
                title: 'Respuesta del Servidor',
                description: e?.message || "Detalle no disponible"
            });
        } finally {
            setIsProcessing(false);
        }
    };

    const exportToPDF = (data: any[] | undefined, rawContent: string) => {
        const doc = new jsPDF();
        
        // Membrete Institucional Encabezado
        doc.setFillColor(30, 41, 59); // Slate-900
        doc.rect(0, 0, 210, 28, 'F');
        
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        doc.text("ATHLETICENTER PRO C.A.", 14, 17);
        
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(200, 210, 225);
        doc.text("INFORME EJECUTIVO DE INTELIGENCIA DE NEGOCIOS Y ANALÍTICA IA", 14, 23);

        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(71, 85, 105);
        doc.text(`FECHA DE EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 35);
        doc.text(`MOTOR: ANALISTA IA GEMINI 2.5 FLASH OMNISCIENTE`, 14, 40);

        let currentY = 48;

        const cleanContent = (rawContent || '').replace(/\[GENERAR_PDF\]/g, '').trim();

        if (data && data.length > 0) {
            const headers = Object.keys(data[0]).map(h => h.toUpperCase());
            const rows = data.map(obj => Object.values(obj));

            (doc as any).autoTable({
                head: [headers],
                body: rows,
                startY: currentY,
                theme: 'grid',
                headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
                styles: { fontSize: 8, font: 'helvetica' }
            });

            currentY = (doc as any).lastAutoTable.finalY + 12;
        }

        if (cleanContent) {
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(30, 41, 59);
            doc.text("ANÁLISIS Y DICTAMEN ESTRATÉGICO:", 14, currentY);
            currentY += 6;

            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(51, 65, 85);

            const splitText = doc.splitTextToSize(cleanContent, 180);
            doc.text(splitText, 14, currentY);
        }

        doc.save(`Informe_Ejecutivo_Athleticenter_${Date.now()}.pdf`);
        toast({ title: 'PDF Descargado', description: 'El informe ejecutivo en PDF se ha generado correctamente.' });
    };

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-700 overflow-hidden bg-[#F8FAFC]">
            <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-8 py-8 shrink-0 border-b bg-white z-20 gap-4">
                <div className="flex items-center gap-5">
                    <div className="p-3 rounded-2xl bg-[#2563EB] text-white shadow-2xl shadow-blue-200">
                        <Sparkles className="h-7 w-7" />
                    </div>
                    <div className="space-y-0.5">
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">AI ANALYST</h1>
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">CENTRO DE INTELIGENCIA DE DATOS v6.0</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="h-9 px-5 border-primary/20 bg-primary/5 text-primary font-black uppercase text-[10px] tracking-widest flex items-center gap-2 rounded-full">
                        <Database className="h-4 w-4" /> CONEXIÓN FIRESTORE ACTIVA
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="h-9 px-4 rounded-xl text-rose-500 font-black uppercase text-[10px] tracking-widest hover:bg-rose-50">
                        <Trash2 className="mr-2 h-4 w-4" /> Limpiar
                    </Button>
                </div>
            </header>

            <div className="flex-1 relative min-h-0">
                <ScrollArea ref={scrollRef} className="h-full">
                    <div className="p-6 sm:p-12 space-y-12 max-w-6xl mx-auto pb-48">
                        {messages.length === 0 && (
                            <div className="py-24 text-center flex flex-col items-center justify-center gap-8 animate-in zoom-in-95 duration-1000 opacity-20">
                                <div className="p-10 rounded-full bg-slate-100">
                                    <Terminal className="h-20 w-20 text-slate-400" />
                                </div>
                                <div className="space-y-3">
                                    <p className="text-3xl font-black uppercase tracking-[0.5em] text-slate-900 leading-none">Motor Analítico Listo</p>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.3em] max-w-lg mx-auto leading-relaxed">
                                        Haz preguntas complejas sobre inventario, ventas o finanzas.
                                    </p>
                                </div>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={cn(
                                "flex gap-6 animate-in slide-in-from-bottom-4 duration-500",
                                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                            )}>
                                <div className={cn(
                                    "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-xl",
                                    msg.role === 'user' ? "bg-[#2563EB] text-white" : "bg-slate-900 text-[#2563EB]"
                                )}>
                                    {msg.role === 'user' ? <UserIcon className="h-6 w-6" /> : msg.role === 'assistant' ? <Bot className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6 text-rose-500" />}
                                </div>
                                <div className={cn("space-y-6 flex-1 max-w-[85%]", msg.role === 'user' ? "text-right" : "text-left")}>
                                    <div className={cn(
                                        "p-6 sm:p-8 rounded-[2.5rem] shadow-xl text-base font-bold leading-relaxed uppercase tracking-tight",
                                        msg.role === 'user' 
                                            ? "bg-[#2563EB] text-white rounded-tr-none" 
                                            : msg.role === 'assistant'
                                            ? "bg-white text-slate-700 border border-slate-100 rounded-tl-none"
                                            : "bg-rose-50 text-rose-700 border border-rose-100 rounded-tl-none"
                                    )}>
                                        {msg.content.replace(/\[GENERAR_PDF\]/g, '')}

                                        {/* Botón Destacado de Descarga de PDF Directa */}
                                        {msg.role === 'assistant' && (msg.content.includes('[GENERAR_PDF]') || msg.content.toLowerCase().includes('pdf')) && (
                                            <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-start">
                                                <Button 
                                                    onClick={() => exportToPDF(msg.data, msg.content)}
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-6 py-3.5 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center gap-2"
                                                >
                                                    <Download className="h-4 w-4" /> 📄 DESCARGAR INFORME EJECUTIVO EN PDF
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {msg.role === 'assistant' && msg.isSimulated && (
                                        <div className="flex items-center gap-2 px-6 text-amber-600 animate-in fade-in duration-1000">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            <span className="text-[9px] font-black uppercase tracking-widest">Modo Resiliencia: Respuesta Simulada (API Key Inactiva)</span>
                                        </div>
                                    )}

                                    {msg.data && msg.data.length > 0 && (
                                        <div className="rounded-[2.5rem] border-none bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-700">
                                            <div className="bg-slate-900 px-8 py-5 flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3">
                                                    <Zap className="h-5 w-5 text-primary animate-pulse" />
                                                    <span className="text-[11px] font-black uppercase tracking-widest text-white/60">Datos Extraídos de Athleticenter</span>
                                                </div>
                                                <Button variant="ghost" size="sm" onClick={() => exportToPDF(msg.data!, msg.content)} className="h-10 text-[11px] font-black text-white uppercase bg-white/10 hover:bg-white/20 rounded-xl px-6">
                                                    <Download className="h-4 w-4 mr-2" /> Exportar PDF
                                                </Button>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-[#F8FAFC] border-b">
                                                        <tr>
                                                            {Object.keys(msg.data[0]).map(k => (
                                                                <th key={k} className="px-8 py-5 text-left font-black uppercase text-slate-400 tracking-wider text-[11px]">{k}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-50">
                                                        {msg.data.map((row, idx) => (
                                                            <tr key={idx} className="group transition-colors hover:bg-blue-50/50">
                                                                {Object.values(row).map((v: any, i) => (
                                                                    <td key={i} className="px-8 py-5 font-black text-slate-700 uppercase tracking-tighter">{v}</td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isProcessing && (
                            <div className="flex gap-6 animate-pulse">
                                <div className="h-12 w-12 rounded-2xl bg-slate-900 flex items-center justify-center text-[#2563EB] shadow-xl">
                                    <Loader2 className="h-7 w-7 animate-spin" />
                                </div>
                                <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-100 text-[12px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-4">
                                    <Zap className="h-5 w-5 animate-bounce" /> Sincronizando con Red Neuronal...
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>

            <div className="p-8 shrink-0 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent pt-6 sticky bottom-0 z-30 space-y-3">
                {/* Sugerencias Rápidas de Mando Superadmin v6.0 */}
                <div className="max-w-5xl mx-auto flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
                    {[
                        { label: '👑 Alertas Autónomas Ejecutivas', query: '¿Cuáles son las alertas autónomas y riesgos críticos del negocio hoy?' },
                        { label: '📈 Score de Crédito (1-100)', query: 'Calcula el score de crédito y riesgo de nuestros clientes principales' },
                        { label: '🔄 Simulador 360° de Decisiones', query: 'Simula el impacto de un descuento de 10% con incremento del 15% en ventas' },
                        { label: '🛡️ Auditoría de Bypass de Mora', query: 'Muéstrame la auditoría de pedidos aprobados con bypass de mora a más de 35 días' },
                        { label: '⚽ Balones Nike por Modelo', query: '¿Cuántos balones Nike se vendieron el último mes especifica por modelo?' },
                        { label: '📦 Clasificación ABC 80/20', query: 'Muéstrame la clasificación ABC de inventario y los productos con menor rotación' },
                    ].map((chip, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => {
                                setInput(chip.query);
                            }}
                            className="px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm text-[9px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-900 hover:text-white transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5"
                        >
                            <span>{chip.label}</span>
                        </button>
                    ))}
                </div>

                <div className="max-w-5xl mx-auto relative group">
                    <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600/20 via-blue-400/40 to-blue-600/20 rounded-[2.8rem] blur-xl opacity-25 group-focus-within:opacity-100 transition-opacity duration-700" />
                    <div className="relative flex items-end gap-4 p-3 bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 transition-all group-focus-within:ring-2 group-focus-within:ring-blue-100">
                        <Textarea 
                            placeholder="Pregunta lo que quieras sobre ventas totales, balones más vendidos, morosidad o estrategias comercial..."
                            className="min-h-[70px] max-h-[250px] border-none shadow-none text-base font-bold p-5 pr-20 leading-relaxed focus-visible:ring-0 rounded-[2.2rem] resize-none placeholder:text-slate-300 placeholder:uppercase placeholder:text-[11px] placeholder:tracking-[0.2em]"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
                        />
                        <Button 
                            onClick={handleQuery}
                            disabled={!input.trim() || isProcessing}
                            className="absolute right-4 bottom-4 h-14 w-14 rounded-3xl bg-slate-900 hover:bg-[#2563EB] text-white shadow-2xl transition-all active:scale-90 shrink-0"
                            size="icon"
                        >
                            {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
                        </Button>
                    </div>
                </div>
                <div className="flex items-center justify-center gap-2.5 mt-5 opacity-25 hover:opacity-100 transition-opacity cursor-default pb-4">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span className="text-[9px] font-black uppercase tracking-[0.5em] text-slate-500">Protocolo de Auditoría Certificado</span>
                </div>
            </div>
        </div>
    );
}
