import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Hasta 5 minutos para catálogos PDF gigantes (hasta 250 MB)

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

async function uploadToGeminiFileApi(buffer: Buffer, mimeType: string, displayName: string, apiKey: string): Promise<{ uri: string; name: string }> {
  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Header-Content-Length': String(buffer.byteLength),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': mimeType,
        'X-Goog-Upload-File-Name': encodeURIComponent(displayName),
      },
      body: new Uint8Array(buffer),
    }
  );

  if (!uploadRes.ok) {
    const errTxt = await uploadRes.text();
    throw new Error(`Error subiendo PDF pesado a Gemini File API (${uploadRes.status}): ${errTxt}`);
  }

  const data = await uploadRes.json();
  const fileObj = data?.file || data;
  if (!fileObj?.uri) {
    throw new Error('Gemini File API no devolvió URI de archivo.');
  }

  // Esperar si el archivo está en estado PROCESSING
  let state = fileObj.state;
  const resourceName = fileObj.name;
  let retries = 0;
  while (state === 'PROCESSING' && resourceName && retries < 25) {
    await new Promise((r) => setTimeout(r, 2000));
    retries++;
    const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${resourceName}?key=${apiKey}`);
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      state = checkData?.state || 'ACTIVE';
    } else {
      break;
    }
  }

  return { uri: fileObj.uri, name: resourceName || '' };
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  let geminiTempFileName = '';
  const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '';

  try {
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'La API Key de Gemini (GOOGLE_GENAI_API_KEY / GEMINI_API_KEY) no está configurada en las variables de entorno.' },
        { status: 500 }
      );
    }

    let rawFileName = '';
    let mimeType = '';
    let fileBuffer: Buffer | null = null;

    const contentTypeHeader = req.headers.get('content-type') || '';

    if (contentTypeHeader.includes('application/json')) {
      const body = await req.json();
      const fileUrl = String(body?.fileUrl || '');
      rawFileName = String(body?.fileName || 'catalogo_competencia.pdf');
      mimeType = String(body?.mimeType || '');

      if (!fileUrl || !fileUrl.startsWith('https://firebasestorage.googleapis.com/')) {
        return NextResponse.json(
          { success: false, error: 'URL de archivo en Cloud Storage no válida.' },
          { status: 400 }
        );
      }

      const dlRes = await fetch(fileUrl, { signal: AbortSignal.timeout(120000) });
      if (!dlRes.ok) {
        throw new Error(`No se pudo descargar el catálogo desde Cloud Storage (${dlRes.status}).`);
      }
      fileBuffer = Buffer.from(await dlRes.arrayBuffer());
      if (!mimeType) mimeType = dlRes.headers.get('content-type') || '';
    } else {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          { success: false, error: 'No se adjuntó ningún archivo en la solicitud.' },
          { status: 400 }
        );
      }
      rawFileName = file.name;
      mimeType = file.type || '';
      fileBuffer = Buffer.from(await file.arrayBuffer());
    }

    const fileName = rawFileName.toLowerCase();
    let promptPart: any = null;

    // 1. SI ES UN ARCHIVO DE EXCEL O CSV (.xlsx, .xls, .csv)
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || mimeType.includes('spreadsheet') || mimeType.includes('csv')) {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      let textContent = '';
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        textContent += `--- HOJA EXCEL: ${sheetName} ---\n` + XLSX.utils.sheet_to_csv(sheet) + '\n\n';
      });
      promptPart = {
        text: `A continuación se presenta el contenido extraído de la hoja de cálculo de la competencia (${rawFileName}):\n\n${textContent}`
      };
    }
    // 2. SI ES UN ARCHIVO PDF (SOPORTE NATIVO HASTA 250 MB VÍA GEMINI FILE API)
    else if (fileName.endsWith('.pdf') || mimeType === 'application/pdf') {
      if (fileBuffer.byteLength > 14 * 1024 * 1024) {
        const uploaded = await uploadToGeminiFileApi(fileBuffer, 'application/pdf', rawFileName, apiKey);
        geminiTempFileName = uploaded.name;
        promptPart = {
          fileData: {
            mimeType: 'application/pdf',
            fileUri: uploaded.uri
          }
        };
      } else {
        promptPart = {
          inlineData: {
            mimeType: 'application/pdf',
            data: fileBuffer.toString('base64')
          }
        };
      }
    }
    // 3. SI ES UNA IMAGEN (.png, .jpg, .jpeg, .webp)
    else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.webp') || mimeType.startsWith('image/')) {
      const imgMime = mimeType || (fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      promptPart = {
        inlineData: {
          mimeType: imgMime,
          data: fileBuffer.toString('base64')
        }
      };
    }
    // 4. OTROS ARCHIVOS DE TEXTO PLANO / DOCUMENTOS (.txt, .tsv, etc.)
    else {
      const textContent = fileBuffer.toString('utf8');
      promptPart = {
        text: `A continuación se presenta el texto del documento de la competencia (${rawFileName}):\n\n${textContent}`
      };
    }

    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-2.0-flash'
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
                maxOutputTokens: 32768
              }
            }),
            signal: AbortSignal.timeout(240000)
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
    } catch {
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

    const sanitizedItems = parsedItems.map(i => ({
      item: String(i.item || 'Producto Sin Nombre').trim(),
      price: Math.max(0, parseFloat(i.price) || 0),
      discipline: String(i.discipline || 'General').trim(),
      brand: String(i.brand || '').trim()
    })).filter(i => i.item.length > 0 && i.price > 0);

    return NextResponse.json({
      success: true,
      fileName: rawFileName,
      extractedCount: sanitizedItems.length,
      items: sanitizedItems
    });

  } catch (error: any) {
    console.error("[Pricing Intelligence API Error]:", error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno al procesar el archivo de la competencia.' },
      { status: 500 }
    );
  } finally {
    if (geminiTempFileName && apiKey) {
      fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiTempFileName}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}
