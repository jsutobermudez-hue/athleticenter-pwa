import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Compresión de imágenes en cliente para PWA (Optimiza cámara y ancho de banda en redes móviles)
 */
export async function compressImage(file: File, maxWidth = 1200, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : resolve(file)),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => resolve(file);
  });
}

const SALESPERSON_CANONICAL_MAP: Record<string, string> = {
  'FABIO GINES': 'FABIO GINÉS',
  'FABIO GINEZ': 'FABIO GINÉS',
  'JUAN PAZ': 'JUAN PAZ',
  'LUIS ALBERTO GIMENEZ': 'LUIS ALBERTO GIMÉNEZ',
  'ERNESTO ORTEGA': 'ERNESTO ORTEGA',
  'YENY HERNANDEZ': 'YENY HERNÁNDEZ'
};

export function normalizeSalespersonName(name: string | null | undefined): string {
  if (!name || !name.trim()) return 'Venta Directa / Oficina Central';
  const clean = name.trim();
  const upper = clean.toUpperCase();
  return SALESPERSON_CANONICAL_MAP[clean] || SALESPERSON_CANONICAL_MAP[upper] || clean;
}

/**
 * Retorna la fecha actual o dada en zona horaria de Venezuela (America/Caracas, UTC-4)
 * en formato YYYY-MM-DD, evitando saltos de fecha nocturnos producidos por toISOString (UTC).
 */
export function getCaracasDateString(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d);
  } catch {
    return d.toISOString().split('T')[0];
  }
}

/**
 * Generador de códigos únicos de pedidos y cotizaciones con alta resistencia a colisiones.
 * Formato: PREFIJO-ACRÓNIMO-TIMESTAMP36-RANDOM
 */
export function generateSecureEntityCode(prefix: string, acronym: string): string {
  const cleanAcronym = (acronym || 'CLI').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const cleanPrefix = (prefix || 'P').toUpperCase();
  const timeHex = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(100 + Math.random() * 900);
  return `${cleanPrefix}-${cleanAcronym}-${timeHex}-${rand}`;
}

