'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../../hooks/use-toast';
import { Button } from './button';
import { X, Loader2, CloudUpload, ShieldCheck, ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Label } from './label';
import { Badge } from './badge';
import { useStorage, useAuth } from '@/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const MAX_INITIAL_BYTES = 25 * 1024 * 1024;
const MAX_STORAGE_IMAGE_BYTES = 15 * 1024 * 1024;
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const MAX_DIMENSION_PX = 1920;

const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

function resolveImageMime(file: File): string | null {
  if (file.type && file.type.startsWith('image/')) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXT_MIME[ext] || null;
}

async function normalizeImageForUpload(
  file: File,
  detectedMime: string
): Promise<{ blob: Blob; contentType: string; ext: string }> {
  const origExt = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  if (detectedMime === 'image/gif') {
    return { blob: file, contentType: detectedMime, ext: 'gif' };
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const needsResize = img.width > MAX_DIMENSION_PX || img.height > MAX_DIMENSION_PX;
        const needsCompress = file.size > COMPRESS_THRESHOLD_BYTES || needsResize;
        if (!needsCompress) {
          URL.revokeObjectURL(objectUrl);
          resolve({ blob: file, contentType: detectedMime, ext: origExt });
          return;
        }
        const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(img.width, img.height));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve({ blob: file, contentType: detectedMime, ext: origExt });
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        canvas.toBlob(
          (outBlob) => {
            URL.revokeObjectURL(objectUrl);
            if (outBlob && (outBlob.size < file.size || needsResize)) {
              resolve({ blob: outBlob, contentType: 'image/jpeg', ext: 'jpg' });
            } else {
              resolve({ blob: file, contentType: detectedMime, ext: origExt });
            }
          },
          'image/jpeg',
          0.84
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve({ blob: file, contentType: detectedMime, ext: origExt });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ blob: file, contentType: detectedMime, ext: origExt });
    };
    img.src = objectUrl;
  });
}

/**
 * CARGADOR DE ACTIVOS PROFESIONAL v4.0
 * Soporta clic desde carpeta, arrastrar y soltar (Drag & Drop) y pegar (Ctrl+V),
 * con compresión automática en navegador y subida reanudable con porcentaje en vivo.
 */
export function ImageUploader({
  folderPath = 'general',
  initialImageUrl,
  onImageUploaded,
  onUploadingChange,
  label = "Imagen",
  variant = 'rectangle'
}: {
  folderPath?: string;
  initialImageUrl?: string | null;
  onImageUploaded: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  label?: string;
  variant?: 'rectangle' | 'avatar';
}) {
  const { toast } = useToast();
  const storage = useStorage();
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initialImageUrl || null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setImagePreview(initialImageUrl || null);
  }, [initialImageUrl]);

  const processAndUploadFile = useCallback(async (file: File) => {
    if (!file || !storage || !auth || isLoading) return;

    if (!auth.currentUser) {
      toast({
        variant: 'destructive',
        title: 'Sesión no detectada',
        description: 'Debe estar autenticado para cargar archivos. Intente re-ingresar al sistema.'
      });
      return;
    }

    const detectedMime = resolveImageMime(file);
    if (!detectedMime) {
      toast({
        variant: 'destructive',
        title: 'Formato no válido',
        description: 'Solo se permiten archivos de imagen (JPG, PNG, WEBP).'
      });
      return;
    }

    if (file.size > MAX_INITIAL_BYTES) {
      toast({
        variant: 'destructive',
        title: 'Archivo muy pesado',
        description: 'El archivo original supera los 25 MB permitidos.'
      });
      return;
    }

    setIsLoading(true);
    setUploadProgress(0);
    onUploadingChange?.(true);

    try {
      const { blob, contentType, ext } = await normalizeImageForUpload(file, detectedMime);

      if (blob.size >= MAX_STORAGE_IMAGE_BYTES) {
        toast({
          variant: 'destructive',
          title: 'Imagen supera límite',
          description: 'La imagen supera el límite de 15 MB incluso tras compresión.'
        });
        return;
      }

      const rawBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40) || 'imagen';
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${rawBase}.${ext}`;
      const storageRef = ref(storage, `${folderPath}/${uniqueName}`);

      const snapshot = await new Promise<any>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, { contentType });
        task.on(
          'state_changed',
          (snap) => {
            if (snap.totalBytes > 0) {
              setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
            }
          },
          reject,
          () => resolve(task.snapshot)
        );
      });

      const downloadURL = await getDownloadURL(snapshot.ref);
      setImagePreview(downloadURL);
      onImageUploaded(downloadURL);

      toast({
        title: 'Activo Sincronizado',
        description: 'Imagen cargada exitosamente.'
      });
    } catch (err: any) {
      console.error("[Storage Error]", err);
      let errorMsg = 'No se pudo subir la imagen.';
      if (err?.code === 'storage/unauthorized') {
        errorMsg = 'Error de permisos: Su sesión no tiene autorización para escribir en esta carpeta.';
      }
      toast({
        variant: 'destructive',
        title: 'Error de Almacenamiento',
        description: errorMsg
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setIsLoading(false);
      setUploadProgress(0);
      onUploadingChange?.(false);
    }
  }, [storage, auth, isLoading, folderPath, onImageUploaded, onUploadingChange, toast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processAndUploadFile(file);
  }, [processAndUploadFile]);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) setIsDragging(true);
  }, [isLoading]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading && !isDragging) setIsDragging(true);
  }, [isLoading, isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isLoading) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) void processAndUploadFile(file);
  }, [isLoading, processAndUploadFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isLoading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          void processAndUploadFile(file);
          return;
        }
      }
    }
  }, [isLoading, processAndUploadFile]);

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

      <div
        tabIndex={0}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-[1.8rem] border-2 border-dashed transition-all overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          variant === 'rectangle' ? "min-h-[160px] w-full" : "mx-auto h-40 w-40 rounded-full",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01] shadow-inner"
            : imagePreview
              ? "border-emerald-500/30 bg-emerald-50/10"
              : "border-slate-200 bg-slate-50 hover:border-slate-300",
          isLoading && "opacity-70"
        )}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-[9px] font-black uppercase text-primary tracking-widest">
              Sincronizando {uploadProgress}%...
            </p>
          </div>
        ) : isDragging ? (
          <div className="flex flex-col items-center gap-2 p-6 pointer-events-none">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary">
              <CloudUpload className="h-7 w-7 animate-bounce" />
            </div>
            <p className="text-[10px] font-black uppercase text-primary tracking-wider">Suelta la imagen aquí</p>
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
            <p className="text-[10px] font-black uppercase text-slate-600 mt-2 text-center">
              Haz clic, arrastra una foto o pega (Ctrl+V)
            </p>
            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest text-center px-4">
              JPG, PNG o WEBP · Compresión automática (máx. 15 MB)
            </p>
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
