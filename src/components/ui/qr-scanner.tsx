
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Camera, X, Loader2, RefreshCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

/**
 * ESCÁNER QR TÁCTICO v1.0
 * Utiliza la API nativa de cámara para confirmación de picking.
 */
export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const getCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        setHasCameraPermission(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        toast({
          variant: 'destructive',
          title: 'Acceso a Cámara Denegado',
          description: 'Por favor, habilita los permisos en tu navegador.',
        });
      }
    };

    getCameraPermission();

    // Limpieza al desmontar
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [toast]);

  const handleManualClose = () => {
    setIsScanning(false);
    onClose();
  };

  // Simulación de escaneo (Para entorno de prototipo donde no hay decodificador JS pesado instalado)
  // En producción se integraría 'jsqr' o 'html5-qrcode'
  const simulateScan = () => {
      toast({ title: "Simulación de Escaneo", description: "Buscando SKU en el campo de visión..." });
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="relative w-full max-w-md aspect-square rounded-[3rem] overflow-hidden border-4 border-primary/20 shadow-2xl">
        <video 
            ref={videoRef} 
            className="w-full h-full object-cover" 
            autoPlay 
            muted 
            playsInline
        />
        
        {/* Overlay de Enfoque */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 border-2 border-white/50 rounded-3xl relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-xl" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-xl" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-xl" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-xl" />
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-primary/30 animate-pulse shadow-[0_0_15px_rgba(37,99,235,0.5)]" />
            </div>
        </div>

        {hasCameraPermission === false && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 p-8 text-center text-white gap-4">
                <ShieldCheck className="h-12 w-12 text-rose-500" />
                <p className="text-sm font-black uppercase tracking-widest">Cámara bloqueada por el sistema</p>
                <Button variant="outline" className="text-white border-white/20" onClick={() => window.location.reload()}>Reintentar</Button>
            </div>
        )}
      </div>

      <div className="mt-10 flex flex-col items-center gap-6 w-full max-w-sm">
        <div className="space-y-1 text-center">
            <h3 className="text-white text-xl font-black uppercase tracking-tighter">Escáner Logístico</h3>
            <p className="text-white/40 text-[9px] font-bold uppercase tracking-[0.3em]">Apunta al código del producto para confirmar</p>
        </div>
        
        <div className="grid grid-cols-2 gap-4 w-full">
            <Button variant="outline" onClick={handleManualClose} className="h-14 rounded-2xl border-white/10 text-white hover:bg-white/5 font-black uppercase text-[10px]">
                <X className="mr-2 h-4 w-4" /> Cancelar
            </Button>
            <Button onClick={simulateScan} className="h-14 rounded-2xl bg-primary text-white font-black uppercase text-[10px] shadow-xl">
                <RefreshCw className="mr-2 h-4 w-4" /> Re-enfocar
            </Button>
        </div>
      </div>
    </div>
  );
}
