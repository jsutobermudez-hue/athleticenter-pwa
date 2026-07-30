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
import { Info, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, OrderItemClient, Offer } from '@/lib/definitions';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { calculateOfferPrice } from '@/lib/offers';


interface AddToOrderDialogProps {
  product: Product | null;
  allOffers: Offer[] | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (item: OrderItemClient) => void;
  onShowDetails: (product: Product) => void;
}

export function AddToOrderDialog({ product, allOffers, isOpen, onOpenChange, onConfirm, onShowDetails }: AddToOrderDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setQuantity(1); // Reset quantity each time the dialog opens
    }
  }, [isOpen]);

  if (!product) return null;

  const offerCalculation = calculateOfferPrice(product, allOffers);

  const handleConfirm = () => {
    if (quantity <= 0) {
      toast({ variant: 'destructive', title: 'Cantidad inválida', description: 'La cantidad debe ser mayor a cero.' });
      return;
    }
    const currentStock = product.stockLevel ?? (product as any).stock ?? 0;
    if (quantity > currentStock) {
      toast({ variant: 'destructive', title: 'Stock insuficiente', description: `Solo hay ${currentStock} unidades de ${product.name} disponibles.` });
      return;
    }

    onConfirm({
      productId: product.id!,
      quantity,
      unitPrice: offerCalculation.finalPrice, // Use the final calculated price
      product: product,
    });
    onOpenChange(false);
  };
  
  const handleShowDetails = () => {
    onOpenChange(false);
    onShowDetails(product);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className='flex items-start gap-4'>
             <Avatar className="h-16 w-16 rounded-md border">
                <AvatarImage src={product.imageUrl} alt={product.name} className="object-cover" />
                <AvatarFallback className="rounded-md bg-muted">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                </AvatarFallback>
            </Avatar>
            <div className="flex-1">
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>SKU: {product.sku} / Stock: {product.stockLevel ?? (product as any).stock ?? 0}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-2 space-y-2">
            <div className="flex items-baseline justify-center gap-4">
                 {offerCalculation.hasOffer ? (
                    <>
                        <div className="text-center">
                            <Label className="text-xs">Precio Lista</Label>
                            <p className="text-lg font-semibold text-destructive line-through">${product.price.toFixed(2)}</p>
                        </div>
                        <div className="text-center">
                            <Label className="text-xs">Precio Oferta</Label>
                            <p className="text-2xl font-bold text-primary">${offerCalculation.finalPrice.toFixed(2)}</p>
                        </div>
                    </>
                 ) : (
                    <div className="text-center">
                        <Label className="text-xs">Precio</Label>
                        <p className="text-2xl font-bold text-primary">${product.price.toFixed(2)}</p>
                    </div>
                 )}
            </div>
            {offerCalculation.hasOffer && <p className="text-center text-sm text-muted-foreground">Descuento total aplicado: {(offerCalculation.totalDiscountPercentage * 100).toFixed(0)}%</p>}
        </div>
        <div className="py-4 space-y-2">
            <Label htmlFor="quantity">Cantidad a agregar</Label>
            <Input
                id="quantity"
                type="number"
                min="1"
                max={product.stockLevel ?? (product as any).stock ?? 0}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                autoFocus
            />
        </div>
        <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={handleShowDetails}>
                <Info className="mr-2 h-4 w-4" /> Ver Detalles
            </Button>
            <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                    Cancelar
                </Button>
                <Button type="button" onClick={handleConfirm}>
                    Agregar al Pedido
                </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
