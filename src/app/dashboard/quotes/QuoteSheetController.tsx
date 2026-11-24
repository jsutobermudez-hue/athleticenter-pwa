
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { useCatalog } from '@/firebase/catalog-context';
import { collection, query, where, doc, getDoc, getDocs, updateDoc, serverTimestamp, limit } from 'firebase/firestore';
import type { Quote, QuoteItem, Product, QuoteItemClient, CompanyProfile, Customer, FinancialSettings } from '@/lib/definitions';
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

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

    const itemsRef = useMemoFirebase(
        () => {
            if (!quote || !firestore || !currentUser) return null;
            return query(collection(firestore, 'quotes', quote.id, 'quoteItems'), limit(300));
        },
        [quote?.id, firestore, currentUser?.id]
    );
    const { data: quoteItemsData, isLoading: isLoadingItems } = useCollection<QuoteItem>(itemsRef);
    
    const productIds = useMemo(() => {
        if (!quoteItemsData || quoteItemsData.length === 0) return [];
        return Array.from(new Set(quoteItemsData.map(item => item.productId)));
    }, [quoteItemsData]);
    
    const { products: catalogProducts, isLoading: isLoadingCatalog } = useCatalog();
    const catalogMap = useMemo(
        () => new Map(catalogProducts.map(p => [p.id, p])),
        [catalogProducts]
    );

    const missingProductIdsKey = useMemo(() => {
        if (isLoadingCatalog) return '';
        return productIds.filter(id => !catalogMap.has(id)).join(',');
    }, [productIds, catalogMap, isLoadingCatalog]);

    const [extraProductsMap, setExtraProductsMap] = useState<Map<string, Product>>(new Map());
    const [isLoadingExtraProducts, setIsLoadingExtraProducts] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!firestore || !missingProductIdsKey) {
            setExtraProductsMap(new Map());
            setIsLoadingExtraProducts(false);
            return;
        }
        const idsToFetch = missingProductIdsKey.split(',').filter(Boolean);
        setIsLoadingExtraProducts(true);
        (async () => {
            try {
                const nextMap = new Map<string, Product>();
                for (let i = 0; i < idsToFetch.length; i += 30) {
                    const chunkIds = idsToFetch.slice(i, i + 30);
                    const snap = await getDocs(
                        query(collection(firestore, 'products'), where('__name__', 'in', chunkIds))
                    );
                    snap.forEach(d => {
                        nextMap.set(d.id, { id: d.id, ...d.data() } as Product);
                    });
                }
                if (!cancelled) {
                    setExtraProductsMap(nextMap);
                }
            } catch (err) {
                console.error('Error fetching missing quote products:', err);
            } finally {
                if (!cancelled) {
                    setIsLoadingExtraProducts(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [firestore, missingProductIdsKey]);

    const itemsWithProductData = React.useMemo(() => {
        if (!quoteItemsData) return [];
        return quoteItemsData.map(item => ({
            ...item,
            product: catalogMap.get(item.productId) || extraProductsMap.get(item.productId)
        })).filter(item => item.product) as QuoteItemClient[];
    }, [quoteItemsData, catalogMap, extraProductsMap]);

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
                globalSettings,
                bcvRate: globalSettings?.bcvRate || 65.50
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
                isLoadingItems={isLoadingItems || isLoadingCatalog || isLoadingExtraProducts}
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
