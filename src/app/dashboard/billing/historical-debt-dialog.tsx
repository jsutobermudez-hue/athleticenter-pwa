'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { doc, setDoc, serverTimestamp, Timestamp, collection } from 'firebase/firestore';
import { Plus, FileText, Loader2, Landmark, History } from 'lucide-react';

const historicalSchema = z.object({
  customerName: z.string().min(2, 'Ingresa el nombre del cliente.'),
  customerRif: z.string().optional(),
  customerPhone: z.string().optional(),
  historicalInvoiceNumber: z.string().min(2, 'Ingresa el número de factura o referencia.'),
  invoiceDate: z.string().min(1, 'Selecciona la fecha de emisión.'),
  dueDate: z.string().min(1, 'Selecciona la fecha de vencimiento.'),
  totalAmount: z.coerce.number().min(0.01, 'El monto debe ser mayor a cero.'),
  amountPaid: z.coerce.number().min(0).default(0),
  salespersonName: z.string().min(2, 'Ingresa el nombre del asesor comercial.'),
  notes: z.string().optional(),
});

type HistoricalFormValues = z.infer<typeof historicalSchema>;

export function HistoricalDebtDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const isAuthorized = currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<HistoricalFormValues>({
    resolver: zodResolver(historicalSchema),
    defaultValues: {
      customerName: '',
      customerRif: '',
      customerPhone: '',
      historicalInvoiceNumber: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      totalAmount: 0,
      amountPaid: 0,
      salespersonName: currentUser?.name || 'Venta Directa',
      notes: ''
    }
  });

  if (!isAuthorized) return null;

  const onSubmit = async (data: HistoricalFormValues) => {
    if (!firestore || !currentUser) return;

    setIsSubmitting(true);
    try {
      const orderRef = doc(collection(firestore, 'orders'));
      const iDate = new Date(data.invoiceDate);
      const dDate = new Date(data.dueDate);
      const isPaid = data.amountPaid >= data.totalAmount - 0.05;
      const isOverdue = !isPaid && dDate < new Date();

      const orderPayload = {
        id: orderRef.id,
        isHistorical: true,
        historicalInvoiceNumber: data.historicalInvoiceNumber,
        customerName: data.customerName.trim(),
        customerId: `hist-${data.customerName.toLowerCase().replace(/\s+/g, '_')}`,
        customerRif: data.customerRif?.trim() || '',
        customerPhone: data.customerPhone?.trim() || '',
        salespersonId: `sp-${data.salespersonName.toLowerCase().replace(/\s+/g, '_')}`,
        salespersonName: data.salespersonName.trim(),
        orderDate: Timestamp.fromDate(iDate),
        receptionDate: Timestamp.fromDate(iDate),
        approvalDate: Timestamp.fromDate(iDate),
        dueDate: Timestamp.fromDate(dDate),
        totalAmount: data.totalAmount,
        amountPaid: data.amountPaid,
        totalCashReceived: data.amountPaid,
        status: isPaid ? 'Pagado' : (isOverdue ? 'Vencido' : 'Entregado'),
        paymentStatus: isPaid ? 'Pagado' : (data.amountPaid > 0 ? 'Abono Parcial' : 'Pendiente'),
        notes: data.notes ? `[CARTERA HISTÓRICA] ${data.notes}` : '[CARTERA HISTÓRICA FUERA DE SISTEMA]',
        items: [],
        createdAt: serverTimestamp(),
        createdBy: currentUser.name || currentUser.email || 'Mariana / Administración'
      };

      await setDoc(orderRef, orderPayload);

      toast({
        title: 'Cartera Histórica Registrada',
        description: `Factura ${data.historicalInvoiceNumber} de ${data.customerName} registrada por $${data.totalAmount} USD.`
      });

      reset();
      setIsOpen(false);
    } catch (e: any) {
      console.error("Error al registrar cartera histórica:", e);
      toast({
        variant: 'destructive',
        title: 'Error al Registrar',
        description: e?.message || 'No se pudo guardar la factura histórica.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline"
          className="h-10 px-4 rounded-xl border-dashed border-amber-400 bg-amber-50/50 hover:bg-amber-100/50 text-amber-900 font-black text-xs uppercase flex items-center gap-2 shadow-sm"
        >
          <History className="h-4 w-4 text-amber-600" />
          <span>Cargar Cartera Histórica</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md sm:max-w-lg rounded-[2rem] bg-white p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-amber-600" />
            Cargar Deuda / Cartera Histórica
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-slate-500">
            Registra saldos o facturas anteriores gestionadas fuera del sistema para integrar su estado a la Mora Crítica (+30D).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Cliente</Label>
              <Input
                {...register('customerName')}
                placeholder="Nombre o Razón Social"
                className="h-10 text-xs font-bold rounded-xl"
              />
              {errors.customerName && <p className="text-[9px] text-rose-500 font-bold">{errors.customerName.message}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">RIF / Cédula</Label>
              <Input
                {...register('customerRif')}
                placeholder="J-12345678-0"
                className="h-10 text-xs font-bold rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">N° Factura Externa</Label>
              <Input
                {...register('historicalInvoiceNumber')}
                placeholder="Ej. FACT-2025-089"
                className="h-10 text-xs font-bold rounded-xl"
              />
              {errors.historicalInvoiceNumber && <p className="text-[9px] text-rose-500 font-bold">{errors.historicalInvoiceNumber.message}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Vendedor Asignado</Label>
              <Input
                {...register('salespersonName')}
                placeholder="Nombre del Vendedor"
                className="h-10 text-xs font-bold rounded-xl"
              />
              {errors.salespersonName && <p className="text-[9px] text-rose-500 font-bold">{errors.salespersonName.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Fecha Emisión Factura</Label>
              <Input
                type="date"
                {...register('invoiceDate')}
                className="h-10 text-xs font-bold rounded-xl"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Fecha Vencimiento (Mora)</Label>
              <Input
                type="date"
                {...register('dueDate')}
                className="h-10 text-xs font-bold rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Monto Total Facturado ($ USD)</Label>
              <Input
                type="number"
                step="0.01"
                {...register('totalAmount')}
                placeholder="0.00"
                className="h-10 text-xs font-black text-slate-900 rounded-xl"
              />
              {errors.totalAmount && <p className="text-[9px] text-rose-500 font-bold">{errors.totalAmount.message}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase text-slate-500">Monto Ya Cobrado ($ USD)</Label>
              <Input
                type="number"
                step="0.01"
                {...register('amountPaid')}
                placeholder="0.00"
                className="h-10 text-xs font-black text-emerald-600 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] font-black uppercase text-slate-500">Observaciones de Cobranza Fuera de Sistema</Label>
            <Textarea
              {...register('notes')}
              placeholder="Detalles acordados con Mariana / Cliente..."
              className="h-20 text-xs rounded-xl"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              className="h-11 rounded-xl text-xs font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase flex items-center gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Guardar en Cartera
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
