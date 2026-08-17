import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 segundos de tiempo de ejecución para archivos grandes

const SYSTEM_PROMPT = `
Eres un Auditor Financiero Senior experto en Inteligencia de Precios B2B para Athleticenter PRO, una empresa mayorista de equipamiento y artículos deportivos en todas las disciplinas (Fútbol, Béisbol, Baloncesto, Voleibol, Tenis, Natación, Boxeo, Fitness, Artes Marciales, Pádel, Atletismo, Ciclismo, etc.).

Tu tarea es analizar minuciosamente el archivo adjunto enviado por la competencia (PDF, Hoja de Cálculo Excel, Imagen o Texto).

REGLAS DE EXTRACCIÓN ESTRICTAS:
1. Lee todo el contenido del archivo e identifica ÚNICAMENTE los productos y equipos deportivos con su precio de venta de competencia en Dólares ($ USD).
2. Ignora todo el ruido visual, membretes, logos, direcciones, teléfonos, términos legales de crédito, cuentas bancarias y títulos de secciones.
3. Para cada producto deportivo identificado, extrae:
   - "item": Nombre claro y completo del artículo deportivo (incluye marca, modelo y especificación si está presente).
   - "price": Precio numérico en USD (ejemplo: 24.50). Si está formateado como $24.50, conviértelo a número plano float sin símbolos.
   - "discipline": Disciplina deportiva detectada (Fútbol, Béisbol, Baloncesto, Voleibol, Tenis, Natación, Boxeo, Fitness, etc.).
   - "brand": Marca si se menciona (Penalty, Molten, Wilson, Rawlings, Easton, Speedo, etc.).
4. Si no logras determinar la disciplina exacta, coloca "General".
5. Devuelve la respuesta ESTRICTAMENTE en formato JSON plano sin bloques de código Markdown (SIN \`\`\`json, SIN comillas de código), un simple arreglo JSON de objetos:
[
  {
    "item": "Pelota de Fútbol Talla 5 Penalty Campo",
    "price": 18.50,
    "discipline": "Fútbol",
    "brand": "Penalty"
  }
]
`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'La API Key de Gemini (GOOGLE_GENAI_API_KEY / GEMINI_API_KEY) no está configurada en las variables de entorno.' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No se adjuntó ningún archivo en la solicitud.' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const mimeType = file.type || '';

    let promptPart: any = null;

    // 1. SI ES UN ARCHIVO DE EXCEL O CSV (.xlsx, .xls, .csv)
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || mimeType.includes('spreadsheet') || mimeType.includes('csv')) {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'buffer' });
      let textContent = '';
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        textContent += `--- HOJA EXCEL: ${sheetName} ---\n` + XLSX.utils.sheet_to_csv(sheet) + '\n\n';
      });
      promptPart = {
        text: `A continuación se presenta el contenido extraído de la hoja de cálculo de la competencia (${file.name}):\n\n${textContent}`
      };
    }
    // 2. SI ES UN ARCHIVO PDF
    else if (fileName.endsWith('.pdf') || mimeType === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      promptPart = {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data
        }
      };
    }
    // 3. SI ES UNA IMAGEN (.png, .jpg, .jpeg, .webp)
    else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.webp') || mimeType.startsWith('image/')) {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      const imgMime = mimeType || (fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      promptPart = {
        inlineData: {
          mimeType: imgMime,
          data: base64Data
        }
      };
    }
    // 4. OTROS ARCHIVOS DE TEXTO PLANO / DOCUMENTOS (.txt, .tsv, etc.)
    else {
      const textContent = await file.text();
      promptPart = {
        text: `A continuación se presenta el texto del documento de la competencia (${file.name}):\n\n${textContent}`
      };
    }

    // Intentar llamadas a Gemini 2.5 Flash / 1.5 Flash
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-1.5-flash'
    ];

    let rawResponseText = '';
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: SYSTEM_PROMPT },
                    promptPart
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 8192
              }
            })
          }
        );

        if (response.ok) {
          const resData = await response.json();
          rawResponseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawResponseText) break;
        } else {
          const errText = await response.text();
          console.warn(`[Pricing Intelligence API] Fallo con modelo ${modelName}:`, errText);
          lastError = errText;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!rawResponseText) {
      throw new Error(`No se pudo procesar el archivo con Gemini. Detalle: ${typeof lastError === 'string' ? lastError : lastError?.message || 'Error de conexión'}`);
    }

    // Saneamiento estricto de JSON
    let cleanedText = rawResponseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const firstBracket = cleanedText.indexOf('[');
    const lastBracket = cleanedText.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      cleanedText = cleanedText.substring(firstBracket, lastBracket + 1);
    }

    let parsedItems: any[] = [];
    try {
      parsedItems = JSON.parse(cleanedText);
    } catch (parseErr: any) {
      console.error("[Pricing Intelligence API] Error al parsear JSON de Gemini:", cleanedText);
      return NextResponse.json(
        {
          success: false,
          error: 'Gemini devolvió un formato no parseable para este archivo.',
          rawOutput: rawResponseText
        },
        { status: 422 }
      );
    }

    if (!Array.isArray(parsedItems)) {
      return NextResponse.json(
        { success: false, error: 'La respuesta extraída de la competencia no es una lista válida de productos.' },
        { status: 422 }
      );
    }

    // Normalizar elementos extraídos
    const sanitizedItems = parsedItems.map(i => ({
      item: String(i.item || 'Producto Sin Nombre').trim(),
      price: Math.max(0, parseFloat(i.price) || 0),
      discipline: String(i.discipline || 'General').trim(),
      brand: String(i.brand || '').trim()
    })).filter(i => i.item.length > 0 && i.price > 0);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      extractedCount: sanitizedItems.length,
      items: sanitizedItems
    });

  } catch (error: any) {
    console.error("[Pricing Intelligence API Error]:", error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno al procesar el archivo de la competencia.' },
      { status: 500 }
    );
  }
}
