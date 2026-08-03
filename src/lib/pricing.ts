import type { FinancialSettings, PricingStrategy } from './definitions';

/**
 * MOTOR DE INGENIERÍA FINANCIERA ATHLETICENTER v158.1.0
 * Resiliencia total: Protege el cálculo contra valores NaN e integra redondeos financieros seguros.
 */
export function calculatePricingTier(
  pricing: Partial<PricingStrategy> | null | undefined,
  settings: FinancialSettings | null | undefined
): PricingStrategy['calculated'] {
  
  const safeSettings: FinancialSettings = settings || { 
    bcvRate: 1, 
    ivaPercent: 16,
    defaultBcvDiscount: 35,
    defaultCommission: 5,
    salesManagerCommission: 5,
    adminCommission: 5,
    defaultOverhead: 10,
    earlyPayment7Days: 10,
    earlyPayment15Days: 5,
    roundingTolerance: 0.05,
    overdueBlockDays: 35,
    historicalDilutionFactor: 0.65,
    stripeEnabled: false
  };

  const safeNum = (val: any) => {
    const n = parseFloat(val);
    return isNaN(n) || !isFinite(n) ? 0 : n;
  };

  const safePricing = pricing || {};
  const cost = Math.max(0, safeNum(safePricing.costLanded));
  const useGlobal = safePricing.useGlobalSettings ?? true;
  
  const salespersonComm = safeNum(useGlobal ? safeSettings.defaultCommission : (safePricing.customCommission ?? 5)) / 100;
  const adminComm = safeNum(useGlobal ? safeSettings.adminCommission : (safePricing.customAdminCommission ?? 5)) / 100;
  const managerComm = safeNum(useGlobal ? safeSettings.salesManagerCommission : (safePricing.customSalesManagerCommission ?? 5)) / 100;
  const overhead = safeNum(useGlobal ? safeSettings.defaultOverhead : (safePricing.customOverhead ?? 10)) / 100;
  
  const totalFeesPercent = salespersonComm + adminComm + managerComm;
  const bcvDiscount = safeNum(safeSettings.defaultBcvDiscount || 35) / 100;
  const early7 = safeNum(safeSettings.earlyPayment7Days || 10) / 100;
  const early15 = safeNum(safeSettings.earlyPayment15Days || 5) / 100;

  let priceListBCV = 0;
  let priceCashUSD = 0;

  if (safePricing.strategy === 'target_price') {
    priceListBCV = Math.max(0, safeNum(safePricing.targetPriceUSD));
    priceCashUSD = priceListBCV * (1 - bcvDiscount);
  } else {
    const targetMargin = safeNum(safePricing.targetMarginPercent || 60) / 100;
    const divisor = 1 - totalFeesPercent - targetMargin;
    
    if (divisor > 0.05) {
        const costWithOverhead = cost * (1 + overhead);
        priceCashUSD = costWithOverhead / divisor;
    } else {
        priceCashUSD = cost * 3; 
    }
    priceListBCV = priceCashUSD / (1 - bcvDiscount);
  }

  const p7d = priceListBCV * (1 - early7);
  const p15d = priceListBCV * (1 - early15);

  const commissionInCash = priceCashUSD * totalFeesPercent;
  const adminOverheadUSD = cost * overhead;
  const netProfitUSD = priceCashUSD - commissionInCash - cost - adminOverheadUSD;
  const netMarginPercent = priceCashUSD > 0 ? (netProfitUSD / priceCashUSD) * 100 : 0;

  const fix = (n: number) => {
    const val = isNaN(n) || !isFinite(n) ? 0 : n;
    return Number(val.toFixed(2));
  };

  return {
    priceListBCV: fix(priceListBCV),
    priceCashUSD: fix(priceCashUSD),
    priceEarly7d: fix(p7d),
    priceEarly15d: fix(p15d),
    netProfitUSD: fix(netProfitUSD),
    netMarginPercent: fix(netMarginPercent),
    totalCommissionsUSD: fix(commissionInCash),
    adminOverheadUSD: fix(adminOverheadUSD),
    landedCost: fix(cost)
  };
}

export type RoundingStrategy = 'none' | 'nearest_integer' | 'ceil_integer' | 'psychological' | 'cash_friendly';

export function applyRounding(price: number, strategy: RoundingStrategy): number {
  if (price <= 0 || isNaN(price) || !isFinite(price)) return 0;
  
  switch (strategy) {
    case 'nearest_integer':
      return Math.round(price);
      
    case 'ceil_integer':
      return Math.ceil(price);
      
    case 'psychological': {
      // Redondea al entero y le resta un centavo (.99)
      const base = Math.round(price);
      return Math.max(0.99, base - 0.01);
    }
      
    case 'cash_friendly':
      // Redondea a los 0.50 centavos o al entero más cercano (ej. 45.24 -> 45.00, 45.26 -> 45.50)
      return Math.round(price * 2) / 2;
      
    case 'none':
    default:
      return Number(price.toFixed(2));
  }
}
