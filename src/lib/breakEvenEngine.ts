import type { Product, FinancialSettings } from './definitions';
import { calculatePricingTier, DEFAULT_BCV_RATE } from './pricing';

export interface ExpenseItem {
  id?: string;
  concept: string;
  category: 'Nómina' | 'Alquiler' | 'Servicios' | 'Marketing' | 'Depreciación' | 'Impuestos' | 'Flete Local' | 'Licencias/Software' | 'Otros';
  amountUSD: number;
  isFixed: boolean;
  periodicity?: 'mensual' | 'anual';
  notes?: string;
}

export interface ProductBreakEvenCalculation {
  product: Product;
  landedCost: number;
  priceCashUSD: number;
  priceListBCV: number;
  netProfitUSD: number;
  netMarginPercent: number;
  salesMixPercent: number; // % Participación en la mezcla de ventas
  requiredUnitsMonth: number; // Unidades exactas que se deben vender al mes
  requiredRevenueUSDMonth: number; // Ventas requeridas en $ USD al mes
  requiredRevenueVESMonth: number; // Ventas requeridas en Bs. BCV al mes
  contributionMarginRatio: number; // Margen de contribución %
  isProfitable: boolean;
}

export interface BreakEvenSummary {
  totalFixedExpensesUSD: number;
  totalVariableExpensesUSD: number;
  targetProfitUSD: number;
  totalRequiredRevenueUSD: number;
  totalRequiredRevenueVES: number;
  totalRequiredUnits: number;
  weightedContributionMargin: number;
  bcvRate: number;
  actualMonthSalesUSD: number;
  actualMonthUnits: number;
  breakEvenProgressPercent: number;
}

/**
 * MOTOR DE CÁLCULO DE PUNTO DE EQUILIBRIO MULTIPRODUCTO
 * Integra las fórmulas de pricing.ts, comisiones de Tesorería (15%), Overhead (10%) y Dólar BCV.
 */
