'use client';

import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/definitions';
import { useFirestore, useUser } from '@/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';

type DeleteProductDialogProps = {
  product: Product | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteProductDialog({ product, isOpen, onOpenChange }: DeleteProductDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();

  const handleConfirmDelete = async () => {
    if (!product || !product.id || !firestore || !authUser || !currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo completar la solicitud de eliminación.',
      });
      return;
    }

    setIsDeleting(true);

    try {
      const productRef = doc(firestore, 'products', product.id);
      await deleteDoc(productRef);

      await createAppNotifications(firestore, {
        category: 'Inventario',
        title: 'Producto Eliminado',
        message: `El producto "${product.name}" (SKU: ${product.sku}) fue eliminado por ${currentUser.name}.`,
        link: `/dashboard/inventory`,
        initiatorId: authUser.uid,
        roles: ['admin', 'gerencia'],
      });
      
      toast({
        title: '¡Producto Eliminado!',
        description: `El producto ${product.name} ha sido eliminado permanentemente.`,
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error("Error deleting product:", error);
      toast({
        variant: 'destructive',
        title: 'Error al Eliminar',
        description: 'No se pudo eliminar el producto. Esto puede deberse a reglas de seguridad.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!product) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción es irreversible y eliminará el producto <strong>{product.name}</strong> (SKU: {product.sku}) de forma permanente. Esto podría afectar el historial de pedidos y cotizaciones que lo incluyan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sí, eliminar permanentemente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
