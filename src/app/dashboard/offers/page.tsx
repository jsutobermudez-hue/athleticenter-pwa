'use client';

import React, { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Loader2, Tag, Percent, Sparkles, X, Settings, Check, Trash2, Power, PowerOff, Library } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { User, Offer, Product } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { collection, doc, getDocs, writeBatch, limit, query } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { NewOfferDialog, EditOfferDialog, DeleteOfferDialog, ApplyOffersDialog, ApplyToProductsDialog } from './offer-dialogs';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';


function OfferCard({ 
    offer, 
    isSelected,
    onSelect,
    onEdit,
    onDelete,
    onApplyToProducts,
} : { 
    offer: Offer, 
    isSelected: boolean,
    onSelect: (offerId: string, selected: boolean) => void;
    onEdit: (offer: Offer) => void;
    onDelete: (offer: Offer) => void;
    onApplyToProducts: (offer: Offer) => void;
}) {
    return (
        <Card 
            className={cn("transition-all flex flex-col", isSelected && "ring-2 ring-primary")}
            onClick={() => onSelect(offer.id, !isSelected)}
        >
            <CardHeader className="flex-row items-start justify-between p-4">
                <div className="flex-1 space-y-1">
                    <CardTitle className="text-base font-bold">{offer.name}</CardTitle>
                    <Badge variant={offer.isActive ? 'default' : 'secondary'} className={cn(offer.isActive && "bg-success text-success-foreground")}>
                        {offer.isActive ? 'Activa' : 'Inactiva'}
                    </Badge>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => onEdit(offer)}><Settings className="mr-2" /> Editar</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onApplyToProducts(offer)}><Library className="mr-2" /> Aplicar a Productos...</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(offer)}><X className="mr-2" /> Eliminar</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex-grow flex items-center justify-center">
                <div className="flex items-baseline justify-center text-center gap-1 text-primary">
                    <span className="text-5xl font-bold tracking-tighter">{(offer.discountPercentage * 100).toFixed(0)}</span>
                    <span className="text-2xl font-bold">%</span>
                </div>
            </CardContent>
            <CardFooter className="p-2 border-t bg-muted/50">
                 <div 
                    className="flex items-center space-x-2 w-full justify-center p-2 rounded-md hover:bg-primary/10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(offer.id, !isSelected);
                    }}
                 >
                    <Checkbox id={`select-${offer.id}`} checked={isSelected} />
                    <label htmlFor={`select-${offer.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                        Seleccionar
                    </label>
                </div>
            </CardFooter>
        </Card>
    );
}


export default function OffersPage() {
  const { user, profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [dialogState, setDialogState] = useState<'new' | 'edit' | 'delete' | 'apply' | 'applyToProducts' | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [selectedOffers, setSelectedOffers] = useState<Record<string, boolean>>({});
  const [isBatchActionLoading, setIsBatchActionLoading] = useState(false);

  const offersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
  const { data: offers, isLoading: isLoadingOffers } = useCollection<Offer>(offersQuery);
  
  const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(100)) : null), [firestore]);
  const { data: allProducts, isLoading: isLoadingProducts } = useCollection<Product>(productsQuery);

  const isLoading = isUserLoading || isLoadingOffers || isLoadingProducts;

  const numSelected = useMemo(() => Object.values(selectedOffers).filter(Boolean).length, [selectedOffers]);

  const handleOpenDialog = (type: 'new' | 'edit' | 'delete' | 'apply' | 'applyToProducts', offer?: Offer) => {
    setSelectedOffer(offer || null);
    setDialogState(type);
  };

  const handleCloseDialogs = () => {
    setSelectedOffer(null);
    setDialogState(null);
  };
  
  const handleSelectOffer = (offerId: string, isSelected: boolean) => {
      setSelectedOffers(prev => ({
          ...prev,
          [offerId]: isSelected
      }));
  };

  const handleSelectAll = (checked: boolean) => {
      if (!offers) return;
      const newSelection: Record<string, boolean> = {};
      if (checked) {
          offers.forEach(o => newSelection[o.id] = true);
      }
      setSelectedOffers(newSelection);
  }
  
  const handleBatchAction = (action: 'activate' | 'deactivate' | 'delete') => {
        if (!firestore) return;
        const offerIdsToUpdate = Object.keys(selectedOffers).filter(id => selectedOffers[id]);
        if (offerIdsToUpdate.length === 0) return;
        
        setIsBatchActionLoading(true);

        const batch = writeBatch(firestore);
        
        const productsRef = collection(firestore, 'products');
        getDocs(productsRef)
            .then((productsSnapshot) => {
                if (action === 'delete') {
                    productsSnapshot.forEach(productDoc => {
                        const productData = productDoc.data() as Product;
                        if (productData.activeOfferIds && productData.activeOfferIds.some(id => offerIdsToUpdate.includes(id))) {
                            const updatedIds = productData.activeOfferIds.filter(id => !offerIdsToUpdate.includes(id));
                            batch.update(productDoc.ref, { activeOfferIds: updatedIds });
                        }
                    });
                }

                offerIdsToUpdate.forEach(id => {
                    const offerRef = doc(firestore, 'offers', id);
                    if (action === 'delete') {
                        batch.delete(offerRef);
                    } else {
                        batch.update(offerRef, { isActive: action === 'activate' });
                    }
                });

                return batch.commit();
            })
            .then(() => {
                toast({ title: '¡Acción Completada!', description: `${numSelected} ofertas actualizadas.` });
                setSelectedOffers({});
            })
            .catch(async (serverError) => {
                const permissionError = new FirestorePermissionError({
                    path: 'offers',
                    operation: 'update',
                    requestResourceData: { batchAction: action, count: offerIdsToUpdate.length }
                });
                errorEmitter.emit('permission-error', permissionError);
            })
            .finally(() => {
                setIsBatchActionLoading(false);
            });
  };


  const isAllSelected = offers && offers.length > 0 && numSelected === offers.length;
  
  if (isLoading) {
    return (
        <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Gestión de Ofertas
          </h1>
          <div className="flex items-center gap-2">
            <Button onClick={() => handleOpenDialog('apply')}>
              <Sparkles className="mr-2 h-4 w-4" /> Aplicar Ofertas Masivamente
            </Button>
            <Button onClick={() => handleOpenDialog('new')}>
              <Tag className="mr-2 h-4 w-4" /> Crear Nueva Oferta
            </Button>
          </div>
        </div>
        
        {numSelected > 0 && (
            <Card className="sticky top-16 z-10 animate-in fade-in-50">
                <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="select-all-contextual" 
                                checked={isAllSelected}
                                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                            />
                            <Label htmlFor="select-all-contextual" className="text-sm font-medium">
                               {numSelected} seleccionado(s)
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleBatchAction('activate')} disabled={isBatchActionLoading}>
                                <Power className="mr-2" /> Activar
                            </Button>
                             <Button size="sm" variant="outline" onClick={() => handleBatchAction('deactivate')} disabled={isBatchActionLoading}>
                                <PowerOff className="mr-2" /> Desactivar
                            </Button>
                             <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button size="sm" variant="destructive" disabled={isBatchActionLoading}>
                                        <Trash2 className="mr-2" /> Eliminar
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                    <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Esta acción eliminará {numSelected} oferta(s) de forma permanente y las quitará de todos los productos.
                                    </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleBatchAction('delete')} className="bg-destructive hover:bg-destructive/90">
                                        Sí, eliminar
                                    </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </div>
                     <Button variant="ghost" size="icon" onClick={() => setSelectedOffers({})}><X className="h-5 w-5"/></Button>
                </CardContent>
            </Card>
        )}
        
        {offers && offers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {offers.map((offer) => (
                    <OfferCard 
                        key={offer.id} 
                        offer={offer} 
                        isSelected={!!selectedOffers[offer.id]}
                        onSelect={handleSelectOffer}
                        onEdit={() => handleOpenDialog('edit', offer)}
                        onDelete={() => handleOpenDialog('delete', offer)}
                        onApplyToProducts={() => handleOpenDialog('applyToProducts', offer)}
                    />
                ))}
            </div>
        ) : (
            <Card className="flex flex-col items-center justify-center text-center p-8 min-h-[400px]">
                <CardHeader>
                    <div className="mx-auto bg-muted rounded-full p-4 w-fit"><Tag className="h-12 w-12 text-muted-foreground" /></div>
                    <CardTitle className="mt-4">Aún no hay ofertas</CardTitle>
                    <CardDescription>
                       Crea tu primera campaña de descuento para empezar a impulsar tus ventas.
                    </CardDescription>
                </CardHeader>
                 <CardContent><Button onClick={() => handleOpenDialog('new')}>Crear Primera Oferta</Button></CardContent>
            </Card>
        )}
      </div>

      {/* Dialogs */}
      <NewOfferDialog isOpen={dialogState === 'new'} onOpenChange={(open) => !open && handleCloseDialogs()} />
      {selectedOffer && <EditOfferDialog isOpen={dialogState === 'edit'} onOpenChange={(open) => !open && handleCloseDialogs()} offer={selectedOffer} />}
      {selectedOffer && <DeleteOfferDialog isOpen={dialogState === 'delete'} onOpenChange={(open) => !open && handleCloseDialogs()} offer={selectedOffer} />}
      <ApplyOffersDialog isOpen={dialogState === 'apply'} onOpenChange={(open) => !open && handleCloseDialogs()} allOffers={offers || []} />
      <ApplyToProductsDialog 
        isOpen={dialogState === 'applyToProducts'} 
        onOpenChange={(open) => !open && handleCloseDialogs()} 
        offer={selectedOffer}
        allProducts={allProducts || []} 
      />
    </>
  );
}