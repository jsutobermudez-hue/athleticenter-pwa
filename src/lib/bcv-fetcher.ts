
/**
 * MOTOR DE CAPTURA DE TASA OFICIAL BCV CON ALTA RESILIENCIA
 * v98.0.0 - Blindaje total contra 'TypeError: Load failed'
 */
export async function fetchLatestBcvRate(): Promise<number | null> {
  const providers = [
    {
      name: 'DolarAPI (Mirror Principal)',
      url: 'https://ve.dolarapi.com/v1/dolares/bcv',
      parse: (data: any) => data.valor || data.promedio
    },
    {
      name: 'DolarToday (Mirror AWS)',
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
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(provider.url, { 
        method: 'GET',
        headers: commonHeaders,
        signal: controller.signal,
        cache: 'no-store'
      }).catch(err => {
          // Captura el fallo de red antes de que suba a la UI
          console.warn(`[BCV SYNC] Fallo de red inmediato para ${provider.name}: ${err.message}`);
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
      // Captura TypeError específicamente para evitar el red-screen
      if (error.name === 'TypeError' || error.message.includes('Load failed')) {
          console.warn(`[BCV SYNC] TypeError interceptado para ${provider.name}.`);
      }
    }
  }
  return null;
}
