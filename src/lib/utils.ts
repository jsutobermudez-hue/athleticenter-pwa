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

