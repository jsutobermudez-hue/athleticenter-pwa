'use client';

import React, { useState, useTransition } from 'react';
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2, Copy, Send, MessageSquareHeart } from 'lucide-react';
import type { Invoice } from '@/lib/definitions';
import { handleWhatsAppReminder } from '@/app/actions';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { useToast } from '@/hooks/use-toast';
import { WhatsAppReminderOutput } from '@/ai/flows/whatsapp-credit-reminder';
import { Card, CardContent } from '@/components/ui/card';

export function WhatsAppReminderDialog({ invoice }: { invoice: Invoice }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, startGenerating] = useTransition();
  const [isSending, setIsSending] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<WhatsAppReminderOutput | null>(null);
  const { toast } = useToast();

  const [remainingDays, setRemainingDays] = useState(invoice.remainingCreditDays);
  const [discount, setDiscount] = useState(invoice.discountPercentage);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    startGenerating(async () => {
      const result = await handleWhatsAppReminder({
        customerName: invoice.customerName,
        remainingCreditDays: remainingDays,
        discountPercentage: discount,
        phoneNumber: invoice.customerPhone,
      });

      if (result.success && result.data) {
        setGeneratedMessage(result.data);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error al Generar Mensaje',
          description: result.error || 'Ocurrió un error inesperado al contactar el servicio de IA.',
        });
      }
    });
  };

  const handleCopyToClipboard = () => {
    if (generatedMessage?.message) {
      navigator.clipboard.writeText(generatedMessage.message);
      toast({
        title: '¡Copiado!',
        description: 'Mensaje copiado al portapapeles.',
      });
    }
  };

  const handleSendAutomaticMessage = async () => {
    if (!generatedMessage?.message) return;

    setIsSending(true);
    const result = await sendWhatsAppMessage(invoice.customerPhone, generatedMessage.message);
    setIsSending(false);

    if (result.success) {
      toast({
        title: '¡Mensaje Enviado!',
        description: `El recordatorio para ${invoice.customerName} ha sido enviado.`,
      });
      resetAndClose();
    } else {
      toast({
        variant: 'destructive',
        title: 'Error de Envío',
        description: result.error || 'No se pudo enviar el mensaje automáticamente.',
      });
    }
  };

  const resetAndClose = () => {
    setIsOpen(false);
    setTimeout(() => {
        setGeneratedMessage(null);
        setIsSending(false);
    }, 300); // delay to allow dialog to close smoothly
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
        if (!open) {
            resetAndClose();
        } else {
            setIsOpen(true);
        }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquareHeart className="mr-2 h-4 w-4" />
          Recordatorio
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar Recordatorio de WhatsApp</DialogTitle>
          <DialogDescription>
            Genera un recordatorio personalizado para {invoice.customerName}.
          </DialogDescription>
        </DialogHeader>
        {!generatedMessage ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="remaining-days">Días de Crédito Restantes</Label>
            <Input
              id="remaining-days"
              type="number"
              value={remainingDays}
              onChange={(e) => setRemainingDays(Number(e.target.value))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discount">Porcentaje de Descuento</Label>
            <Input
              id="discount"
              type="number"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              required
            />
          </div>
          <DialogFooter>
          <Button type="button" variant="secondary" onClick={resetAndClose}>Cancelar</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generando...
                </>
              ) : (
                'Generar Mensaje'
              )}
            </Button>
          </DialogFooter>
        </form>
        ) : (
            <div className="space-y-4">
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm text-foreground">{generatedMessage.message}</p>
                    </CardContent>
                </Card>
                { !generatedMessage.shouldSend && (
                    <p className="text-sm text-muted-foreground text-center">Nota: La IA sugiere no enviar este recordatorio ya que no hay descuento disponible.</p>
                )}
                <DialogFooter className="sm:justify-end">
                    <Button type="button" variant="secondary" onClick={resetAndClose}>Cerrar</Button>
                    <div className="flex items-center gap-2 mt-2 sm:mt-0">
                        <Button type="button" variant="outline" size="sm" onClick={handleCopyToClipboard} disabled={isSending}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar
                        </Button>
                        <Button type="button" size="sm" onClick={handleSendAutomaticMessage} disabled={isSending}>
                            {isSending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="mr-2 h-4 w-4" />
                            )}
                            Enviar
                        </Button>
                    </div>
                </DialogFooter>
            </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
