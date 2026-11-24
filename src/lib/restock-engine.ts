import type { Product, PurchaseOrder } from './definitions';

export type RestockStatus = 'agotado' | 'critico' | 'saludable';
export type RotationTier = 'ALTA' | 'MEDIA' | 'BAJA' | 'SIN_MOV';
export type RestockPriority = 'P1_URGENTE' | 'P2_ALTA' | 'P3_MEDIA' | 'P4_OK';

export interface RestockItemAnalysis {
  product: Product;
  id: string;
  sku: string;
  name: string;
  imageUrl: string;
  category: string;
  discipline: string;
  brand: string;
  warehouseLocation: string;
  stock: number;
  inTransit: number;
  effectiveStock: number;
  totalSold: number;
  price: number;
  priceCashUSD: number;
  cost: number;
  hasRealCost: boolean;
  status: RestockStatus;
  rotationTier: RotationTier;
  priority: RestockPriority;
  priorityRank: number; // 1 = más urgente, 4 = saludable
  priorityScore: number; // mayor = más urgente
  shortageToThreshold: number; // cuántas faltan para llegar al umbral (ej. 20)
  suggestedRestockQty: number; // cantidad recomendada de compra basada en rotación + umbral
  estimatedUnitCostUSD: number;
  estimatedInvestmentUSD: number;
  stockValuationUSD: number;
  lowSizes: string[]; // si usa tallas, cuáles están en < 5
  lowSizesText: string;
  movementLabel: string;
  urgencyBadge: string;
  recommendationText: string;
}

export interface RestockSummary {
  threshold: number;
  totalProducts: number;
  totalStockUnits: number;
  totalStockValuationUSD: number;
  outOfStockCount: number;
  criticalCount: number; // 1 .. threshold - 1
  needsRestockCount: number; // outOfStock + critical
  healthyCount: number; // >= threshold
  p1UrgentCount: number;
  p2HighCount: number;
  p3MediumCount: number;
  totalSuggestedUnits: number;
  totalEstimatedInvestmentUSD: number;
  items: RestockItemAnalysis[];
}

const OPEN_PO_STATUSES = new Set([
  'Cotizando/Alibaba',
  'En Fabricación',
  'En Tránsito',
  'Aduana',
]);

function roundToCommercialPack(qty: number): number {
  if (qty <= 0) return 0;
  if (qty <= 12) return Math.ceil(qty / 6) * 6;
  return Math.ceil(qty / 12) * 12;
}

/**
 * MOTOR DE PRIORIDAD DE REPOSICIÓN Y ROTACIÓN DE INVENTARIO
 * Clasifica todo el catálogo según stock disponible, mercancía en tránsito y ventas acumuladas (`totalSold`)
 * para establecer prioridad P1 (Urgente) -> P4 (Saludable) y cantidades sugeridas de compra.
 */
