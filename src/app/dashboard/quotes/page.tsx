'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { Quote } from '@/lib/definitions';
import { QuoteSheetController } from './QuoteSheetController';
import { NewQuoteDialog } from './new-quote-dialog';
import { Skeleton } from '@/components/ui/skeleton';

import AdminQuotesView from './AdminQuotesView';
import UserQuotesView from './UserQuotesView';

function QuotesViewSkeleton() {
    return (
        <div className="space-y-4 px-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full rounded-[1.8rem] sm:rounded-[2rem]"/>)}
        </div>
    );
}

function QuotesPageContent() {
    const { profile: currentUser, isUserLoading } = useUser();
    const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
    const searchParams = useSearchParams();
    const firestore = useFirestore();

    // Abrir detalle desde URL si existe parámetro
    useEffect(() => {
        const quoteId = searchParams.get('quote');
        if (quoteId && firestore) {
            const quoteDoc = doc(firestore, 'quotes', quoteId);
            getDoc(quoteDoc).then(docSnap => {
                if (docSnap.exists()) {
                    setSelectedQuote({ id: docSnap.id, ...docSnap.data() } as Quote);
                }
            });
        }
    }, [searchParams, firestore]);
    
    if (isUserLoading || !currentUser) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        );
    }
    
    // Solo personal administrativo puede ver el listado global
    const isAdminView = ['admin', 'superadmin', 'gerencia'].includes(currentUser.role);

    return (
        <>
            <div className="flex flex-col gap-10 max-w-7xl mx-auto pb-20 animate-in fade-in-50 duration-500">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-2 sm:px-4">
                    <div className="space-y-1.5">
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">
                            {isAdminView ? 'Control de Cotizaciones' : 'Mis Presupuestos'}
                        </h1>
                        <p className="text-muted-foreground font-medium italic text-xs sm:text-sm">Gestión de propuestas comerciales y prospección.</p>
                    </div>
                    <div className="w-full sm:w-auto">
                        <NewQuoteDialog isLoading={isUserLoading} />
                    </div>
                </div>

                
                {isAdminView ? (
                    <AdminQuotesView />
                ) : (
                    <UserQuotesView currentUser={currentUser} />
                )}
            </div>

            {selectedQuote && (
                <QuoteSheetController 
                    quote={selectedQuote} 
                    onOpenChange={(open) => !open && setSelectedQuote(null)} 
                />
            )}
        </>
    );
}

export default function QuotesPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <QuotesPageContent />
        </Suspense>
    );
}