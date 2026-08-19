/**
 * UTILIDAD CORPORATIVA DE CAPTURA Y EXPORTACIÓN DE GRÁFICOS A PDF (v1.0.0)
 * Permite convertir cualquier SVG / Recharts en imagen PNG de alta definición
 * e insertarlo en los reportes ejecutivos PDF oficiales de Athleticenter.
 */

export async function captureSvgAsPng(containerId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const svgElement = container.querySelector('svg');
    if (!svgElement) return null;

    // Clonamos el SVG para asegurarnos de incluir estilos explícitos de tipografía y colores
    const svgClone = svgElement.cloneNode(true) as SVGElement;
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const width = (svgElement.clientWidth || 800) * 2;
        const height = (svgElement.clientHeight || 400) * 2;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/png');
          URL.revokeObjectURL(blobURL);
          resolve(dataUrl);
        } else {
          URL.revokeObjectURL(blobURL);
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobURL);
        resolve(null);
      };
      img.src = blobURL;
    });
  } catch (e) {
    console.warn('[chart-pdf-exporter] Error al capturar SVG:', e);
    return null;
  }
}
