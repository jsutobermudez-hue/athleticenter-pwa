import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INVOICE_SYSTEM_PROMPT = `
Eres un Auditor de Procura Logística e Importaciones Internacionales experto para Athleticenter PRO.
Tu tarea es analizar minuciosamente el Invoice (Factura Comercial, Packing List o Proforma) adjunto emitido por un proveedor internacional (China, Panamá, EEUU, etc.) en cualquier formato (Excel, PDF, Imagen o Texto).

REGLAS DE EXTRACCIÓN ESTRICTAS:
1. Extrae la información ejecutiva del Invoice y todos sus ítems de productos deportivos importados.
2. Si el archivo es una Hoja de Cálculo Excel, lee las columnas correspondientes a SKU, Descripción, Cantidad, Precio Unitario FOB y CBM.
3. Devuelve la respuesta ESTRICTAMENTE en formato JSON plano sin bloques de código Markdown (SIN \`\`\`json, SIN comillas de código), con la siguiente estructura:

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

    // LLAMADA A LA API DE GEMINI 2.5 FLASH
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

    // LIMPIAR Y FORMATEAR JSON
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsedInvoice = null;
    try {
      parsedInvoice = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Error parseando JSON de Gemini:', cleanJson);
      return NextResponse.json(
        { success: false, error: 'No se pudo interpretar el JSON extraído del Invoice.', rawOutput: rawText },
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
