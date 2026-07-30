
'use client';

import { Hourglass, CheckCircle, Cog, PackageCheck, Truck, Home, FileSearch, DollarSign, XCircle, RefreshCcw } from 'lucide-react';
import type { OrderStatus } from './definitions';
import type { ElementType } from 'react';

export const statusConfig: Record<OrderStatus, { icon: ElementType, title: string, color: string, description: string }> = {
    'Borrador': { icon: FileSearch, title: 'Borrador', color: 'bg-slate-400 text-white', description: 'El pedido es un borrador y aún no ha sido enviado para aprobación.' },
    'Pendiente': { icon: Hourglass, title: 'Pendiente', color: 'bg-yellow-400 text-yellow-900', description: 'El pedido está esperando aprobación de la gerencia.' },
    'Aprobado': { icon: CheckCircle, title: 'Aprobado', color: 'bg-blue-500 text-white', description: 'El pedido fue aprobado y está en cola para ser preparado por el almacén.' },
    'En Preparación': { icon: Cog, title: 'En Preparación', color: 'bg-indigo-500 text-white', description: 'El equipo de almacén está preparando y empacando los productos.' },
    'Completado': { icon: PackageCheck, title: 'Completado', color: 'bg-gray-500 text-white', description: 'El pedido está empacado, verificado y listo para ser despachado.' },
    'Despachado': { icon: Truck, title: 'Despachado', color: 'bg-cyan-500 text-white', description: 'El pedido ha sido entregado al transportista y está en camino.' },
    'Entregado': { icon: Home, title: 'Entregado', color: 'bg-green-500 text-white', description: 'El cliente ha recibido el pedido. El ciclo de cobro ha comenzado.' },
    'En Verificación': { icon: FileSearch, title: 'En Verificación', color: 'bg-blue-400 text-white', description: 'El cliente ha reportado un pago y está pendiente de verificación.'},
    'Pagado': { icon: DollarSign, title: 'Pagado', color: 'bg-green-600 text-white', description: 'El pago ha sido confirmado. La orden está cerrada.' },
    'Cancelado': { icon: XCircle, title: 'Cancelado', color: 'bg-red-500 text-white', description: 'El pedido ha sido cancelado definitivamente.' },
    'Rechazado': { icon: RefreshCcw, title: 'Devuelto', color: 'bg-rose-500 text-white', description: 'El pedido fue devuelto para corrección por la administración.' },
};
