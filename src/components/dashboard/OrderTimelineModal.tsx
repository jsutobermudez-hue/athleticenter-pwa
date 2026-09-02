'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Order, OrderHistoryEvent } from '@/lib/definitions';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Clock,
  CheckCircle2,
  Package,
  Truck,
  ShieldCheck,
  FileText,
  Printer,
  Maximize2,
  X,
  User,
  AlertCircle,
  Sparkles,
  MapPin,
  Tag,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface OrderTimelineModalProps {
  order: Order | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const safeFormatDate = (raw: any): string => {
  if (!raw) return 'Pendiente / En Proceso';
  let date: Date | null = null;
  if (typeof raw.toDate === 'function') date = raw.toDate();
  else if (raw.seconds) date = new Date(raw.seconds * 1000);
  else {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) date = d;
  }
  if (!date || isNaN(date.getTime()) || date.getTime() === 0) return 'Pendiente / En Proceso';
  return format(date, "dd MMM, yyyy - hh:mm a", { locale: es }).toUpperCase();
};

export function OrderTimelineModal({ order, isOpen, onOpenChange }: OrderTimelineModalProps) {
  const firestore = useFirestore();
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const historyQuery = useMemoFirebase(
    () =>
      firestore && order?.id
        ? query(collection(firestore, `orders/${order.id}/statusHistory`), orderBy('timestamp', 'asc'), limit(50))
        : null,
    [firestore, order?.id]
  );
  const { data: dbEvents } = useCollection<OrderHistoryEvent>(historyQuery);

  const timelineEvents = useMemo(() => {
    if (!order) return [];

    const builtInEvents: OrderHistoryEvent[] = [];

    // 1. EMISIÓN DEL PEDIDO
    const creationDate = order.orderDate || order.createdAt || order.receptionDate;
    if (creationDate) {
      builtInEvents.push({
        id: 'created',
        stage: 'Creado',
        title: 'EMISIÓN Y REGISTRO DEL PEDIDO',
        description: `Expediente comercial creado por $${(order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD.`,
        timestamp: creationDate,
        actorName: order.salespersonName || order.customerName || 'Sistema',
        actorRole: order.salespersonName ? 'Asesor Comercial' : 'Cliente B2B',
      });
    }

    // 2. APROBACIÓN COMERCIAL & FINANCIAL
    if (order.approvalDate || ['Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'Pagado'].includes(order.status)) {
      builtInEvents.push({
        id: 'approved',
        stage: 'Aprobado',
        title: 'APROBACIÓN COMERCIAL Y FINANCIERA',
        description: order.bypassMoraReason 
          ? `Aprobado con Autorización Especial Superadmin (Bypass Mora >35d): "${order.bypassMoraReason}".`
          : `Crédito comercial verificado y liberado para picking en almacén.`,
        timestamp: order.approvalDate || creationDate,
        actorName: (order as any).approvedBy || 'Gerencia Comercial',
        actorRole: 'Aprobador',
        metadata: {
          justification: order.bypassMoraReason
        }
      });
    }

    // 3. PICKING EN ALMACÉN
    if ((order as any).pickingStartedAt || ['En Preparación', 'Completado', 'Despachado', 'Entregado'].includes(order.status)) {
      builtInEvents.push({
        id: 'picking',
        stage: 'Picking',
        title: 'RECOLECCIÓN Y PICKING EN ALMACÉN',
        description: `Items verificados y extraídos de estantería.`,
        timestamp: (order as any).pickingStartedAt || order.approvalDate || creationDate,
        actorName: 'Almacén Principal',
        actorRole: 'Operador de Inventario',
      });
    }

    // 4. FINALIZACIÓN DE EMBALAJE
    if ((order as any).packingCompletedAt || ['Completado', 'Despachado', 'Entregado'].includes(order.status)) {
      builtInEvents.push({
        id: 'packing',
        stage: 'Embalado',
        title: 'EMBALAJE Y ROTULADO CON QR',
        description: `Paquete consolidado en ${order.packageCount || 1} bulto(s) listos para despacho.`,
        timestamp: (order as any).packingCompletedAt || order.approvalDate || creationDate,
        actorName: 'Empaque & Etiquetado',
        actorRole: 'Operación Logística',
        metadata: {
          packageCount: order.packageCount || 1
        }
      });
    }

    // 5. DESPACHO Y EN RUTA
    const dispatchDate = (order as any).dispatchDate || (order as any).dispatchedAt;
    if (dispatchDate || ['Despachado', 'Entregado'].includes(order.status)) {
      builtInEvents.push({
        id: 'dispatch',
        stage: 'Despachado',
        title: 'SALIDA Y ENCOMIENDA EN RUTA',
        description: `Asignado a ${order.carrier || 'Encomienda Directa'}. Guía: #${order.trackingNumber || order.internalTrackingNumber || 'S/N'}.`,
        timestamp: dispatchDate || creationDate,
        actorName: 'Coordinación Logística',
        actorRole: 'Despacho',
        metadata: {
          carrier: order.carrier || 'Flete Propio',
          trackingNumber: order.trackingNumber || order.internalTrackingNumber,
          imageUrl: order.dispatchImageUrl
        }
      });
    }

    // 6. ENTREGA CERTIFICADA
    const deliveryReceivedBy = (order as any).deliveryReceivedBy || (order as any).receivedBy || order.customerName;
    if (order.receptionDate || (order as any).deliveryDate || order.status === 'Entregado') {
      builtInEvents.push({
        id: 'delivery',
        stage: 'Entregado',
        title: 'ENTREGA CERTIFICADA AL CLIENTE',
        description: `Recibido conforme en destino por ${deliveryReceivedBy}.`,
        timestamp: order.receptionDate || (order as any).deliveryDate || creationDate,
        actorName: deliveryReceivedBy,
        actorRole: 'Receptor Final',
        metadata: {
          receivedBy: deliveryReceivedBy,
          imageUrl: order.deliveryImageUrl
        }
      });
    }

    // Combinar con eventos de Firestore
    if (dbEvents && dbEvents.length > 0) {
      return [...builtInEvents, ...dbEvents];
    }

    return builtInEvents;
  }, [order, dbEvents]);

  const exportTimelinePDF = () => {
    if (!order) return;
    const doc = new jsPDF();

    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(0, 0, 210, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('ATHLETICENTER PRO - HOJA DE TRAZA Y AUDITORÍA LOGÍSTICA', 14, 18);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`EXPEDIENTE: #${order.id.substring(0, 8).toUpperCase()} | CLIENTE: ${order.customerName.toUpperCase()}`, 14, 25);

    const rows = timelineEvents.map((evt, idx) => [
      `${idx + 1}`,
      evt.stage.toUpperCase(),
      evt.title,
      evt.actorName,
      safeFormatDate(evt.timestamp),
      evt.description
    ]);

    autoTable(doc, {
      startY: 35,
      head: [['#', 'FASE', 'EVENTO', 'RESPONSABLE', 'FECHA Y HORA', 'DETALLES OPERATIVOS']],
      body: rows,
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, cellPadding: 3 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save(`Traza_Pedido_${order.id.substring(0, 8)}.pdf`);
  };

  if (!order) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl p-0 border-none bg-slate-50 rounded-[2rem] overflow-hidden shadow-2xl z-[160]">
          <DialogHeader className="bg-slate-900 text-white p-6 sm:p-8 relative">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 font-mono text-[9px] uppercase px-2.5 py-0.5">
                  TRAZA CRONOLÓGICA 360°
                </Badge>
                <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono text-[9px] uppercase px-2.5 py-0.5">
                  #{order.id.substring(0, 8)}
                </Badge>
              </div>
              <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white">
                {order.customerName}
              </DialogTitle>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                Monto Total: ${Number(order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportTimelinePDF}
              className="absolute top-6 right-6 bg-white/10 hover:bg-white/20 text-white border-white/20 font-black text-[9px] uppercase px-4 py-2 rounded-xl flex items-center gap-2"
            >
              <Printer className="h-3.5 w-3.5" /> DESCARGAR PDF
            </Button>
          </DialogHeader>

          <div className="p-6 sm:p-8 max-h-[70vh] overflow-y-auto space-y-6 custom-scrollbar">
            {/* LÍNEA DE TIEMPO VERTICAL */}
            <div className="relative pl-6 sm:pl-8 border-l-2 border-slate-200 space-y-8 my-2">
              {timelineEvents.map((evt, idx) => {
                const isDelivered = evt.stage === 'Entregado';
                const isDispatched = evt.stage === 'Despachado';
                const isApproved = evt.stage === 'Aprobado';

                return (
                  <div key={evt.id || idx} className="relative group">
                    {/* ICONO DEL NODO */}
                    <div className={cn(
                      "absolute -left-[31px] sm:-left-[39px] top-0 h-8 w-8 sm:h-9 sm:w-9 rounded-full flex items-center justify-center text-white ring-4 ring-slate-50 shadow-md transition-transform group-hover:scale-110",
                      isDelivered ? "bg-emerald-600" :
                      isDispatched ? "bg-sky-600" :
                      isApproved ? "bg-indigo-600" :
                      "bg-slate-900"
                    )}>
                      {isDelivered ? <CheckCircle2 className="h-4 w-4" /> :
                       isDispatched ? <Truck className="h-4 w-4" /> :
                       isApproved ? <ShieldCheck className="h-4 w-4" /> :
                       <Package className="h-4 w-4" />}
                    </div>

                    {/* CONTENIDO DEL HITOS */}
                    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="bg-slate-100 font-mono text-[9px] font-black uppercase text-slate-700">
                            {evt.stage}
                          </Badge>
                          <h4 className="text-xs sm:text-sm font-black uppercase tracking-tight text-slate-900">
                            {evt.title}
                          </h4>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-100">
                          <Clock className="inline h-3 w-3 mr-1 text-slate-400" />
                          {safeFormatDate(evt.timestamp)}
                        </span>
                      </div>

                      <p className="text-xs font-bold text-slate-700 leading-relaxed uppercase tracking-tight">
                        {evt.description}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] font-bold text-slate-500 uppercase">
                        <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg">
                          <User className="h-3 w-3 text-slate-400" />
                          <span>Responsable: <strong className="text-slate-800">{evt.actorName}</strong> ({evt.actorRole || 'Operación'})</span>
                        </div>

                        {evt.metadata?.trackingNumber && (
                          <div className="flex items-center gap-1.5 bg-sky-50 text-sky-800 px-2.5 py-1 rounded-lg border border-sky-100">
                            <Tag className="h-3 w-3 text-sky-600" />
                            <span>Guía: <strong>#{evt.metadata.trackingNumber}</strong> ({evt.metadata.carrier})</span>
                          </div>
                        )}
                      </div>

                      {/* IMÁGENES DE CUSTODIA DIGITAL */}
                      {evt.metadata?.imageUrl && (
                        <div className="pt-2">
                          <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1.5">Custodia Digital Adjunta</p>
                          <div
                            onClick={() => setZoomImage(evt.metadata!.imageUrl!)}
                            className="relative h-20 w-32 rounded-xl overflow-hidden border border-slate-200 cursor-pointer bg-slate-900 group/img"
                          >
                            <img src={evt.metadata.imageUrl} alt="Evidencia" className="h-full w-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white transition-opacity">
                              <Maximize2 className="h-4 w-4" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL ZOOM FOTO CUSTODIA */}
      <Dialog open={!!zoomImage} onOpenChange={() => setZoomImage(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl p-0 border-none bg-black/95 flex items-center justify-center rounded-[2rem] overflow-hidden shadow-2xl z-[180]">
          {zoomImage && <img src={zoomImage} alt="Evidencia Ampliada" className="max-w-full max-h-[85vh] object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
