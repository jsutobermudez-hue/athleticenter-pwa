
/**
 * MOTOR DE CAPTURA DE TASA OFICIAL BCV CON ALTA RESILIENCIA
 * v101.0.0 - Endpoints Oficiales Validados en Vivo
 */
export async function fetchLatestBcvRate(): Promise<number | null> {
  const providers = [
    {
      name: 'DolarAPI Oficial (Principal)',
      url: 'https://ve.dolarapi.com/v1/dolares/oficial',
      parse: (data: any) => data.promedio || data.valor || data.precio
    },
    {
      name: 'DolarAPI Lista Completa (Mirror 2)',
      url: 'https://ve.dolarapi.com/v1/dolares',
      parse: (data: any) => {
        if (Array.isArray(data)) {
          const bcv = data.find((item: any) => item.fuente === 'oficial' || item.nombre?.toLowerCase().includes('dólar'));
          return bcv?.promedio || bcv?.valor;
        }
        return null;
      }
    },
    {
      name: 'DolarToday AWS (Mirror 3)',
      url: 'https://s3.amazonaws.com/dolartoday/data.json',
      parse: (data: any) => data.USD?.bcv || data.USD?.promedio_real
    }
  ];

  const commonHeaders = {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  };

  for (const provider of providers) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      const response = await fetch(provider.url, { 
        method: 'GET',
        headers: commonHeaders,
        signal: controller.signal,
        cache: 'no-store'
      }).catch(err => {
          console.warn(`[BCV SYNC] Fallo de red para ${provider.name}: ${err.message}`);
          return null;
      });

      clearTimeout(timeoutId);

      if (response && response.ok) {
        const data = await response.json();
        const rawRate = provider.parse(data);
        const rate = typeof rawRate === 'string' ? parseFloat(rawRate.replace(',', '.')) : rawRate;

        if (typeof rate === 'number' && rate > 0) {
          console.log(`[BCV SYNC] Éxito con ${provider.name}: ${rate} Bs.`);
          return rate;
        }
      }
    } catch (error: any) {
      if (error.name === 'TypeError' || error.message?.includes('Load failed')) {
          console.warn(`[BCV SYNC] Interceptado error de red para ${provider.name}.`);
      }
    }
  }
  return null;
}
