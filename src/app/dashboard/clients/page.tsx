
'use client';

import React, { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import ClientsPageContent from './ClientsPageContent';

export const dynamic = 'force-dynamic';

function ClientsSkeleton() {
    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-2">
                <div className="space-y-4">
                    <Skeleton className="h-10 w-64 rounded-xl" />
                    <Skeleton className="h-4 w-96 rounded-lg opacity-50" />
                </div>
                <Skeleton className="h-11 w-40 rounded-xl" />
            </header>
            <Skeleton className="h-32 w-full rounded-[2.5rem] mx-2" />
            <div className="space-y-4 mx-2 pt-4">
                {[1, 2, 3, 4, 5].map(i => (
                    <Skeleton key={i} className="h-20 w-full rounded-2xl" />
                ))}
            </div>
        </div>
    );
}

export default function ClientsPage() {
    return (
        <Suspense fallback={<ClientsSkeleton />}>
            <ClientsPageContent />
        </Suspense>
    );
}
