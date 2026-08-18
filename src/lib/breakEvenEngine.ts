import type { Product, FinancialSettings, Order } from './definitions';
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
  historicalUnitsSold: number; // Unidades vendidas reales acumuladas
  salesMixPercent: number; // % Participación automático basado en ventas o custom
  isAutoMix: boolean; // Indica si fue calculado automáticamente por historial
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
  totalHistoricalUnitsSold: number;
}

/**
 * MOTOR DE CÁLCULO DE PUNTO DE EQUILIBRIO MULTIPRODUCTO CON MIX AUTOMÁTICO POR VENTAS REALES
 */
export function calculateMultiProductBreakEven(
  products: Product[],
  expenses: ExpenseItem[],
  targetProfitUSD: number,
  globalSettings?: FinancialSettings | null,
  customMixOverrides?: Record<string, number>, // Overrides opcionales
  actualMonthSalesUSD: number = 0,
  actualMonthUnits: number = 0,
  ordersHistory?: Order[]
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
        breakEvenProgressPercent: 0,
        totalHistoricalUnitsSold: 0
      }
    };
  }

  // 2. CÁLCULO DE UNIDADES HISTÓRICAS REALES VENDIDAS POR PRODUCTO
  const unitsSoldMap: Record<string, number> = {};
  let totalHistoricalUnitsSold = 0;

  // Sumar ventas reales desde el historial de órdenes de Firestore si están presentes
  if (ordersHistory && Array.isArray(ordersHistory)) {
    ordersHistory.forEach(o => {
      if (o.status !== 'Cancelado' && o.status !== 'Rechazado') {
        const orderItems = (o as any).items;
        if (orderItems && Array.isArray(orderItems)) {
          orderItems.forEach((item: any) => {
            const pId = item.productId || item.product?.id;
            const qty = Number(item.quantity || 0);
            if (pId && qty > 0) {
              unitsSoldMap[pId] = (unitsSoldMap[pId] || 0) + qty;
              totalHistoricalUnitsSold += qty;
            }
          });
        }
      }
    });
  }

  // 3. CALCULAR MARGEN DE CONTRIBUCIÓN NETO Y MEZCLA DE VENTAS AUTOMÁTICA
  const tempItems = validProducts.map(p => {
    const calc = calculatePricingTier((p as any).pricing || { costLanded: p.cost, targetPriceUSD: p.price }, globalSettings);
    const landedCost = calc.landedCost || p.cost || 0;
    const priceCashUSD = calc.priceCashUSD || p.priceCashUSD || p.price || 0;
    const priceListBCV = calc.priceListBCV || p.price || 0;
    const netProfitUSD = calc.netProfitUSD !== undefined ? calc.netProfitUSD : (priceCashUSD - landedCost);
    const netMarginPercent = calc.netMarginPercent || (priceCashUSD > 0 ? (netProfitUSD / priceCashUSD) * 100 : 0);
    const contributionMarginRatio = priceCashUSD > 0 ? netProfitUSD / priceCashUSD : 0;

    // Unidades vendidas acumuladas (desde las órdenes o desde el campo totalSold del producto)
    const historicalUnitsSold = unitsSoldMap[p.id!] !== undefined
      ? unitsSoldMap[p.id!]
      : Number(p.totalSold || 0);

    // DETERMINAR EL % MIX
    let salesMixPercent = 0;
    let isAutoMix = true;

    // A) Si el usuario definió un override manual explícito en pantalla:
    if (customMixOverrides && customMixOverrides[p.id!] !== undefined) {
      salesMixPercent = customMixOverrides[p.id!];
      isAutoMix = false;
    } 
    // B) Si hay historial de ventas acumuladas reales en la empresa:
    else if (totalHistoricalUnitsSold > 0 && historicalUnitsSold > 0) {
      salesMixPercent = (historicalUnitsSold / totalHistoricalUnitsSold) * 100;
      isAutoMix = true;
    } 
    // C) Si es un producto nuevo sin historial, se asigna distribución equitativa (100 / N)
    else {
      salesMixPercent = 100 / count;
      isAutoMix = true;
    }

    return {
      product: p,
      landedCost,
      priceCashUSD,
      priceListBCV,
      netProfitUSD,
      netMarginPercent,
      contributionMarginRatio,
      historicalUnitsSold,
      salesMixPercent,
      isAutoMix
    };
  });

  // 4. NORMALIZAR EL % MIX PARA QUE LA SUMA SEA EXACTAMENTE 100%
  const totalMixSum = tempItems.reduce((acc, curr) => acc + curr.salesMixPercent, 0);
  const normalizedMixFactor = totalMixSum > 0 ? 100 / totalMixSum : 1;

  // 5. CALCULAR MARGEN DE CONTRIBUCIÓN PONDERADO (MCP)
  let weightedContributionMargin = 0;
  tempItems.forEach(item => {
    const normalizedMix = (item.salesMixPercent * normalizedMixFactor) / 100;
    weightedContributionMargin += item.netProfitUSD * normalizedMix;
  });

  // 6. CALCULAR PUNTO DE EQUILIBRIO EN UNIDADES TOTALES
  const totalRequiredUnits = weightedContributionMargin > 0
    ? Math.ceil(totalFixedCostsPlusTarget / weightedContributionMargin)
    : 0;

  // 7. DISTRIBUIR UNIDADES Y FACTURACIÓN REQUERIDA POR PRODUCTO
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
      historicalUnitsSold: item.historicalUnitsSold,
      salesMixPercent: normalizedMixPercent,
      isAutoMix: item.isAutoMix,
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
      breakEvenProgressPercent,
      totalHistoricalUnitsSold
    }
  };
}
