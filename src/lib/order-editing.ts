import type { Order, OrderControlSettings, OrderItem, OrderStatus, Product, User } from './definitions';
import type { StockChange } from './inventory-service';
import { roundCurrency } from './billing';

export const EDITABLE_ORDER_STATUSES: OrderStatus[] = [
  'Borrador',
  'Pendiente',
  'Rechazado',
  'Aprobado',
  'En Preparación',
  'Completado',
];

export const SALESPERSON_EDITABLE_STATUSES: OrderStatus[] = [
  'Borrador',
  'Pendiente',
  'Rechazado',
];

export const STOCK_COMMITTED_STATUSES: OrderStatus[] = [
  'Aprobado',
  'En Preparación',
  'Completado',
];

const ADMIN_ROLES = new Set(['superadmin', 'gerencia', 'admin']);

export interface OrderEditPermissionResult {
  allowed: boolean;
  reason?: string;
  isStockCommitted: boolean;
  isEditableStage: boolean;
}

/**
 * Evalúa si un usuario tiene permitido editar un pedido en su etapa actual,
 * respetando el interruptor maestro `system/orderControls` y el candado previo a `Despachado`.
 */
export function canUserEditOrder(params: {
  user?: Pick<User, 'id' | 'role'> | null;
  order?: Pick<Order, 'status' | 'salespersonId' | 'cancellationRequested'> | null;
  controls?: Partial<OrderControlSettings> | null;
}): OrderEditPermissionResult {
  const { user, order, controls } = params;
  const isEditableStage = Boolean(
    order && EDITABLE_ORDER_STATUSES.includes(order.status) && !order.cancellationRequested
  );
  const isStockCommitted = Boolean(order && STOCK_COMMITTED_STATUSES.includes(order.status));

  if (!user || !order) {
    return {
      allowed: false,
      reason: 'Sin sesión o pedido inválido.',
      isStockCommitted,
      isEditableStage,
    };
  }

  if (order.cancellationRequested) {
    return {
      allowed: false,
      reason: 'El pedido tiene una solicitud de anulación en trámite.',
      isStockCommitted,
      isEditableStage,
    };
  }

  if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
    return {
      allowed: false,
      reason: `El pedido está en etapa "${order.status}" y ya no puede editarse.`,
      isStockCommitted,
      isEditableStage,
    };
  }

  if (!controls?.allowOrderEditing) {
    return {
      allowed: false,
      reason: 'La edición de pedidos está deshabilitada por Administración.',
      isStockCommitted,
      isEditableStage,
    };
  }

  if (ADMIN_ROLES.has(user.role)) {
    return { allowed: true, isStockCommitted, isEditableStage };
  }

  if (user.role === 'ventas') {
    if (!controls?.allowSalespersonEditPending) {
      return {
        allowed: false,
        reason: 'Solo los administradores están autorizados para editar pedidos.',
        isStockCommitted,
        isEditableStage,
      };
    }
    if (order.salespersonId !== user.id) {
      return {
        allowed: false,
        reason: 'Solo puedes editar tus propios pedidos.',
        isStockCommitted,
        isEditableStage,
      };
    }
    if (!SALESPERSON_EDITABLE_STATUSES.includes(order.status)) {
      return {
        allowed: false,
        reason: 'Los vendedores solo pueden editar pedidos antes de su aprobación.',
        isStockCommitted,
        isEditableStage,
      };
    }
    return { allowed: true, isStockCommitted: false, isEditableStage: true };
  }

  return {
    allowed: false,
    reason: 'Tu rol no tiene autorización para editar pedidos.',
    isStockCommitted,
    isEditableStage,
  };
}

function normalizeSizeKey(size?: string | null): string {
  return typeof size === 'string' && size.trim().length > 0 ? size.trim() : '';
}

function itemLineKey(productId: string, size?: string | null): string {
  return `${productId}::${normalizeSizeKey(size)}`;
}

/**
 * Calcula los deltas netos de inventario agrupados por producto y talla.
 * delta > 0 reintegra stock (el pedido redujo unidades); delta < 0 descuenta stock (el pedido aumentó unidades).
 */
export function computeStockChangesForOrderEdit(
  originalItems: Array<Pick<OrderItem, 'productId' | 'quantity' | 'size'>>,
  nextItems: Array<Pick<OrderItem, 'productId' | 'quantity' | 'size'>>
): StockChange[] {
  const origMap = new Map<string, { productId: string; size: string; qty: number }>();
  for (const item of originalItems) {
    if (!item.productId) continue;
    const size = normalizeSizeKey(item.size);
    const key = itemLineKey(item.productId, size);
    const existing = origMap.get(key) || { productId: item.productId, size, qty: 0 };
    existing.qty += Math.trunc(Number(item.quantity) || 0);
    origMap.set(key, existing);
  }

  const nextMap = new Map<string, { productId: string; size: string; qty: number }>();
  for (const item of nextItems) {
    if (!item.productId) continue;
    const size = normalizeSizeKey(item.size);
    const key = itemLineKey(item.productId, size);
    const existing = nextMap.get(key) || { productId: item.productId, size, qty: 0 };
    existing.qty += Math.trunc(Number(item.quantity) || 0);
    nextMap.set(key, existing);
  }

  const allKeys = new Set<string>([...origMap.keys(), ...nextMap.keys()]);
  const changes: StockChange[] = [];

  allKeys.forEach((key) => {
    const o = origMap.get(key);
    const n = nextMap.get(key);
    const productId = o?.productId || n?.productId || '';
    const size = o?.size ?? n?.size ?? '';
    const delta = (o?.qty || 0) - (n?.qty || 0);
    if (productId && delta !== 0) {
      changes.push({
        productId,
        change: delta,
        size: size || null,
      });
    }
  });

  return changes;
}

