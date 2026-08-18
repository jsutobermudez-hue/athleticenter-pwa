export interface AlibabaQuote {
  id: string;
  supplierName: string;
  productName: string;
  sku?: string;
  quotedUnitPriceUSD: number;
  moq: number;
  quoteDate: string; // YYYY-MM-DD
  status: 'Inquiry' | 'Sample_Ordered' | 'Approved' | 'Rejected' | 'Converted_PO';
  contactPerson?: string;
  notes?: string;
}

export interface StaleQuoteAlert {
  quote: AlibabaQuote;
  daysStagnant: number;
  severity: 'WARNING' | 'CRITICAL';
  recommendedAction: string;
}

/**
 * Motor de Seguimiento y Radar de Cotizaciones Olvidadas de Alibaba (SLA Radar)
 */
export function analyzeStaleQuotes(
  quotes: AlibabaQuote[],
  warningThresholdDays: number = 3,
  criticalThresholdDays: number = 5
): StaleQuoteAlert[] {
  if (!quotes || quotes.length === 0) return [];

  const now = new Date();
  const alerts: StaleQuoteAlert[] = [];

  quotes.forEach(q => {
    // Solo auditamos cotizaciones que aún no están Aprobadas, Rechazadas o Convertidas en PO
    if (q.status === 'Inquiry' || q.status === 'Sample_Ordered') {
      const qDate = new Date(q.quoteDate);
      if (isNaN(qDate.getTime())) return;

      const diffTime = Math.abs(now.getTime() - qDate.getTime());
      const daysStagnant = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (daysStagnant >= warningThresholdDays) {
        const severity = daysStagnant >= criticalThresholdDays ? 'CRITICAL' : 'WARNING';
        let recommendedAction = '';

        if (q.status === 'Inquiry') {
          recommendedAction = `Lleva ${daysStagnant} días en negociación. Contacta al proveedor "${q.supplierName}" en Alibaba para cerrar precio o descartar.`;
        } else if (q.status === 'Sample_Ordered') {
          recommendedAction = `Muestra pedida hace ${daysStagnant} días. Solicita número de guía/tracking de muestra a "${q.supplierName}".`;
        }

        alerts.push({
          quote: q,
          daysStagnant,
          severity,
          recommendedAction
        });
      }
    }
  });

  return alerts.sort((a, b) => b.daysStagnant - a.daysStagnant);
}