export function buildRestockAnalysis(
  products: Product[],
  options: {
    threshold?: number;
    purchaseOrders?: PurchaseOrder[];
  } = {}
): RestockSummary {
  const threshold = Math.max(1, Math.floor(options.threshold ?? 20));
  const purchaseOrders = options.purchaseOrders || [];

  // Mapa de unidades en tránsito desde Órdenes de Compra abiertas
  const inTransitByProductId = new Map<string, number>();
  const inTransitBySku = new Map<string, number>();

  for (const po of purchaseOrders) {
    if (!po || !OPEN_PO_STATUSES.has(po.status)) continue;
    const poItems = Array.isArray(po.items) ? po.items : [];
    for (const item of poItems) {
      const qty = Math.max(0, Number(item.quantity) || 0);
      if (qty <= 0) continue;
      if (item.productId) {
        inTransitByProductId.set(item.productId, (inTransitByProductId.get(item.productId) || 0) + qty);
      }
      if (item.sku) {
        const skuKey = item.sku.trim().toUpperCase();
        inTransitBySku.set(skuKey, (inTransitBySku.get(skuKey) || 0) + qty);
      }
    }
  }

  // Umbral dinámico de alta rotación (percentil superior de productos con ventas, mínimo 35 uds)
  const soldValues = products
    .map((p) => Number(p.totalSold ?? 0))
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const top25Sold = soldValues.length > 0 ? soldValues[Math.floor(soldValues.length * 0.25)] || 35 : 35;
  const highRotationCutoff = Math.max(35, Math.min(60, top25Sold));

  const analyzed: RestockItemAnalysis[] = products.map((p) => {
    const stock = Math.max(0, Number(p.stockLevel ?? (p as any).stock ?? 0));
    const totalSold = Math.max(0, Number(p.totalSold ?? 0));
    const price = Math.max(0, Number(p.price ?? 0));
    const priceCashUSD = Math.max(0, Number(p.priceCashUSD || (price > 0 ? price * 0.75 : 0)));
    const rawCost = Math.max(0, Number(p.cost ?? 0));
    const hasRealCost = rawCost > 0;
    const estimatedUnitCostUSD = hasRealCost ? rawCost : Number((priceCashUSD * 0.55).toFixed(2));

    const skuUpper = (p.sku || '').trim().toUpperCase();
    const inTransit =
      (p.id ? inTransitByProductId.get(p.id) || 0 : 0) ||
      (skuUpper ? inTransitBySku.get(skuUpper) || 0 : 0);
    const effectiveStock = stock + inTransit;

    const status: RestockStatus =
      stock <= 0 ? 'agotado' : stock < threshold ? 'critico' : 'saludable';

    const rotationTier: RotationTier =
      totalSold >= highRotationCutoff
        ? 'ALTA'
        : totalSold >= 10
          ? 'MEDIA'
          : totalSold > 0
            ? 'BAJA'
            : 'SIN_MOV';

    const shortageToThreshold = Math.max(0, threshold - stock);

    // Cantidad objetivo: al menos el umbral (ej. 20), o más si es un producto de alta rotación
    let suggestedRestockQty = 0;
    if (status !== 'saludable') {
      const rotationTarget =
        rotationTier === 'ALTA'
          ? Math.max(threshold * 2, Math.ceil(totalSold * 0.5))
          : rotationTier === 'MEDIA'
            ? Math.max(threshold, Math.ceil(totalSold * 0.6))
            : threshold;
      const netNeeded = Math.max(0, rotationTarget - effectiveStock);
      suggestedRestockQty = roundToCommercialPack(netNeeded);
    }

    // Prioridad de reposición P1 -> P4
    let priority: RestockPriority = 'P4_OK';
    let priorityRank = 4;

    if (status === 'agotado') {
      if (effectiveStock >= threshold) {
        priority = 'P3_MEDIA';
        priorityRank = 3;
      } else if (rotationTier === 'ALTA' || totalSold >= 20) {
        priority = 'P1_URGENTE';
        priorityRank = 1;
      } else if (rotationTier === 'MEDIA' || totalSold > 0) {
        priority = 'P2_ALTA';
        priorityRank = 2;
      } else {
        priority = 'P3_MEDIA';
        priorityRank = 3;
      }
    } else if (status === 'critico') {
      if (effectiveStock >= threshold) {
        priority = 'P3_MEDIA';
        priorityRank = 3;
      } else if (rotationTier === 'ALTA' && stock <= Math.max(8, Math.floor(threshold * 0.4))) {
        priority = 'P1_URGENTE';
        priorityRank = 1;
      } else if (rotationTier === 'ALTA' || rotationTier === 'MEDIA') {
        priority = 'P2_ALTA';
        priorityRank = 2;
      } else {
        priority = 'P3_MEDIA';
        priorityRank = 3;
      }
    }

    // Puntaje compuesto para orden exacto dentro de cada prioridad:
    // Más peso a agotado/crítico + volumen vendido real (`totalSold`), y menor puntaje si ya viene en tránsito.
    const scarcityBonus =
      status === 'agotado' ? 500 : status === 'critico' ? Math.round(((threshold - stock) / threshold) * 300) : 0;
    const velocityScore = Math.min(500, totalSold * 2.5);
    const transitDiscount = inTransit > 0 ? Math.min(200, inTransit * 2) : 0;
    const priorityScore =
      status === 'saludable'
        ? Math.round(totalSold * 0.5)
        : Math.max(1, Math.round(scarcityBonus + velocityScore - transitDiscount));

    const lowSizes: string[] = [];
    const emptySizes: string[] = [];
    if (p.hasSizes && p.sizes) {
      for (const [sz, qty] of Object.entries(p.sizes)) {
        const n = Number(qty || 0);
        if (n <= 0) emptySizes.push(sz);
        if (n < 5) lowSizes.push(`${sz}:${n}`);
      }
    }
    const lowSizesText =
      emptySizes.length > 0
        ? `Faltan tallas: ${emptySizes.join(', ')}`
        : lowSizes.length > 0
          ? `Tallas bajas: ${lowSizes.join(', ')}`
          : '';

    const movementLabel = getRotationLabel(rotationTier);
    const urgencyBadge =
      priority === 'P1_URGENTE'
        ? 'Pedir urgente'
        : priority === 'P2_ALTA'
          ? 'Reponer pronto'
          : priority === 'P3_MEDIA'
            ? 'Evaluar'
            : 'Con existencia';

    let recommendationText = 'Existencia suficiente, no requiere compra';
    if (priority === 'P1_URGENTE') {
      if (status === 'agotado') {
        recommendationText = totalSold >= 80 ? 'Producto estrella agotado' : 'Alta demanda sin existencia';
      } else {
        recommendationText = 'Se vende muy rápido y quedan muy pocos';
      }
    } else if (priority === 'P2_ALTA') {
      recommendationText =
        status === 'agotado'
          ? 'Agotado con ventas recientes'
          : 'Movimiento constante, reponer antes de agotarse';
    } else if (priority === 'P3_MEDIA') {
      if (inTransit > 0) {
        recommendationText = `Ya vienen ${inTransit} uds en camino`;
      } else if (totalSold === 0) {
        recommendationText = 'Sin ventas registradas, evaluar si reponer';
      } else {
        recommendationText = 'Rotación baja, decidir si reponer';
      }
    }

    const resolvedImageUrl =
      p.imageUrl || (Array.isArray(p.imageUrls) && p.imageUrls.length > 0 ? p.imageUrls[0] : '') || '';

    return {
      product: p,
      id: p.id || p.sku,
      sku: p.sku || 'S/SKU',
      name: p.name || 'Producto sin nombre',
      imageUrl: resolvedImageUrl,
      category: p.category || 'General',
      discipline: p.discipline || p.category || 'General',
      brand: p.brand || 'Athleticenter',
      warehouseLocation: p.warehouseLocation || 'S/U',
      stock,
      inTransit,
      effectiveStock,
      totalSold,
      price,
      priceCashUSD,
      cost: rawCost,
      hasRealCost,
      status,
      rotationTier,
      priority,
      priorityRank,
      priorityScore,
      shortageToThreshold,
      suggestedRestockQty,
      estimatedUnitCostUSD,
      estimatedInvestmentUSD: Number((suggestedRestockQty * estimatedUnitCostUSD).toFixed(2)),
      stockValuationUSD: Number((stock * price).toFixed(2)),
      lowSizes,
      lowSizesText,
      movementLabel,
      urgencyBadge,
      recommendationText,
    };
  });

  // Orden por defecto: Prioridad (P1 -> P4), luego mayor movimiento (totalSold), luego menor stock
  analyzed.sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
    if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
    if (a.stock !== b.stock) return a.stock - b.stock;
    return a.name.localeCompare(b.name);
  });

  let totalStockUnits = 0;
  let totalStockValuationUSD = 0;
  let outOfStockCount = 0;
  let criticalCount = 0;
  let healthyCount = 0;
  let p1UrgentCount = 0;
  let p2HighCount = 0;
  let p3MediumCount = 0;
  let totalSuggestedUnits = 0;
  let totalEstimatedInvestmentUSD = 0;

  for (const item of analyzed) {
    totalStockUnits += item.stock;
    totalStockValuationUSD += item.stockValuationUSD;
    if (item.status === 'agotado') outOfStockCount++;
    else if (item.status === 'critico') criticalCount++;
    else healthyCount++;

    if (item.priority === 'P1_URGENTE') p1UrgentCount++;
    else if (item.priority === 'P2_ALTA') p2HighCount++;
    else if (item.priority === 'P3_MEDIA') p3MediumCount++;

    totalSuggestedUnits += item.suggestedRestockQty;
    totalEstimatedInvestmentUSD += item.estimatedInvestmentUSD;
  }

  return {
    threshold,
    totalProducts: analyzed.length,
    totalStockUnits,
    totalStockValuationUSD: Number(totalStockValuationUSD.toFixed(2)),
    outOfStockCount,
    criticalCount,
    needsRestockCount: outOfStockCount + criticalCount,
    healthyCount,
    p1UrgentCount,
    p2HighCount,
    p3MediumCount,
    totalSuggestedUnits,
    totalEstimatedInvestmentUSD: Number(totalEstimatedInvestmentUSD.toFixed(2)),
    items: analyzed,
  };
}

export function getPriorityLabel(priority: RestockPriority): string {
  switch (priority) {
    case 'P1_URGENTE':
      return 'PEDIR URGENTE';
    case 'P2_ALTA':
      return 'REPONER PRONTO';
    case 'P3_MEDIA':
      return 'EVALUAR';
    case 'P4_OK':
      return 'CON EXISTENCIA';
  }
}

export function getRotationLabel(tier: RotationTier): string {
  switch (tier) {
    case 'ALTA':
      return 'Se vende muy rápido';
    case 'MEDIA':
      return 'Buen movimiento';
    case 'BAJA':
      return 'Poco movimiento';
    case 'SIN_MOV':
      return 'Sin ventas aún';
  }
}
