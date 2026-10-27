'use client';

import { 
  Transaction, 
  doc, 
  serverTimestamp, 
  collection, 
  Firestore,
  increment,
  type DocumentData
} from 'firebase/firestore';
import type { Product } from './definitions';

/**
 * SERVICIO MAESTRO DE INVENTARIO v2.0 - PROTOCOLO DE RED ATHLETICENTER
 * Hardening: Requiere obligatoriamente los datos pre-leídos del producto 
 * para cumplir con la regla "reads before writes" de las transacciones de Firestore.
 */
/** Motivos que representan reintegro de mercancía vendida (anulaciones, devoluciones, rechazos). */
export function isReturnReason(reason: string): boolean {
  return /cancel|anula|devol|rechaz|restitu|reintegr/i.test(reason || '');
}

export interface StockChange {
  productId: string;
  change: number;
  size?: string | null;
}

export const InventoryService = {
  /**
   * Aplica VARIOS cambios de stock en una sola transacción, agrupando por producto y talla.
   * Evita el error de "última escritura gana" cuando un mismo producto aparece en varias líneas
   * (p. ej. distintas tallas en un pedido u orden de compra).
   *
   * @param productData mapa productId -> datos leídos con transaction.get() ANTES de cualquier escritura.
   * @param opts.isReturn  fuerza el tratamiento de reintegro (resta de totalSold) en cambios positivos.
   */
  applyGroupedStockChanges: (
    transaction: Transaction,
    firestore: Firestore,
    changes: StockChange[],
    userId: string,
    userName: string,
    reason: string,
    productData: Record<string, Product | undefined>,
    opts: { isReturn?: boolean } = {}
  ) => {
    const grouped = new Map<string, { total: number; sizes: Record<string, number> }>();
    for (const c of changes) {
      const qty = Math.trunc(Number(c.change) || 0);
      if (!c.productId || qty === 0) continue;
      const g = grouped.get(c.productId) || { total: 0, sizes: {} };
      g.total += qty;
      if (c.size) g.sizes[c.size] = (g.sizes[c.size] || 0) + qty;
      grouped.set(c.productId, g);
    }

    const returning = opts.isReturn ?? isReturnReason(reason);

    // 1) Validar todo antes de escribir nada.
    for (const [productId, g] of grouped) {
      const pData = productData[productId];
      if (!pData) throw new Error(`Protocolo Violado: el producto ${productId} no fue leído dentro de la transacción o no existe.`);
      const oldTotal = Number(pData.stockLevel ?? (pData as any).stock ?? 0);
      if (oldTotal + g.total < 0) throw new Error(`Stock insuficiente para ${pData.name}: disponible ${oldTotal}, requerido ${-g.total}.`);
      if (pData.hasSizes && pData.sizes) {
        for (const [size, delta] of Object.entries(g.sizes)) {
          const cur = Number(pData.sizes[size] || 0);
          if (cur + delta < 0) throw new Error(`Stock insuficiente para ${pData.name} (Talla: ${size}). Disponible: ${cur}.`);
        }
      }
    }

    // 2) Una escritura por producto + una entrada de kardex.
    for (const [productId, g] of grouped) {
      const pData = productData[productId]!;
      const oldTotal = Number(pData.stockLevel ?? (pData as any).stock ?? 0);
      const newTotal = oldTotal + g.total;
      const payload: any = { stockLevel: newTotal, stock: newTotal, updatedAt: serverTimestamp() };

      if (pData.hasSizes && pData.sizes && Object.keys(g.sizes).length) {
        const sizes = { ...pData.sizes } as Record<string, number>;
        for (const [size, delta] of Object.entries(g.sizes)) sizes[size] = Number(sizes[size] || 0) + delta;
        payload.sizes = sizes;
      }
      if (g.total < 0) payload.totalSold = increment(-g.total);
      else if (g.total > 0 && returning) payload.totalSold = increment(-g.total);

      transaction.update(doc(firestore, 'products', productId), payload);

      const sizeDetail = Object.entries(g.sizes).map(([s, d]) => `${s}:${d > 0 ? '+' : ''}${d}`).join(', ');
      transaction.set(doc(collection(firestore, `products/${productId}/stockHistory`)), {
        productId,
        userId,
        userName,
        previousStock: oldTotal,
        newStock: newTotal,
        change: g.total,
        reason: `${reason}${sizeDetail ? ` [Tallas: ${sizeDetail}]` : ''}`,
        createdAt: serverTimestamp()
      });
    }
  },

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

    // Si el stock disminuye (venta), sumamos al total de unidades vendidas (totalSold)
    if (change < 0) {
      updatePayload.totalSold = increment(-change);
    } else if (change > 0 && isReturnReason(reason)) {
      // Si se cancela y se reintegra el stock, restamos del total de vendidos
      updatePayload.totalSold = increment(-change);
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
