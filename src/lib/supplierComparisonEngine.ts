import type { FinancialSettings } from './definitions';

export interface SupplierQuoteItem {
  id: string;
  supplierName: string;
  supplierCountry?: string;
  supplierRating?: string; // e.g. "Gold Supplier 5Y", "Trade Assurance"
  productSku: string;
  productName: string;
  unitPriceFOB: number;
  moq: number; // Minimum Order Quantity
  cbmPerUnit: number;
  estimatedFreightUSD: number; // Flete total asignado al lote
  estimatedCustomsUSD: number; // Aduana/Aranceles total asignado al lote
  leadTimeDays: number; // Días de fabricación
  paymentTerms: string; // ej. "30/70", "100% T/T", "Net 30"
  quoteDate: string; // YYYY-MM-DD
  notes?: string;
}

export interface SupplierComparisonResult {
  quote: SupplierQuoteItem;
  totalQuantity: number;
  totalFOB: number;
  totalFreight: number;
  totalCustoms: number;
  totalInvestmentUSD: number;
  unitLandedCostUSD: number;
  unitLandedCostVES: number;
  isBestPrice: boolean;
  isFastest: boolean;
  isLowestInvestment: boolean;
}

export interface ComparisonReport {
  results: SupplierComparisonResult[];
  recommendedSupplierId: string;
  recommendationReason: string;
  savingsVsHighestUSD: number;
}

/**
 * Motor de Comparación Lado a Lado de Cotizaciones de Proveedores (Alibaba / China)
 */
export function compareSupplierQuotes(
  quotes: SupplierQuoteItem[],
  targetQuantity?: number,
  bcvRate: number = 36.5
): ComparisonReport {
  if (!quotes || quotes.length === 0) {
    return {
      results: [],
      recommendedSupplierId: '',
      recommendationReason: 'No hay cotizaciones para comparar.',
      savingsVsHighestUSD: 0
    };
  }

  const results: SupplierComparisonResult[] = quotes.map(q => {
    const qty = Math.max(q.moq, targetQuantity || q.moq);
    const totalFOB = q.unitPriceFOB * qty;
    const totalFreight = q.estimatedFreightUSD;
    const totalCustoms = q.estimatedCustomsUSD;
    const totalInvestmentUSD = totalFOB + totalFreight + totalCustoms;
    const unitLandedCostUSD = qty > 0 ? totalInvestmentUSD / qty : 0;
    const unitLandedCostVES = unitLandedCostUSD * bcvRate;

    return {
      quote: q,
      totalQuantity: qty,
      totalFOB,
      totalFreight,
      totalCustoms,
      totalInvestmentUSD,
      unitLandedCostUSD,
      unitLandedCostVES,
      isBestPrice: false,
      isFastest: false,
      isLowestInvestment: false
    };
  });

  // Encontrar mínimos para determinar badges
  let minLanded = Infinity;
  let minLeadTime = Infinity;
  let minInvestment = Infinity;
  let maxLanded = 0;

  results.forEach(r => {
    if (r.unitLandedCostUSD < minLanded) minLanded = r.unitLandedCostUSD;
    if (r.quote.leadTimeDays < minLeadTime) minLeadTime = r.quote.leadTimeDays;
    if (r.totalInvestmentUSD < minInvestment) minInvestment = r.totalInvestmentUSD;
    if (r.unitLandedCostUSD > maxLanded) maxLanded = r.unitLandedCostUSD;
  });

  results.forEach(r => {
    if (r.unitLandedCostUSD === minLanded) r.isBestPrice = true;
    if (r.quote.leadTimeDays === minLeadTime) r.isFastest = true;
    if (r.totalInvestmentUSD === minInvestment) r.isLowestInvestment = true;
  });

  // Determinar la cotización ganadora recomendada
  const winner = results.find(r => r.isBestPrice) || results[0];
  const savingsVsHighestUSD = maxLanded > 0 ? (maxLanded - winner.unitLandedCostUSD) * winner.totalQuantity : 0;

  let recommendationReason = `La mejor opción económica es "${winner.quote.supplierName}" con un Costo Landed Puesto en Almacén de $${winner.unitLandedCostUSD.toFixed(2)} USD por unidad`;
  if (winner.isFastest) {
    recommendationReason += ` y el tiempo de fabricación más rápido (${winner.quote.leadTimeDays} días).`;
  } else {
    recommendationReason += `. Tiempo de entrega estimado: ${winner.quote.leadTimeDays} días.`;
  }

  return {
    results,
    recommendedSupplierId: winner.quote.id,
    recommendationReason,
    savingsVsHighestUSD
  };
}
