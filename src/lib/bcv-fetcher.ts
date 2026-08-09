
/**
 * MOTOR DE CAPTURA DE TASA OFICIAL BCV CON ALTA RESILIENCIA
 * v100.0.0 - Triple Mirror Failover con DolarAPI, PyDolarVE y DolarToday
 */
export async function fetchLatestBcvRate(): Promise<number | null> {
  const providers = [
    {
      name: 'DolarAPI (Mirror Principal)',
      url: 'https://ve.dolarapi.com/v1/dolares/bcv',
      parse: (data: any) => data.valor || data.promedio
    },
    {
      name: 'PyDolarVE (Mirror Secundario API)',
      url: 'https://pydolarve.org/api/v1/dollar?page=bcv',
      parse: (data: any) => data.monedas?.usd?.price || data.price || data.usd
    },
    {
      name: 'DolarToday (Mirror Terciario AWS)',
      url: 'https://s3.amazonaws.com/dolartoday/data.json',
      parse: (data: any) => data.USD?.bcv
    }
  ];

  const commonHeaders = {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
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
