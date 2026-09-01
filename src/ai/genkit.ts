import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '';

// Inicializamos el motor principal de Genkit con API Key explícita
export const ai = genkit({
  plugins: [googleAI({ apiKey })],
  // Definimos Gemini 1.5 Flash como modelo por defecto para velocidad y estabilidad en producción
  model: 'googleai/gemini-1.5-flash', 
});
