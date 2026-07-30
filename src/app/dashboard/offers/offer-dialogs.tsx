'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2, Search, ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import type { Offer, Product } from '@/lib/definitions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { useFirestore, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, collection, writeBatch, serverTimestamp, getDocs, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const offerSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  discountPercentage: z.coerce.number().min(0, 'El descuento no puede ser negativo.'),
  isActive: z.boolean(),
});

type OfferFormValues = z.infer<typeof offerSchema>;

function OfferForm({ control, errors }: { control: any; errors: any }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nombre de la Oferta</Label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <Input id="name" {...field} placeholder="Ej. Oferta Aniversario" />
          )}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="discountPercentage">Porcentaje de Descuento (%)</Label>
        <Controller
          name="discountPercentage"
          control={control}
          render={({ field }) => (
            <Input
              id="discountPercentage"
              type="number"
              {...field}
              placeholder="Ej. 35"
            />
          )}
        />
        {errors.discountPercentage && (
          <p className="text-xs text-destructive">{errors.discountPercentage.message}</p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <Switch
              id="isActive"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <Label htmlFor="isActive">Activar esta oferta</Label>
      </div>
    </div>
  );
}

export function NewOfferDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema),
    defaultValues: { name: '', discountPercentage: 0, isActive: true },
  });

  const onSubmit = (data: OfferFormValues) => {
    if (!firestore) return;

    const newOfferRef = doc(collection(firestore, 'offers'));
    const newOfferData: Omit<Offer, 'id'> = {
      name: data.name,
      discountPercentage: data.discountPercentage / 100,
      isActive: data.isActive,
      createdAt: serverTimestamp() as any,
    };

    const batch = writeBatch(firestore);
    batch.set(newOfferRef, newOfferData);

    batch
      .commit()
      .then(() => {
        toast({
          title: '¡Oferta Creada!',
          description: `La oferta "${data.name}" ha sido creada.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: 'offers',
          operation: 'create',
          requestResourceData: newOfferData,
        });
        errorEmitter.emit('permission-error', permissionError);
      });
  };

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen, reset]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Nueva Oferta</DialogTitle>
          <DialogDescription>
            Define una nueva campaña de descuento para tus productos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <OfferForm control={control} errors={errors} />
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Crear
              Oferta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditOfferDialog({
  isOpen,
  onOpenChange,
  offer,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  offer: Offer;
}) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<OfferFormValues>({
    resolver: zodResolver(offerSchema),
  });

  useEffect(() => {
    if (offer && isOpen) {
      reset({
        name: offer.name,
        discountPercentage: offer.discountPercentage * 100,
        isActive: offer.isActive,
      });
    }
  }, [offer, isOpen, reset]);

  const onSubmit = (data: OfferFormValues) => {
    if (!firestore || !offer.id) return;

    const offerRef = doc(firestore, 'offers', offer.id);
    const updatedData = {
      name: data.name,
      discountPercentage: data.discountPercentage / 100,
      isActive: data.isActive,
      updatedAt: serverTimestamp() as any,
    };

    updateDoc(offerRef, updatedData)
      .then(() => {
        toast({
          title: '¡Oferta Actualizada!',
          description: `La oferta "${data.name}" ha sido guardada.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: `offers/${offer.id}`,
          operation: 'update',
          requestResourceData: updatedData,
        });
        errorEmitter.emit('permission-error', permissionError);
      });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Oferta</DialogTitle>
          <DialogDescription>
            Actualiza los detalles de la oferta "{offer.name}".
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <OfferForm control={control} errors={errors} />
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
              Cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteOfferDialog({
  isOpen,
  onOpenChange,
  offer,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  offer: Offer;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();

  const handleDelete = () => {
    if (!firestore || !offer.id) return;
    setIsDeleting(true);

    const offerRef = doc(firestore, 'offers', offer.id);
    const productsRef = collection(firestore, 'products');

    getDocs(productsRef)
      .then((querySnapshot) => {
        const batch = writeBatch(firestore);
        querySnapshot.forEach((productDoc) => {
          const product = productDoc.data();
          if (product.activeOfferIds && product.activeOfferIds.includes(offer.id)) {
            const updatedIds = product.activeOfferIds.filter(
              (id: string) => id !== offer.id
            );
            batch.update(productDoc.ref, { activeOfferIds: updatedIds });
          }
        });
        batch.delete(offerRef);
        return batch.commit();
      })
      .then(() => {
        toast({
          title: '¡Oferta Eliminada!',
          description: `La oferta "${offer.name}" ha sido eliminada de forma permanente.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: `offers/${offer.id}`,
          operation: 'delete',
        });
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setIsDeleting(false);
      });
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Estás seguro de que quieres eliminar esta oferta?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. La oferta "{offer.name}" se eliminará
            permanentemente y se quitará de todos los productos que la tengan asignada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sí, eliminar oferta
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ApplyOffersDialog({
  isOpen,
  onOpenChange,
  allOffers,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  allOffers: Offer[];
}) {
  const [selectedOffers, setSelectedOffers] = useState<Record<string, boolean>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();

  const activeOffers = allOffers.filter((o) => o.isActive);

  const handleApply = () => {
    if (!firestore) return;
    const offerIdsToApply = Object.keys(selectedOffers).filter(
      (id) => selectedOffers[id]
    );
    if (offerIdsToApply.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Ninguna oferta seleccionada',
        description: 'Por favor, selecciona al menos una oferta para aplicar.',
      });
      return;
    }

    setIsApplying(true);
    const productsRef = collection(firestore, 'products');

    getDocs(productsRef)
      .then((querySnapshot) => {
        const batch = writeBatch(firestore);
        querySnapshot.forEach((productDoc) => {
          const product = productDoc.data();
          const currentIds = new Set(product.activeOfferIds || []);
          offerIdsToApply.forEach((id) => currentIds.add(id));
          batch.update(productDoc.ref, { activeOfferIds: Array.from(currentIds) });
        });
        return batch.commit();
      })
      .then(() => {
        toast({
          title: '¡Ofertas Aplicadas!',
          description: `${offerIdsToApply.length} oferta(s) aplicadas masivamente.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: 'products',
          operation: 'update',
          requestResourceData: {
            action: 'mass_offer_apply',
            count: offerIdsToApply.length,
          },
        });
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setIsApplying(false);
      });
  };

  const handleClear = () => {
    if (!firestore) return;
    setIsClearing(true);
    const productsRef = collection(firestore, 'products');

    getDocs(productsRef)
      .then((querySnapshot) => {
        const batch = writeBatch(firestore);
        querySnapshot.forEach((productDoc) => {
          batch.update(productDoc.ref, { activeOfferIds: [] });
        });
        return batch.commit();
      })
      .then(() => {
        toast({
          title: '¡Ofertas Eliminadas!',
          description: `Se quitaron todas las asignaciones de ofertas.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: 'products',
          operation: 'update',
          requestResourceData: { action: 'mass_offer_clear' },
        });
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setIsClearing(false);
      });
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedOffers({});
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar Ofertas Masivamente</DialogTitle>
          <DialogDescription>
            Selecciona una o varias ofertas para añadirlas a TODOS los productos del
            inventario.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label className="font-semibold">Ofertas Activas Disponibles</Label>
          <ScrollArea className="h-48 mt-2 rounded-md border p-4">
            <div className="space-y-2">
              {activeOffers.length > 0 ? (
                activeOffers.map((offer) => (
                  <div key={offer.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`offer-${offer.id}`}
                      checked={!!selectedOffers[offer.id ?? '']}
                      onCheckedChange={(checked) =>
                        setSelectedOffers((prev) => ({
                          ...prev,
                          [offer.id ?? '']: !!checked,
                        }))
                      }
                    />
                    <Label htmlFor={`offer-${offer.id}`} className="cursor-pointer">
                      {offer.name} ({(offer.discountPercentage * 100).toFixed(0)}%)
                    </Label>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  No hay ofertas activas para aplicar.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="destructive"
            onClick={handleClear}
            disabled={isApplying || isClearing}
          >
            {isClearing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}{' '}
            Limpiar Todas
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleApply} disabled={isApplying || isClearing}>
              {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Aplicar a
              Todos
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApplyToProductsDialog({
  isOpen,
  onOpenChange,
  offer,
  allProducts,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  offer: Offer | null;
  allProducts: Product[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Record<string, boolean>>({});
  const [initialSelection, setInitialSelection] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();

  useEffect(() => {
    if (isOpen && offer && allProducts) {
      const initial: Record<string, boolean> = {};
      allProducts.forEach((p) => {
        if (offer.id && p.id && p.activeOfferIds?.includes(offer.id)) {
          initial[p.id] = true;
        }
      });
      setInitialSelection(initial);
      setSelectedProducts(initial);
    } else {
      setSearchTerm('');
      setSelectedProducts({});
      setInitialSelection({});
    }
  }, [isOpen, offer, allProducts]);

  const filteredProducts = useMemo(() => {
    if (!allProducts) return [];
    if (!searchTerm) return allProducts;
    const lowercasedTerm = searchTerm.toLowerCase();
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(lowercasedTerm) ||
        p.sku.toLowerCase().includes(lowercasedTerm) ||
        p.category.toLowerCase().includes(lowercasedTerm)
    );
  }, [allProducts, searchTerm]);

  const handleSelectAll = (checked: boolean) => {
    const newSelection: Record<string, boolean> = {};
    if (checked) {
      filteredProducts.forEach((p) => {
        if (p.id) newSelection[p.id] = true;
      });
    }
    setSelectedProducts(newSelection);
  };

  const handleApply = () => {
    if (!firestore || !offer) return;
    setIsSaving(true);

    const batch = writeBatch(firestore);
    allProducts.forEach((product) => {
      if (!product.id) return;
      const wasApplied = !!initialSelection[product.id];
      const isApplied = !!selectedProducts[product.id];

      if (wasApplied !== isApplied) {
        const productRef = doc(firestore, 'products', product.id);
        if (isApplied) {
          batch.update(productRef, { activeOfferIds: arrayUnion(offer.id) });
        } else {
          batch.update(productRef, { activeOfferIds: arrayRemove(offer.id) });
        }
      }
    });

    batch
      .commit()
      .then(() => {
        toast({
          title: '¡Cambios Guardados!',
          description: `Asignaciones de "${offer.name}" actualizadas.`,
        });
        onOpenChange(false);
      })
      .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: 'products',
          operation: 'update',
          requestResourceData: { action: 'partial_offer_sync', offerId: offer.id },
        });
        errorEmitter.emit('permission-error', permissionError);
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  if (!offer) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aplicar Oferta a Productos Específicos</DialogTitle>
          <DialogDescription>
            Selecciona a qué productos aplicar la oferta "{offer.name}".
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, SKU, categoría..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <ScrollArea className="h-72 rounded-md border">
            <div className="p-4 space-y-2">
              <div className="flex items-center space-x-2 border-b pb-2">
                <Checkbox
                  id="select-all-products"
                  onCheckedChange={(checked) => handleSelectAll(!!checked)}
                />
                <Label htmlFor="select-all-products" className="font-semibold">
                  Seleccionar Todos
                </Label>
              </div>
              {filteredProducts.length > 0 ? (
                filteredProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`product-${p.id}`}
                        checked={!!selectedProducts[p.id ?? '']}
                        onCheckedChange={(checked) =>
                          setSelectedProducts((prev) => ({
                            ...prev,
                            [p.id ?? '']: !!checked,
                          }))
                        }
                      />
                      <Avatar className="h-8 w-8 rounded-md border">
                        <AvatarImage src={p.imageUrl} className="object-cover" />
                        <AvatarFallback className="rounded-md">
                          <ImageIcon />
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <Label htmlFor={`product-${p.id}`} className="cursor-pointer">
                          {p.name}
                        </Label>
                        <p className="text-xs text-muted-foreground">SKU: {p.sku}</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-sm text-muted-foreground pt-10">
                  No se encontraron productos.
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={isSaving} onClick={handleApply}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
            Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}