export interface OrderEditAddedOrRemoved {
  productId: string;
  name: string;
  sku: string;
  size: string;
  qty: number;
  unitPrice: number;
}

export interface OrderEditModified {
  productId: string;
  name: string;
  sku: string;
  size: string;
  oldQty: number;
  newQty: number;
  oldPrice: number;
  newPrice: number;
}

export interface OrderEditSummary {
  hasChanges: boolean;
  added: OrderEditAddedOrRemoved[];
  removed: OrderEditAddedOrRemoved[];
  modified: OrderEditModified[];
  oldTotal: number;
  newTotal: number;
  totalDelta: number;
  lines: string[];
}

type ComparableItem = Pick<OrderItem, 'productId' | 'quantity' | 'unitPrice' | 'size'> & {
  product?: Partial<Product>;
};

function groupComparableItems(items: ComparableItem[]) {
  const map = new Map<
    string,
    {
      productId: string;
      size: string;
      qty: number;
      unitPrice: number;
      subtotal: number;
      product?: Partial<Product>;
    }
  >();

  for (const item of items) {
    if (!item.productId) continue;
    const size = normalizeSizeKey(item.size);
    const key = itemLineKey(item.productId, size);
    const qty = Math.trunc(Number(item.quantity) || 0);
    const unitPrice = roundCurrency(Number(item.unitPrice) || 0);
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        productId: item.productId,
        size,
        qty,
        unitPrice,
        subtotal: roundCurrency(qty * unitPrice),
        product: item.product,
      });
    } else {
      current.qty += qty;
      current.subtotal = roundCurrency(current.subtotal + qty * unitPrice);
      current.unitPrice = current.qty > 0 ? roundCurrency(current.subtotal / current.qty) : unitPrice;
      if (!current.product && item.product) current.product = item.product;
    }
  }
  return map;
}

/**
 * Genera el comparativo Antes vs. Después para confirmación visual y trazabilidad de auditoría.
 */
export function buildOrderEditSummary(
  originalItems: ComparableItem[],
  nextItems: ComparableItem[],
  productsMap?: Map<string, Partial<Product>>
): OrderEditSummary {
  const origGrouped = groupComparableItems(originalItems);
  const nextGrouped = groupComparableItems(nextItems);

  const added: OrderEditAddedOrRemoved[] = [];
  const removed: OrderEditAddedOrRemoved[] = [];
  const modified: OrderEditModified[] = [];

  const resolveMeta = (entry: { productId: string; size: string; product?: Partial<Product> }) => {
    const prod = productsMap?.get(entry.productId) || entry.product;
    return {
      name: prod?.name || entry.productId,
      sku: prod?.sku || entry.productId,
      size: entry.size,
    };
  };

  let oldTotal = 0;
  let newTotal = 0;

  origGrouped.forEach((entry) => {
    oldTotal += entry.subtotal;
  });
  nextGrouped.forEach((entry) => {
    newTotal += entry.subtotal;
  });

  oldTotal = roundCurrency(oldTotal);
  newTotal = roundCurrency(newTotal);
  const totalDelta = roundCurrency(newTotal - oldTotal);

  const allKeys = new Set<string>([...origGrouped.keys(), ...nextGrouped.keys()]);
  allKeys.forEach((key) => {
    const o = origGrouped.get(key);
    const n = nextGrouped.get(key);

    if (!o && n && n.qty > 0) {
      const meta = resolveMeta(n);
      added.push({
        productId: n.productId,
        name: meta.name,
        sku: meta.sku,
        size: meta.size,
        qty: n.qty,
        unitPrice: n.unitPrice,
      });
      return;
    }

    if (o && (!n || n.qty <= 0)) {
      const meta = resolveMeta(o);
      removed.push({
        productId: o.productId,
        name: meta.name,
        sku: meta.sku,
        size: meta.size,
        qty: o.qty,
        unitPrice: o.unitPrice,
      });
      return;
    }

    if (o && n) {
      const qtyChanged = o.qty !== n.qty;
      const priceChanged = Math.abs(o.unitPrice - n.unitPrice) > 0.009;
      if (qtyChanged || priceChanged) {
        const meta = resolveMeta(n.product ? n : o);
        modified.push({
          productId: n.productId,
          name: meta.name,
          sku: meta.sku,
          size: meta.size,
          oldQty: o.qty,
          newQty: n.qty,
          oldPrice: o.unitPrice,
          newPrice: n.unitPrice,
        });
      }
    }
  });

  const lines: string[] = [];
  for (const item of added) {
    const sz = item.size ? ` [Talla ${item.size}]` : '';
    lines.push(`+ Agregado: ${item.name}${sz} x${item.qty} ($${item.unitPrice.toFixed(2)})`);
  }
  for (const item of removed) {
    const sz = item.size ? ` [Talla ${item.size}]` : '';
    lines.push(`- Eliminado: ${item.name}${sz} x${item.qty}`);
  }
  for (const item of modified) {
    const sz = item.size ? ` [Talla ${item.size}]` : '';
    const qtyPart = item.oldQty !== item.newQty ? `${item.oldQty} -> ${item.newQty} u.` : `${item.newQty} u.`;
    const pricePart =
      Math.abs(item.oldPrice - item.newPrice) > 0.009
        ? ` ($${item.oldPrice.toFixed(2)} -> $${item.newPrice.toFixed(2)})`
        : '';
    lines.push(`* Modificado: ${item.name}${sz} ${qtyPart}${pricePart}`);
  }

  return {
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
    added,
    removed,
    modified,
    oldTotal,
    newTotal,
    totalDelta,
    lines,
  };
}
