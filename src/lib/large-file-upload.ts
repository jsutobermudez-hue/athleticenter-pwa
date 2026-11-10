'use client';

import { ref, uploadBytesResumable, getDownloadURL, type FirebaseStorage } from 'firebase/storage';

export interface LargeUploadResult {
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Sube catálogos PDF o archivos multimedia pesados (hasta 250 MB) directamente a Firebase Cloud Storage
 * mediante subida reanudable por bloques (uploadBytesResumable), evitando límites de 1 MB de Firestore
 * y de 32 MB de Cloud Run, y reportando porcentaje de progreso en tiempo real.
 */
export function uploadLargeFileToStorage(params: {
  storage: FirebaseStorage;
  folder: 'catalogs' | 'broadcast-media' | 'competitor-catalogs';
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<LargeUploadResult> {
  const { storage, folder, file, onProgress } = params;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  const contentType =
    file.type ||
    (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  return new Promise<LargeUploadResult>((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, { contentType });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (error) => {
        reject(error);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          if (onProgress) onProgress(100);
          resolve({
            downloadUrl,
            storagePath,
            fileName: safeName,
            sizeBytes: file.size,
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}
