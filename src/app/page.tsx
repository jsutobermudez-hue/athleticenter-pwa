import { redirect } from 'next/navigation';

/**
 * ENTRY POINT v1.5.0 - PROTOCOLO DE LANZAMIENTO
 * Saneamiento de redirección para forzar la regeneración del manifiesto de Webpack 
 * y asegurar que el middleware de Auth tome el control.
 */
export default function HomePage() {
  redirect('/dashboard');
}
