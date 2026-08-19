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
5. Devuelve la respuesta ESTRICTAMENTE en formato JSON plano con la siguiente estructura exacta:

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

    let contentsForGemini: any[] = [];

    // CASO 1: HOJA DE CÁLCULO EXCEL O CSV
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      try {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        let fullExcelText = `CONTENIDO EXTRAÍDO DEL ARCHIVO EXCEL DE IMPORTACIÓN (${file.name}):\n\n`;

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          fullExcelText += `--- HOJA: ${sheetName} ---\n${csvText}\n\n`;
        });

        contentsForGemini = [
          INVOICE_SYSTEM_PROMPT,
          fullExcelText
        ];
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
      contentsForGemini = [
        INVOICE_SYSTEM_PROMPT,
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
      ];
    }

    // LLAMADA A LA API DE GEMINI 2.5 FLASH CON RESPUESTA STRICT JSON
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [
        {
          parts: contentsForGemini.map((item) =>
            typeof item === 'string' ? { text: item } : item
          ),
        },
      ],
      generationConfig: {
        temperature: 0.1, // Respuesta determinística y precisa
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Error en API Gemini:', errText);
      return NextResponse.json(
        { success: false, error: `Error en servidor Gemini AI (${response.status}): ${errText}` },
        { status: 500 }
      );
    }

    const resData = await response.json();
    const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // LIMPIAR Y FORMATEAR JSON ROBUSTO
    let cleanJson = rawText.trim();
    const jsonMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanJson = jsonMatch[1] || jsonMatch[0];
    }

    let parsedInvoice = null;
    try {
      parsedInvoice = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Error parseando JSON de Gemini:', cleanJson);
      try {
        const sanitized = cleanJson
          .replace(/,\s*([\}\]])/g, '$1') // eliminar comas sobrantes al final de objetos o arrays
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // eliminar caracteres de control no imprimibles
        parsedInvoice = JSON.parse(sanitized);
      } catch (secondErr) {
        return NextResponse.json(
          { success: false, error: 'No se pudo interpretar el JSON extraído del Invoice.', rawOutput: rawText },
          { status: 500 }
        );
      }
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
