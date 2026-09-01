import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INVOICE_SYSTEM_PROMPT = `
Eres un Auditor de Procura Logística e Importaciones Internacionales experto para Athleticenter PRO.
Tu tarea es analizar minuciosamente el Invoice (Factura Comercial, Packing List, Proforma o Contrato de Compra) adjunto emitido por un proveedor internacional (China, Guangzhou, Yiwu, Shenzhen, Panamá, EEUU, etc.) en cualquier idioma (Inglés, Chino, Español) y formato (Excel, PDF, Imagen, CSV o Texto).

REGLAS DE EXTRACCIÓN Y TRADUCCIÓN ESTRICTAS:
1. Extrae la información ejecutiva del Invoice y todos los ítems de productos importados.
2. Si el contenido contiene texto o nombres de productos en Chino o Inglés, traduce las descripciones y nombres de productos al Español comercial claro para Athleticenter.
3. Si el SKU no viene explícito en el Invoice, genera un código SKU sugerido limpio basado en la disciplina, marca y modelo (ejemplo: B-MOLTEN-GL7).
4. Asegúrate de que los números de cantidad, precio unitario FOB y CBM sean valores numéricos puros (sin símbolos de moneda $ o comas decimales europeas).
5. NUNCA uses comillas dobles (") dentro de los valores de texto de nombres o descripciones (ejemplo: usa 'Talla 7' o '7 pulg' en lugar de '7"').
6. Devuelve la respuesta ESTRICTAMENTE en formato JSON plano con la siguiente estructura exacta:

{
  "supplierName": "Guangzhou Sport Goods Co., Ltd.",
  "invoiceNumber": "INV-2026-0891",
  "invoiceDate": "2026-08-15",
  "incoterm": "FOB",
  "currency": "USD",
  "shippingFreightUSD": 1250.00,
  "customsCostsUSD": 450.00,
  "otherCostsUSD": 100.00,
  "items": [
    {
      "sku": "B-M01-FIBA01",
      "name": "Balón de Baloncesto Molten GL7",
      "description": "Balón de Baloncesto Profesional Piel Sintética Talla 7",
      "quantity": 500,
      "unitPriceFOB": 14.50,
      "totalPriceFOB": 7250.00,
      "cbmPerUnit": 0.045,
      "discipline": "Baloncesto",
      "brand": "Molten"
    }
  ]
}
`;

function tryRepairJson(jsonStr: string): any {
  if (!jsonStr || jsonStr.trim().length === 0) return null;

  // 1. Intentar parseo directo
  try {
    return JSON.parse(jsonStr);
  } catch (_) {}

  // 2. Limpieza de comas colgantes y caracteres de control
  let sanitized = jsonStr
    .replace(/,\s*([\}\]])/g, '$1')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\r?\n|\r/g, ' ');

  try {
    return JSON.parse(sanitized);
  } catch (_) {}

  // 3. Reparación de JSON truncado o corchetes/llaves no cerradas
  let openBrackets = 0;
  let openBraces = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (char === '\\') {
      isEscaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
      if (char === '{') openBraces++;
      if (char === '}') openBraces = Math.max(0, openBraces - 1);
    }
  }

  if (inString) {
    sanitized += '"';
  }

  sanitized = sanitized.trim().replace(/,\s*$/, '');

  while (openBrackets > 0) {
    sanitized += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    sanitized += '}';
    openBraces--;
  }

  try {
    return JSON.parse(sanitized);
  } catch (_) {}

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'La API Key de Gemini (GOOGLE_GENAI_API_KEY / GEMINI_API_KEY) no está configurada.' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No se adjuntó ningún archivo de Invoice.' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    let fileParts: any[] = [];

    // CASO 1: HOJA DE CÁLCULO EXCEL O CSV
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      try {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        let fullExcelText = `CONTENIDO EXTRAÍDO DEL ARCHIVO EXCEL DE IMPORTACIÓN (${file.name}):\n\n`;

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          fullExcelText += `--- HOJA: ${sheetName} ---\nmatriz_csv:\n${csvText}\n\nmatriz_json:\n${JSON.stringify(jsonRows)}\n\n`;
        });

        fileParts = [{ text: fullExcelText }];
      } catch (excelErr) {
        console.error('Error al procesar archivo Excel:', excelErr);
        return NextResponse.json(
          { success: false, error: 'El archivo Excel no pudo ser leído correctamente.' },
          { status: 400 }
        );
      }
    } else {
      // CASO 2: PDF, IMAGEN O TEXTO DIRECTO
      let mimeType = file.type || 'application/pdf';
      if (fileName.endsWith('.png')) mimeType = 'image/png';
      if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
      if (fileName.endsWith('.webp')) mimeType = 'image/webp';
      if (fileName.endsWith('.pdf')) mimeType = 'application/pdf';

      const base64Data = fileBuffer.toString('base64');
      fileParts = [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
      ];
    }

    const modelsToTry = [
      'gemini-1.5-flash',
      'gemini-1.5-flash'
    ];

    let rawText = '';
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: INVOICE_SYSTEM_PROMPT },
                  ...fileParts
                ]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 8192,
              responseMimeType: "application/json"
            }
          }),
        });

        if (response.ok) {
          const resData = await response.json();
          rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawText.trim().length > 0) break;
        } else {
          const errText = await response.text();
          console.warn(`[Invoice Scanner API] Fallo con modelo ${modelName}:`, errText);
          lastError = errText;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: `No se pudo obtener respuesta de la IA. Detalle: ${typeof lastError === 'string' ? lastError : lastError?.message || 'Fallo de conexión'}` },
        { status: 500 }
      );
    }

    // LIMPIAR Y FORMATEAR JSON CON AUTORREPARACIÓN
    let cleanJson = rawText.trim();
    const jsonMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanJson = jsonMatch[1] || jsonMatch[0];
    }

    let parsedInvoice = tryRepairJson(cleanJson);

    if (!parsedInvoice) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'No se pudo estructurar el JSON del Invoice. Por favor reintenta con una versión en Excel o PDF más clara.',
          rawOutput: rawText.substring(0, 500)
        },
        { status: 500 }
      );
    }

    // NORMALIZAR ESTRUCTURA DE SALIDA
    if (parsedInvoice && !Array.isArray(parsedInvoice.items) && Array.isArray(parsedInvoice.productos)) {
      parsedInvoice.items = parsedInvoice.productos;
    }

    if (!parsedInvoice || !Array.isArray(parsedInvoice.items)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'El formato de Invoice procesado no contiene una lista válida de ítems o productos.', 
          rawOutput: rawText.substring(0, 500) 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: parsedInvoice
    });

  } catch (err: any) {
    console.error('Error en procesar Invoice Importación:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Error interno al procesar Invoice.' },
      { status: 500 }
    );
  }
}
