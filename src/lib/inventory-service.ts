'use client';

import { 
  Transaction, 
  doc, 
  serverTimestamp, 
  collection, 
  Firestore,
  type DocumentData
} from 'firebase/firestore';
import type { Product } from './definitions';

/**
 * SERVICIO MAESTRO DE INVENTARIO v2.0 - PROTOCOLO DE RED ATHLETICENTER
 * Hardening: Requiere obligatoriamente los datos pre-leídos del producto 
 * para cumplir con la regla "reads before writes" de las transacciones de Firestore.
 */
export const InventoryService = {
  /**
   * Ejecuta el ajuste de stock dentro de una transacción activa.
   * IMPORTANTE: El pData DEBE haber sido obtenido mediante transaction.get() previamente.
   */
  updateStockInTransaction: async (
    transaction: Transaction,
    firestore: Firestore,
    productId: string,
    change: number,
    userId: string,
    userName: string,
    reason: string,
    size?: string | null,
    pData?: Product // Datos obtenidos mediante transaction.get() en el nivel superior
  ) => {
    if (!pData) {
        throw new Error(`Protocolo Violado: Los datos del producto ${productId} deben leerse antes de iniciar escrituras en la transacción.`);
    }

    const pRef = doc(firestore, 'products', productId);
    const oldTotalStock = Number(pData.stockLevel ?? (pData as any).stock ?? 0);
    
    // Validación de variante si aplica
    if (pData.hasSizes && size && pData.sizes) {
      const currentSizeStock = pData.sizes[size] || 0;
      if (currentSizeStock + change < 0) {
        throw new Error(`Stock insuficiente para ${pData.name} (Talla: ${size}). Disp: ${currentSizeStock}`);
      }
    }

    const newTotalStock = oldTotalStock + change;
    if (newTotalStock < 0) {
      throw new Error(`La operación dejaría el stock de ${pData.name} en negativo (${newTotalStock}).`);
    }

    const updatePayload: any = {
      stockLevel: newTotalStock,
      stock: newTotalStock,
      updatedAt: serverTimestamp()
    };

    if (pData.hasSizes && size && pData.sizes) {
      updatePayload.sizes = {
        ...pData.sizes,
        [size]: (pData.sizes[size] || 0) + change
      };
    }

    // 1. Actualizar Producto
    transaction.update(pRef, updatePayload);

    // 2. Registrar en Bitácora de Auditoría de Producto
    const logRef = doc(collection(firestore, `products/${productId}/stockHistory`));
    transaction.set(logRef, {
      productId,
      userId,
      userName,
      previousStock: oldTotalStock,
      newStock: newTotalStock,
      change,
      reason: `${reason}${size ? ` [Talla: ${size}]` : ''}`,
      createdAt: serverTimestamp()
    });
  }
};
