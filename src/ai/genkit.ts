import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Inicializamos el motor principal de Genkit
export const ai = genkit({
  plugins: [googleAI()],
  // Definimos Gemini 2.5 Flash como modelo por defecto para velocidad y estabilidad en producción
  model: 'googleai/gemini-2.5-flash', 
});
