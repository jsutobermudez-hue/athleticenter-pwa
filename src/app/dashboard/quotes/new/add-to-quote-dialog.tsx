
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ShoppingCart, ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, QuoteItemClient, Offer } from '@/lib/definitions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { calculateOfferPrice } from '@/lib/offers';

interface AddToQuoteDialogProps {
  product: Product | null;
  allOffers: Offer[] | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (item: QuoteItemClient) => void;
}

export function AddToQuoteDialog({ product, allOffers, isOpen, onOpenChange, onConfirm }: AddToQuoteDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) setQuantity(1);
  }, [isOpen]);

  if (!product) return null;

  const offer = calculateOfferPrice(product, allOffers);

  const handleConfirm = () => {
    onConfirm({
      productId: product.id!,
      quantity,
      unitPrice: offer.finalPrice,
      product: product,
      customerId: '',
      salespersonId: '',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12 rounded border">
                <AvatarImage src={product.imageUrl} className="object-cover" />
                <AvatarFallback><ImageIcon /></AvatarFallback>
            </Avatar>
            <div className="text-left">
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>Referencia de stock: {product.stock} un.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-6 space-y-6">
            <div className="flex justify-center items-center gap-8">
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Precio Unit.</p>
                    <p className="text-2xl font-bold text-primary">${offer.finalPrice.toFixed(2)}</p>
                </div>
                <div className="text-center">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Subtotal</p>
                    <p className="text-2xl font-bold">${(offer.finalPrice * quantity).toFixed(2)}</p>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="qty-quote">Cantidad a presupuestar</Label>
                <Input id="qty-quote" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="text-lg h-12 text-center" />
            </div>
        </div>
        <DialogFooter>
            <Button className="w-full" onClick={handleConfirm} size="lg"><ShoppingCart className="mr-2" /> Añadir al Presupuesto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
