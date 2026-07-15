'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../../hooks/use-toast';
import { Button } from './button';
import { X, Loader2, CloudUpload, ShieldCheck, ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Label } from './label';
import { Badge } from './badge';
import { useStorage, useAuth } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * CARGADOR DE ACTIVOS PROFESIONAL v3.5
 * Sincronizado: Validación de sesión reforzada y logs de auditoría para depuración de permisos.
 */
export function ImageUploader({
  folderPath = 'general', 
  initialImageUrl,
  onImageUploaded,
  label = "Imagen",
  variant = 'rectangle'
}: {
  folderPath?: string; 
  initialImageUrl?: string | null;
  onImageUploaded: (url: string) => void;
  label?: string;
  variant?: 'rectangle' | 'avatar';
}) {
  const { toast } = useToast();
  const storage = useStorage();
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialImageUrl || null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setImagePreview(initialImageUrl || null);
  }, [initialImageUrl]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storage || !auth) return;

    // Validación de seguridad previa: Evita storage/unauthorized antes de subir
    if (!auth.currentUser) {
        console.warn("[Storage] Intento de subida fallido: No se detectó una sesión activa.");
        toast({ 
            variant: 'destructive', 
            title: 'Sesión no detectada', 
            description: 'Debe estar autenticado para cargar archivos. Intente re-ingresar al sistema.' 
        });
        return;
    }

    console.log(`[Storage] Iniciando subida a carpeta '${folderPath}' para usuario: ${auth.currentUser.uid}`);

    setIsLoading(true);
    try {
      const fileName = `${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase()}`;
      const storageRef = ref(storage, `${folderPath}/${fileName}`);
      
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      console.log("[Storage] Subida exitosa. URL generada.");
      
      setImagePreview(downloadURL);
      onImageUploaded(downloadURL);
      
      toast({ 
        title: 'Activo Sincronizado', 
        description: 'Imagen cargada exitosamente.' 
      });
    } catch (err: any) {
      console.error("[Storage Error]", err);
      let errorMsg = 'No se pudo subir la imagen.';
      
      if (err.code === 'storage/unauthorized') {
          errorMsg = 'Error de permisos: Su sesión no tiene autorización para escribir en esta carpeta. Verifique las reglas de seguridad.';
      }

      toast({ 
        variant: 'destructive', 
        title: 'Error de Almacenamiento', 
        description: errorMsg 
      });
    } finally {
      setIsLoading(false);
    }
  }, [onImageUploaded, toast, storage, auth, folderPath]);

  const clearImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setImagePreview(null);
    onImageUploaded('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center justify-between px-1">
        <Label className="text-[10px] font-black uppercase text-slate-400">{label}</Label>
        <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Protocolo Seguro</span>
        </div>
      </div>
      
      <div className={cn(
          "relative flex flex-col items-center justify-center rounded-[1.8rem] border-2 border-dashed transition-all overflow-hidden",
          variant === 'rectangle' ? "min-h-[160px] w-full" : "mx-auto h-40 w-40 rounded-full",
          imagePreview ? "border-emerald-500/30 bg-emerald-50/10" : "border-slate-200 bg-slate-50",
          isLoading && "opacity-50"
      )}>
        {isLoading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-[8px] font-black uppercase text-primary tracking-widest">Sincronizando...</p>
          </div>
        ) : imagePreview ? (
          <>
            <img src={imagePreview} alt="Preview" className="h-full w-full object-contain p-2 max-h-40" />
            <Button 
                type="button" 
                variant="destructive" 
                size="icon" 
                className="absolute right-3 top-3 h-8 w-8 rounded-full z-10 shadow-xl" 
                onClick={clearImage}
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                <Badge className="bg-emerald-500 text-white border-none text-[7px] font-black uppercase h-4">CLOUDHUB OK</Badge>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 cursor-pointer relative w-full h-full group">
            <div className="p-3 rounded-2xl bg-white shadow-sm group-hover:scale-110 transition-transform">
                <CloudUpload className="h-7 w-7 text-slate-400" />
            </div>
            <p className="text-[10px] font-black uppercase text-slate-500 mt-2">Cargar Activo</p>
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest text-center px-4">JPG, PNG o WEBP - MÁX 5MB</p>
            <input 
                ref={fileInputRef} 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                accept="image/*" 
                onChange={handleFileChange} 
                disabled={isLoading} 
            />
          </div>
        )}
      </div>
    </div>
  );
}
