
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { NewOrderDialog } from './new-order-dialog';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { Order } from '@/lib/definitions';
import { OrderSheetController } from './OrderSheetController';
import { Skeleton } from '@/components/ui/skeleton';

import AdminOrdersView from './AdminOrdersView';
import UserOrdersView from './UserOrdersView';

export const dynamic = 'force-dynamic';

function OrdersPageContent() {
    const { profile: currentUser, isUserLoading } = useUser();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const searchParams = useSearchParams();
    const firestore = useFirestore();

    useEffect(() => {
        const orderId = searchParams.get('order');
        if (orderId && firestore) {
            const orderDoc = doc(firestore, 'orders', orderId);
            getDoc(orderDoc).then(docSnap => {
                if (docSnap.exists()) {
                    setSelectedOrder({ id: docSnap.id, ...docSnap.data() } as Order);
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
    
    const isAdminView = ['admin', 'superadmin', 'gerencia', 'deposito', 'warehouse'].includes(currentUser.role);

    return (
        <>
            <div className="flex h-full flex-col gap-10 w-full pb-20 animate-in fade-in-50 duration-500">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-2">
                    <div className="space-y-1">
                        <h1 className="text-5xl font-black uppercase tracking-tighter text-slate-900">
                            {isAdminView ? 'Gestión de Pedidos' : 'Mis Pedidos'}
                        </h1>
                        <p className="text-muted-foreground font-medium italic text-sm">Administra y realiza seguimiento a todos los pedidos comerciales.</p>
                    </div>
                    <NewOrderDialog user={currentUser} isLoading={isUserLoading} />
                </div>
                
                {isAdminView ? (
                    <AdminOrdersView />
                ) : (
                    <UserOrdersView currentUser={currentUser} />
                )}
            </div>

            {selectedOrder && (
                <OrderSheetController 
                    order={selectedOrder} 
                    onOpenChange={(open) => !open && setSelectedOrder(null)} 
                />
            )}
        </>
    );
}

export default function OrdersPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <OrdersPageContent />
        </Suspense>
    );
}
