import React from 'react';
import { Kanit, Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '../components/ui/toaster';
import { cn } from '../lib/utils';
import { FirebaseClientProvider } from '../firebase/client-provider';

const kanit = Kanit({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-kanit',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata = {
  title: 'Athleticenter Pro',
  description: 'Gestión B2B de alto rendimiento para distribuidores deportivos.',
};

/**
 * ROOT LAYOUT v216.0.0
 * Saneado: Se eliminan dependencias de iconos estáticos para cumplir con la validación de Google App Hosting.
 * La identidad visual se gestiona dinámicamente mediante /api/manifest.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={cn(kanit.variable, inter.variable)}>
      <head>
        <link rel="manifest" href="/api/manifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Athleticenter Pro" />
        <meta name="theme-color" content="#0F172A" />
      </head>
      <body className="antialiased bg-background overflow-x-hidden">
        <FirebaseClientProvider>
            {children}
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