export function calculateMultiProductBreakEven(
  products: Product[],
  expenses: ExpenseItem[],
  targetProfitUSD: number,
  globalSettings?: FinancialSettings | null,
  customMixOverrides?: Record<string, number>, // Custom overrides por SKU / ID
  actualMonthSalesUSD: number = 0,
  actualMonthUnits: number = 0
): { items: ProductBreakEvenCalculation[]; summary: BreakEvenSummary } {
  const bcvRate = globalSettings?.bcvRate || DEFAULT_BCV_RATE;
  const safeTargetProfit = Math.max(0, targetProfitUSD || 0);

  // 1. SUMA DE GASTOS FIJOS Y VARIABLES
  let totalFixedExpensesUSD = 0;
  let totalVariableExpensesUSD = 0;

  expenses.forEach(e => {
    const monthlyAmount = e.periodicity === 'anual' ? e.amountUSD / 12 : e.amountUSD;
    if (e.isFixed) {
      totalFixedExpensesUSD += monthlyAmount;
    } else {
      totalVariableExpensesUSD += monthlyAmount;
    }
  });

  const totalFixedCostsPlusTarget = totalFixedExpensesUSD + safeTargetProfit;

  const validProducts = Array.isArray(products) ? products.filter(p => p && p.name) : [];
  const count = validProducts.length;

  if (count === 0) {
    return {
      items: [],
      summary: {
        totalFixedExpensesUSD: Number(totalFixedExpensesUSD.toFixed(2)),
        totalVariableExpensesUSD: Number(totalVariableExpensesUSD.toFixed(2)),
        targetProfitUSD: Number(safeTargetProfit.toFixed(2)),
        totalRequiredRevenueUSD: 0,
        totalRequiredRevenueVES: 0,
        totalRequiredUnits: 0,
        weightedContributionMargin: 0,
        bcvRate,
        actualMonthSalesUSD,
        actualMonthUnits,
        breakEvenProgressPercent: 0
      }
    };
  }

  // 2. CALCULAR MARGEN DE CONTRIBUCIÓN NETO DE CADA PRODUCTO USANDO PRICING.TS
  const tempItems = validProducts.map(p => {
    const calc = calculatePricingTier((p as any).pricing || { costLanded: p.cost, targetPriceUSD: p.price }, globalSettings);
    const landedCost = calc.landedCost || p.cost || 0;
    const priceCashUSD = calc.priceCashUSD || p.priceCashUSD || p.price || 0;
    const priceListBCV = calc.priceListBCV || p.price || 0;
    const netProfitUSD = calc.netProfitUSD !== undefined ? calc.netProfitUSD : (priceCashUSD - landedCost);
    const netMarginPercent = calc.netMarginPercent || (priceCashUSD > 0 ? (netProfitUSD / priceCashUSD) * 100 : 0);
    const contributionMarginRatio = priceCashUSD > 0 ? netProfitUSD / priceCashUSD : 0;

    // Participación en el mix: si existe override manual se usa, de lo contrario distribución equitativa por defecto
    const overrideMix = customMixOverrides && customMixOverrides[p.id!] !== undefined ? customMixOverrides[p.id!] : undefined;
    const salesMixPercent = overrideMix !== undefined ? overrideMix : (100 / count);

    return {
      product: p,
      landedCost,
      priceCashUSD,
      priceListBCV,
      netProfitUSD,
      netMarginPercent,
      contributionMarginRatio,
      salesMixPercent
    };
  });

  // 3. NORMALIZAR EL % MIX PARA QUE LA SUMA SEA EXACTAMENTE 100%
  const totalMixSum = tempItems.reduce((acc, curr) => acc + curr.salesMixPercent, 0);
  const normalizedMixFactor = totalMixSum > 0 ? 100 / totalMixSum : 1;

  // 4. CALCULAR MARGEN DE CONTRIBUCIÓN PONDERADO (MCP)
  let weightedContributionMargin = 0;
  tempItems.forEach(item => {
    const normalizedMix = (item.salesMixPercent * normalizedMixFactor) / 100;
    weightedContributionMargin += item.netProfitUSD * normalizedMix;
  });

  // 5. CALCULAR PUNTO DE EQUILIBRIO EN UNIDADES TOTALES
  const totalRequiredUnits = weightedContributionMargin > 0
    ? Math.ceil(totalFixedCostsPlusTarget / weightedContributionMargin)
    : 0;

  // 6. DISTRIBUIR UNIDADES Y FACTURACIÓN REQUERIDA POR PRODUCTO
  let totalRequiredRevenueUSD = 0;

  const items: ProductBreakEvenCalculation[] = tempItems.map(item => {
    const normalizedMixPercent = Number((item.salesMixPercent * normalizedMixFactor).toFixed(2));
    const normalizedMixDecimal = normalizedMixPercent / 100;

    const requiredUnitsMonth = Math.ceil(totalRequiredUnits * normalizedMixDecimal);
    const requiredRevenueUSDMonth = Number((requiredUnitsMonth * item.priceCashUSD).toFixed(2));
    const requiredRevenueVESMonth = Number((requiredRevenueUSDMonth * bcvRate).toFixed(2));

    totalRequiredRevenueUSD += requiredRevenueUSDMonth;

    return {
      product: item.product,
      landedCost: item.landedCost,
      priceCashUSD: item.priceCashUSD,
      priceListBCV: item.priceListBCV,
      netProfitUSD: item.netProfitUSD,
      netMarginPercent: item.netMarginPercent,
      salesMixPercent: normalizedMixPercent,
      requiredUnitsMonth,
      requiredRevenueUSDMonth,
      requiredRevenueVESMonth,
      contributionMarginRatio: Number((item.contributionMarginRatio * 100).toFixed(1)),
      isProfitable: item.netProfitUSD > 0
    };
  });

  const totalRequiredRevenueVES = Number((totalRequiredRevenueUSD * bcvRate).toFixed(2));
  const breakEvenProgressPercent = totalRequiredRevenueUSD > 0
    ? Math.min(100, Number(((actualMonthSalesUSD / totalRequiredRevenueUSD) * 100).toFixed(1)))
    : 0;

  return {
    items,
    summary: {
      totalFixedExpensesUSD: Number(totalFixedExpensesUSD.toFixed(2)),
      totalVariableExpensesUSD: Number(totalVariableExpensesUSD.toFixed(2)),
      targetProfitUSD: Number(safeTargetProfit.toFixed(2)),
      totalRequiredRevenueUSD: Number(totalRequiredRevenueUSD.toFixed(2)),
      totalRequiredRevenueVES,
      totalRequiredUnits,
      weightedContributionMargin: Number(weightedContributionMargin.toFixed(2)),
      bcvRate,
      actualMonthSalesUSD,
      actualMonthUnits,
      breakEvenProgressPercent
    }
  };
}
