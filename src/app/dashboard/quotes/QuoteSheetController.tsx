
'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc, getDoc, updateDoc, serverTimestamp, limit } from 'firebase/firestore';
import type { Quote, QuoteItem, Product, QuoteItemClient, CompanyProfile, Customer } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { QuoteDetailsSheet } from './QuoteDetailsSheet';
import { UpdateQuoteStatusDialog } from './update-quote-status-dialog';
import { generateQuotePDF } from '@/lib/pdf-generator';
import { createAppNotifications } from '@/lib/notifications';

/**
 * CONTROLADOR DE PRESUPUESTOS v7.3.0
 * Sincronizado: Pasa datos fiscales extendidos del cliente al motor de PDF.
 */
export function QuoteSheetController({ quote, onOpenChange }: { quote: Quote, onOpenChange: (open: boolean) => void }) {
    const firestore = useFirestore();
    const router = useRouter();
    const { toast } = useToast();
    const { profile: currentUser } = useUser();

    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [isQuickActionPending, setIsQuickActionPending] = useState(false);
    
    const customerRef = useMemoFirebase(() => (firestore && quote) ? doc(firestore, 'customers', quote.customerId) : null, [firestore, quote?.customerId]);
    const { data: customerData } = useDoc<Customer>(customerRef);

    const itemsRef = useMemoFirebase(
        () => {
            if (!quote || !firestore || !currentUser) return null;
            return query(collection(firestore, 'quotes', quote.id, 'quoteItems'), limit(100));
        },
        [quote?.id, firestore, currentUser?.id]
    );
    const { data: quoteItemsData, isLoading: isLoadingItems } = useCollection<QuoteItem>(itemsRef);
    
    const productIds = useMemo(() => {
        if (!quoteItemsData || quoteItemsData.length === 0) return [];
        return Array.from(new Set(quoteItemsData.map(item => item.productId))).slice(0, 30);
    }, [quoteItemsData]);
    
    const productsRef = useMemoFirebase(
        () => (firestore && productIds.length > 0 ? query(collection(firestore, 'products'), where('__name__', 'in', productIds), limit(100)) : null),
        [firestore, productIds]
    );
    const { data: productsData, isLoading: isLoadingProducts } = useCollection<Product>(productsRef);

    const itemsWithProductData = React.useMemo(() => {
        if (!quoteItemsData || !productsData) return [];
        const productsMap = new Map(productsData.map(p => [p.id, p]));
        return quoteItemsData.map(item => ({
            ...item,
            product: productsMap.get(item.productId)
        })).filter(item => item.product) as QuoteItemClient[];
    }, [quoteItemsData, productsData]);

    const handleSuccessClose = () => {
        setIsUpdatingStatus(false);
        setIsQuickActionPending(false);
        onOpenChange(false);
        router.replace('/dashboard/quotes');
    };

    const handleContinueDraft = () => {
        if (!quote || !currentUser || itemsWithProductData.length === 0) return;
        const draftKey = `quote_draft_${currentUser.id}`;
        localStorage.setItem(draftKey, JSON.stringify({
            items: itemsWithProductData,
            customerId: quote.customerId,
            updatedAt: new Date().toISOString()
        }));
        router.push('/dashboard/quotes/new');
        onOpenChange(false);
    };

    const handleQuickStatusUpdate = async (newStatus: Quote['status']) => {
        if (!firestore || !currentUser || !quote.id) return;
        setIsQuickActionPending(true);
        
        const quoteRef = doc(firestore, 'quotes', quote.id);
        const updateData = { status: newStatus, updatedAt: serverTimestamp() };

        updateDoc(quoteRef, updateData)
            .then(async () => {
                if (newStatus === 'Aceptada') {
                    await createAppNotifications(firestore, {
                        category: 'Cotizaciones',
                        title: '¡Cotización Aceptada!',
                        message: `El cliente ha aceptado el presupuesto #${quote.id}.`,
                        link: `/dashboard/quotes?quote=${quote.id}`,
                        initiatorId: currentUser.id,
                        roles: ['admin', 'gerencia', 'ventas']
                    });
                }
                toast({ title: '¡Éxito!', description: `Actualizado a "${newStatus}"` });
                handleSuccessClose();
            })
            .catch(() => {})
            .finally(() => setIsQuickActionPending(false));
    };

    const handlePrintPDF = async () => {
        if (!firestore || itemsWithProductData.length === 0) return;
        try {
            const profileSnap = await getDoc(doc(firestore, 'companyProfile', 'main'));
            const companyProfile = profileSnap.exists() ? profileSnap.data() as CompanyProfile : {};
            generateQuotePDF({
                quoteId: quote.id, 
                customerName: quote.customerName, 
                customerRif: customerData?.rif,
                customerAddress: customerData?.address,
                salespersonName: quote.salespersonName,
                quoteItems: itemsWithProductData, 
                expiryDate: quote.expiryDate, 
                companyProfile,
                bcvRate: 1
            });
        } catch (e) {
            console.error("PDF Export Error:", e);
        }
    };

    if (!currentUser) return null;

    return (
        <>
            <QuoteDetailsSheet 
                quote={quote} 
                currentUser={currentUser}
                items={itemsWithProductData}
                isLoadingItems={isLoadingItems || isLoadingProducts}
                isOpen={!!quote}
                onOpenChange={onOpenChange}
                onPrint={handlePrintPDF}
                onStatusUpdate={() => setIsUpdatingStatus(true)}
                onQuickAction={handleQuickStatusUpdate}
                onContinueDraft={handleContinueDraft}
                isActionPending={isQuickActionPending}
            />
            {isUpdatingStatus && (
                <UpdateQuoteStatusDialog 
                    quote={quote} 
                    isOpen={true}
                    onOpenChange={(open) => !open && setIsUpdatingStatus(false)}
                    onStatusUpdate={() => handleSuccessClose()}
                />
            )}
        </>
    );
}
