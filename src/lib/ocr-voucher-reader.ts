/**
 * ATHLETICENTER PRO - MOTOR DE ESCANEO OCR & VISIÓN IA DE VOUCHERS BANCARIOS v1.0
 * Analiza comprobantes de transferencia (Pago Móvil, Banesco, Mercantil, BDV, Zelle, Binance)
 * y extrae la referencia, monto, fecha de transferencia y banco emisor.
 */

export interface VoucherScanResult {
  referenceNumber?: string;
  amountVES?: number;
  amountUSD?: number;
  paymentDate?: string; // YYYY-MM-DD
  bankName?: string;
  confidence: number;
  rawText?: string;
}

/**
 * Parsea el texto escaneado de un voucher bancario para extraer campos clave
 */
export function parseVoucherText(text: string): VoucherScanResult {
  if (!text) {
    return { confidence: 0 };
  }

  const cleanText = text.replace(/\r\n/g, '\n');
  let referenceNumber: string | undefined;
  let amountVES: number | undefined;
  let amountUSD: number | undefined;
  let paymentDate: string | undefined;
  let bankName: string | undefined;
  let matchCount = 0;

  // 1. EXTRAER NÚMERO DE REFERENCIA (Ej: Ref: 12345678, Operación 00987654)
  const refRegex = /(?:ref|referencia|operaci[oó]n|nro|nro\.|transacci[oó]n|num|id|confirmaci[oó]n)[:\s#]*([0-9A-Z]{4,16})/i;
  const refMatch = cleanText.match(refRegex);
  if (refMatch && refMatch[1]) {
    referenceNumber = refMatch[1];
    matchCount++;
  } else {
    // Fallback: Buscar secuencias numéricas de 6 a 12 dígitos aisladas
    const fallbackRef = cleanText.match(/\b\d{6,12}\b/);
    if (fallbackRef) {
      referenceNumber = fallbackRef[0];
      matchCount++;
    }
  }

  // 2. EXTRAER MONTO (Ej: Bs. 6.400,00 | $153.00 USD | 153.00)
  const vesRegex = /(?:bs\.?|bol[ií]vares|ves)[:\s]*([\d.,]+)/i;
  const usdRegex = /(?:\$|usd|d[oó]lares)[:\s]*([\d.,]+)/i;

  const vesMatch = cleanText.match(vesRegex);
  if (vesMatch && vesMatch[1]) {
    const rawVal = vesMatch[1].replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(rawVal);
    if (!isNaN(parsed) && parsed > 0) {
      amountVES = parsed;
      matchCount++;
    }
  }

  const usdMatch = cleanText.match(usdRegex);
  if (usdMatch && usdMatch[1]) {
    const rawVal = usdMatch[1].replace(/,/g, '');
    const parsed = parseFloat(rawVal);
    if (!isNaN(parsed) && parsed > 0) {
      amountUSD = parsed;
      matchCount++;
    }
  }

  // 3. EXTRAER FECHA DE TRANSFERENCIA (Ej: 27/08/2026 | 2026-08-27 | 27-08-2026)
  const dateRegex = /\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})\b/;
  const dateMatch = cleanText.match(dateRegex);
  if (dateMatch) {
    let day = dateMatch[1].padStart(2, '0');
    let month = dateMatch[2].padStart(2, '0');
    let year = dateMatch[3];
    if (year.length === 2) year = `20${year}`;
    paymentDate = `${year}-${month}-${day}`;
    matchCount++;
  }

  // 4. EXTRAER BANCO DE ORIGEN / VÍA
  const upperText = cleanText.toUpperCase();
  if (upperText.includes('BANESCO')) bankName = 'Banesco';
  else if (upperText.includes('MERCANTIL')) bankName = 'Mercantil';
  else if (upperText.includes('VENEZUELA') || upperText.includes('BDV')) bankName = 'Banco de Venezuela (BDV)';
  else if (upperText.includes('PROVINCIAL') || upperText.includes('BBVA')) bankName = 'BBVA Provincial';
  else if (upperText.includes('BNC')) bankName = 'Banco Nacional de Crédito (BNC)';
  else if (upperText.includes('ZELLE')) bankName = 'Zelle';
  else if (upperText.includes('BINANCE') || upperText.includes('USDT')) bankName = 'Binance Pay';
  else if (upperText.includes('PAGO MÓVIL') || upperText.includes('PAGOMOVIL')) bankName = 'Pago Móvil';

  if (bankName) matchCount++;

  const confidence = Math.min(1, matchCount / 4);

  return {
    referenceNumber,
    amountVES,
    amountUSD,
    paymentDate,
    bankName,
    confidence,
    rawText: text
  };
}
