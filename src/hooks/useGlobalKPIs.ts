import { useMemo } from 'react';
import type { Order } from '@/lib/definitions';
import { calculateGlobalFinancialMetrics } from '@/lib/billing';

export function useGlobalKPIs(
  orders: Order[] | null,
  periodFilter: 'today' | '7d' | 'this_month' | 'last_month' | 'all' = 'all'
) {
  return useMemo(() => {
    return calculateGlobalFinancialMetrics(orders, periodFilter);
  }, [orders, periodFilter]);
}
